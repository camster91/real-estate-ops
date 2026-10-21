import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type SeedIds, seedTwoTenants } from "./testing/fixtures.js";
import { createTestDatabase, type TestDatabase } from "./testing/harness.js";

let db: TestDatabase;
let app: pg.Pool;
let ids: SeedIds;

const ISSUER = "https://issuer.invalid";

const code = (promise: Promise<unknown>) =>
	promise.then(
		() => "no error",
		(error: { code?: string }) => error.code,
	);

const one = async (sql: string, params: unknown[] = []) =>
	(await app.query(sql, params)).rows[0];

const resolve = async (issuer: string, subject: string) =>
	(await one("SELECT app.resolve_principal($1, $2) AS id", [issuer, subject]))
		.id as string | null;

const open = async (token: string, principal = ids.pa) =>
	(
		await one(
			"SELECT app.open_session($1, sha256(convert_to($2, 'UTF8'))) AS expires_at",
			[principal, token],
		)
	).expires_at as Date;

const principalOf = async (token: string) =>
	(
		await one(
			"SELECT app.session_principal(sha256(convert_to($1, 'UTF8'))) AS id",
			[token],
		)
	).id as string | null;

const membershipsOf = async (token: string) =>
	(
		await app.query(
			"SELECT app.session_memberships(sha256(convert_to($1, 'UTF8'))) AS id ORDER BY 1",
			[token],
		)
	).rows.map((row) => row.id as string);

const close = (token: string) =>
	app.query("SELECT app.close_session(sha256(convert_to($1, 'UTF8')))", [
		token,
	]);

const sessionWhere = "token_hash = sha256(convert_to($1, 'UTF8'))";

async function suspendA<T>(work: () => Promise<T>): Promise<T> {
	const where = "organization_id = $1 AND principal_id = $2";
	await db.admin.query(
		`UPDATE membership SET status = 'suspended' WHERE ${where}`,
		[ids.orgA, ids.pa],
	);
	try {
		return await work();
	} finally {
		await db.admin.query(
			`UPDATE membership SET status = 'active' WHERE ${where}`,
			[ids.orgA, ids.pa],
		);
	}
}

beforeAll(async () => {
	db = await createTestDatabase();
	app = db.app as pg.Pool;
	ids = await seedTwoTenants(db.admin);
});

afterAll(async () => {
	await db.drop();
});

describe("identity resolution", () => {
	it("resolves a member's identity", async () => {
		expect(await resolve(ISSUER, "synthetic-a")).toBe(ids.pa);
	});

	it("refuses unknown or non-member identities", async () => {
		expect(await resolve(ISSUER, "synthetic-unknown")).toBeNull();
		expect(await resolve("https://other.invalid", "synthetic-a")).toBeNull();
		expect(await resolve(ISSUER, "synthetic-c")).toBeNull();
	});

	it("refuses after the last membership is suspended", async () => {
		expect(await suspendA(() => resolve(ISSUER, "synthetic-a"))).toBeNull();
		expect(await resolve(ISSUER, "synthetic-a")).toBe(ids.pa);
	});
});

