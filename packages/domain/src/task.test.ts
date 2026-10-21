import { describe, expect, it } from "vitest";
import { parseNewTask, TASK_STATUSES } from "./task.js";

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
