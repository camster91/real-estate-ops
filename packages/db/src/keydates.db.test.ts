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

const failure = (promise: Promise<unknown>) =>
	promise.then(
		() => ({ code: "no error", message: "" }),
		(error: { code: string; message: string }) => error,
	);

const ctx = (organizationId: string, principalId: string): TenantContext => ({
	organizationId,
	principalId,
	purpose: "operations",
});

const as = (context: TenantContext, sql: string, params: unknown[] = []) =>
	withTenant(app, context, (client) => client.query(sql, params));

const DEAL =
	"INSERT INTO deal (organization_id, id, side, street, unit, city, postal_code, assigned_principal_id, created_by_principal_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)";

/**
 * Adds a deal and links its clients in one transaction, as the API does. With
 * no client ids, a new client of the caller's is made and linked.
 */
const deal = (
	context: TenantContext,
	values: {
		id?: string;
		org?: string;
		side?: string;
		street?: string;
		unit?: string | null;
		city?: string;
		postal?: string;
		assignee?: string;
		creator?: string;
	} = {},
	clientIds?: string[],
) =>
	withTenant(app, context, async (tx) => {
		const id = values.id ?? randomUUID();
		await tx.query(DEAL, [
			values.org ?? context.organizationId,
			id,
			values.side ?? "buyer",
			values.street ?? "12 Main Street",
			values.unit === undefined ? null : values.unit,
			values.city ?? "Ottawa",
			values.postal ?? "K1A 0B1",
			values.assignee ?? context.principalId,
			values.creator ?? context.principalId,
		]);
		let links = clientIds;
		if (!links) {
			const partyId = randomUUID();
			await tx.query(
				"INSERT INTO party (organization_id, id, display_name, assigned_principal_id, created_by_principal_id) VALUES ($1, $2, 'Linked Client', $3, $3)",
				[context.organizationId, partyId, context.principalId],
			);
			links = [partyId];
		}
		for (const partyId of links)
			await tx.query(
				"INSERT INTO deal_party (organization_id, deal_id, party_id) VALUES ($1, $2, $3)",
				[context.organizationId, id, partyId],
			);
	});

const myDeal = async () => {
	const id = randomUUID();
	await deal(ctx(ids.orgA, ids.pa), { id });
	return id;
};

const KEY_DATE =
	"INSERT INTO deal_key_date (organization_id, id, deal_id, kind, label, due_at, created_by_principal_id) VALUES ($1, $2, $3, $4, $5, $6, $7)";

const addDate = (
	context: TenantContext,
	dealId: string,
	values: {
		id?: string;
		kind?: string;
		label?: string | null;
		due?: string;
		by?: string;
	} = {},
) =>
	as(context, KEY_DATE, [
		context.organizationId,
		values.id ?? randomUUID(),
		dealId,
		values.kind ?? "condition",
		values.label === undefined ? "Financing" : values.label,
		values.due ?? "2026-11-02T23:59:00-05:00",
		values.by ?? context.principalId,
	]);

const myDate = async () => {
	const id = randomUUID();
	await addDate(ctx(ids.orgA, ids.pa), await myDeal(), { id });
	return id;
};

