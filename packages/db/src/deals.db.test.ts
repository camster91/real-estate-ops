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

const client = async (context: TenantContext, assignee?: string) => {
	const id = randomUUID();
	await as(
		context,
		"INSERT INTO party (organization_id, id, display_name, assigned_principal_id, created_by_principal_id) VALUES ($1, $2, 'Synthetic Client', $3, $4)",
		[
			context.organizationId,
			id,
			assignee ?? context.principalId,
			context.principalId,
		],
	);
	return id;
};

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

const link = (context: TenantContext, dealId: string, partyId: string) =>
	as(
		context,
		"INSERT INTO deal_party (organization_id, deal_id, party_id) VALUES ($1, $2, $3)",
		[context.organizationId, dealId, partyId],
	);

const mine = async () => {
	const id = randomUUID();
	await deal(ctx(ids.orgA, ids.pa), { id });
	return id;
};

const move = (id: string, set: string, context = ctx(ids.orgA, ids.pa)) =>
	as(context, `UPDATE deal SET ${set} WHERE id = $1`, [id]);

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

describe("deal table", () => {
	it("member adds a deal with defaults and links own client", async () => {
		const context = ctx(ids.orgA, ids.pa);
		const id = randomUUID();
		await deal(context, { id }, [await client(context)]);
		const { rows } = await as(
			context,
			"SELECT stage, province, classification, version FROM deal WHERE id = $1",
			[id],
		);
		expect(rows).toEqual([
			{
				stage: "draft",
				province: "ON",
				classification: "personal",
				version: 1,
			},
		]);
		const links = await as(
			context,
			"SELECT count(*)::int AS n FROM deal_party WHERE deal_id = $1",
			[id],
		);
		expect(links.rows[0].n).toBe(1);
	});

	it("a deal needs at least one client", async () => {
		expect(
			await failure(
				as(ctx(ids.orgA, ids.pa), DEAL, [
					ids.orgA,
					randomUUID(),
					"buyer",
					"1 Main St",
					null,
					"Ottawa",
					"K1A 0B1",
					ids.pa,
					ids.pa,
				]),
			),
		).toMatchObject({
			code: "23514",
			message: "a deal needs at least one client",
		});
	});

	it("a deal has at most four clients", async () => {
		const context = ctx(ids.orgA, ids.pa);
		const four = await Promise.all([1, 2, 3, 4].map(() => client(context)));
		expect(await code(deal(context, {}, four))).toBe("no error");
		expect(
			await failure(deal(context, {}, [...four, await client(context)])),
		).toMatchObject({ code: "23514", message: "a deal has at most 4 clients" });
	});

	it("clients cannot be linked after the deal is created", async () => {
		const context = ctx(ids.orgA, ids.pa);
		const id = await mine();
		expect(
			await failure(link(context, id, await client(context))),
		).toMatchObject({ code: "23514", message: "deal clients are fixed" });
		// The owner too.
		expect(
			await failure(
				db.admin.query(
					"INSERT INTO deal_party (organization_id, deal_id, party_id) VALUES ($1, $2, $3)",
					[ids.orgA, id, await client(context)],
				),
			),
		).toMatchObject({ code: "23514", message: "deal clients are fixed" });
	});

	it("another member and another organisation see nothing", async () => {
		const id = await mine();
		for (const other of [ctx(ids.orgA, pa2), ctx(ids.orgB, ids.pb)]) {
			const deals = await as(
				other,
				"SELECT count(*)::int AS n FROM deal WHERE id = $1",
				[id],
			);
			const links = await as(
				other,
				"SELECT count(*)::int AS n FROM deal_party WHERE deal_id = $1",
				[id],
			);
			expect([deals.rows[0].n, links.rows[0].n]).toEqual([0, 0]);
		}
	});

	it.each([
		["assigned to another member", () => ({ assignee: pa2 })],
		["created as another member", () => ({ creator: pa2 })],
		["in another organisation", () => ({ org: ids.orgB })],
	])("cannot add a deal %s", async (_label, values) => {
		expect(await code(deal(ctx(ids.orgA, ids.pa), values()))).toBe("42501");
	});

	it("cannot link another member's client, or to another member's deal", async () => {
		const me = ctx(ids.orgA, ids.pa);
		const them = ctx(ids.orgA, pa2);
		expect(await code(deal(me, {}, [await client(them)]))).toBe("42501");
		const theirDeal = randomUUID();
		await deal(them, { id: theirDeal });
		// Invisible to me, so the link guard refuses it before RLS does.
		expect(await code(link(me, theirDeal, await client(me)))).toBe("23514");
	});

	it("a suspended member sees and adds nothing", async () => {
		const id = await mine();
		const where = "organization_id = $1 AND principal_id = $2";
		await db.admin.query(
			`UPDATE membership SET status = 'suspended' WHERE ${where}`,
			[ids.orgA, ids.pa],
		);
		try {
			const { rows } = await as(
				ctx(ids.orgA, ids.pa),
				"SELECT count(*)::int AS n FROM deal WHERE id = $1",
				[id],
			);
			expect(rows[0].n).toBe(0);
			expect(await code(deal(ctx(ids.orgA, ids.pa)))).toBe("42501");
		} finally {
			await db.admin.query(
				`UPDATE membership SET status = 'active' WHERE ${where}`,
				[ids.orgA, ids.pa],
			);
		}
	});

	it.each([
		["stage", "'firm'"],
		["province", "'BC'"],
		["classification", "'operational'"],
		["version", "5"],
		["created_at", "now() - interval '1 year'"],
	])("cannot set %s on insert", async (column, value) => {
		expect(
			await code(
				as(
					ctx(ids.orgA, ids.pa),
					`INSERT INTO deal (organization_id, id, side, street, city, postal_code, assigned_principal_id, created_by_principal_id, ${column}) VALUES ($1, $2, 'buyer', 'x', 'y', 'K1A 0B1', $3, $3, ${value})`,
					[ids.orgA, randomUUID(), ids.pa],
				),
			),
		).toBe("42501");
	});

	it("no delete and no unlinking", async () => {
		const context = ctx(ids.orgA, ids.pa);
		for (const sql of [
			"DELETE FROM deal",
			"DELETE FROM deal_party",
			"UPDATE deal_party SET party_id = party_id",
		])
			expect(await code(as(context, sql)), sql).toBe("42501");
	});

	it.each<[string, Record<string, string | null>]>([
		["an unknown side", { side: "agent" }],
		["an empty street", { street: "" }],
		["a padded street", { street: " 1 Main" }],
		["a long street", { street: "x".repeat(201) }],
		["a newline in the street", { street: "1\nMain" }],
		["a line separator in the city", { city: "Ott\u2028awa" }],
		["an empty unit", { unit: "" }],
		["a padded unit", { unit: "4 " }],
		["a tab in the unit", { unit: "4\t5" }],
		["an empty city", { city: "" }],
		["a padded city", { city: " Ottawa" }],
		["a long unit", { unit: "x".repeat(21) }],
		["a long city", { city: "x".repeat(101) }],
		["a lower-case postal code", { postal: "k1a 0b1" }],
		["a postal code without a space", { postal: "K1A0B1" }],
		["a BC postal code", { postal: "V6B 1A1" }],
		["a postal code with O", { postal: "K1O 0B1" }],
	])("constraint: %s", async (_label, values) => {
		expect(await code(deal(ctx(ids.orgA, ids.pa), values))).toBe("23514");
	});

	it("tables are forced and not owned by the runtime role", async () => {
		const appUser = (await app.query("SELECT current_user AS u")).rows[0].u;
		for (const table of ["deal", "deal_party"]) {
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

describe("deal stages", () => {
	it("the assigned agent moves a deal; version and time update", async () => {
		const id = await mine();
		await move(id, "stage = 'active', version = version + 1");
		const { rows } = await db.admin.query(
			"SELECT stage, version, stage_changed_at > created_at AS moved FROM deal WHERE id = $1",
			[id],
		);
		expect(rows[0]).toEqual({ stage: "active", version: 2, moved: true });
	});

	it.each([
		["back to draft", ["active"], "draft"],
		["from closed", ["active", "closed"], "active"],
		["from fell through to firm", ["active", "fell_through"], "firm"],
		["to the same stage", ["active"], "active"],
	])("guard refuses a move %s", async (_label, path, to) => {
		const id = await mine();
		for (const stage of path)
			await move(id, `stage = '${stage}', version = version + 1`);
		expect(await code(move(id, `stage = '${to}', version = version + 1`))).toBe(
			"23514",
		);
	});

	it("a deal that fell through reopens as active", async () => {
		const id = await mine();
		await move(id, "stage = 'fell_through', version = version + 1");
		expect(
			await code(move(id, "stage = 'active', version = version + 1")),
		).toBe("no error");
	});

	it.each([
		["an unchanged version", "stage = 'active'"],
		["a version jump", "stage = 'active', version = version + 2"],
	])("guard refuses %s", async (_label, set) => {
		expect(await code(move(await mine(), set))).toBe("23514");
	});

	it.each([
		["street", "'x'"],
		["side", "'seller'"],
		["city", "'x'"],
		["assigned_principal_id", "assigned_principal_id"],
	])("runtime role cannot change %s", async (column, value) => {
		expect(
			await code(
				move(
					await mine(),
					`${column} = ${value}, stage = 'active', version = version + 1`,
				),
			),
		).toBe("42501");
	});

	it.each([
		["organization_id", "$2"],
		["id", "gen_random_uuid()"],
		["side", "'seller'"],
		["street", "'1 Other St'"],
		["unit", "'9'"],
		["city", "'Toronto'"],
		["postal_code", "'M5H 1A1'"],
		["assigned_principal_id", "$3"],
		["created_by_principal_id", "$3"],
		["province", "'QC'"],
		["classification", "'operational'"],
		["created_at", "created_at - interval '1 day'"],
	])("the owner cannot change %s either", async (column, value) => {
		const id = await mine();
		expect(
			await failure(
				db.admin.query(
					`UPDATE deal SET ${column} = ${value}, stage = 'active', version = version + 1 WHERE id = $1 AND $2::uuid IS NOT NULL AND $3::uuid IS NOT NULL`,
					[id, ids.orgB, pa2],
				),
			),
		).toMatchObject({
			code: "23514",
			message: "deal stage change not allowed",
		});
	});

	it("another member cannot move my deal", async () => {
		const id = await mine();
		const { rowCount } = await move(
			id,
			"stage = 'active', version = version + 1",
			ctx(ids.orgA, pa2),
		);
		expect(rowCount).toBe(0);
	});
});
