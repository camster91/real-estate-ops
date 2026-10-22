import { randomBytes } from "node:crypto";
import type { AuthConfig } from "@reo/config";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import {
	hashToken,
	requireSession,
	SESSION_COOKIE,
	sessionHash,
	sessionToken,
} from "./guard.js";
import {
	createOidcLogin,
	LoginRejectedError,
	type OidcLogin,
	type ProviderName,
} from "./oidc.js";

export interface AuthOptions {
	/** Pool logged in as a reo_app member; only the session functions are used. */
	pool: pg.Pool;
	config: AuthConfig;
	/** Allows a plain-HTTP issuer. Tests only. */
	allowInsecureIssuer?: boolean;
}

const LOGIN_COOKIE = "__Host-reo_login";
const LOGIN_TTL_SECONDS = 600;

// __Host- cookies must be Secure, Path=/ and have no Domain.
const cookieBase = {
	httpOnly: true,
	secure: true,
	sameSite: "lax",
	path: "/",
} as const;

interface PendingLogin {
	provider: ProviderName;
	state: string;
	nonce: string;
	codeVerifier: string;
	issuedAt: number;
}

function readPendingLogin(
	request: FastifyRequest,
	provider: ProviderName,
): PendingLogin | undefined {
	const raw = request.cookies[LOGIN_COOKIE];
	if (!raw) return undefined;
	const unsigned = request.unsignCookie(raw);
	if (!unsigned.valid || unsigned.value === null) return undefined;
	let data: Partial<PendingLogin>;
	try {
		data = JSON.parse(unsigned.value);
	} catch {
		return undefined;
	}
	const age = Date.now() - (data.issuedAt ?? 0);
	if (
		data.provider !== provider ||
		typeof data.state !== "string" ||
		typeof data.nonce !== "string" ||
		typeof data.codeVerifier !== "string" ||
		typeof data.issuedAt !== "number" ||
		age < 0 ||
		age > LOGIN_TTL_SECONDS * 1000
	)
		return undefined;
	return data as PendingLogin;
}

/**
 * Sends a failed sign-in back to the website's sign-in page with a fixed
 * reason code. No session is set and nothing else is shown (ADR 0016).
 */
const signInFailed = (
	reply: FastifyReply,
	reason: "failed" | "no_access" | "unavailable",
) =>
	reply.header("cache-control", "no-store").redirect(`/?signin=${reason}`, 302);

/**
 * Login, callback, logout and /v1/session. Routes exist only for configured
 * providers. Logs carry an outcome code and never tokens, codes or claims.
 * Expects @fastify/cookie to be registered with `config.cookieSecret`.
 */
export async function registerAuthRoutes(
	app: FastifyInstance,
	options: AuthOptions,
): Promise<void> {
	const { pool, config } = options;

	// Discovery runs on first use and is retried after a failure, so a provider
	// outage does not stop the API from starting.
	const logins = new Map<ProviderName, Promise<OidcLogin>>();
	const providers = new Map(config.providers.map((p) => [p.name, p]));
	const loginFor = (name: ProviderName) => {
		let login = logins.get(name);
		if (!login) {
			const provider = providers.get(name);
			if (!provider) throw new Error(`Unknown provider ${name}`);
			login = createOidcLogin(
				{
					...provider,
					redirectUri: `${config.publicUrl}/auth/${name}/callback`,
				},
				{ allowInsecure: options.allowInsecureIssuer === true },
			);
			login.catch(() => logins.delete(name));
			logins.set(name, login);
		}
		return login;
	};

	for (const name of providers.keys()) {
		app.get(`/auth/${name}/login`, async (_request, reply) => {
			const start = await (await loginFor(name)).start();
			const pending: PendingLogin = {
				provider: name,
				state: start.state,
				nonce: start.nonce,
				codeVerifier: start.codeVerifier,
				issuedAt: Date.now(),
			};
			return reply
				.setCookie(LOGIN_COOKIE, JSON.stringify(pending), {
					...cookieBase,
					signed: true,
					maxAge: LOGIN_TTL_SECONDS,
				})
				.header("cache-control", "no-store")
				.redirect(start.url, 302);
		});

		app.get(`/auth/${name}/callback`, async (request, reply) => {
			const pending = readPendingLogin(request, name);
			// The login cookie is single use whatever the outcome.
			reply.clearCookie(LOGIN_COOKIE, cookieBase);
			if (!pending) {
				request.log.info({ outcome: "login_cookie_invalid" }, "login");
				return signInFailed(reply, "failed");
			}
			// Claimed before the code is redeemed, so a replay fails here even if
			// the provider would accept the same code again.
			const claimed = await pool.query<{ claimed: boolean | null }>(
				"SELECT app.claim_login_state($1) AS claimed",
				[hashToken(pending.state)],
			);
			if (claimed.rows[0]?.claimed !== true) {
				request.log.info({ outcome: "login_state_reused" }, "login");
				return signInFailed(reply, "failed");
			}
			let identity: { issuer: string; subject: string };
			try {
				identity = await (await loginFor(name)).finish(
					new URL(request.url, config.publicUrl),
					pending,
				);
			} catch (error) {
				if (!(error instanceof LoginRejectedError)) throw error;
				request.log.info(
					{ outcome: error.reason, code: error.detail },
					"login",
				);
				if (error.reason === "provider_unavailable")
					return signInFailed(reply, "unavailable");
				return signInFailed(reply, "failed");
			}
			const { rows } = await pool.query<{ id: string | null }>(
				"SELECT app.resolve_principal($1, $2) AS id",
				[identity.issuer, identity.subject],
			);
			const principal = rows[0]?.id ?? null;
			const token = randomBytes(32).toString("base64url");
			const opened = principal
				? await pool.query<{ expires_at: Date | null }>(
						"SELECT app.open_session($1, $2) AS expires_at",
						[principal, hashToken(token)],
					)
				: undefined;
			const expiresAt = opened?.rows[0]?.expires_at ?? null;
			if (!expiresAt) {
				request.log.info({ outcome: "no_access" }, "login");
				return signInFailed(reply, "no_access");
			}
			// A session cookie already in the browser is replaced, so an earlier
			// token that may have leaked stops working at the next sign-in.
			const previous = sessionHash(request);
			if (previous)
				await pool.query("SELECT app.close_session($1)", [previous]);
			request.log.info({ outcome: "signed_in" }, "login");
			return reply
				.setCookie(SESSION_COOKIE, token, { ...cookieBase, expires: expiresAt })
				.header("cache-control", "no-store")
				.redirect("/", 302);
		});
	}

	app.post("/auth/logout", async (request, reply) => {
		const token = sessionToken(request);
		if (token)
			await pool.query("SELECT app.close_session($1)", [hashToken(token)]);
		request.log.info({ outcome: "signed_out" }, "logout");
		return reply.clearCookie(SESSION_COOKIE, cookieBase).code(204).send();
	});

	app.get(
		"/v1/session",
		{ preHandler: requireSession(pool) },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const memberships = await pool.query<{
				organization_id: string;
				name: string;
			}>("SELECT organization_id, name FROM app.session_organizations($1)", [
				sessionHash(request),
			]);
			return {
				principalId: request.principalId,
				memberships: memberships.rows.map((row) => ({
					organizationId: row.organization_id,
					name: row.name,
				})),
			};
		},
	);
}
