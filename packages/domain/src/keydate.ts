import { parseOffsetDateTime } from "./time.js";

/**
 * Key dates on a deal (ADR 0022): condition deadlines, deposit due, closing
 * and other dates, each a moment in time that can be marked done.
 */
export const KEY_DATE_KINDS = Object.freeze([
	"condition",
	"deposit",
	"closing",
	"other",
] as const);
export type KeyDateKind = (typeof KEY_DATE_KINDS)[number];
export const KEY_DATE_KIND_LABELS: Readonly<Record<KeyDateKind, string>> =
	Object.freeze({
		condition: "Condition",
		deposit: "Deposit due",
		closing: "Closing",
		other: "Other",
	});

/** Kinds that need a label saying which one, e.g. "Financing". */
export const needsLabel = (kind: KeyDateKind) =>
	kind === "condition" || kind === "other";

export const KEY_DATE_LABEL_MAX = 100;
/** Due times outside these years are refused as typing mistakes. */
export const KEY_DATE_YEARS = Object.freeze({ min: 2000, max: 2100 });
/** Key dates per deal; more are refused rather than hidden from the list. */
export const KEY_DATES_PER_DEAL_MAX = 200;
/** "Due soon" means within this many hours. */
export const DUE_SOON_HOURS = 72;

export interface NewKeyDate {
	id: string;
	kind: KeyDateKind;
	label: string | null;
	dueAt: Date;
}

export interface KeyDateUpdate {
	version: number;
	label: string | null;
	dueAt: Date;
	done: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Control characters, line/paragraph separators, and lone surrogates. Mirrors
// the database CHECK.
const FORBIDDEN = /[\p{Cc}\u2028\u2029]|\p{Cs}/u;
const VERSION_MAX = 2147483647;
const NEW_KEYS = new Set(["id", "kind", "label", "dueAt"]);
const UPDATE_KEYS = new Set(["version", "label", "dueAt", "done"]);

/** A due time with an offset, within KEY_DATE_YEARS. */
function parseDue(value: unknown): Date | undefined {
	const date = parseOffsetDateTime(value);
	if (!date) return undefined;
	const year = date.getUTCFullYear();
	return year >= KEY_DATE_YEARS.min && year <= KEY_DATE_YEARS.max
		? date
		: undefined;
}

const asObject = (input: unknown) =>
	typeof input === "object" && input !== null && !Array.isArray(input)
		? (input as Record<string, unknown>)
		: undefined;

const onlyKeys = (body: Record<string, unknown>, allowed: Set<string>) =>
	Object.keys(body).every((key) => allowed.has(key));

/** A missing or blank label is null; otherwise 1 to 100 clean characters. */
function parseLabel(value: unknown): string | null | undefined {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") return undefined;
	const label = value.trim();
	if (label === "") return null;
	if ([...label].length > KEY_DATE_LABEL_MAX || FORBIDDEN.test(label))
		return undefined;
	return label;
}

/** Validates a new key date. The only rules; shared by every app. */
export function parseNewKeyDate(
	input: unknown,
):
	| { ok: true; keyDate: NewKeyDate }
	| { ok: false; field: "id" | "kind" | "label" | "dueAt" | "body" } {
	const body = asObject(input);
	if (!body || !onlyKeys(body, NEW_KEYS)) return { ok: false, field: "body" };
	if (typeof body.id !== "string" || !UUID.test(body.id))
		return { ok: false, field: "id" };
	if (
		typeof body.kind !== "string" ||
		!(KEY_DATE_KINDS as readonly string[]).includes(body.kind)
	)
		return { ok: false, field: "kind" };
	const kind = body.kind as KeyDateKind;
	const label = parseLabel(body.label);
	if (label === undefined || (label === null && needsLabel(kind)))
		return { ok: false, field: "label" };
	const dueAt = parseDue(body.dueAt);
	if (!dueAt) return { ok: false, field: "dueAt" };
	return {
		ok: true,
		keyDate: { id: body.id.toLowerCase(), kind, label, dueAt },
	};
}

/**
 * Validates an edit: every editable field plus the version seen. Whether the
 * label may be empty depends on the stored kind; see needsLabel.
 */
export function parseKeyDateUpdate(
	input: unknown,
):
	| { ok: true; update: KeyDateUpdate }
	| { ok: false; field: "version" | "label" | "dueAt" | "done" | "body" } {
	const body = asObject(input);
	if (
		!body ||
		!onlyKeys(body, UPDATE_KEYS) ||
		![...UPDATE_KEYS].every((key) => key in body)
	)
		return { ok: false, field: "body" };
	const version = body.version;
	if (
		typeof version !== "number" ||
		!Number.isInteger(version) ||
		version < 1 ||
		version > VERSION_MAX
	)
		return { ok: false, field: "version" };
	const label = parseLabel(body.label);
	if (label === undefined) return { ok: false, field: "label" };
	const dueAt = parseDue(body.dueAt);
	if (!dueAt) return { ok: false, field: "dueAt" };
	if (typeof body.done !== "boolean") return { ok: false, field: "done" };
	return { ok: true, update: { version, label, dueAt, done: body.done } };
}

export type KeyDateState = "done" | "overdue" | "due_soon" | "upcoming";

/** Where a key date stands at `now`: done, past due, within 72 hours, or later. */
export function keyDateState(
	dueAt: string | Date,
	doneAt: string | Date | null,
	now: Date = new Date(),
): KeyDateState {
	if (doneAt) return "done";
	const due = new Date(dueAt).getTime();
	if (due < now.getTime()) return "overdue";
	if (due - now.getTime() <= DUE_SOON_HOURS * 3_600_000) return "due_soon";
	return "upcoming";
}
