import { describe, expect, it } from "vitest";
import {
	canTransition,
	DONE_STATUSES,
	OPEN_STATUSES,
	parseNewTask,
	parseStatusChange,
	TASK_STATUSES,
	type TaskStatus,
} from "./task.js";

const id = "0b9c2e1a-1d2f-4c3b-8a9e-1f2e3d4c5b6a";

describe("parseNewTask", () => {
	it("accepts a minimal task", () => {
		expect(parseNewTask({ id, title: "  Call back  " })).toEqual({
			ok: true,
			task: { id, title: "Call back", dueAt: null },
		});
	});

	it("lower-cases the id", () => {
		const result = parseNewTask({ id: id.toUpperCase(), title: "x" });
		expect(result.ok && result.task.id).toBe(id);
	});

	it("accepts emoji and accents", () => {
		const result = parseNewTask({ id, title: "Réviser l'offre ✅" });
		expect(result.ok && result.task.title).toBe("Réviser l'offre ✅");
	});

	it("accepts a due date with an offset", () => {
		const result = parseNewTask({
			id,
			title: "x",
			dueAt: "2026-11-01T09:00:00-04:00",
		});
		expect(result.ok && result.task.dueAt?.toISOString()).toBe(
			"2026-11-01T13:00:00.000Z",
		);
		expect(parseNewTask({ id, title: "x", dueAt: null }).ok).toBe(true);
	});

	it.each<[string, unknown, string]>([
		["empty title", { id, title: "" }, "title"],
		["blank title", { id, title: "   " }, "title"],
		["long title", { id, title: "x".repeat(201) }, "title"],
		["NUL in title", { id, title: "a\u0000b" }, "title"],
		["bell in title", { id, title: "a\u0007b" }, "title"],
		["tab in title", { id, title: "a\tb" }, "title"],
		["lone surrogate", { id, title: "\uD800abc" }, "title"],
		["line separator", { id, title: "a\u2028b" }, "title"],
		["paragraph separator", { id, title: "a\u2029b" }, "title"],
		["non-string title", { id, title: 5 }, "title"],
		["missing id", { title: "x" }, "id"],
		["bad id", { id: "not-a-uuid", title: "x" }, "id"],
		["word due date", { id, title: "x", dueAt: "tomorrow" }, "dueAt"],
		["date only", { id, title: "x", dueAt: "2026-11-01" }, "dueAt"],
		["bad month", { id, title: "x", dueAt: "2026-13-01T00:00:00Z" }, "dueAt"],
		["numeric due date", { id, title: "x", dueAt: 5 }, "dueAt"],
		["extra key", { id, title: "x", assigneeId: id }, "body"],
		["array body", [id], "body"],
		["null body", null, "body"],
	])("rejects %s", (_label, input, field) => {
		expect(parseNewTask(input)).toEqual({ ok: false, field });
	});

	it("allows exactly 200 characters, counting emoji as one", () => {
		expect(parseNewTask({ id, title: "x".repeat(200) }).ok).toBe(true);
		expect(parseNewTask({ id, title: "✅".repeat(200) }).ok).toBe(true);
	});

	it("statuses match the core model", () => {
		expect(TASK_STATUSES).toEqual([
			"ready",
			"in_progress",
			"waiting",
			"blocked",
			"completed",
			"cancelled",
		]);
	});
});

describe("parseNewTask calendar", () => {
	it("rejects impossible dates", () => {
		expect(
			parseNewTask({ id, title: "x", dueAt: "2026-02-30T09:00:00Z" }),
		).toEqual({ ok: false, field: "dueAt" });
	});
});

describe("status transitions", () => {
	const pairs = (from: readonly TaskStatus[], to: readonly TaskStatus[]) =>
		from.flatMap((a) => to.filter((b) => b !== a).map((b) => [a, b] as const));

	it("open statuses move freely", () => {
		for (const [from, to] of pairs(OPEN_STATUSES, OPEN_STATUSES))
			expect(canTransition(from, to), `${from}→${to}`).toBe(true);
	});

	it("open to done", () => {
		for (const [from, to] of pairs(OPEN_STATUSES, DONE_STATUSES))
			expect(canTransition(from, to), `${from}→${to}`).toBe(true);
	});

	it("done only reopens", () => {
		expect(canTransition("completed", "ready")).toBe(true);
		expect(canTransition("cancelled", "ready")).toBe(true);
		expect(canTransition("completed", "cancelled")).toBe(false);
		expect(canTransition("cancelled", "completed")).toBe(false);
		expect(canTransition("completed", "in_progress")).toBe(false);
		expect(canTransition("cancelled", "blocked")).toBe(false);
	});

	it("the same status is not a transition", () => {
		for (const status of TASK_STATUSES)
			expect(canTransition(status, status), status).toBe(false);
	});

	it("open and done statuses cover every status once", () => {
		expect([...OPEN_STATUSES, ...DONE_STATUSES].sort()).toEqual(
			[...TASK_STATUSES].sort(),
		);
	});
});

describe("parseStatusChange", () => {
	it("accepts a status and version", () => {
		expect(parseStatusChange({ status: "in_progress", version: 3 })).toEqual({
			ok: true,
			status: "in_progress",
			version: 3,
		});
	});

	it.each<[string, unknown, string]>([
		["unknown status", { status: "done", version: 1 }, "status"],
		["missing version", { status: "ready" }, "version"],
		["zero version", { status: "ready", version: 0 }, "version"],
		["fractional version", { status: "ready", version: 1.5 }, "version"],
		["string version", { status: "ready", version: "1" }, "version"],
		["huge version", { status: "ready", version: 2147483648 }, "version"],
		["extra key", { status: "ready", version: 1, title: "x" }, "body"],
		["array", [], "body"],
		["null", null, "body"],
		["inherited key", { status: "toString", version: 1 }, "status"],
	])("rejects %s", (_label, input, field) => {
		expect(parseStatusChange(input)).toEqual({ ok: false, field });
	});
});
