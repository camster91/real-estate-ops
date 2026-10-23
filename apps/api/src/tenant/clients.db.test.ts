import { randomUUID } from "node:crypto";
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
import { type FakeIssuer, startFakeIssuer } from "../auth/fake-issuer.js";
import { PUBLIC_URL, SESSION_COOKIE, signInAs } from "../auth/testing.js";
import { createServer } from "../server.js";

let db: TestDatabase;
let ids: SeedIds;
let fake: FakeIssuer;
let config: AuthConfig;
let app: FastifyInstance;
let pa2: string;
let tokenA: string;
let tokenA2: string;

const clientsUrl = (org: string) => `/v1/organizations/${org}/clients`;

const list = (token = tokenA, org = ids.orgA) =>
	app.inject({ url: clientsUrl(org), cookies: { [SESSION_COOKIE]: token } });

const detail = (id: string, token = tokenA, org = ids.orgA) =>
	app.inject({
		url: `${clientsUrl(org)}/${id}`,
		cookies: { [SESSION_COOKIE]: token },
	});

const post = (
	body: unknown,
	token = tokenA,
	org = ids.orgA,
	headers: Record<string, string> = { origin: PUBLIC_URL },
) =>
	app.inject({
		method: "POST",
		url: clientsUrl(org),
		cookies: { [SESSION_COOKIE]: token },
		headers,
		payload: body as Record<string, unknown>,
	});

const countWhere = async (table: string, where: string, params: unknown[]) =>
	(
		await db.admin.query(
			`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`,
			params,
		)
	).rows[0].n as number;

function buildApp() {
	return createServer({
		auth: { pool: db.app as pg.Pool, config, allowInsecureIssuer: true },
	});
}

beforeAll(async () => {
	db = await createTestDatabase();
	ids = await seedTwoTenants(db.admin);
	fake = await startFakeIssuer();
	pa2 = (
		await db.admin.query(
			"INSERT INTO principal (oidc_issuer, oidc_subject) VALUES ('https://issuer.invalid', 'synthetic-a2') RETURNING id",
		)
	).rows[0].id;
	await db.admin.query(
		"INSERT INTO membership (organization_id, principal_id, status, approved_by_principal_id, approved_at, effective_from) VALUES ($1, $2, 'active', $3, now(), now() - interval '1 day')",
		[ids.orgA, pa2, ids.approver],
	);
	await db.admin.query("UPDATE principal SET oidc_issuer = $1", [fake.issuer]);
	config = readAuthConfig({
		NODE_ENV: "test",
		REO_PUBLIC_URL: PUBLIC_URL,
		REO_LOGIN_COOKIE_SECRET: "synthetic-cookie-secret-0123456789abcdef",
		REO_GOOGLE_CLIENT_ID: fake.clientId,
		REO_GOOGLE_CLIENT_SECRET: fake.clientSecret,
		REO_TEST_OIDC_ISSUER: fake.issuer,
	}) as AuthConfig;
	app = buildApp();
	tokenA = await signInAs(app, fake, "synthetic-a");
	tokenA2 = await signInAs(app, fake, "synthetic-a2");
});

afterAll(async () => {
	await app?.close();
	await fake?.close();
	await db?.drop();
});

