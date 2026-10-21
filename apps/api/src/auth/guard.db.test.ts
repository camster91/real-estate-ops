import { type AuthConfig, readAuthConfig } from "@reo/config";
import {
	createTestDatabase,
	type SeedIds,
	seedTwoTenants,
	type TestDatabase,
} from "@reo/db/testing";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../server.js";
import { type FakeIssuer, startFakeIssuer } from "./fake-issuer.js";
import { requireSession } from "./guard.js";
import { PUBLIC_URL, SESSION_COOKIE, signInAs } from "./testing.js";

let db: TestDatabase;
let ids: SeedIds;
let fake: FakeIssuer;
let app: FastifyInstance;

const session = (token: string) =>
	app.inject({ url: "/v1/session", cookies: { [SESSION_COOKIE]: token } });

beforeAll(async () => {
	db = await createTestDatabase();
	ids = await seedTwoTenants(db.admin);
	fake = await startFakeIssuer();
	await db.admin.query("UPDATE principal SET oidc_issuer = $1", [fake.issuer]);
	const config = readAuthConfig({
		NODE_ENV: "test",
		REO_PUBLIC_URL: PUBLIC_URL,
		REO_LOGIN_COOKIE_SECRET: "synthetic-cookie-secret-0123456789abcdef",
		REO_GOOGLE_CLIENT_ID: fake.clientId,
		REO_GOOGLE_CLIENT_SECRET: fake.clientSecret,
		REO_TEST_OIDC_ISSUER: fake.issuer,
	}) as AuthConfig;
	const pool = db.app as pg.Pool;
	app = createServer({ auth: { pool, config, allowInsecureIssuer: true } });
	app.get(
		"/v1/test/whoami",
		{ preHandler: requireSession(pool) },
		async (request) => ({ principalId: request.principalId }),
	);
});

afterAll(async () => {
	await app?.close();
	await fake?.close();
	await db?.drop();
});

describe("origin guard", () => {
	it.each<[string, Record<string, string>]>([
		["no Origin", {}],
		["a foreign Origin", { origin: "http://evil.invalid" }],
		["a trailing slash", { origin: `${PUBLIC_URL}/` }],
		["Origin null", { origin: "null" }],
	])("logout with %s is refused", async (_label, headers) => {
		const token = await signInAs(app, fake, "synthetic-a");
		const response = await app.inject({
			method: "POST",
			url: "/auth/logout",
			headers,
			cookies: { [SESSION_COOKIE]: token },
		});
		expect(response.statusCode).toBe(403);
		expect(response.json()).toEqual({ error: "forbidden_origin" });
		expect((await session(token)).statusCode).toBe(200);
	});

	it("same-origin logout works", async () => {
		const token = await signInAs(app, fake, "synthetic-a");
		const response = await app.inject({
			method: "POST",
			url: "/auth/logout",
			headers: { origin: PUBLIC_URL },
			cookies: { [SESSION_COOKIE]: token },
		});
		expect(response.statusCode).toBe(204);
		expect((await session(token)).statusCode).toBe(401);
	});

	it("unsafe /v1 methods need the origin", async () => {
		const token = await signInAs(app, fake, "synthetic-a");
		const cookies = { [SESSION_COOKIE]: token };
		for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
			const bare = await app.inject({ method, url: "/v1/contacts", cookies });
			expect(bare.statusCode, method).toBe(403);
			const same = await app.inject({
				method,
				url: "/v1/contacts",
				cookies,
				headers: { origin: PUBLIC_URL },
			});
			expect(same.statusCode, method).toBe(401);
		}
	});

	it("safe methods are not origin-checked", async () => {
		const token = await signInAs(app, fake, "synthetic-a");
		expect((await session(token)).statusCode).toBe(200);
	});
});

describe("requireSession", () => {
	it("sets the principal or refuses", async () => {
		const token = await signInAs(app, fake, "synthetic-a");
		const me = await app.inject({
			url: "/v1/test/whoami",
			cookies: { [SESSION_COOKIE]: token },
		});
		expect(me.statusCode).toBe(200);
		expect(me.json()).toEqual({ principalId: ids.pa });
		const none = await app.inject("/v1/test/whoami");
		expect(none.statusCode).toBe(401);
		expect(none.headers["cache-control"]).toBe("no-store");
		expect(none.json()).toEqual({ error: "authentication_required" });
	});
});
