import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TenantContext, withTenant } from "./tenant.js";
import { grant, type SeedIds, seedTwoTenants } from "./testing/fixtures.js";
import { createTestDatabase, type TestDatabase } from "./testing/harness.js";

let db: TestDatabase;
let app: pg.Pool;
let ids: SeedIds;
const recordA: Record<number, string> = {};
const grants: Record<number, string> = {};

const as = (ctx: TenantContext, sql: string, params: unknown[] = []) =>
	withTenant(app, ctx, (client) => client.query(sql, params));

const code = (promise: Promise<unknown>) =>
	promise.then(
		() => "no error",
		(error: { code?: string }) => error.code,
	);

const ctx = (organizationId: string, principalId: string): TenantContext => ({
	organizationId,
	principalId,
	purpose: "client_service",
});
const memberA = () => ctx(ids.orgA, ids.pa);

// The list filter every client-record query must use (ADR 0011).
const readable =
	"EXISTS (SELECT 1 FROM app.readable_record rr WHERE rr.resource_type = 'fixture_record' AND rr.resource_id = f.id AND rr.classification = f.classification)";

const visible = async (context: TenantContext, suffix = "") =>
	(
		await as(
			context,
			`SELECT n FROM fixture_record f WHERE ${readable} ORDER BY n ${suffix}`,
		)
	).rows.map((row) => row.n as number);

beforeAll(async () => {
	db = await createTestDatabase();
	app = db.app as pg.Pool;
	ids = await seedTwoTenants(db.admin);
	// Test-only record table with the 0001 tenant policy shape.
	await db.admin.query(`
		CREATE TABLE fixture_record (
			organization_id uuid NOT NULL REFERENCES organization,
			id uuid NOT NULL DEFAULT gen_random_uuid(),
			classification text NOT NULL,
			n int NOT NULL,
			PRIMARY KEY (organization_id, id)
		);
		ALTER TABLE fixture_record ENABLE ROW LEVEL SECURITY;
		ALTER TABLE fixture_record FORCE ROW LEVEL SECURITY;
		CREATE POLICY fixture_tenant ON fixture_record FOR SELECT USING (
			organization_id = (SELECT app.current_organization_id())
			AND (SELECT app.has_active_membership())
		);
		GRANT SELECT ON fixture_record TO reo_app;
	`);
	for (let n = 1; n <= 5; n++)
		recordA[n] = (
			await db.admin.query(
				"INSERT INTO fixture_record (organization_id, classification, n) VALUES ($1, 'operational', $2) RETURNING id",
				[ids.orgA, n],
			)
		).rows[0].id;
	for (let n = 1; n <= 2; n++)
		await db.admin.query(
			"INSERT INTO fixture_record (organization_id, classification, n) VALUES ($1, 'operational', $2)",
			[ids.orgB, n],
		);
	for (const n of [2, 4])
		grants[n] = await grant(db.admin, {
			org: ids.orgA,
			principal: ids.pa,
			action: "record.read",
			resourceType: "fixture_record",
			resourceId: recordA[n] as string,
			grantor: ids.approver,
		});
});

afterAll(async () => {
	await db.drop();
});

