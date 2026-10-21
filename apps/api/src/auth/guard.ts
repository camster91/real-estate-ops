import { createHash } from "node:crypto";
import type {
	FastifyReply,
	FastifyRequest,
	onRequestAsyncHookHandler,
	preHandlerAsyncHookHandler,
} from "fastify";
import type pg from "pg";

declare module "fastify" {
	interface FastifyRequest {
		/** The verified principal; set only by requireSession. */
		principalId?: string;
	}
}

export const SESSION_COOKIE = "__Host-reo_session";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const hashToken = (token: string) =>
	createHash("sha256").update(token).digest();

/** The well-formed session token from the cookie, if any. */
export function sessionToken(request: FastifyRequest): string | undefined {
	const token = request.cookies[SESSION_COOKIE];
	return token && TOKEN.test(token) ? token : undefined;
}

/** SHA-256 of a well-formed session cookie, as stored by the database. */
export function sessionHash(request: FastifyRequest): Buffer | undefined {
	const token = sessionToken(request);
	return token ? hashToken(token) : undefined;
}

const unauthenticated = (reply: FastifyReply) =>
	reply
		.code(401)
		.header("cache-control", "no-store")
		.send({ error: "authentication_required" });

/**
 * Turns a live session cookie into `request.principalId`, or replies 401.
 * Each call refreshes the session's idle timer.
 */
export function requireSession(pool: pg.Pool): preHandlerAsyncHookHandler {
	return async (request, reply) => {
		const hash = sessionHash(request);
		const principal = hash
			? (
					await pool.query<{ id: string | null }>(
						"SELECT app.session_principal($1) AS id",
						[hash],
					)
				).rows[0]?.id
			: null;
		if (!principal) return unauthenticated(reply);
		request.principalId = principal;
	};
}

/**
 * CSRF defence for cookie-authenticated writes: any method other than GET,
 * HEAD and OPTIONS on /v1/* or /auth/logout must carry an Origin equal to
 * the public URL. Browsers send Origin on cross-site and same-site POSTs.
 */
export function originGuard(publicUrl: string): onRequestAsyncHookHandler {
	return async (request, reply) => {
		if (SAFE_METHODS.has(request.method)) return;
		const path = request.url.split("?")[0] ?? "";
		if (!path.startsWith("/v1/") && path !== "/auth/logout") return;
		if (request.headers.origin === publicUrl) return;
		request.log.info({ outcome: "forbidden_origin" }, "request refused");
		return reply
			.code(403)
			.header("cache-control", "no-store")
			.send({ error: "forbidden_origin" });
	};
}
