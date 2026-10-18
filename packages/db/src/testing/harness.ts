import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrate, migrationsDirectory } from "../migrate.js";

export interface TestDatabase {
	/** Superuser pool on the throwaway database (bypasses RLS; fixtures only). */
	admin: pg.Pool;
	/** Pool logged in as a role that only inherits reo_app; set when migrated. */
	app: pg.Pool | undefined;
	/** Superuser connection string for the throwaway database. */
	url: string;
	name: string;
	drop(): Promise<void>;
}

const suffix = () => randomBytes(6).toString("hex");

function adminUrl(): URL {
	const raw = process.env.REO_TEST_DATABASE_URL;
	if (!raw)
		throw new Error("REO_TEST_DATABASE_URL is required for database tests");
	return new URL(raw);
}

function withDatabase(
	base: URL,
	database: string,
	user?: string,
	password?: string,
) {
	const url = new URL(base);
	url.pathname = `/${database}`;
	if (user !== undefined) url.username = user;
	if (password !== undefined) url.password = password;
	return url.toString();
}

/** Creates an isolated database (and app login when migrated) for one test file. */
export async function createTestDatabase(
	options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
	const base = adminUrl();
	const name = `reo_test_${suffix()}`;
	const server = new pg.Client({ connectionString: base.toString() });
	await server.connect();
	try {
		await server.query(`CREATE DATABASE ${name}`);
	} finally {
		await server.end();
	}
	const url = withDatabase(base, name);
	const admin = new pg.Pool({ connectionString: url });
	let app: pg.Pool | undefined;
	let appRole: string | undefined;
	if (options.migrate !== false) {
		const client = await admin.connect();
		try {
			await migrate(client, migrationsDirectory);
		} finally {
			client.release();
		}
		appRole = `reo_app_${suffix()}`;
		const password = randomBytes(18).toString("hex");
		await admin.query(
			`CREATE ROLE ${appRole} LOGIN PASSWORD '${password}' IN ROLE reo_app`,
		);
		app = new pg.Pool({
			connectionString: withDatabase(base, name, appRole, password),
		});
	}
	return {
		admin,
		app,
		url,
		name,
		async drop() {
			await app?.end();
			await admin.end();
			const server = new pg.Client({ connectionString: base.toString() });
			await server.connect();
			try {
				await server.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
				if (appRole) await server.query(`DROP ROLE IF EXISTS ${appRole}`);
			} finally {
				await server.end();
			}
		},
	};
}
