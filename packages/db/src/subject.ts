import {
	type Action,
	authorize,
	type Classification,
	type Decision,
	type Grant,
	type Resource,
	type Subject,
} from "@reo/auth";
import type pg from "pg";

interface ContextRow {
	organization_id: string;
	principal_id: string;
	purpose: string;
	now_ms: number;
	membership_active: boolean | null;
}

interface GrantRow {
	organization_id: string;
	principal_id: string;
	action: Action;
	resource_id: string;
	classification: Classification;
	purpose: string;
	valid_from: Date;
	expires_at: Date;
	revoked_at: Date | null;
}

async function readContext(client: pg.ClientBase): Promise<ContextRow> {
	const { rows } = await client.query<ContextRow>(`
		SELECT app.current_organization_id() AS organization_id,
			app.current_principal_id() AS principal_id,
			app.current_purpose() AS purpose,
			(extract(epoch FROM now()) * 1000)::float8 AS now_ms,
			(SELECT m.status = 'active' AND m.effective_from <= now()
					AND (m.effective_to IS NULL OR now() < m.effective_to)
				FROM membership m
				WHERE m.organization_id = app.current_organization_id()
					AND m.principal_id = app.current_principal_id()) AS membership_active`);
	return rows[0] as ContextRow;
}

/**
 * Builds the @reo/auth subject for the current tenant context from the
 * database, fresh on every call (nothing is cached, so revocation applies to
 * the next decision). Call inside withTenant(). RLS limits the rows to the
 * current principal's own membership and grants. Each grant row becomes one
 * complete Grant, so rows never combine. Pass resourceType to keep only grants
 * for that kind of record.
 */
export async function loadSubject(
	client: pg.ClientBase,
	resourceType?: string,
): Promise<Subject> {
	const context = await readContext(client);
	const { rows } = await client.query<GrantRow>(
		`SELECT organization_id, principal_id, action, resource_id, classification,
			purpose, valid_from, expires_at, revoked_at
		FROM access_grant
		WHERE $1::text IS NULL OR resource_type = $1`,
		[resourceType ?? null],
	);
	const grants: Grant[] = rows.map((row) => ({
		tenantId: row.organization_id,
		subjectId: row.principal_id,
		actions: [row.action],
		resourceIds: [row.resource_id],
		classifications: [row.classification],
		purposes: [row.purpose],
		validFrom: row.valid_from.getTime(),
		expiresAt: row.expires_at.getTime(),
		revoked: row.revoked_at !== null,
	}));
	return {
		id: context.principal_id,
		tenantId: context.organization_id,
		kind: "human",
		membershipActive: context.membership_active === true,
		grants,
	};
}

/**
 * Runs one decision through the shared @reo/auth policy, using grants read
 * from the database and the database clock. Call inside withTenant().
 */
export async function authorizeInTenant(
	client: pg.ClientBase,
	request: { action: Action; resourceType: string; resource: Resource },
): Promise<Decision> {
	const subject = await loadSubject(client, request.resourceType);
	const context = await readContext(client);
	return authorize({
		subject,
		resource: request.resource,
		action: request.action,
		purpose: context.purpose,
		now: context.now_ms,
	});
}
