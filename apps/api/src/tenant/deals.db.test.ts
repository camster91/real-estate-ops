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

const dealsUrl = (org = ids.orgA) => `/v1/organizations/${org}/deals`;
const ORIGIN = { origin: PUBLIC_URL };

const send = (
	method: "GET" | "POST" | "PATCH",
	url: string,
	body?: unknown,
	token = tokenA,
	headers: Record<string, string> = ORIGIN,
) =>
	app.inject({
		method,
		url,
		cookies: { [SESSION_COOKIE]: token },
		headers: method === "GET" ? {} : headers,
		...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
	});

/** Adds a client for the token's member and returns its id. */
const newClient = async (name: string, token = tokenA) => {
	const id = randomUUID();
	const response = await send(
		"POST",
		`/v1/organizations/${ids.orgA}/clients`,
		{ id, name },
		token,
	);
	expect(response.statusCode).toBe(201);
	return id;
};

const dealBody = (
	clientIds: string[],
	overrides: Record<string, unknown> = {},
) => ({
	id: randomUUID(),
	side: "seller",
	address: {
		street: "12 Secret Street",
		unit: "4",
		city: "Ottawa",
		postalCode: "k2p 1l4",
	},
	clientIds,
	...overrides,
});

const newDeal = async (clientIds?: string[]) => {
	const body = dealBody(clientIds ?? [await newClient("Deal Client")]);
	const response = await send("POST", dealsUrl(), body);
	expect(response.statusCode).toBe(201);
	return response.json().deal as { id: string; version: number };
};

const stage = (id: string, body: unknown, token = tokenA, headers = ORIGIN) =>
	send("PATCH", `${dealsUrl()}/${id}`, body, token, headers);

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

