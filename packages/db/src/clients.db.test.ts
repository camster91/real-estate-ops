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

	it("no delete", async () => {
		expect(await code(as(ctx(ids.orgA, ids.pa), "DELETE FROM party"))).toBe(
			"42501",
		);
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
		["an email with mailto parameters", { email: "a@b.ca?subject=hi" }],
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

describe("client edits", () => {
	const mine = async () => {
		const id = randomUUID();
		await create(ctx(ids.orgA, ids.pa), { id, email: "old@example.invalid" });
		return id;
	};
	const edit = (
		id: string,
		set: string,
		context = ctx(ids.orgA, ids.pa),
		params: unknown[] = [],
	) => as(context, `UPDATE party SET ${set} WHERE id = $1`, [id, ...params]);

	it("assignee edits name, email and phone with version + 1", async () => {
		const id = await mine();
		const result = await edit(
			id,
			"display_name = 'New Name', email = NULL, phone = '4165550100', version = version + 1",
		);
		expect(result.rowCount).toBe(1);
		const { rows } = await db.admin.query(
			"SELECT display_name, email, phone, version, updated_at > created_at AS moved FROM party WHERE id = $1",
			[id],
		);
		expect(rows[0]).toEqual({
			display_name: "New Name",
			email: null,
			phone: "4165550100",
			version: 2,
			moved: true,
		});
	});

	it.each([
		["an unchanged version", "display_name = 'X'"],
		["a version jump", "display_name = 'X', version = version + 2"],
	])("guard refuses %s", async (_label, set) => {
		expect(await code(edit(await mine(), set))).toBe("23514");
	});

	it.each([
		["organization_id", "$2"],
		["id", "gen_random_uuid()"],
		["kind", "'organization'"],
		["assigned_principal_id", "$3"],
		["created_by_principal_id", "$3"],
		["classification", "'operational'"],
		["created_at", "created_at - interval '1 day'"],
	])("the owner cannot change %s either", async (column, value) => {
		const id = await mine();
		const error = await db.admin
			.query(
				`UPDATE party SET ${column} = ${value}, version = version + 1 WHERE id = $1 AND $2::uuid IS NOT NULL AND $3::uuid IS NOT NULL`,
				[id, ids.orgB, pa2],
			)
			.then(
				() => ({ code: "no error", message: "" }),
				(e: { code: string; message: string }) => e,
			);
		expect(error).toMatchObject({
			code: "23514",
			message: "client edit not allowed",
		});
	});

	it.each([
		["kind", "'person'"],
		["classification", "'operational'"],
		["assigned_principal_id", "assigned_principal_id"],
		["created_at", "now()"],
		["updated_at", "now()"],
	])("runtime role cannot set %s", async (column, value) => {
		expect(
			await code(
				edit(await mine(), `${column} = ${value}, version = version + 1`),
			),
		).toBe("42501");
	});

	it("another member cannot edit", async () => {
		const id = await mine();
		expect(
			(
				await edit(
					id,
					"display_name = 'X', version = version + 1",
					ctx(ids.orgA, pa2),
				)
			).rowCount,
		).toBe(0);
	});

	it("creator who is not the assignee cannot edit", async () => {
		const id = randomUUID();
		await db.admin.query(
			"INSERT INTO party (organization_id, id, display_name, assigned_principal_id, created_by_principal_id) VALUES ($1, $2, 'Assigned away', $3, $4)",
			[ids.orgA, id, pa2, ids.pa],
		);
		expect(
			(await edit(id, "display_name = 'X', version = version + 1")).rowCount,
		).toBe(0);
	});

	it("constraints still hold on edit", async () => {
		expect(
			await code(
				edit(
					await mine(),
					"email = 'UPPER@example.invalid', version = version + 1",
				),
			),
		).toBe("23514");
	});
});

describe("consent records", () => {
	const CONSENT =
		"INSERT INTO consent_record (organization_id, id, party_id, purpose, status, method, recorded_by_principal_id) VALUES ($1, $2, $3, $4, $5, $6, $7)";
	const record = (
		partyId: string,
		values: {
			purpose?: string;
			status?: string;
			method?: string;
			by?: string;
		} = {},
		context = ctx(ids.orgA, ids.pa),
	) =>
		as(context, CONSENT, [
			context.organizationId,
			randomUUID(),
			partyId,
			values.purpose ?? "market_updates",
			values.status ?? "granted",
			values.method ?? "written",
			values.by ?? context.principalId,
		]);
	const client = async (assignee = ids.pa) => {
		const id = randomUUID();
		await db.admin.query(
			"INSERT INTO party (organization_id, id, display_name, assigned_principal_id, created_by_principal_id) VALUES ($1, $2, 'Consenting', $3, $3)",
			[ids.orgA, id, assignee],
		);
		return id;
	};

	it("assignee records a grant and a withdrawal; both stay", async () => {
		const partyId = await client();
		await record(partyId);
		await record(partyId, { status: "withdrawn", method: "verbal" });
		const { rows } = await as(
			ctx(ids.orgA, ids.pa),
			"SELECT status, method FROM consent_record WHERE party_id = $1 ORDER BY recorded_at, status DESC",
			[partyId],
		);
		expect(rows).toEqual([
			{ status: "granted", method: "written" },
			{ status: "withdrawn", method: "verbal" },
		]);
	});

	it("the runtime role has no update or delete grant", async () => {
		const partyId = await client();
		await record(partyId);
		for (const sql of [
			"UPDATE consent_record SET status = 'withdrawn'",
			"DELETE FROM consent_record",
			"TRUNCATE consent_record",
		])
			expect(await code(as(ctx(ids.orgA, ids.pa), sql)), sql).toBe("42501");
	});

	// The trigger, not a grant: the owner has every privilege. The owner can
	// still disable the trigger; see ADR 0020 for that limit.
	it.each([
		"UPDATE consent_record SET status = 'withdrawn' WHERE party_id = $1",
		"DELETE FROM consent_record WHERE party_id = $1",
		"TRUNCATE consent_record",
	])("the trigger refuses the owner: %s", async (sql) => {
		const partyId = await client();
		await record(partyId);
		const error = await db.admin
			.query(sql, sql.includes("$1") ? [partyId] : [])
			.then(
				() => ({ code: "no error", message: "" }),
				(e: { code: string; message: string }) => e,
			);
		expect(error).toMatchObject({
			code: "42501",
			message: "consent_record is append-only",
		});
	});

	it("table is forced and not owned by the runtime role", async () => {
		const appUser = (await app.query("SELECT current_user AS u")).rows[0].u;
		const { rows } = await db.admin.query(
			"SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.consent_record'::regclass",
		);
		expect(rows[0]).toMatchObject({
			relrowsecurity: true,
			relforcerowsecurity: true,
		});
		expect(rows[0].owner).not.toBe(appUser);
	});

	it("cannot record for a client assigned to someone else, or as someone else", async () => {
		const theirs = await client(pa2);
		expect(await code(record(theirs))).toBe("42501");
		const mineId = await client();
		expect(await code(record(mineId, { by: pa2 }))).toBe("42501");
	});

	it("another member sees no consent for my client", async () => {
		const partyId = await client();
		await record(partyId);
		const { rows } = await as(
			ctx(ids.orgA, pa2),
			"SELECT count(*)::int AS n FROM consent_record WHERE party_id = $1",
			[partyId],
		);
		expect(rows[0].n).toBe(0);
	});

	it.each([
		["purpose", { purpose: "spam" }],
		["status", { status: "maybe" }],
		["method", { method: "guessed" }],
	])("unknown %s is refused", async (_label, values) => {
		expect(await code(record(await client(), values))).toBe("23514");
	});

	it("recorded_at cannot be backdated", async () => {
		const partyId = await client();
		expect(
			await code(
				as(
					ctx(ids.orgA, ids.pa),
					"INSERT INTO consent_record (organization_id, id, party_id, purpose, status, method, recorded_by_principal_id, recorded_at) VALUES ($1, $2, $3, 'market_updates', 'granted', 'written', $4, now() - interval '1 year')",
					[ids.orgA, randomUUID(), partyId, ids.pa],
				),
			),
		).toBe("42501");
	});

	it("table is forced", async () => {
		const { rows } = await db.admin.query(
			"SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.consent_record'::regclass",
		);
		expect(rows[0]).toEqual({
			relrowsecurity: true,
			relforcerowsecurity: true,
		});
	});
});
