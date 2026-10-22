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

const tasksUrl = (org: string) => `/v1/organizations/${org}/tasks`;

const list = (token = tokenA, org = ids.orgA) =>
	app.inject({ url: tasksUrl(org), cookies: { [SESSION_COOKIE]: token } });

const post = (
	body: unknown,
	token = tokenA,
	org = ids.orgA,
	headers: Record<string, string> = { origin: PUBLIC_URL },
) =>
	app.inject({
		method: "POST",
		url: tasksUrl(org),
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

describe("task routes", () => {
	it("creates a task and lists it", async () => {
		const id = randomUUID();
		const created = await post({ id, title: "Synthetic follow-up" });
		expect(created.statusCode).toBe(201);
		expect(created.json()).toEqual({
			task: {
				id,
				title: "Synthetic follow-up",
				status: "ready",
				dueAt: null,
				version: 1,
			},
		});
		const listed = await list();
		expect(listed.statusCode).toBe(200);
		expect(listed.headers["cache-control"]).toBe("no-store");
		expect(listed.json().tasks).toContainEqual(created.json().task);

		const audit = await db.admin.query(
			"SELECT action, details, purpose, details::text AS raw FROM audit_event WHERE resource_id = $1",
			[id],
		);
		expect(audit.rows).toHaveLength(1);
		expect(audit.rows[0]).toMatchObject({
			action: "task.create",
			details: { status: "ready", hasDueDate: false },
			purpose: "operations",
		});
		expect(audit.rows[0].raw).not.toContain("Synthetic follow-up");
		const events = await db.admin.query(
			"SELECT event_type, payload, payload::text AS raw FROM outbox_event WHERE aggregate_id = $1",
			[id],
		);
		expect(events.rows).toHaveLength(1);
		expect(events.rows[0]).toMatchObject({
			event_type: "task.created",
			payload: { taskId: id },
		});
		expect(events.rows[0].raw).not.toContain("Synthetic follow-up");
	});

	it("orders open tasks by due date, undated last", async () => {
		const later = randomUUID();
		const sooner = randomUUID();
		const undated = randomUUID();
		const org = ids.orgB;
		// pb's organisation is untouched by other tests; sign in as pb.
		const tokenB = await signInAs(app, fake, "synthetic-b");
		await post(
			{ id: later, title: "Later", dueAt: "2026-12-01T10:00:00Z" },
			tokenB,
			org,
		);
		await post({ id: undated, title: "Undated" }, tokenB, org);
		await post(
			{ id: sooner, title: "Sooner", dueAt: "2026-11-01T10:00:00-04:00" },
			tokenB,
			org,
		);
		const tasks = (await list(tokenB, org)).json().tasks;
		expect(tasks.map((task: { id: string }) => task.id)).toEqual([
			sooner,
			later,
			undated,
		]);
		expect(tasks[0].dueAt).toBe("2026-11-01T14:00:00.000Z");
	});

	it("another member's task is not listed", async () => {
		const theirs = randomUUID();
		expect(
			(await post({ id: theirs, title: "Theirs" }, tokenA2)).statusCode,
		).toBe(201);
		const ids_ = (await list()).json().tasks.map((t: { id: string }) => t.id);
		expect(ids_).not.toContain(theirs);
	});

	it("cannot create for someone else", async () => {
		const response = await post({
			id: randomUUID(),
			title: "For them",
			assigneeId: pa2,
		});
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({ error: "invalid_task", field: "body" });
	});

	it("retried POST is safe", async () => {
		const id = randomUUID();
		const body = { id, title: "Once", dueAt: "2026-11-05T15:00:00Z" };
		const first = await post(body);
		const second = await post(body);
		expect(first.statusCode).toBe(201);
		expect(second.statusCode).toBe(200);
		expect(second.json()).toEqual(first.json());
		expect(await countWhere("task", "id = $1", [id])).toBe(1);
		expect(await countWhere("audit_event", "resource_id = $1", [id])).toBe(1);
		expect(await countWhere("outbox_event", "aggregate_id = $1", [id])).toBe(1);
		const changed = await post({ ...body, title: "Twice" });
		expect(changed.statusCode).toBe(409);
		expect(changed.json()).toEqual({ error: "conflict" });
		const stolen = await post({ id, title: "Once" }, tokenA2);
		expect(stolen.statusCode).toBe(409);
		expect(await countWhere("task", "id = $1", [id])).toBe(1);
	});

	it.each([
		["empty", ""],
		["blank", "   "],
		["too long", "x".repeat(201)],
		["NUL", "a\u0000b"],
		["bell", "a\u0007b"],
	])("odd title %s is 400", async (_label, title) => {
		const response = await post({ id: randomUUID(), title });
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({ error: "invalid_task", field: "title" });
	});

	it("accents and emoji are accepted", async () => {
		expect(
			(await post({ id: randomUUID(), title: "Réviser ✅" })).statusCode,
		).toBe(201);
	});

	it("a non-JSON or oversized body is 400", async () => {
		const bad = await app.inject({
			method: "POST",
			url: tasksUrl(ids.orgA),
			cookies: { [SESSION_COOKIE]: tokenA },
			headers: { origin: PUBLIC_URL, "content-type": "application/json" },
			payload: "{not json",
		});
		expect(bad.statusCode).toBe(400);
		const big = await post({ id: randomUUID(), title: "x".repeat(5000) });
		expect([400, 413]).toContain(big.statusCode);
	});

	it("membership lost", async () => {
		const token = await signInAs(app, fake, "synthetic-a");
		const where = "organization_id = $1 AND principal_id = $2";
		await db.admin.query(
			`UPDATE membership SET status = 'suspended' WHERE ${where}`,
			[ids.orgA, ids.pa],
		);
		const id = randomUUID();
		try {
			expect((await list(token)).statusCode).toBe(401);
			expect((await post({ id, title: "Late" }, token)).statusCode).toBe(401);
		} finally {
			await db.admin.query(
				`UPDATE membership SET status = 'active' WHERE ${where}`,
				[ids.orgA, ids.pa],
			);
		}
		expect(await countWhere("task", "id = $1", [id])).toBe(0);
	});

	it("membership lost between the check and the insert is 404, not 500", async () => {
		const real = db.app as pg.Pool;
		const where = "organization_id = $1 AND principal_id = $2";
		// Suspends the membership after inTenant's check, as the transaction opens.
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
				url: tasksUrl(ids.orgA),
				cookies: { [SESSION_COOKIE]: tokenA },
				headers: { origin: PUBLIC_URL },
				payload: { id, title: "Raced" },
			});
			expect(response.statusCode).toBe(404);
			expect(response.json()).toEqual({ error: "not_found" });
		} finally {
			await racingApp.close();
			await db.admin.query(
				`UPDATE membership SET status = 'active' WHERE ${where}`,
				[ids.orgA, ids.pa],
			);
		}
		expect(await countWhere("task", "id = $1", [id])).toBe(0);
	});

	it("other organisation is 404 and a POST without Origin is 403", async () => {
		expect((await list(tokenA, ids.orgB)).statusCode).toBe(404);
		expect(
			(await post({ id: randomUUID(), title: "x" }, tokenA, ids.orgB))
				.statusCode,
		).toBe(404);
		expect(
			(await post({ id: randomUUID(), title: "x" }, tokenA, ids.orgA, {}))
				.statusCode,
		).toBe(403);
	});

	it("logs carry no titles or ids", async () => {
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
			expect(
				(await post({ id, title: "Secret synthetic title" })).statusCode,
			).toBe(201);
			await list();
			await post({ id, title: "Different" });
		} finally {
			write.mockRestore();
			await app.close();
			app = shared;
		}
		const log = lines.join("");
		expect(log.length).toBeGreaterThan(0);
		for (const secret of ["Secret synthetic title", id, ids.orgA, tokenA])
			expect(log).not.toContain(secret);
	});
});
