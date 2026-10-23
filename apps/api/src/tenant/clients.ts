import { recordChange } from "@reo/db";
import {
	type ClientUpdate,
	type NewClient,
	parseClientUpdate,
	parseNewClient,
} from "@reo/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { requireSession } from "../auth/guard.js";
import { inTenant, NOT_MEMBER } from "./context.js";

interface PartyRow {
	id: string;
	display_name: string;
	email: string | null;
	phone: string | null;
	version: number;
	created_at: Date;
	updated_at: Date;
}

const PURPOSE = "operations";
const LIST_LIMIT = 100;
const COLUMNS =
	"id, display_name, email, phone, version, created_at, updated_at";
export const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toClient = (row: PartyRow) => ({
	id: row.id,
	name: row.display_name,
	email: row.email,
	phone: row.phone,
	version: row.version,
	createdAt: row.created_at.toISOString(),
	updatedAt: row.updated_at.toISOString(),
});

type EditOutcome =
	| { kind: "changed" | "unchanged" | "conflict"; row: PartyRow }
	| { kind: "missing" };

type CreateOutcome =
	| { kind: "created" | "replayed"; row: PartyRow }
	| { kind: "conflict" };

// Membership can end between inTenant's check and the insert; RLS (42501) or
// the membership FK (23503) then refuses the row: "not a member", not a 500.
export const MEMBERSHIP_LOST = new Set(["42501", "23503"]);

/** "My clients": list, add and view the caller's own clients (ADR 0019). */
export function registerClientRoutes(
	app: FastifyInstance,
	options: { pool: pg.Pool },
): void {
	const { pool } = options;

	app.get(
		"/v1/organizations/:organizationId/clients",
		{ preHandler: requireSession(pool) },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const result = await inTenant(
				pool,
				request,
				PURPOSE,
				async ({ client, context }) =>
					(
						await client.query<PartyRow>(
							// One extra row tells the screen there are more than shown.
							`SELECT ${COLUMNS} FROM party
							WHERE assigned_principal_id = $1
							ORDER BY display_name COLLATE "und-x-icu", id
							LIMIT ${LIST_LIMIT + 1}`,
							[context.principalId],
						)
					).rows,
			);
			if (result === NOT_MEMBER)
				return reply.code(404).send({ error: "not_found" });
			return {
				clients: result.slice(0, LIST_LIMIT).map(toClient),
				more: result.length > LIST_LIMIT,
			};
		},
	);

	app.get(
		"/v1/organizations/:organizationId/clients/:clientId",
		{ preHandler: requireSession(pool) },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const { clientId } = request.params as { clientId: string };
			// A malformed id is simply not found; it never reaches the database.
			if (!UUID.test(clientId))
				return reply.code(404).send({ error: "not_found" });
			const result = await inTenant(
				pool,
				request,
				PURPOSE,
				async ({ client }) =>
					(
						await client.query<PartyRow>(
							`SELECT ${COLUMNS} FROM party WHERE id = $1`,
							[clientId.toLowerCase()],
						)
					).rows[0],
			);
			if (result === NOT_MEMBER || !result)
				return reply.code(404).send({ error: "not_found" });
			return { client: toClient(result) };
		},
	);

	app.post(
		"/v1/organizations/:organizationId/clients",
		{ preHandler: requireSession(pool), bodyLimit: 4096 },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const parsed = parseNewClient(request.body);
			if (!parsed.ok)
				return reply
					.code(400)
					.send({ error: "invalid_client", field: parsed.field });
			const result = await createOrReplay(pool, request, parsed.client);
			if (result === NOT_MEMBER)
				return reply.code(404).send({ error: "not_found" });
			if (result.kind === "conflict")
				return reply.code(409).send({ error: "conflict" });
			return reply
				.code(result.kind === "created" ? 201 : 200)
				.send({ client: toClient(result.row) });
		},
	);

	app.patch(
		"/v1/organizations/:organizationId/clients/:clientId",
		{ preHandler: requireSession(pool), bodyLimit: 4096 },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const { clientId } = request.params as { clientId: string };
			if (!UUID.test(clientId))
				return reply.code(404).send({ error: "not_found" });
			const parsed = parseClientUpdate(request.body);
			if (!parsed.ok)
				return reply
					.code(400)
					.send({ error: "invalid_client", field: parsed.field });
			const result = await edit(
				pool,
				request,
				clientId.toLowerCase(),
				parsed.update,
			);
			if (result === NOT_MEMBER || result.kind === "missing")
				return reply.code(404).send({ error: "not_found" });
			if (result.kind === "conflict")
				return reply
					.code(409)
					.send({ error: "conflict", client: toClient(result.row) });
			return { client: toClient(result.row) };
		},
	);
}

