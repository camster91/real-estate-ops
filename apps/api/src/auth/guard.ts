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
	interface FastifyContextConfig {
		/** Opt a route out of the Origin check (e.g. a signed provider webhook). */
		allowCrossOrigin?: boolean;
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
 * CSRF defence for cookie-authenticated writes: every method other than GET,
 * HEAD and OPTIONS must carry an Origin equal to the public URL, whatever the
 * path. Matching on the raw path would miss encoded spellings such as
 * /auth/%6Cogout, which the router decodes. A route can opt out only through
 * its own `config.allowCrossOrigin`. Browsers send Origin on every POST.
 */
export function originGuard(publicUrl: string): onRequestAsyncHookHandler {
	return async (request, reply) => {
		if (SAFE_METHODS.has(request.method)) return;
		if (request.routeOptions.config?.allowCrossOrigin === true) return;
		if (request.headers.origin === publicUrl) return;
		request.log.info({ outcome: "forbidden_origin" }, "request refused");
		return reply
			.code(403)
			.header("cache-control", "no-store")
			.send({ error: "forbidden_origin" });
	};
}
