/**
 * Deals, first slice (ADR 0021). A deal is one side of a real estate
 * transaction that the brokerage represents, for an Ontario property, with
 * the clients it is for.
 */

/** Whom the brokerage represents. Stored codes; labels may change. */
export const DEAL_SIDES = Object.freeze([
	"buyer",
	"seller",
	"tenant",
	"landlord",
] as const);
export type DealSide = (typeof DEAL_SIDES)[number];
export const DEAL_SIDE_LABELS: Readonly<Record<DealSide, string>> =
	Object.freeze({
		buyer: "Buyer",
		seller: "Seller",
		tenant: "Tenant",
		landlord: "Landlord",
	});

/**
 * Deal stages. PLACEHOLDER names and rules until the broker of record
 * approves them (docs/roadmap/PILOT.md, slice 3): change the labels freely;
 * changing codes or rules needs a migration, because they are stored and
 * the database trigger repeats canMoveDeal.
 */
export const DEAL_STAGES = Object.freeze([
	"draft",
	"active",
	"conditional",
	"firm",
	"closed",
	"fell_through",
] as const);
export type DealStage = (typeof DEAL_STAGES)[number];
export const DEAL_STAGE_LABELS: Readonly<Record<DealStage, string>> =
	Object.freeze({
		draft: "Draft",
		active: "Active",
		conditional: "Conditional",
		firm: "Firm",
		closed: "Closed",
		fell_through: "Fell through",
	});
export const DEAL_STAGES_ARE_PLACEHOLDER = true;

/** Stages of a deal still in progress. */
export const OPEN_DEAL_STAGES = Object.freeze([
	"draft",
	"active",
	"conditional",
	"firm",
] as const satisfies readonly DealStage[]);

const isOpen = (stage: DealStage) =>
	(OPEN_DEAL_STAGES as readonly DealStage[]).includes(stage);

/**
 * Whether a deal may move from one stage to another (ADR 0021). An open
 * deal moves to any other stage except back to draft; a deal that fell
 * through can only be reopened as active; a closed deal never moves. The
 * database trigger in migrations/0011_deals.sql repeats these rules.
 */
export function canMoveDeal(from: DealStage, to: DealStage): boolean {
	if (from === to || to === "draft") return false;
	if (from === "closed") return false;
	if (from === "fell_through") return to === "active";
	return isOpen(from);
}

export const STREET_MAX = 200;
export const UNIT_MAX = 20;
export const CITY_MAX = 100;
/** Clients on one deal: at least one, at most this many. */
export const DEAL_CLIENTS_MAX = 4;

export interface DealAddress {
	street: string;
	unit: string | null;
	city: string;
	/** Ontario postal code, upper case with one space: "K1A 0B1". */
	postalCode: string;
}

export interface NewDeal {
	id: string;
	side: DealSide;
	address: DealAddress;
	clientIds: string[];
}

export type DealField =
	| "id"
	| "side"
	| "street"
	| "unit"
	| "city"
	| "postalCode"
	| "clientIds"
	| "body";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Control characters, line/paragraph separators, and lone surrogates. Mirrors
// the database CHECK.
const FORBIDDEN = /[\p{Cc}\u2028\u2029]|\p{Cs}/u;
// Ontario postal codes start with K, L, M, N or P; the letters D, F, I, O, Q
// and U are never used. Mirrors the database CHECK.
const POSTAL_CODE = /^([KLMNP]\d[ABCEGHJ-NPRSTV-Z]) ?(\d[ABCEGHJ-NPRSTV-Z]\d)$/;
const KEYS = new Set(["id", "side", "address", "clientIds"]);
const ADDRESS_KEYS = new Set(["street", "unit", "city", "postalCode"]);

const asObject = (input: unknown) =>
	typeof input === "object" && input !== null && !Array.isArray(input)
		? (input as Record<string, unknown>)
		: undefined;

const onlyKeys = (body: Record<string, unknown>, allowed: Set<string>) =>
	Object.keys(body).every((key) => allowed.has(key));

/** Trimmed text of 1 to `max` code points without control characters. */
function text(value: unknown, max: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	const length = [...trimmed].length;
	if (length < 1 || length > max || FORBIDDEN.test(trimmed)) return undefined;
	return trimmed;
}

/** Validates a request to add a deal. The only rules; shared by every app. */
export function parseNewDeal(
	input: unknown,
): { ok: true; deal: NewDeal } | { ok: false; field: DealField } {
	const body = asObject(input);
	if (!body || !onlyKeys(body, KEYS)) return { ok: false, field: "body" };
	if (typeof body.id !== "string" || !UUID.test(body.id))
		return { ok: false, field: "id" };
	if (
		typeof body.side !== "string" ||
		!(DEAL_SIDES as readonly string[]).includes(body.side)
	)
		return { ok: false, field: "side" };
	const address = asObject(body.address);
	if (!address || !onlyKeys(address, ADDRESS_KEYS))
		return { ok: false, field: "body" };
	const street = text(address.street, STREET_MAX);
	if (!street) return { ok: false, field: "street" };
	let unit: string | null = null;
	if (
		address.unit !== undefined &&
		address.unit !== null &&
		!(typeof address.unit === "string" && address.unit.trim() === "")
	) {
		const value = text(address.unit, UNIT_MAX);
		if (!value) return { ok: false, field: "unit" };
		unit = value;
	}
	const city = text(address.city, CITY_MAX);
	if (!city) return { ok: false, field: "city" };
	const postal =
		typeof address.postalCode === "string"
			? POSTAL_CODE.exec(address.postalCode.trim().toUpperCase())
			: null;
	if (!postal) return { ok: false, field: "postalCode" };
	const ids = body.clientIds;
	if (
		!Array.isArray(ids) ||
		ids.length < 1 ||
		ids.length > DEAL_CLIENTS_MAX ||
		!ids.every((id) => typeof id === "string" && UUID.test(id))
	)
		return { ok: false, field: "clientIds" };
	const clientIds = (ids as string[]).map((id) => id.toLowerCase());
	if (new Set(clientIds).size !== clientIds.length)
		return { ok: false, field: "clientIds" };
	return {
		ok: true,
		deal: {
			id: body.id.toLowerCase(),
			side: body.side as DealSide,
			address: {
				street,
				unit,
				city,
				postalCode: `${postal[1]} ${postal[2]}`,
			},
			clientIds: [...clientIds].sort(),
		},
	};
}

const VERSION_MAX = 2147483647;
const STAGE_KEYS = new Set(["stage", "version"]);

/** Validates a stage change: `{ stage, version }` and nothing else. */
export function parseStageChange(
	input: unknown,
):
	| { ok: true; stage: DealStage; version: number }
	| { ok: false; field: "stage" | "version" | "body" } {
	const body = asObject(input);
	if (!body || !onlyKeys(body, STAGE_KEYS)) return { ok: false, field: "body" };
	if (
		typeof body.stage !== "string" ||
		!(DEAL_STAGES as readonly string[]).includes(body.stage)
	)
		return { ok: false, field: "stage" };
	const version = body.version;
	if (
		typeof version !== "number" ||
		!Number.isInteger(version) ||
		version < 1 ||
		version > VERSION_MAX
	)
		return { ok: false, field: "version" };
	return { ok: true, stage: body.stage as DealStage, version };
}

/** One line for lists: "12 Main St, Unit 4, Ottawa ON K1A 0B1". */
export function formatAddress(address: DealAddress): string {
	return [
		address.street,
		address.unit ? `Unit ${address.unit}` : null,
		`${address.city} ON ${address.postalCode}`,
	]
		.filter(Boolean)
		.join(", ");
}