/**
 * One edit in one transaction: lock the caller's own client, then replay,
 * refuse a stale version, or apply it with its audit row and event.
 */
async function edit(
	pool: pg.Pool,
	request: FastifyRequest,
	clientId: string,
	update: ClientUpdate,
): Promise<EditOutcome | typeof NOT_MEMBER> {
	try {
		return await inTenant(
			pool,
			request,
			PURPOSE,
			async ({ client, context }): Promise<EditOutcome> => {
				const current = (
					await client.query<PartyRow>(
						`SELECT ${COLUMNS} FROM party
							WHERE id = $1 AND assigned_principal_id = $2
							FOR UPDATE`,
						[clientId, context.principalId],
					)
				).rows[0];
				if (!current) return { kind: "missing" };
				const changed = [
					current.display_name !== update.name,
					current.email !== update.email,
					current.phone !== update.phone,
				].filter(Boolean).length;
				// Already saved: a retried request, whatever version it carried.
				if (changed === 0) return { kind: "unchanged", row: current };
				if (current.version !== update.version)
					return { kind: "conflict", row: current };
				const updated = (
					await client.query<PartyRow>(
						`UPDATE party SET display_name = $2, email = $3, phone = $4,
								version = version + 1
							WHERE id = $1
							RETURNING ${COLUMNS}`,
						[clientId, update.name, update.email, update.phone],
					)
				).rows[0];
				if (!updated) return { kind: "missing" };
				// A count only: field names and values stay out of history.
				await recordChange(client, {
					action: "party.update",
					resourceType: "party",
					resourceId: clientId,
					details: { fieldsChanged: changed },
					event: {
						type: "party.updated",
						schemaVersion: 1,
						aggregateVersion: updated.version,
						payload: { partyId: clientId },
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

async function createOrReplay(
	pool: pg.Pool,
	request: FastifyRequest,
	party: NewClient,
): Promise<CreateOutcome | typeof NOT_MEMBER> {
	try {
		return await inTenant(
			pool,
			request,
			PURPOSE,
			async ({ client, context }): Promise<CreateOutcome> => {
				// The client-chosen id makes a retried POST safe: a replay finds the
				// existing row instead of adding a second client, audit or event.
				const inserted = await client.query<PartyRow>(
					`INSERT INTO party (organization_id, id, display_name, email, phone,
							assigned_principal_id, created_by_principal_id)
						VALUES ($1, $2, $3, $4, $5, $6, $6)
						ON CONFLICT (organization_id, id) DO NOTHING
						RETURNING ${COLUMNS}`,
					[
						context.organizationId,
						party.id,
						party.name,
						party.email,
						party.phone,
						context.principalId,
					],
				);
				const created = inserted.rows[0];
				if (created) {
					// No names, emails or phone numbers in history (ADR 0014).
					await recordChange(client, {
						action: "party.create",
						resourceType: "party",
						resourceId: party.id,
						// Key names mentioning email or phone are redacted by design,
						// so only a count is kept.
						details: {
							kind: "person",
							contactPoints: [party.email, party.phone].filter(Boolean).length,
						},
						event: {
							type: "party.created",
							schemaVersion: 1,
							aggregateVersion: 1,
							payload: { partyId: party.id },
						},
					});
					return { kind: "created", row: created };
				}
				// Visible only to its creator; another member's id reads as a conflict.
				const existing = (
					await client.query<PartyRow>(
						`SELECT ${COLUMNS} FROM party
							WHERE id = $1 AND created_by_principal_id = $2`,
						[party.id, context.principalId],
					)
				).rows[0];
				if (
					existing &&
					existing.display_name === party.name &&
					existing.email === party.email &&
					existing.phone === party.phone
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
