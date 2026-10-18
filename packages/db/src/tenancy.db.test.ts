import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TenantContext, withTenant } from "./tenant.js";
import { createTestDatabase, type TestDatabase } from "./testing/harness.js";

const tables = ["organization", "principal", "membership", "branch", "team"];

let db: TestDatabase;
let app: pg.Pool;
let adminUser: string;
const ids: Record<string, string> = {};

const insert = async (sql: string, params: unknown[] = []) =>
	(await db.admin.query(sql, params)).rows[0].id as string;

const as = (ctx: TenantContext, sql: string, params: unknown[] = []) =>
	withTenant(app, ctx, (client) => client.query(sql, params));

const code = (promise: Promise<unknown>) =>
	promise.then(
		() => "no error",
		(error: { code?: string }) => error.code,
	);

const memberA = (): TenantContext => ({
	organizationId: ids.orgA as string,
	principalId: ids.pa as string,
});

beforeAll(async () => {
	db = await createTestDatabase();
	app = db.app as pg.Pool;
	adminUser = (await db.admin.query("SELECT current_user AS u")).rows[0].u;
	ids.orgA = await insert(
		"INSERT INTO organization (name) VALUES ('Synthetic Org A') RETURNING id",
	);
	ids.orgB = await insert(
		"INSERT INTO organization (name) VALUES ('Synthetic Org B') RETURNING id",
	);
	for (const [key, subject] of [
		["pa", "synthetic-a"],
		["pb", "synthetic-b"],
		["approver", "synthetic-approver"],
		["pc", "synthetic-c"],
	])
		ids[key as string] = await insert(
			"INSERT INTO principal (oidc_issuer, oidc_subject) VALUES ('https://issuer.invalid', $1) RETURNING id",
			[subject],
		);
	for (const [org, principal] of [
		[ids.orgA, ids.pa],
		[ids.orgB, ids.pb],
	])
		await db.admin.query(
			"INSERT INTO membership (organization_id, principal_id, status, approved_by_principal_id, approved_at, effective_from) VALUES ($1, $2, 'active', $3, now(), now() - interval '7 days')",
			[org, principal, ids.approver],
		);
	ids.branchA = await insert(
		"INSERT INTO branch (organization_id, name) VALUES ($1, 'Synthetic Branch A') RETURNING id",
		[ids.orgA],
	);
	ids.branchB = await insert(
		"INSERT INTO branch (organization_id, name) VALUES ($1, 'Synthetic Branch B') RETURNING id",
		[ids.orgB],
	);
});

afterAll(async () => {
	await db.drop();
});

