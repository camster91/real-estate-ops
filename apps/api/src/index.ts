import { readAuthConfig, readConfig } from "@reo/config";
import type pg from "pg";
import { createPool } from "./db.js";
import { createServer } from "./server.js";

const config = readConfig(process.env);
const authConfig = readAuthConfig(process.env);
let pool: pg.Pool | undefined;
if (authConfig) {
	// Login needs the database; the URL must use a login role in reo_app.
	const databaseUrl = process.env.REO_DATABASE_URL;
	if (!databaseUrl)
		throw new Error("REO_DATABASE_URL is required when login is configured");
	pool = createPool(databaseUrl, (code) =>
		app.log.error({ code }, "database pool error"),
	);
}
const app = createServer(
	authConfig && pool ? { auth: { pool, config: authConfig } } : {},
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
	process.once(signal, () => {
		void app.close().then(() => pool?.end());
	});
await app.listen({ port: config.port, host: config.host });
