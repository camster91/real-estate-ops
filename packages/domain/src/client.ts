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

/** Validates a request to add a client. The only rules; shared by every app. */
export function parseNewClient(input: unknown): NewClientResult {
	if (typeof input !== "object" || input === null || Array.isArray(input))
		return { ok: false, field: "body" };
	const body = input as Record<string, unknown>;
	if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key)))
		return { ok: false, field: "body" };
	if (typeof body.id !== "string" || !UUID.test(body.id))
		return { ok: false, field: "id" };
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
	return {
		ok: true,
		client: { id: body.id.toLowerCase(), name, email, phone },
	};
}