describe("sessions", () => {
	it("opens and resolves a session", async () => {
		const expiresAt = await open("t1");
		const row = (
			await db.admin.query(
				`SELECT created_at, expires_at FROM auth_session WHERE ${sessionWhere}`,
				["t1"],
			)
		).rows[0];
		expect(expiresAt.getTime()).toBe(row.expires_at.getTime());
		expect(expiresAt.getTime() - row.created_at.getTime()).toBe(
			12 * 60 * 60 * 1000,
		);
		expect(await principalOf("t1")).toBe(ids.pa);
	});

	it("touching a session moves last_seen_at forward", async () => {
		await open("touch");
		await db.admin.query(
			`UPDATE auth_session SET last_seen_at = now() - interval '20 minutes' WHERE ${sessionWhere}`,
			["touch"],
		);
		expect(await principalOf("touch")).toBe(ids.pa);
		const { rows } = await db.admin.query(
			`SELECT now() - last_seen_at < interval '1 minute' AS fresh FROM auth_session WHERE ${sessionWhere}`,
			["touch"],
		);
		expect(rows[0].fresh).toBe(true);
	});

	it.each([
		[
			"idle",
			(token: string) =>
				db.admin.query(
					`UPDATE auth_session SET last_seen_at = now() - interval '31 minutes' WHERE ${sessionWhere}`,
					[token],
				),
		],
		[
			"absolute",
			(token: string) =>
				db.admin.query(
					`UPDATE auth_session SET created_at = now() - interval '13 hours', last_seen_at = now(), expires_at = now() - interval '1 hour' WHERE ${sessionWhere}`,
					[token],
				),
		],
		["revoked", (token: string) => close(token)],
	])("%s session ends", async (label, end) => {
		const token = `end-${label}`;
		await open(token);
		expect(await principalOf(token)).toBe(ids.pa);
		await end(token);
		expect(await principalOf(token)).toBeNull();
		expect(await membershipsOf(token)).toEqual([]);
	});

	it("will not open a session for a non-member", async () => {
		expect(await open("t-pc", ids.pc)).toBeNull();
		const { rows } = await db.admin.query(
			"SELECT count(*)::int AS n FROM auth_session WHERE principal_id = $1",
			[ids.pc],
		);
		expect(rows[0].n).toBe(0);
	});

	it("session ends when membership is lost", async () => {
		await open("t-member");
		expect(await suspendA(() => principalOf("t-member"))).toBeNull();
		// Reinstating the membership does not revive the old session.
		expect(await principalOf("t-member")).toBeNull();
		const { rows } = await db.admin.query(
			`SELECT revoked_at IS NOT NULL AS revoked FROM auth_session WHERE ${sessionWhere}`,
			["t-member"],
		);
		expect(rows[0].revoked).toBe(true);
	});

	it("lists only active memberships", async () => {
		await db.admin.query(
			"INSERT INTO membership (organization_id, principal_id, status, effective_from) VALUES ($1, $2, 'suspended', now() - interval '1 day')",
			[ids.orgB, ids.pa],
		);
		try {
			await open("t-list");
			expect(await membershipsOf("t-list")).toEqual([ids.orgA]);
			expect(await membershipsOf("t-unknown")).toEqual([]);
		} finally {
			await db.admin.query(
				"DELETE FROM membership WHERE organization_id = $1 AND principal_id = $2",
				[ids.orgB, ids.pa],
			);
		}
	});

	it("runtime role cannot touch sessions directly", async () => {
		for (const sql of [
			"SELECT * FROM auth_session",
			"INSERT INTO auth_session (token_hash, principal_id, expires_at) VALUES (sha256('x'), gen_random_uuid(), now())",
			"UPDATE auth_session SET revoked_at = NULL",
			"DELETE FROM auth_session",
		])
			expect(await code(app.query(sql)), sql).toBe("42501");
		expect(
			await code(app.query("SELECT app.principal_is_active($1)", [ids.pa])),
		).toBe("42501");
		const { rows } = await app.query(
			"SELECT count(*)::int AS n FROM principal",
		);
		expect(rows[0].n).toBe(0);
	});

	it("token hash must be 32 bytes", async () => {
		expect(
			await code(app.query("SELECT app.open_session($1, '\\x01')", [ids.pa])),
		).toBe("23514");
	});

	it("session tables are forced and owned away from the runtime role", async () => {
		const { rows } = await db.admin.query(
			"SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.auth_session'::regclass",
		);
		expect(rows[0]).toEqual({
			relrowsecurity: true,
			relforcerowsecurity: true,
		});
		const owners = await db.admin.query(
			"SELECT DISTINCT pg_get_userbyid(proowner) AS owner, bool_and(prosecdef) AS definer FROM pg_proc WHERE proname IN ('resolve_principal', 'open_session', 'session_principal', 'close_session', 'session_memberships') GROUP BY 1",
		);
		expect(owners.rows).toEqual([{ owner: "reo_auth", definer: true }]);
		const login = await db.admin.query(
			"SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'reo_auth'",
		);
		expect(login.rows[0]).toEqual({
			rolcanlogin: false,
			rolbypassrls: false,
			rolsuper: false,
		});
	});
});
