import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InvalidTenantContextError, withTenant } from "./tenant.js";
import { createTestDatabase, type TestDatabase } from "./testing/harness.js";

const context = {
	organizationId: "0b6c2f4e-1d2a-4c55-9e1f-3a7b8c9d0e1f",
	principalId: "5f0e9d8c-7b6a-4954-8a3b-2c1d0e9f8a7b",
};

let db: TestDatabase;
let pool: pg.Pool;

const setting = async (name: string) =>
	(await pool.query("SELECT current_setting($1, true) AS value", [name]))
		.rows[0].value as string | null;

beforeAll(async () => {
	db = await createTestDatabase({ migrate: false });
	// One connection, so every call below reuses the same pooled session.
	pool = new pg.Pool({ connectionString: db.url, max: 1 });
});

afterAll(async () => {
	await pool.end();
	await db.drop();
});

describe("withTenant", () => {
	it("sets both ids for the transaction", async () => {
		const seen = await withTenant(pool, context, async (client) => {
			const { rows } = await client.query(
				"SELECT current_setting('app.organization_id') AS org, current_setting('app.principal_id') AS principal",
			);
			return rows[0];
		});
		expect(seen).toEqual({
			org: context.organizationId,
			principal: context.principalId,
		});
	});

	it("clears context after commit", async () => {
		await withTenant(pool, context, async () => undefined);
		expect(await setting("app.organization_id")).toBeOneOf(["", null]);
		expect(await setting("app.principal_id")).toBeOneOf(["", null]);
	});

	it("clears context and rolls back after work throws", async () => {
		const failure = new Error("work failed");
		await expect(
			withTenant(pool, context, async (client) => {
				await client.query("CREATE TEMP TABLE t (id int)");
				throw failure;
			}),
		).rejects.toBe(failure);
		expect(await setting("app.organization_id")).toBeOneOf(["", null]);
		const { rows } = await pool.query("SELECT to_regclass('pg_temp.t') AS t");
		expect(rows[0].t).toBeNull();
	});

	it.each([
		"",
		"not-a-uuid",
		"00000000-0000-0000-0000-00000000000g",
		"1'; SET ROLE postgres; --",
	])("rejects malformed id %j before touching the database", async (bad) => {
		const connect = vi.spyOn(pool, "connect");
		try {
			for (const ctx of [
				{ ...context, organizationId: bad },
				{ ...context, principalId: bad },
			])
				await expect(
					withTenant(pool, ctx, async () => undefined),
				).rejects.toBeInstanceOf(InvalidTenantContextError);
			expect(connect).not.toHaveBeenCalled();
		} finally {
			connect.mockRestore();
		}
	});
});
