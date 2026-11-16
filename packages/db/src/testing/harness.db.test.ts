import { describe, expect, it } from "vitest";
import { createTestDatabase } from "./harness.js";

describe("test database shutdown", () => {
	it("absorbs the administrator shutdown from DROP DATABASE FORCE", async () => {
		const db = await createTestDatabase({ migrate: false });
		await db.admin.query("SELECT 1");
		const unhandled: unknown[] = [];
		const onUncaught = (error: unknown) => {
			unhandled.push(error);
		};
		process.on("uncaughtException", onUncaught);
		try {
			const dropping = db.drop();
			const error = Object.assign(
				new Error("terminating connection due to administrator command"),
				{ code: "57P01" },
			);
			expect(() => db.admin.emit("error", error, {})).not.toThrow();
			await dropping;
			await new Promise((resolve) => setImmediate(resolve));
			expect(unhandled).toEqual([]);
		} finally {
			process.off("uncaughtException", onUncaught);
		}
	});
});
