import type { Action, Decision, Resource } from "@reo/auth";
import { authorizeInTenant, type TenantContext, withTenant } from "@reo/db";
import type { FastifyRequest } from "fastify";
import type pg from "pg";
import { sessionHash } from "../auth/guard.js";

export interface TenantWork {
	client: pg.PoolClient;
	context: TenantContext;
	/** One @reo/auth decision on this transaction, with grants read fresh. */
	decide(
		action: Action,
		resourceType: string,
		resource: Resource,
	): Promise<Decision>;
}

/** Returned when the URL's organisation is not one of the session's. */
export const NOT_MEMBER: unique symbol = Symbol("not_member");

// Lower-case only: the database returns lower-case ids, and one spelling per
// organisation keeps the membership comparison exact.
const ORGANIZATION_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Runs `work` in the organisation named by `:organizationId`, as the verified
 * principal, for `purpose`. The context comes only from the session
 * (requireSession must run first) and a membership check, never from headers
 * or the body. RLS still applies inside the transaction.
 */
export async function inTenant<T>(
	pool: pg.Pool,
	request: FastifyRequest,
	purpose: string,
	work: (tenant: TenantWork) => Promise<T>,
): Promise<T | typeof NOT_MEMBER> {
	const principalId = request.principalId;
	const hash = sessionHash(request);
	if (!principalId || !hash)
		throw new Error("inTenant requires requireSession to run first");
	const organizationId = (request.params as { organizationId?: unknown })
		.organizationId;
	if (
		typeof organizationId !== "string" ||
		!ORGANIZATION_ID.test(organizationId)
	)
		return NOT_MEMBER;
	const { rows } = await pool.query<{ member: boolean }>(
		"SELECT $2::uuid IN (SELECT app.session_memberships($1)) AS member",
		[hash, organizationId],
	);
	if (rows[0]?.member !== true) return NOT_MEMBER;
	const context: TenantContext = { organizationId, principalId, purpose };
	return withTenant(pool, context, (client) =>
		work({
			client,
			context,
			decide: (action, resourceType, resource) =>
				authorizeInTenant(client, { action, resourceType, resource }),
		}),
	);
}
