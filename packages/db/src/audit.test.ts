import { describe, expect, it } from "vitest";
import { minimiseDetails } from "./audit.js";

describe("minimiseDetails", () => {
	it("keeps short primitives", () => {
		const input = { status: "ready", count: 2, done: false, due: null };
		expect(minimiseDetails(input)).toEqual(input);
	});

	it("redacts sensitive keys", () => {
		expect(
			minimiseDetails({
				email: "a@b.invalid",
				clientName: "X",
				phoneNumber: "1",
				accountNo: "9",
				SIN: "1",
				homeAddress: "1 Main",
				noteText: "private",
				apiToken: "t",
			}),
		).toEqual({
			email: "[redacted]",
			clientName: "[redacted]",
			phoneNumber: "[redacted]",
			accountNo: "[redacted]",
			SIN: "[redacted]",
			homeAddress: "[redacted]",
			noteText: "[redacted]",
			apiToken: "[redacted]",
		});
		expect(minimiseDetails({ closingDate: "2026-11-01" })).toEqual({
			closingDate: "2026-11-01",
		});
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

	it("truncates long text", () => {
		const result = minimiseDetails({ status: "x".repeat(500) });
		expect((result.status as string).length).toBe(200);
	});

	it("limits keys", () => {
		const input = Object.fromEntries(
			Array.from({ length: 30 }, (_, i) => [`k${i}`, i]),
		);
		expect(Object.keys(minimiseDetails(input))).toEqual(
			Array.from({ length: 20 }, (_, i) => `k${i}`),
		);
	});

	it("drops odd key names", () => {
		expect(minimiseDetails({ "bad key": 1, "1x": 2, __proto__x: 3 })).toEqual(
			{},
		);
	});
});
