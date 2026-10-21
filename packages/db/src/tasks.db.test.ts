import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TenantContext, withTenant } from "./tenant.js";
import { type SeedIds, seedTwoTenants } from "./testing/fixtures.js";
import { createTestDatabase, type TestDatabase } from "./testing/harness.js";

let db: TestDatabase;
let app: pg.Pool;
let ids: SeedIds;
let pa2: string;

const code = (promise: Promise<unknown>) =>
	promise.then(
		() => "no error",
		(error: { code?: string }) => error.code,
	);

const ctx = (organizationId: string, principalId: string): TenantContext => ({
	organizationId,
	principalId,
	purpose: "operations",
});

const as = (context: TenantContext, sql: string, params: unknown[] = []) =>
	withTenant(app, context, (client) => client.query(sql, params));

const create = (
	context: TenantContext,
	values: { assignee?: string; creator?: string; org?: string; title?: string },
) =>
	as(
		context,
		"INSERT INTO task (organization_id, id, title, assignee_principal_id, created_by_principal_id) VALUES ($1, $2, $3, $4, $5)",
		[
			values.org ?? context.organizationId,
			randomUUID(),
			values.title ?? "Synthetic task",
			values.assignee ?? context.principalId,
			values.creator ?? context.principalId,
		],
	);

beforeAll(async () => {
	db = await createTestDatabase();
	app = db.app as pg.Pool;
	ids = await seedTwoTenants(db.admin);
	pa2 = (
		await db.admin.query(
			"INSERT INTO principal (oidc_issuer, oidc_subject) VALUES ('https://issuer.invalid', 'synthetic-a2') RETURNING id",
		)
	).rows[0].id;
	await db.admin.query(
		"INSERT INTO membership (organization_id, principal_id, status, approved_by_principal_id, approved_at, effective_from) VALUES ($1, $2, 'active', $3, now(), now() - interval '1 day')",
		[ids.orgA, pa2, ids.approver],
	);
});

afterAll(async () => {
	await db.drop();
});

describe("task table", () => {
	it("member creates and sees own task", async () => {
		const id = randomUUID();
		await as(
			ctx(ids.orgA, ids.pa),
			"INSERT INTO task (organization_id, id, title, assignee_principal_id, created_by_principal_id) VALUES ($1, $2, 'Mine', $3, $3)",
			[ids.orgA, id, ids.pa],
		);
		const { rows } = await as(
			ctx(ids.orgA, ids.pa),
			"SELECT status, version, classification FROM task WHERE id = $1",
			[id],
		);
		expect(rows).toEqual([
			{ status: "ready", version: 1, classification: "operational" },
		]);
	});

	it("other member's task is invisible", async () => {
		await create(ctx(ids.orgA, pa2), { title: "Theirs" });
		const { rows } = await as(
			ctx(ids.orgA, ids.pa),
			"SELECT count(*)::int AS n FROM task WHERE created_by_principal_id = $1",
			[pa2],
		);
		expect(rows[0].n).toBe(0);
		const all = await as(
			ctx(ids.orgA, ids.pa),
			"SELECT title FROM task ORDER BY title",
		);
		expect(all.rows.map((row) => row.title)).not.toContain("Theirs");
	});

	it.each([
		["assigned to another member", () => ({ assignee: pa2 })],
		["created as another member", () => ({ creator: pa2 })],
		["in another organisation", () => ({ org: ids.orgB })],
	])("cannot create a task %s", async (_label, values) => {
		expect(await code(create(ctx(ids.orgA, ids.pa), values()))).toBe("42501");
	});

	it.each([
		["status", "'completed'"],
		["version", "5"],
		["classification", "'personal'"],
		["created_at", "now() - interval '1 year'"],
	])("cannot set %s on insert", async (column, value) => {
		expect(
			await code(
				as(
					ctx(ids.orgA, ids.pa),
					`INSERT INTO task (organization_id, id, title, assignee_principal_id, created_by_principal_id, ${column}) VALUES ($1, $2, 'x', $3, $3, ${value})`,
					[ids.orgA, randomUUID(), ids.pa],
				),
			),
		).toBe("42501");
	});

	it("no update or delete", async () => {
		for (const sql of [
			"UPDATE task SET status = 'completed'",
			"DELETE FROM task",
		])
			expect(await code(as(ctx(ids.orgA, ids.pa), sql)), sql).toBe("42501");
	});

	it.each([
		["empty", ""],
		["leading space", " x"],
		["too long", "x".repeat(201)],
		["tab", "a\tb"],
		["line separator", "a\u2028b"],
		["DEL", "a\u007fb"],
		["C1 control", "a\u0085b"],
	])("title constraint: %s", async (_label, title) => {
		expect(await code(create(ctx(ids.orgA, ids.pa), { title }))).toBe("23514");
	});

	it("suspended member sees and creates nothing", async () => {
		const where = "organization_id = $1 AND principal_id = $2";
		await db.admin.query(
			`UPDATE membership SET status = 'suspended' WHERE ${where}`,
			[ids.orgA, ids.pa],
		);
		try {
			const { rows } = await as(
				ctx(ids.orgA, ids.pa),
				"SELECT count(*)::int AS n FROM task",
			);
			expect(rows[0].n).toBe(0);
			expect(await code(create(ctx(ids.orgA, ids.pa), {}))).toBe("42501");
		} finally {
			await db.admin.query(
				`UPDATE membership SET status = 'active' WHERE ${where}`,
				[ids.orgA, ids.pa],
			);
		}
	});

	it("table is forced and not owned by the runtime role", async () => {
		const appUser = (await app.query("SELECT current_user AS u")).rows[0].u;
		const { rows } = await db.admin.query(
			"SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.task'::regclass",
		);
		expect(rows[0]).toMatchObject({
			relrowsecurity: true,
			relforcerowsecurity: true,
		});
		expect(rows[0].owner).not.toBe(appUser);
	});
});
