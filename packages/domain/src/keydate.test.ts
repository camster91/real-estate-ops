import { describe, expect, it } from "vitest";
import {
	keyDateState,
	needsLabel,
	parseKeyDateUpdate,
	parseNewKeyDate,
} from "./keydate.js";

const id = "0b9c2e1a-1d2f-4c3b-8a9e-1f2e3d4c5b6a";
const due = "2026-11-02T23:59:00-05:00";

describe("parseNewKeyDate", () => {
	it("accepts a condition with a label", () => {
		expect(
			parseNewKeyDate({
				id: id.toUpperCase(),
				kind: "condition",
				label: " Financing ",
				dueAt: due,
			}),
		).toEqual({
			ok: true,
			keyDate: {
				id,
				kind: "condition",
				label: "Financing",
				dueAt: new Date("2026-11-03T04:59:00Z"),
			},
		});
	});

	it.each([undefined, null, "", "  "])(
		"a closing needs no label (%j)",
		(label) => {
			const result = parseNewKeyDate({
				id,
				kind: "closing",
				label,
				dueAt: due,
			});
			expect(result.ok && result.keyDate.label).toBe(null);
		},
	);

	it.each<[string, unknown, string]>([
		["a bad id", { id: "x", kind: "closing", dueAt: due }, "id"],
		["an unknown kind", { id, kind: "party", dueAt: due }, "kind"],
		[
			"a condition without a label",
			{ id, kind: "condition", dueAt: due },
			"label",
		],
		[
			"other without a label",
			{ id, kind: "other", label: " ", dueAt: due },
			"label",
		],
		[
			"a long label",
			{ id, kind: "other", label: "x".repeat(101), dueAt: due },
			"label",
		],
		[
			"a label with a newline",
			{ id, kind: "other", label: "a\nb", dueAt: due },
			"label",
		],
		[
			"a label that is not text",
			{ id, kind: "other", label: 5, dueAt: due },
			"label",
		],
		["no due time", { id, kind: "closing" }, "dueAt"],
		[
			"a due time without an offset",
			{ id, kind: "closing", dueAt: "2026-11-02T23:59" },
			"dueAt",
		],
		[
			"30 February",
			{ id, kind: "closing", dueAt: "2026-02-30T12:00:00Z" },
			"dueAt",
		],
		["an extra key", { id, kind: "closing", dueAt: due, done: true }, "body"],
		["not an object", "x", "body"],
	])("rejects %s", (_label, input, field) => {
		expect(parseNewKeyDate(input)).toEqual({ ok: false, field });
	});
});

describe("parseKeyDateUpdate", () => {
	const full = { version: 2, label: "Inspection", dueAt: due, done: true };
	it("accepts every field", () => {
		expect(parseKeyDateUpdate(full)).toEqual({
			ok: true,
			update: {
				version: 2,
				label: "Inspection",
				dueAt: new Date("2026-11-03T04:59:00Z"),
				done: true,
			},
		});
	});
	it.each<[string, unknown, string]>([
		["a missing done", { version: 1, label: null, dueAt: due }, "body"],
		["a missing label", { version: 1, dueAt: due, done: false }, "body"],
		["an extra key", { ...full, kind: "other" }, "body"],
		["a zero version", { ...full, version: 0 }, "version"],
		["a bad label", { ...full, label: "x".repeat(101) }, "label"],
		["a bad due time", { ...full, dueAt: "soon" }, "dueAt"],
		["done as text", { ...full, done: "yes" }, "done"],
	])("rejects %s", (_label, input, field) => {
		expect(parseKeyDateUpdate(input)).toEqual({ ok: false, field });
	});
});

describe("needsLabel", () => {
	it("conditions and other dates need one", () => {
		expect(
			["condition", "deposit", "closing", "other"].map((k) =>
				needsLabel(k as "condition"),
			),
		).toEqual([true, false, false, true]);
	});
});

describe("keyDateState", () => {
	const now = new Date("2026-10-23T12:00:00Z");
	it.each<[string, string | null, string]>([
		["2026-10-23T11:59:00Z", null, "overdue"],
		["2026-10-23T12:00:00Z", null, "due_soon"],
		["2026-10-26T12:00:00Z", null, "due_soon"],
		["2026-10-26T12:00:01Z", null, "upcoming"],
		["2026-10-20T12:00:00Z", "2026-10-19T12:00:00Z", "done"],
	])("%s (done %s) is %s", (dueAt, doneAt, state) => {
		expect(keyDateState(dueAt, doneAt, now)).toBe(state);
	});
});
