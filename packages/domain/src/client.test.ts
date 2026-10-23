import { describe, expect, it } from "vitest";
import {
	CONSENT_PURPOSE_LABELS,
	CONSENT_PURPOSES,
	CONSENT_WORDING_IS_PLACEHOLDER,
	NAME_MAX,
	parseClientUpdate,
	parseConsentRecord,
	parseNewClient,
} from "./client.js";

const id = "0b9c2e1a-1d2f-4c3b-8a9e-1f2e3d4c5b6a";

describe("parseNewClient", () => {
	it("accepts a name only", () => {
		expect(parseNewClient({ id, name: "  Synthetic Client  " })).toEqual({
			ok: true,
			client: { id, name: "Synthetic Client", email: null, phone: null },
		});
	});

	it("normalises email and phone", () => {
		expect(
			parseNewClient({
				id: id.toUpperCase(),
				name: "Élodie Tremblay",
				email: " Synthetic.Client@Example.INVALID ",
				phone: "(416) 555-0100",
			}),
		).toEqual({
			ok: true,
			client: {
				id,
				name: "Élodie Tremblay",
				email: "synthetic.client@example.invalid",
				phone: "4165550100",
			},
		});
	});

	it("keeps a leading plus on international numbers", () => {
		const parsed = parseNewClient({ id, name: "X", phone: "+44 20 7946 0000" });
		expect(parsed.ok && parsed.client.phone).toBe("+442079460000");
	});

	it("treats empty email and phone as absent", () => {
		const parsed = parseNewClient({ id, name: "X", email: "", phone: " " });
		expect(parsed.ok && parsed.client).toMatchObject({
			email: null,
			phone: null,
		});
	});

	it("allows the maximum name length, counting emoji as one", () => {
		expect(parseNewClient({ id, name: "😀".repeat(NAME_MAX) }).ok).toBe(true);
		expect(parseNewClient({ id, name: "x".repeat(NAME_MAX + 1) })).toEqual({
			ok: false,
			field: "name",
		});
	});

	it.each<[string, unknown, string]>([
		["not an object", "x", "body"],
		["an array", [], "body"],
		["an extra field", { id, name: "X", notes: "y" }, "body"],
		["a bad id", { id: "nope", name: "X" }, "id"],
		["no name", { id }, "name"],
		["a blank name", { id, name: "   " }, "name"],
		["a control character", { id, name: "a\u0007b" }, "name"],
		["a line separator", { id, name: "a\u2028b" }, "name"],
		["half an emoji", { id, name: "a\ud83d" }, "name"],
		["a malformed email", { id, name: "X", email: "not-an-email" }, "email"],
		["an email with spaces", { id, name: "X", email: "a b@c.ca" }, "email"],
		[
			"a long email",
			{ id, name: "X", email: `${"a".repeat(250)}@b.ca` },
			"email",
		],
		["a number email", { id, name: "X", email: 5 }, "email"],
		[
			"an email with mailto parameters",
			{ id, name: "X", email: "a@b.ca?subject=hi" },
			"email",
		],
		["an email with a fragment", { id, name: "X", email: "a@b.ca#x" }, "email"],
		[
			"an email with a percent",
			{ id, name: "X", email: "a%40b@c.ca" },
			"email",
		],
		[
			"an email with an ampersand",
			{ id, name: "X", email: "a&b@c.ca" },
			"email",
		],
		["a short phone", { id, name: "X", phone: "555-01" }, "phone"],
		["a long phone", { id, name: "X", phone: "1".repeat(16) }, "phone"],
		["letters in a phone", { id, name: "X", phone: "416-CALL-NOW" }, "phone"],
		["a plus in the middle", { id, name: "X", phone: "416+5550100" }, "phone"],
	])("rejects %s", (_label, input, field) => {
		expect(parseNewClient(input)).toEqual({ ok: false, field });
	});
});

describe("parseClientUpdate", () => {
	it("accepts the full set of editable fields with a version", () => {
		expect(
			parseClientUpdate({
				version: 2,
				name: " New Name ",
				email: "New@Example.invalid",
				phone: "",
			}),
		).toEqual({
			ok: true,
			update: {
				version: 2,
				name: "New Name",
				email: "new@example.invalid",
				phone: null,
			},
		});
	});

	it("clears email and phone sent as null", () => {
		expect(
			parseClientUpdate({ version: 1, name: "X", email: null, phone: null }),
		).toMatchObject({ ok: true, update: { email: null, phone: null } });
	});

	it.each<[string, unknown, string]>([
		["no version", { name: "X", email: "", phone: "" }, "body"],
		[
			"a zero version",
			{ version: 0, name: "X", email: "", phone: "" },
			"version",
		],
		[
			"a string version",
			{ version: "1", name: "X", email: "", phone: "" },
			"version",
		],
		["an id", { version: 1, id, name: "X", email: "", phone: "" }, "body"],
		["a missing email", { version: 1, name: "X", phone: "" }, "body"],
		["a missing phone", { version: 1, name: "X", email: null }, "body"],
		["a bad name", { version: 1, name: "", email: "", phone: "" }, "name"],
		["a bad email", { version: 1, name: "X", email: "x", phone: "" }, "email"],
		["a bad phone", { version: 1, name: "X", email: "", phone: "1" }, "phone"],
		["not an object", null, "body"],
	])("rejects %s", (_label, input, field) => {
		expect(parseClientUpdate(input)).toEqual({ ok: false, field });
	});
});

describe("parseConsentRecord", () => {
	it("accepts a grant", () => {
		expect(
			parseConsentRecord({
				id,
				purpose: "market_updates",
				status: "granted",
				method: "written",
			}),
		).toEqual({
			ok: true,
			record: {
				id,
				purpose: "market_updates",
				status: "granted",
				method: "written",
			},
		});
	});

	it("every purpose has a label and is marked as placeholder wording", () => {
		for (const purpose of CONSENT_PURPOSES) {
			expect(CONSENT_PURPOSE_LABELS[purpose].length).toBeGreaterThan(10);
		}
		expect(CONSENT_WORDING_IS_PLACEHOLDER).toBe(true);
	});

	it.each<[string, unknown, string]>([
		[
			"an unknown purpose",
			{ id, purpose: "spam", status: "granted", method: "written" },
			"purpose",
		],
		[
			"an inherited purpose",
			{ id, purpose: "toString", status: "granted", method: "written" },
			"purpose",
		],
		[
			"an unknown status",
			{ id, purpose: "market_updates", status: "maybe", method: "written" },
			"status",
		],
		[
			"an unknown method",
			{ id, purpose: "market_updates", status: "granted", method: "guessed" },
			"method",
		],
		[
			"a bad id",
			{
				id: "x",
				purpose: "market_updates",
				status: "granted",
				method: "written",
			},
			"id",
		],
		[
			"an extra field",
			{
				id,
				purpose: "market_updates",
				status: "granted",
				method: "written",
				note: "x",
			},
			"body",
		],
		["an array", [], "body"],
	])("rejects %s", (_label, input, field) => {
		expect(parseConsentRecord(input)).toEqual({ ok: false, field });
	});
});