describe("access grants", () => {
	it("lists and counts only granted records", async () => {
		const count = await as(
			memberA(),
			`SELECT count(*)::int AS n FROM fixture_record f WHERE ${readable}`,
		);
		expect(count.rows[0].n).toBe(2);
		expect(await visible(memberA())).toEqual([2, 4]);
	});

	it("paginates after filtering", async () => {
		expect(await visible(memberA(), "LIMIT 1 OFFSET 1")).toEqual([4]);
		expect(await visible(memberA(), "LIMIT 1 OFFSET 2")).toEqual([]);
	});

	it("ignores look-alike grants", async () => {
		const extra: string[] = [];
		await db.admin.query(
			"INSERT INTO membership (organization_id, principal_id, status, approved_by_principal_id, approved_at, effective_from) VALUES ($1, $2, 'active', $3, now(), now() - interval '1 day')",
			[ids.orgA, ids.pb, ids.approver],
		);
		try {
			extra.push(
				await grant(db.admin, {
					org: ids.orgA,
					principal: ids.pb,
					action: "record.read",
					resourceType: "fixture_record",
					resourceId: recordA[1] as string,
					grantor: ids.approver,
				}),
				await grant(db.admin, {
					org: ids.orgB,
					principal: ids.pb,
					action: "record.read",
					resourceType: "fixture_record",
					resourceId: recordA[3] as string,
					grantor: ids.approver,
				}),
				await grant(db.admin, {
					org: ids.orgA,
					principal: ids.pa,
					action: "record.read",
					resourceType: "other_type",
					resourceId: recordA[5] as string,
					grantor: ids.approver,
				}),
			);
			expect(await visible(memberA())).toEqual([2, 4]);
			expect(await visible(ctx(ids.orgB, ids.pb))).toEqual([]);
		} finally {
			await db.admin.query("DELETE FROM access_grant WHERE id = ANY($1)", [
				extra,
			]);
			await db.admin.query(
				"DELETE FROM membership WHERE organization_id = $1 AND principal_id = $2",
				[ids.orgA, ids.pb],
			);
		}
	});

	it.each([
		["wrong purpose", "purpose = 'marketing'"],
		["wrong classification", "classification = 'personal'"],
		[
			"expired",
			"valid_from = now() - interval '2 days', expires_at = now() - interval '1 day'",
		],
		[
			"not yet valid",
			"valid_from = now() + interval '1 day', expires_at = now() + interval '2 days'",
		],
		["revoked", "revoked_at = now()"],
	])("%s grant does not grant", async (_label, change) => {
		const id = grants[2];
		const saved = (
			await db.admin.query("SELECT * FROM access_grant WHERE id = $1", [id])
		).rows[0];
		await db.admin.query(`UPDATE access_grant SET ${change} WHERE id = $1`, [
			id,
		]);
		try {
			expect(await visible(memberA())).toEqual([4]);
		} finally {
			await db.admin.query(
				"UPDATE access_grant SET purpose = $2, classification = $3, valid_from = $4, expires_at = $5, revoked_at = $6 WHERE id = $1",
				[
					id,
					saved.purpose,
					saved.classification,
					saved.valid_from,
					saved.expires_at,
					saved.revoked_at,
				],
			);
		}
	});

	it("inactive membership hides all grants", async () => {
		const where = "organization_id = $1 AND principal_id = $2";
		await db.admin.query(
			`UPDATE membership SET status = 'suspended' WHERE ${where}`,
			[ids.orgA, ids.pa],
		);
		try {
			expect(await visible(memberA())).toEqual([]);
			const own = await as(
				memberA(),
				"SELECT count(*)::int AS n FROM access_grant",
			);
			expect(own.rows[0].n).toBe(0);
			const readable = await as(
				memberA(),
				"SELECT count(*)::int AS n FROM app.readable_record",
			);
			expect(readable.rows[0].n).toBe(0);
		} finally {
			await db.admin.query(
				`UPDATE membership SET status = 'active' WHERE ${where}`,
				[ids.orgA, ids.pa],
			);
		}
	});

	it("runtime role cannot write grants", async () => {
		const attempts: [string, unknown[]][] = [
			[
				"INSERT INTO access_grant (organization_id, principal_id, action, resource_type, resource_id, classification, purpose, expires_at, granted_by_principal_id) VALUES ($1, $2, 'record.read', 'fixture_record', $3, 'operational', 'client_service', now() + interval '1 day', $4)",
				[ids.orgA, ids.pa, recordA[1], ids.approver],
			],
			["UPDATE access_grant SET expires_at = now() + interval '10 years'", []],
			["UPDATE access_grant SET revoked_at = NULL", []],
			["DELETE FROM access_grant", []],
		];
		for (const [sql, params] of attempts)
			expect(await code(as(memberA(), sql, params)), sql).toBe("42501");
	});

	it("grant constraints hold for admins", async () => {
		const base = {
			org: ids.orgA,
			principal: ids.pa,
			action: "record.read",
			resourceType: "fixture_record",
			resourceId: recordA[1] as string,
			grantor: ids.approver,
		};
		expect(await code(grant(db.admin, { ...base, grantor: ids.pa }))).toBe(
			"23514",
		);
		expect(
			await code(grant(db.admin, { ...base, action: "record.update" })),
		).toBe("23514");
		expect(await code(grant(db.admin, { ...base, principal: ids.pc }))).toBe(
			"23503",
		);
		expect(
			await code(
				db.admin.query(
					"INSERT INTO access_grant (organization_id, principal_id, action, resource_type, resource_id, classification, purpose, expires_at, granted_by_principal_id) VALUES ($1, $2, 'record.read', 'fixture_record', $3, 'operational', 'client_service', NULL, $4)",
					[ids.orgA, ids.pa, recordA[1], ids.approver],
				),
			),
		).toBe("23502");
	});

	it("read filter becomes a join, not a per-row subquery", async () => {
		const plan = (
			await as(
				memberA(),
				`EXPLAIN SELECT n FROM fixture_record f WHERE ${readable}`,
			)
		).rows
			.map((row) => row["QUERY PLAN"] as string)
			.join("\n");
		expect(plan).toMatch(/Nested Loop|Join/);
		expect(plan).toContain("access_grant_lookup");
		expect(plan).not.toMatch(/SubPlan/);
	});

	it("grant table is forced and not owned by the runtime role", async () => {
		const appUser = (await app.query("SELECT current_user AS u")).rows[0].u;
		const { rows } = await db.admin.query(
			"SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.access_grant'::regclass",
		);
		expect(rows[0]).toMatchObject({
			relrowsecurity: true,
			relforcerowsecurity: true,
		});
		expect(rows[0].owner).not.toBe(appUser);
	});
});