describe("deal routes", () => {
	it("adds a deal for my clients; history holds no address or names", async () => {
		const a = await newClient("Zed Synthetic");
		const b = await newClient("Amy Synthetic");
		const body = dealBody([a, b]);
		const response = await send("POST", dealsUrl(), body);
		expect(response.statusCode).toBe(201);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.json().deal).toEqual({
			id: body.id,
			side: "seller",
			stage: "draft",
			address: {
				street: "12 Secret Street",
				unit: "4",
				city: "Ottawa",
				postalCode: "K2P 1L4",
			},
			clients: [
				{ id: b, name: "Amy Synthetic" },
				{ id: a, name: "Zed Synthetic" },
			],
			version: 1,
			createdAt: expect.any(String),
			stageChangedAt: expect.any(String),
		});
		const audit = await db.admin.query(
			"SELECT action, details, details::text AS raw FROM audit_event WHERE resource_id = $1",
			[body.id],
		);
		expect(audit.rows[0]).toMatchObject({
			action: "deal.create",
			details: { side: "seller", clients: 2 },
		});
		const events = await db.admin.query(
			"SELECT event_type, payload, payload::text AS raw FROM outbox_event WHERE aggregate_id = $1",
			[body.id],
		);
		expect(events.rows[0]).toMatchObject({
			event_type: "deal.created",
			payload: { dealId: body.id },
		});
		for (const raw of [audit.rows[0].raw, events.rows[0].raw])
			for (const secret of ["Secret", "Ottawa", "K2P", "Synthetic", a, b])
				expect(raw).not.toContain(secret);
	});

	it("lists and shows my deals, newest first", async () => {
		const first = await newDeal();
		const second = await newDeal();
		const listed = await send("GET", dealsUrl());
		expect(listed.statusCode).toBe(200);
		const ids_ = listed.json().deals.map((d: { id: string }) => d.id);
		expect(ids_.indexOf(second.id)).toBeLessThan(ids_.indexOf(first.id));
		expect(listed.json().more).toBe(false);
		const shown = await send("GET", `${dealsUrl()}/${first.id.toUpperCase()}`);
		expect(shown.statusCode).toBe(200);
		expect(shown.json().deal.id).toBe(first.id);
	});

	it("a retried add is harmless; changed details conflict", async () => {
		const body = dealBody([await newClient("Retry Client")]);
		expect((await send("POST", dealsUrl(), body)).statusCode).toBe(201);
		const again = await send("POST", dealsUrl(), body);
		expect(again.statusCode).toBe(200);
		for (const changed of [
			{ ...body, side: "buyer" },
			{ ...body, address: { ...body.address, unit: "5" } },
			{ ...body, clientIds: [await newClient("Other Client")] },
		])
			expect((await send("POST", dealsUrl(), changed)).statusCode).toBe(409);
		expect(await countWhere("deal", "id = $1", [body.id])).toBe(1);
		expect(await countWhere("audit_event", "resource_id = $1", [body.id])).toBe(
			1,
		);
	});

	it("another member's deal id conflicts and stays hidden", async () => {
		const body = dealBody([await newClient("Theirs", tokenA2)]);
		expect((await send("POST", dealsUrl(), body, tokenA2)).statusCode).toBe(
			201,
		);
		const mine = { ...body, clientIds: [await newClient("Mine")] };
		expect((await send("POST", dealsUrl(), mine)).statusCode).toBe(409);
		expect((await send("GET", `${dealsUrl()}/${body.id}`)).statusCode).toBe(
			404,
		);
		const listed = (await send("GET", dealsUrl())).json().deals;
		expect(listed.map((d: { id: string }) => d.id)).not.toContain(body.id);
	});

	it("another member's client, or an unknown one, cannot be linked", async () => {
		for (const clientId of [
			await newClient("Not Mine", tokenA2),
			randomUUID(),
		]) {
			const body = dealBody([await newClient("Mine Too"), clientId]);
			const response = await send("POST", dealsUrl(), body);
			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({
				error: "invalid_deal",
				field: "clientIds",
			});
			expect(await countWhere("deal", "id = $1", [body.id])).toBe(0);
		}
	});

	it.each<[string, Record<string, unknown>, string]>([
		["a bad side", { side: "agent" }, "side"],
		[
			"a BC postal code",
			{
				address: { street: "1 A St", city: "Victoria", postalCode: "V8W 1A1" },
			},
			"postalCode",
		],
		["no clients", { clientIds: [] }, "clientIds"],
		["a price", { price: 1 }, "body"],
	])("%s is 400", async (_label, overrides, field) => {
		const response = await send(
			"POST",
			dealsUrl(),
			dealBody([randomUUID()], overrides),
		);
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({ error: "invalid_deal", field });
	});

	it("moves a deal through stages with version checks", async () => {
		const deal = await newDeal();
		const moved = await stage(deal.id, { stage: "active", version: 1 });
		expect(moved.statusCode).toBe(200);
		expect(moved.json().deal).toMatchObject({ stage: "active", version: 2 });
		// Same stage again: a retry, whatever version it carried.
		const again = await stage(deal.id, { stage: "active", version: 1 });
		expect(again.statusCode).toBe(200);
		expect(again.json().deal.version).toBe(2);
		const stale = await stage(deal.id, { stage: "firm", version: 1 });
		expect(stale.statusCode).toBe(409);
		expect(stale.json()).toMatchObject({
			error: "conflict",
			deal: { stage: "active", version: 2 },
		});
		const audit = await db.admin.query(
			"SELECT details FROM audit_event WHERE resource_id = $1 AND action = 'deal.stage_change'",
			[deal.id],
		);
		expect(audit.rows.map((r) => r.details)).toEqual([
			{ from: "draft", to: "active" },
		]);
		const events = await db.admin.query(
			"SELECT aggregate_version, payload FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'deal.stage_changed'",
			[deal.id],
		);
		expect(events.rows).toEqual([
			{ aggregate_version: 2, payload: { dealId: deal.id, stage: "active" } },
		]);
	});

	it("refuses a move the rules do not allow", async () => {
		const deal = await newDeal();
		expect(
			(await stage(deal.id, { stage: "closed", version: 1 })).statusCode,
		).toBe(200);
		const reopen = await stage(deal.id, { stage: "active", version: 2 });
		expect(reopen.statusCode).toBe(409);
		expect(reopen.json()).toMatchObject({
			error: "invalid_transition",
			deal: { stage: "closed", version: 2 },
		});
	});

	it("another member or organisation cannot see or move my deal", async () => {
		const deal = await newDeal();
		expect(
			(await stage(deal.id, { stage: "active", version: 1 }, tokenA2))
				.statusCode,
		).toBe(404);
		expect(
			(await send("GET", `${dealsUrl()}/${deal.id}`, undefined, tokenA2))
				.statusCode,
		).toBe(404);
		const tokenB = await signInAs(app, fake, "synthetic-b");
		for (const org of [ids.orgA, ids.orgB]) {
			expect(
				(await send("GET", `${dealsUrl(org)}/${deal.id}`, undefined, tokenB))
					.statusCode,
			).toBe(404);
			expect(
				(
					await send(
						"PATCH",
						`${dealsUrl(org)}/${deal.id}`,
						{ stage: "active", version: 1 },
						tokenB,
					)
				).statusCode,
			).toBe(404);
		}
		expect(await countWhere("deal", "id = $1 AND version = 1", [deal.id])).toBe(
			1,
		);
	});

	it("bad ids, bad bodies and missing Origin", async () => {
		const deal = await newDeal();
		expect((await send("GET", `${dealsUrl()}/nope`)).statusCode).toBe(404);
		expect(
			(await stage("nope", { stage: "active", version: 1 })).statusCode,
		).toBe(404);
		const bad = await stage(deal.id, { stage: "won", version: 1 });
		expect(bad.statusCode).toBe(400);
		expect(bad.json()).toEqual({ error: "invalid_stage", field: "stage" });
		expect(
			(await stage(deal.id, { stage: "active", version: 1 }, tokenA, {}))
				.statusCode,
		).toBe(403);
		expect(
			(await send("POST", dealsUrl(), dealBody([randomUUID()]), tokenA, {}))
				.statusCode,
		).toBe(403);
	});

	it("logs carry no addresses, names or ids", async () => {
		const lines: string[] = [];
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				lines.push(String(chunk));
				return true;
			});
		const shared = app;
		app = buildApp();
		const clientId = await newClient("Logged Secret Name");
		const body = dealBody([clientId]);
		try {
			await send("POST", dealsUrl(), body);
			await send("POST", dealsUrl(), { ...body, side: "buyer" });
			await send("GET", dealsUrl());
			await send("GET", `${dealsUrl()}/${body.id}`);
			await stage(body.id, { stage: "active", version: 1 });
			await stage(body.id, { stage: "firm", version: 1 });
		} finally {
			write.mockRestore();
			await app.close();
			app = shared;
		}
		const log = lines.join("");
		expect(log.length).toBeGreaterThan(0);
		for (const secret of [
			"12 Secret Street",
			"Logged Secret Name",
			"K2P",
			body.id,
			clientId,
			ids.orgA,
			tokenA,
		])
			expect(log).not.toContain(secret);
	});
});