describe("client routes", () => {
	it("adds a client, lists and shows it, and audits without personal data", async () => {
		const id = randomUUID();
		const created = await post({
			id,
			name: "Synthetic Client",
			email: "Synthetic.Client@Example.invalid",
			phone: "(416) 555-0100",
		});
		expect(created.statusCode).toBe(201);
		expect(created.headers["cache-control"]).toBe("no-store");
		const client = {
			id,
			name: "Synthetic Client",
			email: "synthetic.client@example.invalid",
			phone: "4165550100",
			version: 1,
			createdAt: expect.any(String),
		};
		expect(created.json()).toEqual({ client });
		const listed = await list();
		expect(listed.statusCode).toBe(200);
		expect(listed.headers["cache-control"]).toBe("no-store");
		expect(listed.json().clients).toContainEqual(client);
		const shown = await detail(id);
		expect(shown.statusCode).toBe(200);
		expect(shown.json()).toEqual({ client });

		const audit = await db.admin.query(
			"SELECT action, details, purpose, details::text AS raw FROM audit_event WHERE resource_id = $1",
			[id],
		);
		expect(audit.rows).toHaveLength(1);
		expect(audit.rows[0]).toMatchObject({
			action: "party.create",
			details: { kind: "person", contactPoints: 2 },
			purpose: "operations",
		});
		const events = await db.admin.query(
			"SELECT event_type, payload, payload::text AS raw FROM outbox_event WHERE aggregate_id = $1",
			[id],
		);
		expect(events.rows).toHaveLength(1);
		expect(events.rows[0]).toMatchObject({
			event_type: "party.created",
			payload: { partyId: id },
		});
		for (const raw of [audit.rows[0].raw, events.rows[0].raw])
			for (const secret of ["Synthetic", "example", "555"])
				expect(raw).not.toContain(secret);
	});

	it("lists clients alphabetically, ignoring case and accents", async () => {
		const tokenB = await signInAs(app, fake, "synthetic-b");
		for (const name of ["Zo\u00eb", "adam", "\u00c9mile", "bob"])
			await post({ id: randomUUID(), name }, tokenB, ids.orgB);
		const body = (await list(tokenB, ids.orgB)).json();
		expect(body.clients.map((c: { name: string }) => c.name)).toEqual([
			"adam",
			"bob",
			"\u00c9mile",
			"Zo\u00eb",
		]);
		expect(body.more).toBe(false);
	});

	it("says when there are more than 100 clients", async () => {
		for (let i = 0; i < 101; i++)
			await post(
				{ id: randomUUID(), name: `Bulk ${String(i).padStart(3, "0")}` },
				tokenA2,
			);
		const body = (await list(tokenA2)).json();
		expect(body.clients).toHaveLength(100);
		expect(body.more).toBe(true);
	});

	it("another member's client is not listed or shown", async () => {
		const theirs = randomUUID();
		expect(
			(await post({ id: theirs, name: "Theirs" }, tokenA2)).statusCode,
		).toBe(201);
		const listed = (await list())
			.json()
			.clients.map((c: { id: string }) => c.id);
		expect(listed).not.toContain(theirs);
		const shown = await detail(theirs);
		expect(shown.statusCode).toBe(404);
		expect(shown.json()).toEqual({ error: "not_found" });
	});

	it("a malformed client id is 404", async () => {
		expect((await detail("not-a-uuid")).statusCode).toBe(404);
	});

	it("retried POST is safe", async () => {
		const id = randomUUID();
		const body = { id, name: "Once", email: "once@example.invalid" };
		const first = await post(body);
		const second = await post({ ...body, email: "ONCE@example.invalid" });
		expect(first.statusCode).toBe(201);
		expect(second.statusCode).toBe(200);
		expect(second.json()).toEqual(first.json());
		expect(await countWhere("party", "id = $1", [id])).toBe(1);
		expect(await countWhere("audit_event", "resource_id = $1", [id])).toBe(1);
		const changed = await post({ ...body, name: "Twice" });
		expect(changed.statusCode).toBe(409);
		expect(changed.json()).toEqual({ error: "conflict" });
		const stolen = await post(body, tokenA2);
		expect(stolen.statusCode).toBe(409);
		expect(await countWhere("party", "id = $1", [id])).toBe(1);
	});

	it.each<[string, Record<string, unknown>, string]>([
		["no name", {}, "name"],
		["a bad email", { name: "X", email: "nope" }, "email"],
		["a bad phone", { name: "X", phone: "12" }, "phone"],
		["an extra field", { name: "X", notes: "y" }, "body"],
	])("%s is 400", async (_label, fields, field) => {
		const response = await post({ id: randomUUID(), ...fields });
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({ error: "invalid_client", field });
	});

	it("other organisation is 404 and a POST without Origin is 403", async () => {
		expect((await list(tokenA, ids.orgB)).statusCode).toBe(404);
		expect(
			(await post({ id: randomUUID(), name: "x" }, tokenA, ids.orgB))
				.statusCode,
		).toBe(404);
		expect(
			(await post({ id: randomUUID(), name: "x" }, tokenA, ids.orgA, {}))
				.statusCode,
		).toBe(403);
	});

	it("membership lost between the check and the insert is 404", async () => {
		const real = db.app as pg.Pool;
		const where = "organization_id = $1 AND principal_id = $2";
		const racing = {
			query: real.query.bind(real),
			connect: async () => {
				await db.admin.query(
					`UPDATE membership SET status = 'suspended' WHERE ${where}`,
					[ids.orgA, ids.pa],
				);
				return real.connect();
			},
		} as unknown as pg.Pool;
		const racingApp = createServer({
			auth: { pool: racing, config, allowInsecureIssuer: true },
		});
		const id = randomUUID();
		try {
			const response = await racingApp.inject({
				method: "POST",
				url: clientsUrl(ids.orgA),
				cookies: { [SESSION_COOKIE]: tokenA },
				headers: { origin: PUBLIC_URL },
				payload: { id, name: "Raced" },
			});
			expect(response.statusCode).toBe(404);
		} finally {
			await racingApp.close();
			await db.admin.query(
				`UPDATE membership SET status = 'active' WHERE ${where}`,
				[ids.orgA, ids.pa],
			);
		}
		expect(await countWhere("party", "id = $1", [id])).toBe(0);
	});

	it("logs carry no names, emails, phones or ids", async () => {
		const lines: string[] = [];
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				lines.push(String(chunk));
				return true;
			});
		const shared = app;
		app = buildApp();
		const id = randomUUID();
		try {
			await post({
				id,
				name: "Secret Synthetic Name",
				email: "secret@example.invalid",
				phone: "6475550199",
			});
			await list();
			await detail(id);
			await post({ id, name: "Different" });
		} finally {
			write.mockRestore();
			await app.close();
			app = shared;
		}
		const log = lines.join("");
		expect(log.length).toBeGreaterThan(0);
		for (const secret of [
			"Secret Synthetic Name",
			"secret@example.invalid",
			"6475550199",
			id,
			ids.orgA,
			tokenA,
		])
			expect(log).not.toContain(secret);
	});
});
