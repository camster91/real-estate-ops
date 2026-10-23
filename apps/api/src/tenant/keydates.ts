import { recordChange } from "@reo/db";
import {
	type KeyDateKind,
	type KeyDateUpdate,
	type NewKeyDate,
	needsLabel,
	parseKeyDateUpdate,
	parseNewKeyDate,
} from "@reo/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { requireSession } from "../auth/guard.js";
import { MEMBERSHIP_LOST, UUID } from "./clients.js";
import { inTenant, NOT_MEMBER } from "./context.js";

interface KeyDateRow {
	id: string;
	deal_id: string;
	kind: KeyDateKind;
	label: string | null;
	due_at: Date;
	done_at: Date | null;
	version: number;
}

const PURPOSE = "operations";
const COLUMNS = "id, deal_id, kind, label, due_at, done_at, version";

const toKeyDate = (row: KeyDateRow) => ({
	id: row.id,
	kind: row.kind,
	label: row.label,
	dueAt: row.due_at.toISOString(),
	doneAt: row.done_at ? row.done_at.toISOString() : null,
	version: row.version,
});

type CreateOutcome =
	| { kind: "created" | "replayed"; row: KeyDateRow }
	| { kind: "conflict" }
	| { kind: "missing" };

type EditOutcome =
	| { kind: "changed" | "unchanged" | "conflict"; row: KeyDateRow }
	| { kind: "needs_label" }
	| { kind: "missing" };

/** Key dates on a deal: list, add and change (ADR 0022). */
export function registerKeyDateRoutes(
	app: FastifyInstance,
	options: { pool: pg.Pool },
): void {
	const { pool } = options;
	const path = "/v1/organizations/:organizationId/deals/:dealId/key-dates";

	app.get(
		path,
		{ preHandler: requireSession(pool) },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const { dealId } = request.params as { dealId: string };
			if (!UUID.test(dealId))
				return reply.code(404).send({ error: "not_found" });
			const result = await inTenant(
				pool,
				request,
				PURPOSE,
				async ({ client }) => {
					// The deal must be visible to the caller (deal RLS).
					const visible = await client.query(
						"SELECT 1 FROM deal WHERE id = $1",
						[dealId.toLowerCase()],
					);
					if (visible.rowCount === 0) return undefined;
					return (
						await client.query<KeyDateRow>(
							`SELECT ${COLUMNS} FROM deal_key_date
								WHERE deal_id = $1
								ORDER BY due_at, id
								LIMIT 200`,
							[dealId.toLowerCase()],
						)
					).rows;
				},
			);
			if (result === NOT_MEMBER || result === undefined)
				return reply.code(404).send({ error: "not_found" });
			return { keyDates: result.map(toKeyDate) };
		},
	);

	app.post(
		path,
		{ preHandler: requireSession(pool), bodyLimit: 1024 },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const { dealId } = request.params as { dealId: string };
			if (!UUID.test(dealId))
				return reply.code(404).send({ error: "not_found" });
			const parsed = parseNewKeyDate(request.body);
			if (!parsed.ok)
				return reply
					.code(400)
					.send({ error: "invalid_key_date", field: parsed.field });
			const result = await create(
				pool,
				request,
				dealId.toLowerCase(),
				parsed.keyDate,
			);
			if (result === NOT_MEMBER || result.kind === "missing")
				return reply.code(404).send({ error: "not_found" });
			if (result.kind === "conflict")
				return reply.code(409).send({ error: "conflict" });
			return reply
				.code(result.kind === "created" ? 201 : 200)
				.send({ keyDate: toKeyDate(result.row) });
		},
	);

	app.patch(
		`${path}/:keyDateId`,
		{ preHandler: requireSession(pool), bodyLimit: 1024 },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const { dealId, keyDateId } = request.params as {
				dealId: string;
				keyDateId: string;
			};
			if (!UUID.test(dealId) || !UUID.test(keyDateId))
				return reply.code(404).send({ error: "not_found" });
			const parsed = parseKeyDateUpdate(request.body);
			if (!parsed.ok)
				return reply
					.code(400)
					.send({ error: "invalid_key_date", field: parsed.field });
			const result = await edit(
				pool,
				request,
				dealId.toLowerCase(),
				keyDateId.toLowerCase(),
				parsed.update,
			);
			if (result === NOT_MEMBER || result.kind === "missing")
				return reply.code(404).send({ error: "not_found" });
			if (result.kind === "needs_label")
				return reply
					.code(400)
					.send({ error: "invalid_key_date", field: "label" });
			if (result.kind === "conflict")
				return reply
					.code(409)
					.send({ error: "conflict", keyDate: toKeyDate(result.row) });
			return { keyDate: toKeyDate(result.row) };
		},
	);
}

