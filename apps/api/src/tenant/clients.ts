import { recordChange } from "@reo/db";
import { type NewClient, parseNewClient } from "@reo/domain";
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
}

const PURPOSE = "operations";
const LIST_LIMIT = 100;
const COLUMNS = "id, display_name, email, phone, version, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toClient = (row: PartyRow) => ({
	id: row.id,
	name: row.display_name,
	email: row.email,
	phone: row.phone,
	version: row.version,
	createdAt: row.created_at.toISOString(),
});

type CreateOutcome =
	| { kind: "created" | "replayed"; row: PartyRow }
	| { kind: "conflict" };

// Membership can end between inTenant's check and the insert; RLS (42501) or
// the membership FK (23503) then refuses the row: "not a member", not a 500.
const MEMBERSHIP_LOST = new Set(["42501", "23503"]);

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
