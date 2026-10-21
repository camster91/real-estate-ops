import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MissingTenantContextError, recordChange } from "./audit.js";
import { type TenantContext, withTenant } from "./tenant.js";
import { type SeedIds, seedTwoTenants } from "./testing/fixtures.js";
import { createTestDatabase, type TestDatabase } from "./testing/harness.js";

let db: TestDatabase;
let app: pg.Pool;
let ids: SeedIds;

const code = (promise: Promise<unknown>) =>
	promise.then(
		() => "no error",
		(error: { code?: string }) => error.code,
	);

const memberA = (): TenantContext => ({
	organizationId: ids.orgA,
	principalId: ids.pa,
	purpose: "operations",
});

const as = (ctx: TenantContext, sql: string, params: unknown[] = []) =>
	withTenant(app, ctx, (client) => client.query(sql, params));

const insertAudit = `INSERT INTO audit_event (organization_id, actor_principal_id, action, resource_type, resource_id, purpose, correlation_id, details)
	VALUES ($1, $2, 'branch.create', 'branch', gen_random_uuid(), 'operations', gen_random_uuid(), $3::jsonb)`;
const insertOutbox = `INSERT INTO outbox_event (organization_id, actor_principal_id, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, correlation_id, payload)
	VALUES ($1, $2, 'branch.created', 1, 'branch', $3, 1, gen_random_uuid(), '{}')`;

const count = async (table: string) =>
	(await db.admin.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]
		.n as number;

beforeAll(async () => {
	db = await createTestDatabase();
	app = db.app as pg.Pool;
	ids = await seedTwoTenants(db.admin);
});

afterAll(async () => {
	await db.drop();
});

describe("audit and outbox tables", () => {
	it("runtime role inserts its own audit and outbox rows", async () => {
		const audits = await count("audit_event");
		const events = await count("outbox_event");
		await as(memberA(), insertAudit, [ids.orgA, ids.pa, "{}"]);
		await as(memberA(), insertOutbox, [
			ids.orgA,
			ids.pa,
			"00000000-0000-4000-8000-000000000001",
		]);
		expect(await count("audit_event")).toBe(audits + 1);
		expect(await count("outbox_event")).toBe(events + 1);
	});

	it.each([
		["another organisation", () => [ids.orgB, ids.pa]],
		["another principal", () => [ids.orgA, ids.pb]],
		["the approver", () => [ids.orgA, ids.approver]],
	])("forged %s is refused", async (_label, values) => {
		const [org, actor] = values();
		expect(await code(as(memberA(), insertAudit, [org, actor, "{}"]))).toBe(
			"42501",
		);
		expect(
			await code(
				as(memberA(), insertOutbox, [
					org,
					actor,
					"00000000-0000-4000-8000-000000000002",
				]),
			),
		).toBe("42501");
	});

	it("inactive member cannot write", async () => {
		const where = "organization_id = $1 AND principal_id = $2";
		await db.admin.query(
			`UPDATE membership SET status = 'suspended' WHERE ${where}`,
			[ids.orgA, ids.pa],
		);
		try {
			expect(
				await code(as(memberA(), insertAudit, [ids.orgA, ids.pa, "{}"])),
			).toBe("42501");
		} finally {
			await db.admin.query(
				`UPDATE membership SET status = 'active' WHERE ${where}`,
				[ids.orgA, ids.pa],
			);
		}
	});

	it("runtime role cannot read, change or delete", async () => {
		for (const table of ["audit_event", "outbox_event"])
			for (const sql of [
				`SELECT * FROM ${table}`,
				`UPDATE ${table} SET correlation_id = gen_random_uuid()`,
				`DELETE FROM ${table}`,
			])
				expect(await code(as(memberA(), sql)), sql).toBe("42501");
	});

	it("audit is append-only even for the owner", async () => {
		await as(memberA(), insertAudit, [ids.orgA, ids.pa, "{}"]);
		for (const sql of [
			"UPDATE audit_event SET action = 'x.y'",
			"DELETE FROM audit_event",
			"TRUNCATE audit_event",
		])
			expect(await code(db.admin.query(sql)), sql).toBe("42501");
		expect(await count("audit_event")).toBeGreaterThan(0);
	});

	it("constraints hold", async () => {
		expect(
			await code(as(memberA(), insertAudit, [ids.orgA, ids.pa, "[1]"])),
		).toBe("23514");
		const big = JSON.stringify({ blob: "x".repeat(5000) });
		expect(
			await code(as(memberA(), insertAudit, [ids.orgA, ids.pa, big])),
		).toBe("23514");
		expect(
			await code(
				as(memberA(), insertAudit.replace("'branch.create'", "'Task.Create'"), [
					ids.orgA,
					ids.pa,
					"{}",
				]),
			),
		).toBe("23514");
		const aggregate = "00000000-0000-4000-8000-000000000003";
		await as(memberA(), insertOutbox, [ids.orgA, ids.pa, aggregate]);
		expect(
			await code(as(memberA(), insertOutbox, [ids.orgA, ids.pa, aggregate])),
		).toBe("23505");
	});

	it("tables are forced and not owned by the runtime role", async () => {
		const appUser = (await app.query("SELECT current_user AS u")).rows[0].u;
		for (const table of ["audit_event", "outbox_event"]) {
			const { rows } = await db.admin.query(
				"SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = $1::regclass",
				[`public.${table}`],
			);
			expect(rows[0]).toMatchObject({
				relrowsecurity: true,
				relforcerowsecurity: true,
			});
			expect(rows[0].owner).not.toBe(appUser);
		}
	});
});

