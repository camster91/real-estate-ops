import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { requireSession } from "../auth/guard.js";
import { registerClientRoutes } from "./clients.js";
import { registerConsentRoutes } from "./consents.js";
import { inTenant, NOT_MEMBER } from "./context.js";
import { registerDealRoutes } from "./deals.js";
import { registerKeyDateRoutes } from "./keydates.js";
import { registerTaskRoutes } from "./tasks.js";

interface BranchRow {
	id: string;
	name: string;
	version: number;
}

/** Tenant-scoped routes. Registered only when login is configured. */
export async function registerTenantRoutes(
	app: FastifyInstance,
	options: { pool: pg.Pool },
): Promise<void> {
	const { pool } = options;
	registerTaskRoutes(app, { pool });
	registerClientRoutes(app, { pool });
	registerConsentRoutes(app, { pool });
	registerDealRoutes(app, { pool });
	registerKeyDateRoutes(app, { pool });

	app.get(
		"/v1/organizations/:organizationId/branches",
		{ preHandler: requireSession(pool) },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const result = await inTenant(
				pool,
				request,
				"operations",
				async ({ client }) =>
					(
						await client.query<BranchRow>(
							"SELECT id, name, version FROM branch ORDER BY name, id LIMIT 200",
						)
					).rows,
			);
			if (result === NOT_MEMBER)
				return reply.code(404).send({ error: "not_found" });
			return { branches: result };
		},
	);
}