describe("tenancy schema", () => {
	it("runtime role cannot bypass isolation", async () => {
		const role = await app.query(
			"SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
		);
		expect(role.rows[0]).toMatchObject({
			rolsuper: false,
			rolbypassrls: false,
		});
		const appUser = role.rows[0].name;
		const { rows } = await db.admin.query(
			"SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.relname = ANY($1) AND c.relnamespace = 'public'::regnamespace ORDER BY c.relname",
			[tables],
		);
		expect(rows).toHaveLength(tables.length);
		for (const row of rows) {
			expect(row).toMatchObject({
				relrowsecurity: true,
				relforcerowsecurity: true,
			});
			expect(row.owner).not.toBe(appUser);
		}
	});

	it("member sees only their tenant, including counts", async () => {
		const count = await as(memberA(), "SELECT count(*)::int AS n FROM branch");
		expect(count.rows[0].n).toBe(1);
		const names = await as(memberA(), "SELECT name FROM branch");
		expect(names.rows.map((row) => row.name)).toEqual(["Synthetic Branch A"]);
		const orgs = await as(memberA(), "SELECT id FROM organization");
		expect(orgs.rows.map((row) => row.id)).toEqual([ids.orgA]);
		const people = await as(memberA(), "SELECT id FROM principal");
		expect(people.rows.map((row) => row.id)).toEqual([ids.pa]);
	});

	it("forged tenant gets nothing and cannot write", async () => {
		const forged = {
			organizationId: ids.orgB as string,
			principalId: ids.pa as string,
		};
		for (const table of ["branch", "organization", "membership"])
			expect((await as(forged, `SELECT 1 FROM ${table}`)).rowCount).toBe(0);
		expect(
			await code(
				as(
					forged,
					"INSERT INTO branch (organization_id, name) VALUES ($1, 'x')",
					[ids.orgB],
				),
			),
		).toBe("42501");
	});

	it.each([
		["invited", "status = 'invited'"],
		["suspended", "status = 'suspended'"],
		["revoked", "status = 'revoked'"],
		[
			"expired",
			"effective_from = now() - interval '2 days', effective_to = now() - interval '1 day'",
		],
		["not yet effective", "effective_from = now() + interval '1 day'"],
	])("%s membership is denied", async (_label, change) => {
		const where = "organization_id = $1 AND principal_id = $2";
		const saved = (
			await db.admin.query(`SELECT * FROM membership WHERE ${where}`, [
				ids.orgA,
				ids.pa,
			])
		).rows[0];
		await db.admin.query(`UPDATE membership SET ${change} WHERE ${where}`, [
			ids.orgA,
			ids.pa,
		]);
		try {
			expect((await as(memberA(), "SELECT 1 FROM branch")).rowCount).toBe(0);
			expect(
				await code(
					as(
						memberA(),
						"INSERT INTO branch (organization_id, name) VALUES ($1, 'x')",
						[ids.orgA],
					),
				),
			).toBe("42501");
		} finally {
			await db.admin.query(
				`UPDATE membership SET status = $3, effective_from = $4, effective_to = $5 WHERE ${where}`,
				[
					ids.orgA,
					ids.pa,
					saved.status,
					saved.effective_from,
					saved.effective_to,
				],
			);
		}
	});

	it("missing context sees nothing and cannot write", async () => {
		const count = await app.query("SELECT count(*)::int AS n FROM branch");
		expect(count.rows[0].n).toBe(0);
		expect(
			await code(
				app.query(
					"INSERT INTO branch (organization_id, name) VALUES ($1, 'x')",
					[ids.orgA],
				),
			),
		).toBe("42501");
	});

	it("cross-tenant association is rejected", async () => {
		expect(
			await code(
				as(
					memberA(),
					"INSERT INTO team (organization_id, branch_id, name) VALUES ($1, $2, 't')",
					[ids.orgA, ids.branchB],
				),
			),
		).toBe("23503");
	});

	it("runtime role cannot escalate", async () => {
		for (const sql of [
			"UPDATE membership SET status = 'active'",
			"UPDATE organization SET name = 'x'",
			"DELETE FROM branch",
			"ALTER TABLE branch DISABLE ROW LEVEL SECURITY",
			`SET ROLE ${adminUser}`,
		])
			expect(await code(as(memberA(), sql)), sql).toBe("42501");
	});

	it("membership constraints hold for admins too", async () => {
		expect(
			await code(
				db.admin.query(
					"INSERT INTO membership (organization_id, principal_id, status) VALUES ($1, $2, 'active')",
					[ids.orgA, ids.pc],
				),
			),
		).toBe("23514");
		expect(
			await code(
				db.admin.query(
					"INSERT INTO membership (organization_id, principal_id, status, approved_by_principal_id, approved_at) VALUES ($1, $2, 'active', $2, now())",
					[ids.orgA, ids.pc],
				),
			),
		).toBe("23514");
	});

	it("migration is safe to re-run in fresh databases when reo_app already exists", async () => {
		const created = await Promise.all([
			createTestDatabase(),
			createTestDatabase(),
		]);
		await Promise.all(created.map((other) => other.drop()));
		expect(created).toHaveLength(2);
	});
});
