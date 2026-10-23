import { recordChange } from "@reo/db";
import {
	canMoveDeal,
	type DealSide,
	type DealStage,
	type NewDeal,
	parseNewDeal,
	parseStageChange,
} from "@reo/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { requireSession } from "../auth/guard.js";
import { MEMBERSHIP_LOST, UUID } from "./clients.js";
import { inTenant, NOT_MEMBER } from "./context.js";

interface DealRow {
	id: string;
	side: DealSide;
	stage: DealStage;
	street: string;
	unit: string | null;
	city: string;
	postal_code: string;
	version: number;
	created_at: Date;
	stage_changed_at: Date;
}

interface LinkRow {
	deal_id: string;
	party_id: string;
	display_name: string | null;
}

type Deal = DealRow & { clients: { id: string; name: string | null }[] };

const PURPOSE = "operations";
const LIST_LIMIT = 100;
const COLUMNS =
	"id, side, stage, street, unit, city, postal_code, version, created_at, stage_changed_at";

const toDeal = (deal: Deal) => ({
	id: deal.id,
	side: deal.side,
	stage: deal.stage,
	address: {
		street: deal.street,
		unit: deal.unit,
		city: deal.city,
		postalCode: deal.postal_code,
	},
	clients: deal.clients,
	version: deal.version,
	createdAt: deal.created_at.toISOString(),
	stageChangedAt: deal.stage_changed_at.toISOString(),
});

/** Adds each deal's linked clients, by name (A to Z). */
async function withClients(
	client: pg.PoolClient,
	rows: DealRow[],
): Promise<Deal[]> {
	if (rows.length === 0) return [];
	const links = (
		await client.query<LinkRow>(
			// A left join: a client the caller can no longer see stays listed by id.
			`SELECT dp.deal_id, dp.party_id, p.display_name
				FROM deal_party dp
				LEFT JOIN party p
					ON p.organization_id = dp.organization_id AND p.id = dp.party_id
				WHERE dp.deal_id = ANY($1::uuid[])
				ORDER BY p.display_name COLLATE "und-x-icu", dp.party_id`,
			[rows.map((row) => row.id)],
		)
	).rows;
	return rows.map((row) => ({
		...row,
		clients: links
			.filter((link) => link.deal_id === row.id)
			.map((link) => ({ id: link.party_id, name: link.display_name })),
	}));
}

type CreateOutcome =
	| { kind: "created" | "replayed"; deal: Deal }
	| { kind: "conflict" }
	| { kind: "unknown_client" };

type StageOutcome =
	| { kind: "changed" | "unchanged"; deal: Deal }
	| { kind: "conflict" | "invalid_transition"; deal: Deal }
	| { kind: "missing" };

