/** Maximum client name length in characters (code points), as in the database. */
export const NAME_MAX = 200;
/** Maximum email length (RFC 5321 path limit). */
export const EMAIL_MAX = 254;

export interface NewClient {
	id: string;
	name: string;
	/** Lower-cased, or null when not given. */
	email: string | null;
	/** Digits only, with a leading "+" for international numbers, or null. */
	phone: string | null;
}

export type NewClientResult =
	| { ok: true; client: NewClient }
	| { ok: false; field: "id" | "name" | "email" | "phone" | "body" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same rule as task titles: no controls, line/paragraph separators or half emoji.
const FORBIDDEN = /[\p{Cc}\u2028\u2029]|\p{Cs}/u;
// Deliberately simple: one "@", no spaces, a dot in the domain. Mailbox
// verification happens when a message is sent, never by pattern alone.
// "?", "#", "%" and "&" are refused so an address can never carry mailto:
// parameters (e.g. a hidden bcc) into an email link.
const EMAIL = /^[^\s@?#%&]+@[^\s@?#%&]+\.[^\s@?#%&]+$/;
// Spaces, dots, dashes and brackets are formatting; a "+" only leads.
const PHONE_FORMATTING = /[\s.()-]/g;
const PHONE = /^\+?\d{7,15}$/;
const ALLOWED_KEYS = new Set(["id", "name", "email", "phone"]);

const blank = (value: unknown) =>
	value === undefined ||
	value === null ||
	(typeof value === "string" && value.trim() === "");

type Fields = Pick<NewClient, "name" | "email" | "phone">;
type FieldError = { ok: false; field: "name" | "email" | "phone" };

/** Name, email and phone: the same rules for adding and editing. */
function parseFields(body: Record<string, unknown>): Fields | FieldError {
	if (typeof body.name !== "string") return { ok: false, field: "name" };
	const name = body.name.trim();
	const length = [...name].length;
	if (length < 1 || length > NAME_MAX || FORBIDDEN.test(name))
		return { ok: false, field: "name" };
	let email: string | null = null;
	if (!blank(body.email)) {
		if (typeof body.email !== "string") return { ok: false, field: "email" };
		email = body.email.trim().toLowerCase();
		if (email.length > EMAIL_MAX || !EMAIL.test(email) || FORBIDDEN.test(email))
			return { ok: false, field: "email" };
	}
	let phone: string | null = null;
	if (!blank(body.phone)) {
		if (typeof body.phone !== "string") return { ok: false, field: "phone" };
		phone = body.phone.replace(PHONE_FORMATTING, "");
		if (!PHONE.test(phone)) return { ok: false, field: "phone" };
	}
	return { name, email, phone };
}

const asObject = (input: unknown) =>
	typeof input === "object" && input !== null && !Array.isArray(input)
		? (input as Record<string, unknown>)
		: undefined;

const onlyKeys = (body: Record<string, unknown>, allowed: Set<string>) =>
	Object.keys(body).every((key) => allowed.has(key));

/** Validates a request to add a client. The only rules; shared by every app. */
export function parseNewClient(input: unknown): NewClientResult {
	const body = asObject(input);
	if (!body || !onlyKeys(body, ALLOWED_KEYS))
		return { ok: false, field: "body" };
	if (typeof body.id !== "string" || !UUID.test(body.id))
		return { ok: false, field: "id" };
	const fields = parseFields(body);
	if ("ok" in fields) return fields;
	return { ok: true, client: { id: body.id.toLowerCase(), ...fields } };
}

const VERSION_MAX = 2147483647;
const UPDATE_KEYS = new Set(["version", "name", "email", "phone"]);

export interface ClientUpdate extends Fields {
	/** The version the editor saw; a stale one is a conflict. */
	version: number;
}

/**
 * Validates an edit: the full set of editable fields plus the version seen.
 * A missing or blank email or phone clears it.
 */
export function parseClientUpdate(
	input: unknown,
):
	| { ok: true; update: ClientUpdate }
	| { ok: false; field: "version" | "name" | "email" | "phone" | "body" } {
	const body = asObject(input);
	if (!body || !onlyKeys(body, UPDATE_KEYS))
		return { ok: false, field: "body" };
	const version = body.version;
	if (
		typeof version !== "number" ||
		!Number.isInteger(version) ||
		version < 1 ||
		version > VERSION_MAX
	)
		return { ok: false, field: "version" };
	const fields = parseFields(body);
	if ("ok" in fields) return fields;
	return { ok: true, update: { version, ...fields } };
}

/**
 * Why a client may be contacted. PLACEHOLDER wording until the brokerage's
 * privacy owner approves it (docs/roadmap/PILOT.md, slice 2): change the
 * labels, never the codes, which are stored.
 */
export const CONSENT_PURPOSES = Object.freeze([
	"transaction_service",
	"market_updates",
] as const);
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const CONSENT_PURPOSE_LABELS: Readonly<Record<ConsentPurpose, string>> =
	Object.freeze({
		transaction_service:
			"Contact me about my purchase, sale or lease (placeholder wording)",
		market_updates:
			"Send me market updates and new listings (placeholder wording)",
	});
export const CONSENT_WORDING_IS_PLACEHOLDER = true;

export const CONSENT_STATUSES = Object.freeze([
	"granted",
	"withdrawn",
] as const);
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
/** How the client gave or withdrew consent, as evidence of who recorded it. */
export const CONSENT_METHODS = Object.freeze([
	"written",
	"electronic",
	"verbal",
] as const);
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export interface ConsentRecord {
	id: string;
	purpose: ConsentPurpose;
	status: ConsentStatus;
	method: ConsentMethod;
}

const CONSENT_KEYS = new Set(["id", "purpose", "status", "method"]);
const oneOf = <T extends string>(
	list: readonly T[],
	value: unknown,
): value is T =>
	typeof value === "string" && (list as readonly string[]).includes(value);

/** Validates a consent grant or withdrawal. Records are never edited. */
export function parseConsentRecord(
	input: unknown,
):
	| { ok: true; record: ConsentRecord }
	| { ok: false; field: "id" | "purpose" | "status" | "method" | "body" } {
	const body = asObject(input);
	if (!body || !onlyKeys(body, CONSENT_KEYS))
		return { ok: false, field: "body" };
	if (typeof body.id !== "string" || !UUID.test(body.id))
		return { ok: false, field: "id" };
	if (!oneOf(CONSENT_PURPOSES, body.purpose))
		return { ok: false, field: "purpose" };
	if (!oneOf(CONSENT_STATUSES, body.status))
		return { ok: false, field: "status" };
	if (!oneOf(CONSENT_METHODS, body.method))
		return { ok: false, field: "method" };
	return {
		ok: true,
		record: {
			id: body.id.toLowerCase(),
			purpose: body.purpose,
			status: body.status,
			method: body.method,
		},
	};
}
