import { type AuthConfig, readAuthConfig } from "@reo/config";
import {
	createTestDatabase,
	type SeedIds,
	seedTwoTenants,
	type TestDatabase,
} from "@reo/db/testing";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer } from "../server.js";
import { type FakeIssuer, startFakeIssuer } from "./fake-issuer.js";

let db: TestDatabase;
let ids: SeedIds;
let fake: FakeIssuer;
let config: AuthConfig;
let app: FastifyInstance;

const LOGIN = "__Host-reo_login";
const SESSION = "__Host-reo_session";

interface Cookie {
	name: string;
	value: string;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: string;
	path?: string;
	maxAge?: number;
}

const cookieOf = (
	response: { cookies: Cookie[] },
	name: string,
): Cookie | undefined =>
	response.cookies.find((cookie) => cookie.name === name && cookie.value);

const sessionCount = async () =>
	(await db.admin.query("SELECT count(*)::int AS n FROM auth_session")).rows[0]
		.n as number;

/** Login start + fake provider round trip; returns the callback path and login cookie. */
async function beginLogin(provider = "google") {
	const start = await app.inject(`/auth/${provider}/login`);
	expect(start.statusCode).toBe(302);
	const login = cookieOf(start, LOGIN) as Cookie;
	const authorize = await fetch(start.headers.location as string, {
		redirect: "manual",
	});
	const callback = new URL(authorize.headers.get("location") as string);
	return { path: `${callback.pathname}${callback.search}`, login };
}

const callback = (path: string, loginValue?: string) =>
	app.inject({
		url: path,
		...(loginValue ? { cookies: { [LOGIN]: loginValue } } : {}),
	});

async function signIn(subject = "synthetic-a") {
	fake.mint({ sub: subject });
	const { path, login } = await beginLogin();
	return callback(path, login.value);
}

const session = (token: string) =>
	app.inject({ url: "/v1/session", cookies: { [SESSION]: token } });

beforeAll(async () => {
	db = await createTestDatabase();
	ids = await seedTwoTenants(db.admin);
	fake = await startFakeIssuer();
	// The synthetic principals use the fake issuer's identity.
	await db.admin.query("UPDATE principal SET oidc_issuer = $1", [fake.issuer]);
	config = readAuthConfig({
		NODE_ENV: "test",
		REO_PUBLIC_URL: "http://127.0.0.1:4000",
		REO_LOGIN_COOKIE_SECRET: "synthetic-cookie-secret-0123456789abcdef",
		REO_GOOGLE_CLIENT_ID: fake.clientId,
		REO_GOOGLE_CLIENT_SECRET: fake.clientSecret,
		REO_MICROSOFT_CLIENT_ID: fake.clientId,
		REO_MICROSOFT_CLIENT_SECRET: fake.clientSecret,
		REO_MICROSOFT_TENANT_ID: "00000000-0000-4000-8000-000000000001",
		REO_TEST_OIDC_ISSUER: fake.issuer,
	}) as AuthConfig;
	app = createServer({
		auth: { pool: db.app as pg.Pool, config, allowInsecureIssuer: true },
	});
});

afterAll(async () => {
	await app?.close();
	await fake?.close();
	await db?.drop();
});