/** "My deals": list, add, view and move the caller's deals (ADR 0021). */
export function registerDealRoutes(
	app: FastifyInstance,
	options: { pool: pg.Pool },
): void {
	const { pool } = options;
	const base = "/v1/organizations/:organizationId/deals";

	app.get(
		base,
		{ preHandler: requireSession(pool) },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const result = await inTenant(
				pool,
				request,
				PURPOSE,
				async ({ client, context }) => {
					const rows = (
						await client.query<DealRow>(
							// One extra row tells the screen there are more than shown.
							`SELECT ${COLUMNS} FROM deal
								WHERE assigned_principal_id = $1
								ORDER BY created_at DESC, id
								LIMIT ${LIST_LIMIT + 1}`,
							[context.principalId],
						)
					).rows;
					return {
						deals: await withClients(client, rows.slice(0, LIST_LIMIT)),
						more: rows.length > LIST_LIMIT,
					};
				},
			);
			if (result === NOT_MEMBER)
				return reply.code(404).send({ error: "not_found" });
			return { deals: result.deals.map(toDeal), more: result.more };
		},
	);

	app.get(
		`${base}/:dealId`,
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
					const rows = (
						await client.query<DealRow>(
							`SELECT ${COLUMNS} FROM deal WHERE id = $1`,
							[dealId.toLowerCase()],
						)
					).rows;
					return (await withClients(client, rows))[0];
				},
			);
			if (result === NOT_MEMBER || !result)
				return reply.code(404).send({ error: "not_found" });
			return { deal: toDeal(result) };
		},
	);

	app.post(
		base,
		{ preHandler: requireSession(pool), bodyLimit: 4096 },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const parsed = parseNewDeal(request.body);
			if (!parsed.ok)
				return reply
					.code(400)
					.send({ error: "invalid_deal", field: parsed.field });
			const result = await createOrReplay(pool, request, parsed.deal);
			if (result === NOT_MEMBER)
				return reply.code(404).send({ error: "not_found" });
			// Missing and not-yours read the same: nothing about other clients leaks.
			if (result.kind === "unknown_client")
				return reply
					.code(400)
					.send({ error: "invalid_deal", field: "clientIds" });
			if (result.kind === "conflict")
				return reply.code(409).send({ error: "conflict" });
			return reply
				.code(result.kind === "created" ? 201 : 200)
				.send({ deal: toDeal(result.deal) });
		},
	);

	app.patch(
		`${base}/:dealId`,
		{ preHandler: requireSession(pool), bodyLimit: 1024 },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const { dealId } = request.params as { dealId: string };
			if (!UUID.test(dealId))
				return reply.code(404).send({ error: "not_found" });
			const parsed = parseStageChange(request.body);
			if (!parsed.ok)
				return reply
					.code(400)
					.send({ error: "invalid_stage", field: parsed.field });
			const result = await changeStage(
				pool,
				request,
				dealId.toLowerCase(),
				parsed.stage,
				parsed.version,
			);
			if (result === NOT_MEMBER || result.kind === "missing")
				return reply.code(404).send({ error: "not_found" });
			if (result.kind === "conflict" || result.kind === "invalid_transition")
				return reply
					.code(409)
					.send({ error: result.kind, deal: toDeal(result.deal) });
			return { deal: toDeal(result.deal) };
		},
	);
}

const sameDeal = (existing: Deal, deal: NewDeal) =>
	existing.side === deal.side &&
	existing.street === deal.address.street &&
	existing.unit === deal.address.unit &&
	existing.city === deal.address.city &&
	existing.postal_code === deal.address.postalCode &&
	existing.clients
		.map((c) => c.id)
		.sort()
		.join() === deal.clientIds.join();

/** Thrown inside the transaction so it rolls back the deal as well. */
class UnknownClient extends Error {}