const change = (id: string, set: string, context = ctx(ids.orgA, ids.pa)) =>
	as(context, `UPDATE deal_key_date SET ${set} WHERE id = $1 RETURNING *`, [
		id,
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

describe("deal key dates", () => {
	it("the deal's agent adds a key date with defaults", async () => {
		const id = await myDate();
		const { rows } = await as(
			ctx(ids.orgA, ids.pa),
			"SELECT kind, label, done_at, classification, version FROM deal_key_date WHERE id = $1",
			[id],
		);
		expect(rows).toEqual([
			{
				kind: "condition",
				label: "Financing",
				done_at: null,
				classification: "operational",
				version: 1,
			},
		]);
	});

	it("another member or organisation sees, adds and changes nothing", async () => {
		const dealId = await myDeal();
		const id = randomUUID();
		await addDate(ctx(ids.orgA, ids.pa), dealId, { id });
		for (const other of [ctx(ids.orgA, pa2), ctx(ids.orgB, ids.pb)]) {
			const { rows } = await as(
				other,
				"SELECT count(*)::int AS n FROM deal_key_date WHERE id = $1",
				[id],
			);
			expect(rows[0].n).toBe(0);
			expect(
				(await change(id, "label = 'x', version = version + 1", other))
					.rowCount,
			).toBe(0);
		}
		expect(await code(addDate(ctx(ids.orgA, pa2), dealId))).toBe("42501");
		expect(
			await code(addDate(ctx(ids.orgA, ids.pa), dealId, { by: pa2 })),
		).toBe("42501");
	});

	it("a suspended member sees nothing", async () => {
		const id = await myDate();
		const where = "organization_id = $1 AND principal_id = $2";
		await db.admin.query(
			`UPDATE membership SET status = 'suspended' WHERE ${where}`,
			[ids.orgA, ids.pa],
		);
		try {
			const { rows } = await as(
				ctx(ids.orgA, ids.pa),
				"SELECT count(*)::int AS n FROM deal_key_date WHERE id = $1",
				[id],
			);
			expect(rows[0].n).toBe(0);
		} finally {
			await db.admin.query(
				`UPDATE membership SET status = 'active' WHERE ${where}`,
				[ids.orgA, ids.pa],
			);
		}
	});

	it.each([
		["done_at", "now()"],
		["classification", "'personal'"],
		["version", "5"],
		["created_at", "now() - interval '1 year'"],
	])("cannot set %s on insert", async (column, value) => {
		const dealId = await myDeal();
		expect(
			await code(
				as(
					ctx(ids.orgA, ids.pa),
					`INSERT INTO deal_key_date (organization_id, id, deal_id, kind, due_at, created_by_principal_id, ${column}) VALUES ($1, $2, $3, 'closing', now(), $4, ${value})`,
					[ids.orgA, randomUUID(), dealId, ids.pa],
				),
			),
		).toBe("42501");
	});

	it.each<[string, Record<string, string | null>]>([
		["a condition without a label", { kind: "condition", label: null }],
		["other without a label", { kind: "other", label: null }],
		["an unknown kind", { kind: "party" }],
		["an empty label", { label: "" }],
		["a padded label", { label: " Financing" }],
		["a long label", { label: "x".repeat(101) }],
		["a newline in the label", { label: "a\nb" }],
	])("constraint: %s", async (_label, values) => {
		expect(
			await code(addDate(ctx(ids.orgA, ids.pa), await myDeal(), values)),
		).toBe("23514");
	});

	it("deposit and closing need no label", async () => {
		const dealId = await myDeal();
		for (const kind of ["deposit", "closing"])
			expect(
				await code(
					addDate(ctx(ids.orgA, ids.pa), dealId, { kind, label: null }),
				),
			).toBe("no error");
	});

	it("done time comes from the server clock", async () => {
		const id = await myDate();
		const done = await change(
			id,
			"done_at = '2000-01-01T00:00:00Z', version = version + 1",
		);
		const first = done.rows[0].done_at as Date;
		expect(first.getFullYear()).toBeGreaterThan(2000);
		const still = await change(
			id,
			"label = 'Inspection', done_at = '2001-01-01T00:00:00Z', version = version + 1",
		);
		expect((still.rows[0].done_at as Date).getTime()).toBe(first.getTime());
		const reopened = await change(id, "done_at = NULL, version = version + 1");
		expect(reopened.rows[0]).toMatchObject({ done_at: null, version: 4 });
	});

	it.each([
		["an unchanged version", "label = 'X'"],
		["a version jump", "label = 'X', version = version + 2"],
	])("guard refuses %s", async (_label, set) => {
		expect(await code(change(await myDate(), set))).toBe("23514");
	});

	it.each([
		["kind", "'other'"],
		["deal_id", "deal_id"],
		["classification", "'personal'"],
		["updated_at", "now()"],
	])("runtime role cannot change %s", async (column, value) => {
		expect(
			await code(
				change(await myDate(), `${column} = ${value}, version = version + 1`),
			),
		).toBe("42501");
	});

	it.each([
		["organization_id", "$2"],
		["id", "gen_random_uuid()"],
		["deal_id", "$3"],
		["kind", "'other'"],
		["created_by_principal_id", "$4"],
		["classification", "'personal'"],
		["created_at", "created_at - interval '1 day'"],
	])("the owner cannot change %s either", async (column, value) => {
		const id = await myDate();
		const otherDeal = await myDeal();
		expect(
			await failure(
				db.admin.query(
					`UPDATE deal_key_date SET ${column} = ${value}, version = version + 1 WHERE id = $1 AND $2::uuid IS NOT NULL AND $3::uuid IS NOT NULL AND $4::uuid IS NOT NULL`,
					[id, ids.orgB, otherDeal, pa2],
				),
			),
		).toMatchObject({ code: "23514", message: "key date change not allowed" });
	});

	it("no delete", async () => {
		expect(
			await code(as(ctx(ids.orgA, ids.pa), "DELETE FROM deal_key_date")),
		).toBe("42501");
	});

	it("table is forced and not owned by the runtime role", async () => {
		const appUser = (await app.query("SELECT current_user AS u")).rows[0].u;
		const { rows } = await db.admin.query(
			"SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.deal_key_date'::regclass",
		);
		expect(rows[0]).toMatchObject({
			relrowsecurity: true,
			relforcerowsecurity: true,
		});
		expect(rows[0].owner).not.toBe(appUser);
	});
});
