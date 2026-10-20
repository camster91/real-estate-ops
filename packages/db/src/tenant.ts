import type pg from "pg";

/**
 * The tenant and principal for one unit of work. Build it only from a
 * verified session and membership lookup, never from request input.
 */
export interface TenantContext {
	readonly organizationId: string;
	readonly principalId: string;
	/** Why the work happens, e.g. "client_service"; grants match only their own purpose. */
	readonly purpose: string;
}

export class InvalidTenantContextError extends Error {
	constructor() {
		super(
			"Tenant context requires UUID organization and principal ids and a lowercase purpose",
		);
		this.name = "InvalidTenantContextError";
	}
}

const purposeName = /^[a-z][a-z0-9_]{0,63}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` in one transaction with the tenant context set transaction-locally,
 * so it never outlives the transaction on a pooled connection. RLS policies read
 * `app.organization_id`, `app.principal_id` and `app.purpose`.
 */
export async function withTenant<T>(
	pool: pg.Pool,
	context: TenantContext,
	work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
	if (
		!uuid.test(context.organizationId) ||
		!uuid.test(context.principalId) ||
		!purposeName.test(context.purpose)
	)
		throw new InvalidTenantContextError();
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query(
			"SELECT set_config('app.organization_id', $1, true), set_config('app.principal_id', $2, true), set_config('app.purpose', $3, true)",
			[context.organizationId, context.principalId, context.purpose],
		);
		const result = await work(client);
		await client.query("COMMIT");
		client.release();
		return result;
	} catch (error) {
		try {
			await client.query("ROLLBACK");
			client.release();
		} catch (rollbackError) {
			// A connection that cannot roll back must not return to the pool.
			client.release(rollbackError as Error);
		}
		throw error;
	}
}
