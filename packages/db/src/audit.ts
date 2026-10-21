import { randomUUID } from "node:crypto";
import type pg from "pg";

export type DetailValue = string | number | boolean | null;

export class MissingTenantContextError extends Error {
	constructor() {
		super("recordChange must run inside withTenant()");
		this.name = "MissingTenantContextError";
	}
}

const MAX_KEYS = 20;
const MAX_TEXT = 200;
const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const SENSITIVE =
	/(e-?mail|phone|name|address|birth|dob|social|note|body|message|token|secret|password|account)/i;
// "sin" alone would also match keys such as closingDate.
const SIN = /^sin$/i;

/**
 * Keeps audit details and event payloads minimal: short primitives only,
 * sensitive-named keys redacted, nested values dropped, text truncated.
 */
export function minimiseDetails(
	input: Record<string, unknown>,
): Record<string, DetailValue> {
	const output: Record<string, DetailValue> = {};
	let kept = 0;
	for (const [key, value] of Object.entries(input)) {
		if (kept >= MAX_KEYS) break;
		if (!KEY.test(key)) continue;
		if (SENSITIVE.test(key) || SIN.test(key)) {
			output[key] = "[redacted]";
		} else if (value === null || typeof value === "boolean") {
			output[key] = value;
		} else if (typeof value === "number") {
			if (!Number.isFinite(value)) continue;
			output[key] = value;
		} else if (typeof value === "string") {
			output[key] = value.slice(0, MAX_TEXT);
		} else {
			continue;
		}
		kept++;
	}
	return output;
}

export interface Change {
	action: string;
	resourceType: string;
	resourceId: string;
	details?: Record<string, unknown>;
	correlationId?: string;
	event: {
		type: string;
		schemaVersion: number;
		aggregateVersion: number;
		payload?: Record<string, unknown>;
		causationId?: string;
	};
}

/**
 * Writes one minimised audit event and one outbox event on the caller's
 * withTenant() transaction, so they commit or roll back with the change.
 * Tenant, actor and purpose come from the transaction's context, never from
 * the caller.
 */
export async function recordChange(
	client: pg.PoolClient,
	change: Change,
): Promise<{ auditId: string; eventId: string; correlationId: string }> {
	const { rows } = await client.query<{ ready: boolean }>(
		`SELECT app.current_organization_id() IS NOT NULL
			AND app.current_principal_id() IS NOT NULL
			AND app.current_purpose() IS NOT NULL AS ready`,
	);
	if (rows[0]?.ready !== true) throw new MissingTenantContextError();
	const auditId = randomUUID();
	const eventId = randomUUID();
	const correlationId = change.correlationId ?? randomUUID();
	// No RETURNING: the runtime role may insert but not read these tables.
	await client.query(
		`INSERT INTO audit_event (organization_id, id, actor_principal_id, action,
			resource_type, resource_id, purpose, correlation_id, details)
		VALUES (app.current_organization_id(), $1, app.current_principal_id(), $2,
			$3, $4, app.current_purpose(), $5, $6)`,
		[
			auditId,
			change.action,
			change.resourceType,
			change.resourceId,
			correlationId,
			minimiseDetails(change.details ?? {}),
		],
	);
	await client.query(
		`INSERT INTO outbox_event (organization_id, id, event_type, schema_version,
			aggregate_type, aggregate_id, aggregate_version, actor_principal_id,
			correlation_id, causation_id, payload)
		VALUES (app.current_organization_id(), $1, $2, $3, $4, $5, $6,
			app.current_principal_id(), $7, $8, $9)`,
		[
			eventId,
			change.event.type,
			change.event.schemaVersion,
			change.resourceType,
			change.resourceId,
			change.event.aggregateVersion,
			correlationId,
			change.event.causationId ?? null,
			minimiseDetails(change.event.payload ?? {}),
		],
	);
	return { auditId, eventId, correlationId };
}