async function create(
	pool: pg.Pool,
	request: FastifyRequest,
	dealId: string,
	keyDate: NewKeyDate,
): Promise<CreateOutcome | typeof NOT_MEMBER> {
	try {
		return await inTenant(
			pool,
			request,
			PURPOSE,
			async ({ client, context }): Promise<CreateOutcome> => {
				// Only the deal's assigned agent adds key dates.
				const assigned = await client.query(
					"SELECT 1 FROM deal WHERE id = $1 AND assigned_principal_id = $2",
					[dealId, context.principalId],
				);
				if (assigned.rowCount === 0) return { kind: "missing" };
				// The client-chosen id makes a retried POST safe.
				const inserted = await client.query<KeyDateRow>(
					`INSERT INTO deal_key_date (organization_id, id, deal_id, kind,
							label, due_at, created_by_principal_id)
						VALUES ($1, $2, $3, $4, $5, $6, $7)
						ON CONFLICT (organization_id, id) DO NOTHING
						RETURNING ${COLUMNS}`,
					[
						context.organizationId,
						keyDate.id,
						dealId,
						keyDate.kind,
						keyDate.label,
						keyDate.dueAt,
						context.principalId,
					],
				);
				const created = inserted.rows[0];
				if (created) {
					// The kind only: labels are free text and stay out of history.
					await recordChange(client, {
						action: "key_date.create",
						resourceType: "deal_key_date",
						resourceId: keyDate.id,
						details: { kind: keyDate.kind },
						event: {
							type: "key_date.created",
							schemaVersion: 1,
							aggregateVersion: 1,
							payload: { keyDateId: keyDate.id, dealId },
						},
					});
					return { kind: "created", row: created };
				}
				const existing = (
					await client.query<KeyDateRow>(
						`SELECT ${COLUMNS} FROM deal_key_date
							WHERE id = $1 AND created_by_principal_id = $2`,
						[keyDate.id, context.principalId],
					)
				).rows[0];
				if (
					existing &&
					existing.deal_id === dealId &&
					existing.kind === keyDate.kind &&
					existing.label === keyDate.label &&
					existing.due_at.getTime() === keyDate.dueAt.getTime()
				)
					return { kind: "replayed", row: existing };
				return { kind: "conflict" };
			},
		);
	} catch (error) {
		if (MEMBERSHIP_LOST.has((error as { code?: string }).code ?? ""))
			return NOT_MEMBER;
		throw error;
	}
}

/**
 * One edit in one transaction: lock the key date on the caller's own deal,
 * then replay, refuse a stale version, or apply it with audit and event.
 */
async function edit(
	pool: pg.Pool,
	request: FastifyRequest,
	dealId: string,
	keyDateId: string,
	update: KeyDateUpdate,
): Promise<EditOutcome | typeof NOT_MEMBER> {
	try {
		return await inTenant(
			pool,
			request,
			PURPOSE,
			async ({ client, context }): Promise<EditOutcome> => {
				const current = (
					await client.query<KeyDateRow>(
						`SELECT ${COLUMNS.split(", ")
							.map((column) => `k.${column}`)
							.join(", ")}
							FROM deal_key_date k
							JOIN deal d ON d.organization_id = k.organization_id
								AND d.id = k.deal_id
							WHERE k.id = $1 AND k.deal_id = $2
								AND d.assigned_principal_id = $3
							FOR UPDATE OF k`,
						[keyDateId, dealId, context.principalId],
					)
				).rows[0];
				if (!current) return { kind: "missing" };
				if (update.label === null && needsLabel(current.kind))
					return { kind: "needs_label" };
				const changes = {
					label: current.label !== update.label,
					dueAt: current.due_at.getTime() !== update.dueAt.getTime(),
					done: (current.done_at !== null) !== update.done,
				};
				const changed = Object.values(changes).filter(Boolean).length;
				// Already saved: a retried request, whatever version it carried.
				if (changed === 0) return { kind: "unchanged", row: current };
				if (current.version !== update.version)
					return { kind: "conflict", row: current };
				// The trigger sets done_at from the server clock.
				const updated = (
					await client.query<KeyDateRow>(
						`UPDATE deal_key_date SET label = $2, due_at = $3,
								done_at = CASE WHEN $4::boolean THEN now() END,
								version = version + 1
							WHERE id = $1
							RETURNING ${COLUMNS}`,
						[keyDateId, update.label, update.dueAt, update.done],
					)
				).rows[0];
				if (!updated) return { kind: "missing" };
				await recordChange(client, {
					action: "key_date.update",
					resourceType: "deal_key_date",
					resourceId: keyDateId,
					details: {
						fieldsChanged: changed,
						dateChanged: changes.dueAt,
						done: update.done,
					},
					event: {
						type: "key_date.updated",
						schemaVersion: 1,
						aggregateVersion: updated.version,
						payload: { keyDateId, dealId },
					},
				});
				return { kind: "changed", row: updated };
			},
		);
	} catch (error) {
		if (MEMBERSHIP_LOST.has((error as { code?: string }).code ?? ""))
			return NOT_MEMBER;
		throw error;
	}
}