describe("login and sessions", () => {
	it("member logs in and sees their session", async () => {
		const start = await app.inject("/auth/google/login");
		expect(start.statusCode).toBe(302);
		expect(start.headers.location).toMatch(`${fake.issuer}/authorize?`);
		expect(cookieOf(start, LOGIN)).toMatchObject({
			httpOnly: true,
			secure: true,
			sameSite: "Lax",
			path: "/",
			maxAge: 600,
		});

		const response = await signIn();
		expect(response.statusCode).toBe(302);
		expect(response.headers.location).toBe("/");
		const cookie = cookieOf(response, SESSION) as Cookie;
		expect(cookie).toMatchObject({
			httpOnly: true,
			secure: true,
			sameSite: "Lax",
			path: "/",
		});
		expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
		// The login cookie is cleared.
		expect(response.cookies.find((c: Cookie) => c.name === LOGIN)?.value).toBe(
			"",
		);

		const me = await session(cookie.value);
		expect(me.statusCode).toBe(200);
		expect(me.headers["cache-control"]).toBe("no-store");
		expect(me.json()).toEqual({
			principalId: ids.pa,
			memberships: [{ organizationId: ids.orgA }],
		});
		// Only the hash is stored.
		const stored = await db.admin.query(
			"SELECT count(*)::int AS n FROM auth_session WHERE token_hash = sha256(convert_to($1, 'UTF8'))",
			[cookie.value],
		);
		expect(stored.rows[0].n).toBe(1);
	});

	it("non-member is refused", async () => {
		const before = await sessionCount();
		const response = await signIn("synthetic-c");
		expect(response.statusCode).toBe(403);
		expect(response.json()).toEqual({ error: "no_access" });
		expect(cookieOf(response, SESSION)).toBeUndefined();
		expect(await sessionCount()).toBe(before);
	});

	it("replayed callback is refused", async () => {
		fake.mint({});
		const { path, login } = await beginLogin();
		expect((await callback(path, login.value)).statusCode).toBe(302);
		const before = await sessionCount();
		const replay = await callback(path, login.value);
		expect(replay.statusCode).toBe(400);
		expect(replay.json()).toEqual({ error: "login_failed" });
		expect(cookieOf(replay, SESSION)).toBeUndefined();
		expect(await sessionCount()).toBe(before);
	});

	it("replay is refused even when the provider would redeem the code again", async () => {
		fake.allowCodeReuse(true);
		try {
			fake.mint({});
			const { path, login } = await beginLogin();
			expect((await callback(path, login.value)).statusCode).toBe(302);
			const before = await sessionCount();
			fake.mint({});
			const replay = await callback(path, login.value);
			expect(replay.statusCode).toBe(400);
			expect(replay.json()).toEqual({ error: "login_failed" });
			expect(cookieOf(replay, SESSION)).toBeUndefined();
			expect(await sessionCount()).toBe(before);
		} finally {
			fake.allowCodeReuse(false);
		}
	});

	it.each<[string, (login: Cookie) => string | undefined, string?]>([
		["a changed signature", (login) => `${login.value.slice(0, -2)}xx`],
		["no cookie", () => undefined],
		["a cookie for another provider", (login) => login.value, "microsoft"],
		[
			"an expired cookie",
			(login) => {
				const raw = app.unsignCookie(login.value).value as string;
				const data = JSON.parse(raw);
				data.issuedAt -= 601_000;
				return app.signCookie(JSON.stringify(data));
			},
		],
		[
			"an unsigned cookie",
			(login) => app.unsignCookie(login.value).value as string,
		],
	])("login with %s is refused", async (_label, change, provider) => {
		fake.mint({});
		const before = await sessionCount();
		const { path, login } = await beginLogin();
		const target = provider
			? path.replace("/auth/google/", `/auth/${provider}/`)
			: path;
		const response = await callback(target, change(login));
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({ error: "login_failed" });
		expect(cookieOf(response, SESSION)).toBeUndefined();
		expect(await sessionCount()).toBe(before);
	});

	it("a provider outage is 502 and opens no session", async () => {
		const gone = await startFakeIssuer();
		const outage = createServer({
			auth: {
				pool: db.app as pg.Pool,
				config: readAuthConfig({
					NODE_ENV: "test",
					REO_PUBLIC_URL: "http://127.0.0.1:4000",
					REO_LOGIN_COOKIE_SECRET: "synthetic-cookie-secret-0123456789abcdef",
					REO_GOOGLE_CLIENT_ID: gone.clientId,
					REO_GOOGLE_CLIENT_SECRET: gone.clientSecret,
					REO_TEST_OIDC_ISSUER: gone.issuer,
				}) as AuthConfig,
				allowInsecureIssuer: true,
			},
		});
		try {
			const start = await outage.inject("/auth/google/login");
			const login = cookieOf(start, LOGIN) as Cookie;
			const authorize = await fetch(start.headers.location as string, {
				redirect: "manual",
			});
			const back = new URL(authorize.headers.get("location") as string);
			await gone.close();
			const before = await sessionCount();
			const response = await outage.inject({
				url: `${back.pathname}${back.search}`,
				cookies: { [LOGIN]: login.value },
			});
			expect(response.statusCode).toBe(502);
			expect(response.json()).toEqual({ error: "login_unavailable" });
			expect(cookieOf(response, SESSION)).toBeUndefined();
			expect(await sessionCount()).toBe(before);
		} finally {
			await outage.close();
		}
	});

	it("logout revokes", async () => {
		const token = (cookieOf(await signIn(), SESSION) as Cookie).value;
		expect((await session(token)).statusCode).toBe(200);
		const logout = await app.inject({
			method: "POST",
			url: "/auth/logout",
			headers: { origin: "http://127.0.0.1:4000" },
			cookies: { [SESSION]: token },
		});
		expect(logout.statusCode).toBe(204);
		expect(logout.cookies.find((c: Cookie) => c.name === SESSION)?.value).toBe(
			"",
		);
		const after = await session(token);
		expect(after.statusCode).toBe(401);
		expect(after.json()).toEqual({ error: "authentication_required" });
	});

	it("membership loss ends the session", async () => {
		const token = (cookieOf(await signIn(), SESSION) as Cookie).value;
		const where = "organization_id = $1 AND principal_id = $2";
		await db.admin.query(
			`UPDATE membership SET status = 'suspended' WHERE ${where}`,
			[ids.orgA, ids.pa],
		);
		try {
			expect((await session(token)).statusCode).toBe(401);
		} finally {
			await db.admin.query(
				`UPDATE membership SET status = 'active' WHERE ${where}`,
				[ids.orgA, ids.pa],
			);
		}
		// Reinstating the membership does not revive the old session.
		expect((await session(token)).statusCode).toBe(401);
	});

	it.each([undefined, "not-a-token", "A".repeat(43)])(
		"session %s is unauthenticated",
		async (token) => {
			const response = await app.inject({
				url: "/v1/session",
				...(token ? { cookies: { [SESSION]: token } } : {}),
			});
			expect(response.statusCode).toBe(401);
		},
	);

	it("unconfigured provider is 404 and other /v1 routes stay 401", async () => {
		expect((await app.inject("/auth/github/login")).statusCode).toBe(404);
		expect((await app.inject("/auth/github/callback")).statusCode).toBe(404);
		const token = (cookieOf(await signIn(), SESSION) as Cookie).value;
		const other = await app.inject({
			url: "/v1/contacts",
			cookies: { [SESSION]: token },
		});
		expect(other.statusCode).toBe(401);

		const off = createServer();
		try {
			expect((await off.inject("/auth/google/login")).statusCode).toBe(404);
			expect((await off.inject("/v1/session")).statusCode).toBe(401);
		} finally {
			await off.close();
		}
	});

	it("logs carry no secrets", async () => {
		const lines: string[] = [];
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				lines.push(String(chunk));
				return true;
			});
		let token: string;
		let path: string;
		// The logger binds stdout when the server is created.
		const shared = app;
		app = createServer({
			auth: { pool: db.app as pg.Pool, config, allowInsecureIssuer: true },
		});
		try {
			fake.mint({ email: "someone@example.invalid" });
			const begun = await beginLogin();
			path = begun.path;
			const response = await callback(path, begun.login.value);
			token = (cookieOf(response, SESSION) as Cookie).value;
			await session(token);
			await signIn("synthetic-c");
			fake.mint({ nonce: "another-nonce" });
			const failed = await beginLogin();
			await callback(failed.path, failed.login.value);
		} finally {
			write.mockRestore();
			await app.close();
			app = shared;
		}
		const log = lines.join("");
		expect(log).toContain('"outcome":"signed_in"');
		expect(log).toContain('"outcome":"no_access"');
		expect(log).toMatch(/"outcome":"invalid_response","code":"[A-Z0-9_]+"/);
		const code = new URLSearchParams(path.split("?")[1]).get("code") as string;
		for (const secret of [token, code, "synthetic-a", "@", fake.clientSecret])
			expect(log).not.toContain(secret);
	});
});
