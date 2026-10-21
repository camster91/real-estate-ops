// Test-only helpers for HTTP login tests. Excluded from the build.
import type { FastifyInstance } from "fastify";
import type { FakeIssuer } from "./fake-issuer.js";
import { SESSION_COOKIE } from "./guard.js";

export const PUBLIC_URL = "http://127.0.0.1:4000";
export { SESSION_COOKIE } from "./guard.js";

/** Full login through the fake issuer; returns the session token. */
export async function signInAs(
	app: FastifyInstance,
	fake: FakeIssuer,
	subject: string,
): Promise<string> {
	fake.mint({ sub: subject });
	const start = await app.inject("/auth/google/login");
	const login = start.cookies.find((c) => c.name === "__Host-reo_login");
	const authorize = await fetch(start.headers.location as string, {
		redirect: "manual",
	});
	const back = new URL(authorize.headers.get("location") as string);
	const callback = await app.inject({
		url: `${back.pathname}${back.search}`,
		cookies: { "__Host-reo_login": login?.value ?? "" },
	});
	const session = callback.cookies.find(
		(c) => c.name === SESSION_COOKIE && c.value,
	);
	if (!session) throw new Error(`login failed: ${callback.statusCode}`);
	return session.value;
}
