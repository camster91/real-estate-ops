import { recordChange } from "@reo/db";
import { type NewTask, parseNewTask, type TaskStatus } from "@reo/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { requireSession } from "../auth/guard.js";
import { inTenant, NOT_MEMBER } from "./context.js";

interface TaskRow {
	id: string;
	title: string;
	status: TaskStatus;
	due_at: Date | null;
	version: number;
}

const PURPOSE = "operations";
const COLUMNS = "id, title, status, due_at, version";

const toTask = (row: TaskRow) => ({
	id: row.id,
	title: row.title,
	status: row.status,
	dueAt: row.due_at ? row.due_at.toISOString() : null,
	version: row.version,
});

const sameDue = (a: Date | null, b: Date | null) =>
	(a === null && b === null) ||
	(a !== null && b !== null && a.getTime() === b.getTime());

type CreateOutcome =
	| { kind: "created" | "replayed"; row: TaskRow }
	| { kind: "conflict" };

/** "My tasks" and self-assigned task creation (ADR 0015). */
export function registerTaskRoutes(
	app: FastifyInstance,
	options: { pool: pg.Pool },
): void {
	const { pool } = options;

	app.get(
		"/v1/organizations/:organizationId/tasks",
		{ preHandler: requireSession(pool) },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const result = await inTenant(
				pool,
				request,
				PURPOSE,
				async ({ client, context }) =>
					(
						await client.query<TaskRow>(
							`SELECT ${COLUMNS} FROM task
							WHERE assignee_principal_id = $1
							ORDER BY status IN ('completed', 'cancelled'), due_at ASC NULLS LAST,
								created_at, id
							LIMIT 100`,
							[context.principalId],
						)
					).rows,
			);
			if (result === NOT_MEMBER)
				return reply.code(404).send({ error: "not_found" });
			return { tasks: result.map(toTask) };
		},
	);

	app.post(
		"/v1/organizations/:organizationId/tasks",
		{ preHandler: requireSession(pool), bodyLimit: 4096 },
		async (request, reply) => {
			reply.header("cache-control", "no-store");
			const parsed = parseNewTask(request.body);
			if (!parsed.ok)
				return reply
					.code(400)
					.send({ error: "invalid_task", field: parsed.field });
			const task = parsed.task;
			const result = await createOrReplay(pool, request, task);
			if (result === NOT_MEMBER)
				return reply.code(404).send({ error: "not_found" });
			if (result.kind === "conflict")
				return reply.code(409).send({ error: "conflict" });
			return reply
				.code(result.kind === "created" ? 201 : 200)
				.send({ task: toTask(result.row) });
		},
	);
}

// Membership can end between inTenant's check and the insert; RLS (42501) or
// the membership FK (23503) then refuses the row. That is "not a member", not
// a server error.
const MEMBERSHIP_LOST = new Set(["42501", "23503"]);

async function createOrReplay(
	pool: pg.Pool,
	request: FastifyRequest,
	task: NewTask,
): Promise<CreateOutcome | typeof NOT_MEMBER> {
	try {
		return await inTenant(
			pool,
			request,
			PURPOSE,
			async ({ client, context }): Promise<CreateOutcome> => {
				// The client-chosen id makes a retried POST safe: a replay finds the
				// existing row instead of creating a second task, audit or event.
				const inserted = await client.query<TaskRow>(
					`INSERT INTO task (organization_id, id, title, assignee_principal_id,
							created_by_principal_id, due_at)
						VALUES ($1, $2, $3, $4, $4, $5)
						ON CONFLICT (organization_id, id) DO NOTHING
						RETURNING ${COLUMNS}`,
					[
						context.organizationId,
						task.id,
						task.title,
						context.principalId,
						task.dueAt,
					],
				);
				const created = inserted.rows[0];
				if (created) {
					await recordChange(client, {
						action: "task.create",
						resourceType: "task",
						resourceId: task.id,
						details: {
							status: created.status,
							hasDueDate: task.dueAt !== null,
						},
						event: {
							type: "task.created",
							schemaVersion: 1,
							aggregateVersion: 1,
							payload: { taskId: task.id },
						},
					});
					return { kind: "created", row: created };
				}
				// Visible only to its creator; another member's id reads as a conflict.
				const existing = (
					await client.query<TaskRow>(
						`SELECT ${COLUMNS} FROM task
							WHERE id = $1 AND created_by_principal_id = $2`,
						[task.id, context.principalId],
					)
				).rows[0];
				if (
					existing &&
					existing.title === task.title &&
					sameDue(existing.due_at, task.dueAt)
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
