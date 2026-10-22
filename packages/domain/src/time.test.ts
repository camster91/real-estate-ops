import { describe, expect, it } from "vitest";
import { parseNewTask } from "./task.js";
import { formatInZone, TORONTO, toOffsetIso, zonedLocalToUtc } from "./time.js";

const utc = (local: string) => {
	const result = zonedLocalToUtc(local, TORONTO);
	if (!(result instanceof Date)) throw new Error(`not a date: ${result}`);
	return result;
};

describe("Toronto time", () => {
	it("summer time", () => {
		const date = utc("2026-07-01T09:00");
		expect(date.toISOString()).toBe("2026-07-01T13:00:00.000Z");
		expect(toOffsetIso(date, TORONTO)).toBe("2026-07-01T09:00:00-04:00");
	});

	it("winter time", () => {
		const date = utc("2026-12-01T09:00");
		expect(date.toISOString()).toBe("2026-12-01T14:00:00.000Z");
		expect(toOffsetIso(date, TORONTO)).toBe("2026-12-01T09:00:00-05:00");
	});

	it("fall-back hour is the first occurrence", () => {
		const date = utc("2026-11-01T01:30");
		expect(date.toISOString()).toBe("2026-11-01T05:30:00.000Z");
		expect(toOffsetIso(date, TORONTO)).toBe("2026-11-01T01:30:00-04:00");
	});

	it("spring-forward gap does not exist", () => {
		expect(zonedLocalToUtc("2026-03-08T02:30", TORONTO)).toBe("nonexistent");
	});

	it.each(["", "2026-02-30T09:00", "tomorrow", "2026-07-01T24:00"])(
		"invalid input %j",
		(value) => {
			expect(zonedLocalToUtc(value, TORONTO)).toBe("invalid");
		},
	);

	it("accepts seconds", () => {
		expect(utc("2026-07-01T09:00:30").toISOString()).toBe(
			"2026-07-01T13:00:30.000Z",
		);
	});

	it.each([
		["2026-07-01T09:00", "9:00"],
		["2026-12-01T09:00", "9:00"],
		["2026-11-01T01:30", "1:30"],
		["2026-03-08T03:15", "3:15"],
	])("round trip %s", (local, clock) => {
		const shown = formatInZone(toOffsetIso(utc(local), TORONTO), TORONTO);
		expect(shown).toContain(clock);
	});

	it("format", () => {
		const shown = formatInZone("2026-11-01T14:00:00Z", TORONTO);
		expect(shown).toContain("Nov");
		expect(shown).toContain("1");
		expect(shown).toContain("9:00");
		expect(shown).toMatch(/a\.m\./);
	});

	it("agrees with parseNewTask", () => {
		for (const local of [
			"2026-07-01T09:00",
			"2026-12-01T09:00",
			"2026-11-01T01:30",
			"2026-03-08T03:15",
		]) {
			const dueAt = toOffsetIso(utc(local), TORONTO);
			const parsed = parseNewTask({
				id: "0b9c2e1a-1d2f-4c3b-8a9e-1f2e3d4c5b6a",
				title: "x",
				dueAt,
			});
			expect(parsed.ok, dueAt).toBe(true);
		}
	});
});
