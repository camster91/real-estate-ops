/** Task states from docs/product/CORE_MODEL.md. */
export const TASK_STATUSES = Object.freeze([
	"ready",
	"in_progress",
	"waiting",
	"blocked",
	"completed",
	"cancelled",
] as const);
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Maximum title length in characters (code points), as in the database. */
export const TITLE_MAX = 200;

export interface NewTask {
	id: string;
	title: string;
	dueAt: Date | null;
}

export type NewTaskResult =
	| { ok: true; task: NewTask }
	| { ok: false; field: "id" | "title" | "dueAt" | "body" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Control characters, line/paragraph separators, and lone surrogates (half an
// emoji, which PostgreSQL would silently replace). Mirrors the database CHECK.
const FORBIDDEN = /[\p{Cc}\u2028\u2029]|\p{Cs}/u;
// ISO 8601 date-time with an explicit offset or Z; seconds and fractions optional.
const DATE_TIME =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ALLOWED_KEYS = new Set(["id", "title", "dueAt"]);

function parseDueAt(value: unknown): Date | null | undefined {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") return undefined;
	const match = DATE_TIME.exec(value);
	if (!match) return undefined;
	const [, year, month, day, hour, minute, second] = match.map(Number);
	// Reject impossible calendar dates (e.g. 30 February) that Date would roll over.
	const calendar = new Date(
		Date.UTC(year as number, (month as number) - 1, day),
	);
	if (
		calendar.getUTCMonth() !== (month as number) - 1 ||
		(hour as number) > 23 ||
		(minute as number) > 59 ||
		(second ?? 0) > 59
	)
		return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Validates a request to create a task. The only rules; shared by every app. */
export function parseNewTask(input: unknown): NewTaskResult {
	if (typeof input !== "object" || input === null || Array.isArray(input))
		return { ok: false, field: "body" };
	const body = input as Record<string, unknown>;
	if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key)))
		return { ok: false, field: "body" };
	if (typeof body.id !== "string" || !UUID.test(body.id))
		return { ok: false, field: "id" };
	if (typeof body.title !== "string") return { ok: false, field: "title" };
	const title = body.title.trim();
	const length = [...title].length;
	if (length < 1 || length > TITLE_MAX || FORBIDDEN.test(title))
		return { ok: false, field: "title" };
	const dueAt = parseDueAt(body.dueAt);
	if (dueAt === undefined) return { ok: false, field: "dueAt" };
	return { ok: true, task: { id: body.id.toLowerCase(), title, dueAt } };
}

/** Statuses of work still to do. */
export const OPEN_STATUSES = Object.freeze([
	"ready",
	"in_progress",
	"waiting",
	"blocked",
] as const satisfies readonly TaskStatus[]);

/** Finished statuses; a finished task can only be reopened (to ready). */
export const DONE_STATUSES = Object.freeze([
	"completed",
	"cancelled",
] as const satisfies readonly TaskStatus[]);

const isOpen = (status: TaskStatus) =>
	(OPEN_STATUSES as readonly TaskStatus[]).includes(status);

/**
 * Whether a task may move from one status to another (ADR 0017). Open
 * statuses move to any other status; finished ones only back to ready.
 * The same status is not a transition. The database trigger in
 * migrations/0008_task_status.sql repeats these rules.
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
	if (from === to) return false;
	return isOpen(from) || to === "ready";
}

const VERSION_MAX = 2147483647;
const STATUS_KEYS = new Set(["status", "version"]);

/** Validates a status change request: `{ status, version }` and nothing else. */
export function parseStatusChange(
	input: unknown,
):
	| { ok: true; status: TaskStatus; version: number }
	| { ok: false; field: "status" | "version" | "body" } {
	if (typeof input !== "object" || input === null || Array.isArray(input))
		return { ok: false, field: "body" };
	const body = input as Record<string, unknown>;
	if (Object.keys(body).some((key) => !STATUS_KEYS.has(key)))
		return { ok: false, field: "body" };
	const status = body.status;
	if (
		typeof status !== "string" ||
		!(TASK_STATUSES as readonly string[]).includes(status)
	)
		return { ok: false, field: "status" };
	const version = body.version;
	if (
		typeof version !== "number" ||
		!Number.isInteger(version) ||
		version < 1 ||
		version > VERSION_MAX
	)
		return { ok: false, field: "version" };
	return { ok: true, status: status as TaskStatus, version };
}
