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

const INSERT =
	"INSERT INTO party (organization_id, id, display_name, email, phone, assigned_principal_id, created_by_principal_id) VALUES ($1, $2, $3, $4, $5, $6, $7)";

const create = (
	context: TenantContext,
	values: {
		assignee?: string;
		creator?: string;
		org?: string;
		name?: string;
		email?: string | null;
		phone?: string | null;
		id?: string;
	} = {},
) =>
	as(context, INSERT, [
		values.org ?? context.organizationId,
		values.id ?? randomUUID(),
		values.name ?? "Synthetic Client",
		values.email ?? null,
		values.phone ?? null,
		values.assignee ?? context.principalId,
		values.creator ?? context.principalId,
	]);

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

describe("party table (clients)", () => {
	it("member adds and sees own client", async () => {
		const id = randomUUID();
		await create(ctx(ids.orgA, ids.pa), {
			id,
			email: "synthetic@example.invalid",
			phone: "4165550100",
		});
		const { rows } = await as(
			ctx(ids.orgA, ids.pa),
			"SELECT kind, classification, version, email, phone FROM party WHERE id = $1",
			[id],
		);
		expect(rows).toEqual([
			{
				kind: "person",
				classification: "personal",
				version: 1,
				email: "synthetic@example.invalid",
				phone: "4165550100",
			},
		]);
	});

	it("another member's client is invisible", async () => {
		await create(ctx(ids.orgA, pa2), { name: "Theirs" });
		const { rows } = await as(
			ctx(ids.orgA, ids.pa),
			"SELECT display_name FROM party",
		);
		expect(rows.map((row) => row.display_name)).not.toContain("Theirs");
	});

	it("another organisation's client is invisible", async () => {
		await create(ctx(ids.orgB, ids.pb), { name: "Other org" });
		const { rows } = await as(
			ctx(ids.orgA, ids.pa),
			"SELECT count(*)::int AS n FROM party WHERE display_name = 'Other org'",
		);
		expect(rows[0].n).toBe(0);
	});

	it.each([
		["assigned to another member", () => ({ assignee: pa2 })],
		["created as another member", () => ({ creator: pa2 })],
		["in another organisation", () => ({ org: ids.orgB })],
	])("cannot add a client %s", async (_label, values) => {
		expect(await code(create(ctx(ids.orgA, ids.pa), values()))).toBe("42501");
	});

	it.each([
		["kind", "'company'"],
		["classification", "'operational'"],
		["version", "5"],
		["created_at", "now() - interval '1 year'"],
	])("cannot set %s on insert", async (column, value) => {
		expect(
			await code(
				as(
					ctx(ids.orgA, ids.pa),
					`INSERT INTO party (organization_id, id, display_name, assigned_principal_id, created_by_principal_id, ${column}) VALUES ($1, $2, 'x', $3, $3, ${value})`,
					[ids.orgA, randomUUID(), ids.pa],
				),
			),
		).toBe("42501");
	});

	it("no update or delete yet", async () => {
		for (const sql of [
			"UPDATE party SET display_name = 'Changed'",
			"DELETE FROM party",
		])
			expect(await code(as(ctx(ids.orgA, ids.pa), sql)), sql).toBe("42501");
	});

	it.each<[string, Record<string, string>]>([
		["an empty name", { name: "" }],
		["a padded name", { name: " x" }],
		["a long name", { name: "x".repeat(201) }],
		["a tab in the name", { name: "a\tb" }],
		["a line separator in the name", { name: "a\u2028b" }],
		["an upper-case email", { email: "A@example.invalid" }],
		["an email without a domain dot", { email: "a@example" }],
		["an email with a space", { email: "a b@example.invalid" }],
		["a long email", { email: `${"a".repeat(250)}@b.ca` }],
		["a formatted phone", { phone: "416-555-0100" }],
		["a short phone", { phone: "55501" }],
		["a plus inside a phone", { phone: "416+5550100" }],
	])("constraint: %s", async (_label, values) => {
		expect(await code(create(ctx(ids.orgA, ids.pa), values))).toBe("23514");
	});

	it("suspended member sees and adds nothing", async () => {
		const where = "organization_id = $1 AND principal_id = $2";
		await db.admin.query(
			`UPDATE membership SET status = 'suspended' WHERE ${where}`,
			[ids.orgA, ids.pa],
		);
		try {
			const { rows } = await as(
				ctx(ids.orgA, ids.pa),
				"SELECT count(*)::int AS n FROM party",
			);
			expect(rows[0].n).toBe(0);
			expect(await code(create(ctx(ids.orgA, ids.pa)))).toBe("42501");
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
			"SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.party'::regclass",
		);
		expect(rows[0]).toMatchObject({
			relrowsecurity: true,
			relforcerowsecurity: true,
		});
		expect(rows[0].owner).not.toBe(appUser);
	});
});