async function createOrReplay(
	pool: pg.Pool,
	request: FastifyRequest,
	deal: NewDeal,
): Promise<CreateOutcome | typeof NOT_MEMBER> {
	try {
		return await inTenant(
			pool,
			request,
			PURPOSE,
			async ({ client, context }): Promise<CreateOutcome> => {
				// Every client must be the caller's own; RLS on deal_party repeats this.
				const owned = await client.query(
					`SELECT id FROM party
						WHERE id = ANY($1::uuid[]) AND assigned_principal_id = $2`,
					[deal.clientIds, context.principalId],
				);
				if (owned.rowCount !== deal.clientIds.length)
					return { kind: "unknown_client" };
				// The client-chosen id makes a retried POST safe: a replay finds the
				// existing deal instead of adding a second one, audit or event.
				const inserted = await client.query<DealRow>(
					`INSERT INTO deal (organization_id, id, side, street, unit, city,
							postal_code, assigned_principal_id, created_by_principal_id)
						VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
						ON CONFLICT (organization_id, id) DO NOTHING
						RETURNING ${COLUMNS}`,
					[
						context.organizationId,
						deal.id,
						deal.side,
						deal.address.street,
						deal.address.unit,
						deal.address.city,
						deal.address.postalCode,
						context.principalId,
					],
				);
				const created = inserted.rows[0];
				if (!created) {
					// Visible only to its creator; another member's id is a conflict.
					const rows = (
						await client.query<DealRow>(
							`SELECT ${COLUMNS} FROM deal
								WHERE id = $1 AND created_by_principal_id = $2`,
							[deal.id, context.principalId],
						)
					).rows;
					const existing = (await withClients(client, rows))[0];
					return existing && sameDeal(existing, deal)
						? { kind: "replayed", deal: existing }
						: { kind: "conflict" };
				}
				// RLS repeats the own-client check. If it refuses (or a client has
				// gone), that is the same 400 as above, not "not a member".
				try {
					await client.query(
						`INSERT INTO deal_party (organization_id, deal_id, party_id)
							SELECT $1, $2, unnest($3::uuid[])`,
						[context.organizationId, deal.id, deal.clientIds],
					);
				} catch (error) {
					if (MEMBERSHIP_LOST.has((error as { code?: string }).code ?? ""))
						throw new UnknownClient();
					throw error;
				}
				// Codes and a count only: the address and names stay out of history.
				await recordChange(client, {
					action: "deal.create",
					resourceType: "deal",
					resourceId: deal.id,
					details: { side: deal.side, clients: deal.clientIds.length },
					event: {
						type: "deal.created",
						schemaVersion: 1,
						aggregateVersion: 1,
						payload: { dealId: deal.id },
					},
				});
				return {
					kind: "created",
					deal: (await withClients(client, [created]))[0] as Deal,
				};
			},
		);
	} catch (error) {
		if (error instanceof UnknownClient) return { kind: "unknown_client" };
		if (MEMBERSHIP_LOST.has((error as { code?: string }).code ?? ""))
			return NOT_MEMBER;
		throw error;
	}
}

/**
 * One stage change in one transaction: lock the caller's own deal, then
 * replay, refuse or apply it with its audit row and event (ADR 0014).
 */
async function changeStage(
	pool: pg.Pool,
	request: FastifyRequest,
	dealId: string,
	stage: DealStage,
	version: number,
): Promise<StageOutcome | typeof NOT_MEMBER> {
	try {
		return await inTenant(
			pool,
			request,
			PURPOSE,
			async ({ client, context }): Promise<StageOutcome> => {
				const current = (
					await client.query<DealRow>(
						`SELECT ${COLUMNS} FROM deal
							WHERE id = $1 AND assigned_principal_id = $2
							FOR UPDATE`,
						[dealId, context.principalId],
					)
				).rows[0];
				if (!current) return { kind: "missing" };
				const full = async (row: DealRow) =>
					(await withClients(client, [row]))[0] as Deal;
				// Already there: a retried request, whatever version it carried.
				if (current.stage === stage)
					return { kind: "unchanged", deal: await full(current) };
				if (current.version !== version)
					return { kind: "conflict", deal: await full(current) };
				if (!canMoveDeal(current.stage, stage))
					return { kind: "invalid_transition", deal: await full(current) };
				const updated = (
					await client.query<DealRow>(
						`UPDATE deal SET stage = $2, version = version + 1
							WHERE id = $1
							RETURNING ${COLUMNS}`,
						[dealId, stage],
					)
				).rows[0];
				if (!updated) return { kind: "missing" };
				await recordChange(client, {
					action: "deal.stage_change",
					resourceType: "deal",
					resourceId: dealId,
					details: { from: current.stage, to: stage },
					event: {
						type: "deal.stage_changed",
						schemaVersion: 1,
						aggregateVersion: updated.version,
						payload: { dealId, stage },
					},
				});
				return { kind: "changed", deal: await full(updated) };
			},
		);
	} catch (error) {
		if (MEMBERSHIP_LOST.has((error as { code?: string }).code ?? ""))
			return NOT_MEMBER;
		throw error;
	}
}
