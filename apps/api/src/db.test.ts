import { describe, expect, it, vi } from "vitest";
import { createPool } from "./db.js";

describe("database pool", () => {
	it("an idle-client error is reported by code and does not crash", async () => {
		const onError = vi.fn();
		const pool = createPool("postgres://synthetic@127.0.0.1:1/none", onError);
		try {
			const error = Object.assign(new Error("password=synthetic-secret"), {
				code: "57P01",
			});
			expect(() => pool.emit("error", error, {})).not.toThrow();
			expect(onError).toHaveBeenCalledWith("57P01");
			expect(() => pool.emit("error", new Error("no code"), {})).not.toThrow();
			expect(onError).toHaveBeenLastCalledWith(undefined);
		} finally {
			await pool.end();
		}
	});
});
