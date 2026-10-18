import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	MigrationChecksumError,
	MigrationNameError,
	migrate,
} from "./migrate.js";
import { createTestDatabase, type TestDatabase } from "./testing/harness.js";

let db: TestDatabase;
let dir: string;

const write = (name: string, sql: string) => writeFile(join(dir, name), sql);
const exists = async (table: string) =>
	(await db.admin.query("SELECT to_regclass($1) AS t", [table])).rows[0].t !==
	null;
const ledger = async () =>
	(
		await db.admin.query(
			"SELECT version, checksum FROM schema_migrations ORDER BY version",
		)
	).rows as { version: string; checksum: string }[];
const run = async () => {
	const client = await db.admin.connect();
	try {
		return await migrate(client, dir);
	} finally {
		client.release();
	}
};

beforeEach(async () => {
	db = await createTestDatabase({ migrate: false });
	dir = await mkdtemp(join(tmpdir(), "reo-migrations-"));
	await write("0001_a.sql", "CREATE TABLE a (id int);");
	await write("0002_b.sql", "CREATE TABLE b (id int);");
});

afterEach(async () => {
	await db.drop();
	await rm(dir, { recursive: true, force: true });
});

describe("migrate", () => {
	it("applies pending migrations in order and records checksums", async () => {
		const result = await run();
		expect(result.applied).toEqual(["0001_a", "0002_b"]);
		const rows = await ledger();
		expect(rows.map((row) => row.version)).toEqual(["0001_a", "0002_b"]);
		for (const row of rows) expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
		expect(await exists("a")).toBe(true);
		expect(await exists("b")).toBe(true);
	});

	it("is a no-op on a second run", async () => {
		await run();
		expect(await run()).toEqual({
			applied: [],
			skipped: ["0001_a", "0002_b"],
		});
	});

	it("refuses a changed applied migration", async () => {
		await run();
		await write("0001_a.sql", "CREATE TABLE a (id bigint);");
		await write("0003_c.sql", "CREATE TABLE c (id int);");
		const error = await run().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(MigrationChecksumError);
		expect((error as MigrationChecksumError).version).toBe("0001_a");
		expect(await exists("c")).toBe(false);
	});

	it("rolls back a failing migration completely", async () => {
		await write("0002_b.sql", "CREATE TABLE b (id int); SELECT 1/0;");
		await expect(run()).rejects.toThrow();
		expect(await exists("b")).toBe(false);
		expect((await ledger()).map((row) => row.version)).toEqual(["0001_a"]);
	});

	it("applies each migration once under concurrent runs", async () => {
		const [first, second] = await Promise.all([run(), run()]);
		expect(first.applied.length + second.applied.length).toBe(2);
		expect(await ledger()).toHaveLength(2);
	});

	it("rejects badly named files", async () => {
		await write("1_x.sql", "SELECT 1;");
		await expect(run()).rejects.toBeInstanceOf(MigrationNameError);
		expect(await exists("a")).toBe(false);
	});
});
