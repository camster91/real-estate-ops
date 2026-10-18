import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

/** Bundled migrations; resolves from both src/ (tests) and dist/ (build). */
export const migrationsDirectory = fileURLToPath(
	new URL("../migrations", import.meta.url),
);

export class MigrationNameError extends Error {
	constructor(file: string) {
		super(`Migration file name must match NNNN_name.sql: ${file}`);
		this.name = "MigrationNameError";
	}
}

export class MigrationChecksumError extends Error {
	constructor(readonly version: string) {
		super(
			`Applied migration ${version} has changed; add a new migration instead`,
		);
		this.name = "MigrationChecksumError";
	}
}

export interface MigrationResult {
	applied: string[];
	skipped: string[];
}

const fileName = /^\d{4}_[a-z0-9_]+\.sql$/;
// Arbitrary constant key shared by every runner of this repository's migrations.
const lockKey = 7212026;

async function readMigrations(directory: string) {
	const files = (await readdir(directory))
		.filter((file) => file.endsWith(".sql"))
		.sort();
	for (const file of files)
		if (!fileName.test(file)) throw new MigrationNameError(file);
	return Promise.all(
		files.map(async (file) => {
			const sql = await readFile(join(directory, file));
			return {
				version: file.slice(0, -".sql".length),
				sql: sql.toString("utf8"),
				checksum: createHash("sha256").update(sql).digest("hex"),
			};
		}),
	);
}

/**
 * Applies pending forward-only migrations, each in its own transaction.
 * Refuses to run if an already-applied file changed.
 */
export async function migrate(
	client: pg.ClientBase,
	directory: string,
): Promise<MigrationResult> {
	const migrations = await readMigrations(directory);
	await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
	try {
		await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
			version text PRIMARY KEY,
			checksum text NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`);
		const { rows } = await client.query<{ version: string; checksum: string }>(
			"SELECT version, checksum FROM public.schema_migrations",
		);
		const applied = new Map(rows.map((row) => [row.version, row.checksum]));
		for (const migration of migrations) {
			const checksum = applied.get(migration.version);
			if (checksum !== undefined && checksum !== migration.checksum)
				throw new MigrationChecksumError(migration.version);
		}
		const result: MigrationResult = { applied: [], skipped: [] };
		for (const migration of migrations) {
			if (applied.has(migration.version)) {
				result.skipped.push(migration.version);
				continue;
			}
			await client.query("BEGIN");
			try {
				await client.query(migration.sql);
				await client.query(
					"INSERT INTO public.schema_migrations (version, checksum) VALUES ($1, $2)",
					[migration.version, migration.checksum],
				);
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			}
			result.applied.push(migration.version);
		}
		return result;
	} finally {
		await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
	}
}
