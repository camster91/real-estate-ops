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

const datesUrl = (dealId: string, org = ids.orgA) =>
	`${dealsUrl(org)}/${dealId}/key-dates`;
const DUE = "2026-11-02T23:59:00-05:00";

const dateBody = (overrides: Record<string, unknown> = {}) => ({
	id: randomUUID(),
	kind: "condition",
	label: "Secret Financing Label",
	dueAt: DUE,
	...overrides,
});

const newDate = async (dealId?: string) => {
	const deal = dealId ?? (await newDeal()).id;
	const body = dateBody();
	const response = await send("POST", datesUrl(deal), body);
	expect(response.statusCode).toBe(201);
	return { dealId: deal, keyDate: response.json().keyDate as { id: string } };
};

const edit = (
	dealId: string,
	id: string,
	body: unknown,
	token = tokenA,
	headers = ORIGIN,
) => send("PATCH", `${datesUrl(dealId)}/${id}`, body, token, headers);

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

describe("key date routes", () => {
	it("adds and lists key dates in order; history holds the kind only", async () => {
		const deal = await newDeal();
		const later = dateBody({
			kind: "closing",
			label: null,
			dueAt: "2026-12-01T17:00:00-05:00",
		});
		const sooner = dateBody();
		expect((await send("POST", datesUrl(deal.id), later)).statusCode).toBe(201);
		const created = await send("POST", datesUrl(deal.id), sooner);
		expect(created.statusCode).toBe(201);
		expect(created.headers["cache-control"]).toBe("no-store");
		expect(created.json().keyDate).toEqual({
			id: sooner.id,
			kind: "condition",
			label: "Secret Financing Label",
			dueAt: "2026-11-03T04:59:00.000Z",
			doneAt: null,
			version: 1,
		});
		const listed = await send("GET", datesUrl(deal.id));
		expect(listed.statusCode).toBe(200);
		expect(listed.json().keyDates.map((k: { id: string }) => k.id)).toEqual([
			sooner.id,
			later.id,
		]);
		const audit = await db.admin.query(
			"SELECT action, details, details::text AS raw FROM audit_event WHERE resource_id = $1",
			[sooner.id],
		);
		expect(audit.rows[0]).toMatchObject({
			action: "key_date.create",
			details: { kind: "condition" },
		});
		const events = await db.admin.query(
			"SELECT event_type, payload, payload::text AS raw FROM outbox_event WHERE aggregate_id = $1",
			[sooner.id],
		);
		expect(events.rows[0]).toMatchObject({
			event_type: "key_date.created",
			payload: { keyDateId: sooner.id, dealId: deal.id },
		});
		for (const raw of [audit.rows[0].raw, events.rows[0].raw])
			expect(raw).not.toContain("Secret");
	});

	it("a retried add is harmless; changed details conflict", async () => {
		const deal = await newDeal();
		const body = dateBody();
		expect((await send("POST", datesUrl(deal.id), body)).statusCode).toBe(201);
		expect((await send("POST", datesUrl(deal.id), body)).statusCode).toBe(200);
		for (const changed of [
			{ ...body, label: "Inspection" },
			{ ...body, dueAt: "2026-11-03T23:59:00-05:00" },
			{ ...body, kind: "other" },
		])
			expect((await send("POST", datesUrl(deal.id), changed)).statusCode).toBe(
				409,
			);
		const otherDeal = await newDeal();
		expect((await send("POST", datesUrl(otherDeal.id), body)).statusCode).toBe(
			409,
		);
		expect(await countWhere("deal_key_date", "id = $1", [body.id])).toBe(1);
	});

	it.each<[string, Record<string, unknown>, string]>([
		["a condition without a label", { label: "" }, "label"],
		["a due time without an offset", { dueAt: "2026-11-02T23:59" }, "dueAt"],
		["an unknown kind", { kind: "party" }, "kind"],
		["done on create", { done: true }, "body"],
	])("%s is 400", async (_label, overrides, field) => {
		const deal = await newDeal();
		const response = await send("POST", datesUrl(deal.id), dateBody(overrides));
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({ error: "invalid_key_date", field });
	});

	it("marks done, replays, refuses a stale version, and reopens", async () => {
		const { dealId, keyDate } = await newDate();
		const full = { version: 1, label: "Secret Financing Label", dueAt: DUE };
		const done = await edit(dealId, keyDate.id, { ...full, done: true });
		expect(done.statusCode).toBe(200);
		expect(done.json().keyDate).toMatchObject({
			version: 2,
			doneAt: expect.any(String),
		});
		const again = await edit(dealId, keyDate.id, { ...full, done: true });
		expect(again.statusCode).toBe(200);
		expect(again.json().keyDate.version).toBe(2);
		const stale = await edit(dealId, keyDate.id, {
			...full,
			dueAt: "2026-11-05T23:59:00-05:00",
			done: true,
		});
		expect(stale.statusCode).toBe(409);
		expect(stale.json()).toMatchObject({
			error: "conflict",
			keyDate: { version: 2 },
		});
		const moved = await edit(dealId, keyDate.id, {
			...full,
			version: 2,
			dueAt: "2026-11-05T23:59:00-05:00",
			done: false,
		});
		expect(moved.statusCode).toBe(200);
		expect(moved.json().keyDate).toMatchObject({
			version: 3,
			doneAt: null,
			dueAt: "2026-11-06T04:59:00.000Z",
		});
		const audit = await db.admin.query(
			"SELECT details FROM audit_event WHERE resource_id = $1 AND action = 'key_date.update' ORDER BY occurred_at",
			[keyDate.id],
		);
		expect(audit.rows.map((r) => r.details)).toEqual([
			{ fieldsChanged: 1, dateChanged: false, done: true },
			{ fieldsChanged: 2, dateChanged: true, done: false },
		]);
	});

	it("a condition cannot lose its label; a closing can have none", async () => {
		const { dealId, keyDate } = await newDate();
		const response = await edit(dealId, keyDate.id, {
			version: 1,
			label: null,
			dueAt: DUE,
			done: false,
		});
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({
			error: "invalid_key_date",
			field: "label",
		});
		const closing = dateBody({ kind: "closing", label: "Closing day" });
		expect((await send("POST", datesUrl(dealId), closing)).statusCode).toBe(
			201,
		);
		expect(
			(
				await edit(dealId, closing.id, {
					version: 1,
					label: "",
					dueAt: DUE,
					done: false,
				})
			).statusCode,
		).toBe(200);
	});

	it("another member or organisation cannot see, add or change key dates", async () => {
		const { dealId, keyDate } = await newDate();
		const body = { version: 1, label: "Hijack", dueAt: DUE, done: true };
		expect(
			(await send("GET", datesUrl(dealId), undefined, tokenA2)).statusCode,
		).toBe(404);
		expect(
			(await send("POST", datesUrl(dealId), dateBody(), tokenA2)).statusCode,
		).toBe(404);
		expect((await edit(dealId, keyDate.id, body, tokenA2)).statusCode).toBe(
			404,
		);
		const tokenB = await signInAs(app, fake, "synthetic-b");
		for (const org of [ids.orgA, ids.orgB]) {
			expect(
				(await send("GET", datesUrl(dealId, org), undefined, tokenB))
					.statusCode,
			).toBe(404);
			expect(
				(
					await send(
						"PATCH",
						`${datesUrl(dealId, org)}/${keyDate.id}`,
						body,
						tokenB,
					)
				).statusCode,
			).toBe(404);
		}
		expect(
			await countWhere("deal_key_date", "id = $1 AND version = 1", [
				keyDate.id,
			]),
		).toBe(1);
	});

	it("a key date is only reachable through its own deal", async () => {
		const { keyDate } = await newDate();
		const otherDeal = await newDeal();
		expect(
			(
				await edit(otherDeal.id, keyDate.id, {
					version: 1,
					label: "X",
					dueAt: DUE,
					done: true,
				})
			).statusCode,
		).toBe(404);
	});

	it("a deal holds at most 200 key dates; a replay still works", async () => {
		const deal = await newDeal();
		const last = dateBody();
		await db.admin.query(
			"INSERT INTO deal_key_date (organization_id, id, deal_id, kind, due_at, created_by_principal_id) SELECT $1, CASE WHEN n = 1 THEN $4::uuid ELSE gen_random_uuid() END, $2, 'closing', now(), $3 FROM generate_series(1, 200) AS n",
			[ids.orgA, deal.id, ids.pa, last.id],
		);
		const full = await send("POST", datesUrl(deal.id), dateBody());
		expect(full.statusCode).toBe(409);
		expect(full.json()).toEqual({ error: "limit_reached" });
		expect((await send("GET", datesUrl(deal.id))).json().keyDates).toHaveLength(
			200,
		);
		// The same id as an existing date is still a replay or conflict, not a limit.
		const again = await send("POST", datesUrl(deal.id), last);
		expect(again.json()).toEqual({ error: "conflict" });
	});

	it("bad ids and a missing Origin", async () => {
		const { dealId, keyDate } = await newDate();
		expect((await send("GET", datesUrl("nope"))).statusCode).toBe(404);
		const body = { version: 1, label: "X", dueAt: DUE, done: true };
		expect((await edit(dealId, "nope", body)).statusCode).toBe(404);
		expect((await edit(dealId, keyDate.id, body, tokenA, {})).statusCode).toBe(
			403,
		);
		expect(
			(await send("POST", datesUrl(dealId), dateBody(), tokenA, {})).statusCode,
		).toBe(403);
	});

	it("logs carry no labels or ids", async () => {
		const lines: string[] = [];
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				lines.push(String(chunk));
				return true;
			});
		const shared = app;
		app = buildApp();
		const deal = await newDeal();
		const body = dateBody();
		try {
			await send("POST", datesUrl(deal.id), body);
			await send("POST", datesUrl(deal.id), { ...body, label: "Other Secret" });
			await send("GET", datesUrl(deal.id));
			await edit(deal.id, body.id, {
				version: 1,
				label: "Edited Secret",
				dueAt: DUE,
				done: true,
			});
		} finally {
			write.mockRestore();
			await app.close();
			app = shared;
		}
		const log = lines.join("");
		expect(log.length).toBeGreaterThan(0);
		for (const secret of ["Secret", body.id, deal.id, ids.orgA, tokenA])
			expect(log).not.toContain(secret);
	});
});
