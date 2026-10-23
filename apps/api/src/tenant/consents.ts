import { recordChange } from "@reo/db";
import {
	CONSENT_PURPOSES,
	type ConsentRecord,
	parseConsentRecord,
} from "@reo/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { requireSession } from "../auth/guard.js";
import { MEMBERSHIP_LOST, UUID } from "./clients.js";
import { inTenant, NOT_MEMBER } from "./context.js";

interface ConsentRow {
	id: string;
	purpose: string;
	status: string;
	method: string;
	recorded_at: Date;
}

const PURPOSE = "operations";
const HISTORY_LIMIT = 50;
const COLUMNS = "id, purpose, status, method, recorded_at";

const toEntry = (row: ConsentRow) => ({
	id: row.id,
	purpose: row.purpose,
	status: row.status,
	method: row.method,
	recordedAt: row.recorded_at.toISOString(),
});

type RecordOutcome =
	| { kind: "created" | "replayed"; row: ConsentRow }
	| { kind: "conflict" }
	| { kind: "missing" };

/** Consent for a client: current status per purpose, history, recording (ADR 0020). */
export function registerConsentRoutes(
	app: FastifyInstance,
	options: { pool: pg.Pool },
): void {
	const { pool } = options;
	const path = "/v1/organizations/:organizationId/clients/:clientId/consents";

	app.get(
		path,
		{ preHandler: requireSession(pool) },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const { clientId } = request.params as { clientId: string };
			if (!UUID.test(clientId))
				return reply.code(404).send({ error: "not_found" });
			const result = await inTenant(
				pool,
				request,
				PURPOSE,
				async ({ client }) => {
					// The client must be visible to the caller (party RLS).
					const visible = await client.query(
						"SELECT 1 FROM party WHERE id = $1",
						[clientId.toLowerCase()],
					);
					if (visible.rowCount === 0) return undefined;
					// One statement, so current and history come from one snapshot.
					// Current is the newest row per purpose over all history, not
					// just the page.
					const rows = (
						await client.query<ConsentRow & { kind: "latest" | "history" }>(
							`WITH latest AS (
								SELECT DISTINCT ON (purpose) ${COLUMNS} FROM consent_record
								WHERE party_id = $1
								ORDER BY purpose, recorded_at DESC, id DESC
							), page AS (
								SELECT ${COLUMNS} FROM consent_record
								WHERE party_id = $1
								ORDER BY recorded_at DESC, id DESC
								LIMIT ${HISTORY_LIMIT}
							)
							SELECT 'latest' AS kind, * FROM latest
							UNION ALL
							SELECT 'history' AS kind, * FROM page
							ORDER BY kind, recorded_at DESC, id DESC`,
							[clientId.toLowerCase()],
						)
					).rows;
					const history = { rows: rows.filter((r) => r.kind === "history") };
					const latest = { rows: rows.filter((r) => r.kind === "latest") };
					return { history: history.rows, latest: latest.rows };
				},
			);
			if (result === NOT_MEMBER || result === undefined)
				return reply.code(404).send({ error: "not_found" });
			const history = result.history.map(toEntry);
			const current = CONSENT_PURPOSES.map((purpose) => {
				const row = result.latest.find((entry) => entry.purpose === purpose);
				return {
					purpose,
					status: row?.status ?? null,
					method: row?.method ?? null,
					recordedAt: row?.recorded_at.toISOString() ?? null,
				};
			});
			return { current, history };
		},
	);

	app.post(
		path,
		{ preHandler: requireSession(pool), bodyLimit: 1024 },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const { clientId } = request.params as { clientId: string };
			if (!UUID.test(clientId))
				return reply.code(404).send({ error: "not_found" });
			const parsed = parseConsentRecord(request.body);
			if (!parsed.ok)
				return reply
					.code(400)
					.send({ error: "invalid_consent", field: parsed.field });
			const result = await record(
				pool,
				request,
				clientId.toLowerCase(),
				parsed.record,
			);
			if (result === NOT_MEMBER || result.kind === "missing")
				return reply.code(404).send({ error: "not_found" });
			if (result.kind === "conflict")
				return reply.code(409).send({ error: "conflict" });
			return reply
				.code(result.kind === "created" ? 201 : 200)
				.send({ consent: toEntry(result.row) });
		},
	);
}

async function record(
	pool: pg.Pool,
	request: FastifyRequest,
	partyId: string,
	consent: ConsentRecord,
): Promise<RecordOutcome | typeof NOT_MEMBER> {
	try {
		return await inTenant(
			pool,
			request,
			PURPOSE,
			async ({ client, context }): Promise<RecordOutcome> => {
				// Only the client's assigned agent records consent. The row lock
				// orders recordings for one client, so the newest is current.
				const assigned = await client.query(
					"SELECT 1 FROM party WHERE id = $1 AND assigned_principal_id = $2 FOR UPDATE",
					[partyId, context.principalId],
				);
				if (assigned.rowCount === 0) return { kind: "missing" };
				const inserted = await client.query<ConsentRow>(
					`INSERT INTO consent_record (organization_id, id, party_id, purpose,
							status, method, recorded_by_principal_id)
						VALUES ($1, $2, $3, $4, $5, $6, $7)
						ON CONFLICT (organization_id, id) DO NOTHING
						RETURNING ${COLUMNS}`,
					[
						context.organizationId,
						consent.id,
						partyId,
						consent.purpose,
						consent.status,
						consent.method,
						context.principalId,
					],
				);
				const created = inserted.rows[0];
				if (created) {
					// Codes only; who and when are on the audit row itself.
					await recordChange(client, {
						action: "consent.record",
						resourceType: "consent_record",
						resourceId: consent.id,
						details: {
							purpose: consent.purpose,
							status: consent.status,
							method: consent.method,
						},
						event: {
							type: "consent.recorded",
							schemaVersion: 1,
							aggregateVersion: 1,
							payload: { consentId: consent.id, partyId },
						},
					});
					return { kind: "created", row: created };
				}
				const existing = (
					await client.query<ConsentRow & { party_id: string }>(
						`SELECT ${COLUMNS}, party_id FROM consent_record
							WHERE id = $1 AND recorded_by_principal_id = $2`,
						[consent.id, context.principalId],
					)
				).rows[0];
				if (
					existing &&
					existing.party_id === partyId &&
					existing.purpose === consent.purpose &&
					existing.status === consent.status &&
					existing.method === consent.method
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