describe("recordChange", () => {
	const branchChange = (resourceId: string) => ({
		action: "branch.create",
		resourceType: "branch",
		resourceId,
		details: { name: "Synthetic", status: "new" },
		event: {
			type: "branch.created",
			schemaVersion: 1,
			aggregateVersion: 1,
			payload: { branchId: resourceId },
		},
	});

	const createBranch = async (client: pg.PoolClient) =>
		(
			await client.query(
				"INSERT INTO branch (organization_id, name) VALUES (app.current_organization_id(), 'Synthetic Audited') RETURNING id",
			)
		).rows[0].id as string;

	it("change, audit and event commit together", async () => {
		const { branchId, result } = await withTenant(
			app,
			memberA(),
			async (client) => {
				const branchId = await createBranch(client);
				return {
					branchId,
					result: await recordChange(client, branchChange(branchId)),
				};
			},
		);
		const audit = (
			await db.admin.query("SELECT * FROM audit_event WHERE id = $1", [
				result.auditId,
			])
		).rows[0];
		expect(audit).toMatchObject({
			organization_id: ids.orgA,
			actor_principal_id: ids.pa,
			action: "branch.create",
			resource_type: "branch",
			resource_id: branchId,
			purpose: "operations",
			correlation_id: result.correlationId,
			details: { name: "[redacted]", status: "new" },
		});
		const event = (
			await db.admin.query("SELECT * FROM outbox_event WHERE id = $1", [
				result.eventId,
			])
		).rows[0];
		expect(event).toMatchObject({
			organization_id: ids.orgA,
			actor_principal_id: ids.pa,
			event_type: "branch.created",
			schema_version: 1,
			aggregate_type: "branch",
			aggregate_id: branchId,
			aggregate_version: 1,
			correlation_id: result.correlationId,
			causation_id: null,
			payload: { branchId },
			published_at: null,
		});
	});

	it("rollback leaves nothing", async () => {
		const before = await Promise.all(
			["branch", "audit_event", "outbox_event"].map(count),
		);
		await expect(
			withTenant(app, memberA(), async (client) => {
				const branchId = await createBranch(client);
				await recordChange(client, branchChange(branchId));
				throw new Error("synthetic failure");
			}),
		).rejects.toThrow("synthetic failure");
		const after = await Promise.all(
			["branch", "audit_event", "outbox_event"].map(count),
		);
		expect(after).toEqual(before);
	});

	it("outside a tenant context fails", async () => {
		const before = await count("audit_event");
		const client = await app.connect();
		try {
			await client.query("BEGIN");
			await expect(
				recordChange(
					client,
					branchChange("00000000-0000-4000-8000-000000000009"),
				),
			).rejects.toBeInstanceOf(MissingTenantContextError);
			await client.query("ROLLBACK");
		} finally {
			client.release();
		}
		expect(await count("audit_event")).toBe(before);
	});

	it("given correlation id is kept", async () => {
		const correlationId = "00000000-0000-4000-8000-0000000000aa";
		const result = await withTenant(app, memberA(), async (client) =>
			recordChange(client, {
				...branchChange(await createBranch(client)),
				correlationId,
			}),
		);
		expect(result.correlationId).toBe(correlationId);
		const { rows } = await db.admin.query(
			"SELECT count(*)::int AS n FROM outbox_event WHERE correlation_id = $1",
			[correlationId],
		);
		expect(rows[0].n).toBe(1);
	});
});
