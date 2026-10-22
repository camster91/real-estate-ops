import { describe, expect, it } from "vitest";
import { minimiseDetails } from "./audit.js";

describe("minimiseDetails", () => {
	it("keeps short primitives and code-like strings", () => {
		const input = {
			status: "ready",
			count: 2,
			done: false,
			due: null,
			closingDate: "2026-11-01",
			at: "2026-11-01T10:00:00Z",
			branchId: "0b9c2e1a-1d2f-4c3b-8a9e-1f2e3d4c5b6a",
		};
		expect(minimiseDetails(input)).toEqual(input);
	});

	it("redacts sensitive keys", () => {
		const keys = [
			"email",
			"clientName",
			"phoneNumber",
			"accountNo",
			"SIN",
			"clientSin",
			"sinNumber",
			"homeAddress",
			"postalCode",
			"mobile",
			"licenceNumber",
			"bankNumber",
			"transit",
			"iban",
			"cardNumber",
			"passport",
			"ohip",
			"healthCard",
			"street",
			"city",
			"occupation",
			"employer",
			"apiKey",
			"authorization",
			"credential",
			"noteText",
			"apiToken",
		];
		// One key at a time: at most 20 keys are kept per object.
		for (const key of keys)
			expect(minimiseDetails({ [key]: "x1" })[key], key).toBe("[redacted]");
	});

	it("redacts personal data in values under neutral keys", () => {
		expect(
			minimiseDetails({
				status: "Called Jane Doe at 416-555-0100",
				to: "jane@x.invalid",
				reason: "client asked",
				code: "OK_1",
			}),
		).toEqual({
			status: "[redacted]",
			to: "[redacted]",
			reason: "[redacted]",
			code: "OK_1",
		});
	});

	it("redacts personal numbers and postal codes under neutral keys", () => {
		for (const value of [
			"046454286",
			"046-454-286",
			"4165551234",
			"+14165551234",
			"416-555-0100",
			"4111.1111.1111.1111",
			"M5V2T6",
			"m5v-2t6",
		])
			expect(minimiseDetails({ ref: value }).ref, value).toBe("[redacted]");
		for (const key of ["postcode", "post_code", "insuranceNumber"])
			expect(minimiseDetails({ [key]: "x1" })[key], key).toBe("[redacted]");
	});

	it("keeps dates, short numbers and versions", () => {
		const input = {
			closingDate: "2026-11-01",
			at: "2026-11-01T10:00:00.000Z",
			local: "2026-11-01T10:00-04:00",
			version: "1.2.3",
			step: "123456",
			code: "A1B2C3D",
		};
		expect(minimiseDetails(input)).toEqual(input);
	});

	it("keeps uuid-valued id keys even when the name looks sensitive", () => {
		const id = "0b9c2e1a-1d2f-4c3b-8a9e-1f2e3d4c5b6a";
		expect(
			minimiseDetails({ accountId: id, messageId: id, noteId: "n1" }),
		).toEqual({ accountId: id, messageId: id, noteId: "[redacted]" });
	});

	it("drops nested and odd values", () => {
		expect(
			minimiseDetails({
				nested: { a: 1 },
				list: [1],
				fn: () => 1,
				big: 1n,
				inf: Number.POSITIVE_INFINITY,
				nan: Number.NaN,
				undef: undefined,
			}),
		).toEqual({});
	});

	it.each([
		["long text", "x".repeat(65)],
		["multibyte", "日本語"],
		["NUL", "a\u0000b"],
		["emoji", "x😀"],
		["control", "\u0001\u0001"],
	])("%s becomes [redacted]", (_label, value) => {
		expect(minimiseDetails({ status: value })).toEqual({
			status: "[redacted]",
		});
	});

	it("limits keys", () => {
		const input = Object.fromEntries(
			Array.from({ length: 30 }, (_, i) => [`k${i}`, i]),
		);
		expect(Object.keys(minimiseDetails(input))).toEqual(
			Array.from({ length: 20 }, (_, i) => `k${i}`),
		);
	});

	it("worst case fits the database size check", () => {
		const input = Object.fromEntries(
			Array.from({ length: 30 }, (_, i) => [
				`k${String(i).padStart(2, "0")}${"x".repeat(36)}`,
				"y".repeat(64),
			]),
		);
		expect(
			Buffer.byteLength(JSON.stringify(minimiseDetails(input))),
		).toBeLessThan(4096);
	});

	it("drops odd key names", () => {
		expect(minimiseDetails({ "bad key": 1, "1x": 2, __proto__x: 3 })).toEqual(
			{},
		);
	});
});
