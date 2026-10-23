import { describe, expect, it } from "vitest";
import { NAME_MAX, parseNewClient } from "./client.js";

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
		["a short phone", { id, name: "X", phone: "555-01" }, "phone"],
		["a long phone", { id, name: "X", phone: "1".repeat(16) }, "phone"],
		["letters in a phone", { id, name: "X", phone: "416-CALL-NOW" }, "phone"],
		["a plus in the middle", { id, name: "X", phone: "416+5550100" }, "phone"],
	])("rejects %s", (_label, input, field) => {
		expect(parseNewClient(input)).toEqual({ ok: false, field });
	});
});
