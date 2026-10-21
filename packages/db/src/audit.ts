import { randomUUID } from "node:crypto";
import type pg from "pg";

export type DetailValue = string | number | boolean | null;

export class MissingTenantContextError extends Error {
	constructor() {
		super("recordChange must run inside withTenant()");
		this.name = "MissingTenantContextError";
	}
}

export class InvalidChangeError extends Error {
	constructor(readonly field: string) {
		super(`Invalid change: ${field}`);
		this.name = "InvalidChangeError";
	}
}

/** The same aggregate version and event type was already recorded. */
export class DuplicateEventError extends Error {
	constructor(options?: { cause?: unknown }) {
		super("Event already recorded for this aggregate version", options);
		this.name = "DuplicateEventError";
	}
}

// Keep in step with the CHECK constraints in migrations/0005_audit_outbox.sql.
export const ACTION_PATTERN = /^[a-z][a-z_]{0,40}\.[a-z][a-z_]{0,40}$/;
export const RESOURCE_TYPE_PATTERN = /^[a-z][a-z_]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_KEYS = 20;
const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
// Strings are kept only when they look like a code, id, number or date: no
// spaces, no "@", ASCII only, at most 64 characters. Anything else, including
// free text that might hold personal data, is stored as "[redacted]". With 20
// keys of at most 40 characters this always fits the 4096-byte column check.
const CODE_LIKE = /^[A-Za-z0-9_.:+-]{1,64}$/;
const SENSITIVE =
	/(e-?mail|phone|mobile|cell|tel|fax|name|address|street|city|postal|zip|birth|dob|social|licen[cs]e|registration|passport|ohip|health|bank|transit|iban|card|account|occupation|employer|note|body|message|comment|description|subject|recipient|token|secret|password|key|auth|credential|cookie|session)/i;
// SIN as a word: "sin", "SIN", "clientSin", "sinNumber", "client_sin" - but not
// closingDate or business.
const SIN = /(^|_|[a-z])(sin|SIN|Sin)($|_|[A-Z0-9])/;
const ID_KEY = /(Id|_id)$/;

const redact = (key: string, value: unknown): DetailValue | undefined => {
	if (ID_KEY.test(key) && typeof value === "string" && UUID.test(value))
		return value;
	if (SENSITIVE.test(key) || SIN.test(key)) return "[redacted]";
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string")
		return CODE_LIKE.test(value) ? value : "[redacted]";
	return undefined;
};

/**
 * Keeps audit details and event payloads minimal and free of personal data:
 * code-like strings, finite numbers, booleans and null only; sensitive-named
 * keys and free text redacted; nested values dropped. UUID values under keys
 * ending in Id/_id are kept, so events can still name the records they concern.
 */
export function minimiseDetails(
	input: Record<string, unknown>,
): Record<string, DetailValue> {
	const output: Record<string, DetailValue> = {};
	let kept = 0;
	for (const [key, value] of Object.entries(input)) {
		if (kept >= MAX_KEYS) break;
		if (!KEY.test(key)) continue;
		const minimised = redact(key, value);
		if (minimised === undefined) continue;
		output[key] = minimised;
		kept++;
	}
	return output;
}

function validate(change: Change): void {
	const checks: [string, boolean][] = [
		["action", ACTION_PATTERN.test(change.action)],
		["resourceType", RESOURCE_TYPE_PATTERN.test(change.resourceType)],
		["resourceId", UUID.test(change.resourceId)],
		[
			"correlationId",
			change.correlationId === undefined || UUID.test(change.correlationId),
		],
		["event.type", ACTION_PATTERN.test(change.event.type)],
		[
			"event.schemaVersion",
			Number.isInteger(change.event.schemaVersion) &&
				change.event.schemaVersion >= 1,
		],
		[
			"event.aggregateVersion",
			Number.isInteger(change.event.aggregateVersion) &&
				change.event.aggregateVersion >= 1,
		],
		[
			"event.causationId",
			change.event.causationId === undefined ||
				UUID.test(change.event.causationId),
		],
	];
	for (const [field, ok] of checks)
		if (!ok) throw new InvalidChangeError(field);
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
	validate(change);
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
	try {
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
	} catch (error) {
		if (
			(error as { constraint?: string }).constraint ===
			"outbox_event_version_unique"
		)
			throw new DuplicateEventError({ cause: error });
		throw error;
	}
	return { auditId, eventId, correlationId };
}
