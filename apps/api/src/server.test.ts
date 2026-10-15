import { describe, expect, it, vi } from "vitest";
import { createServer } from "./server.js";

describe("API scaffold refuses premature operation", () => {
	it("exposes liveness but reports not-ready", async () => {
		const app = createServer();
		try {
			expect((await app.inject("/health/live")).statusCode).toBe(200);
			expect((await app.inject("/health/ready")).statusCode).toBe(503);
		} finally {
			await app.close();
		}
	});
	it.each(["GET", "POST", "PUT", "DELETE"] as const)(
		"denies %s operational access even with forged context",
		async (method) => {
			const app = createServer();
			try {
				const response = await app.inject({
					method,
					url: "/v1/contacts",
					headers: {
						authorization: "Bearer forged",
						"x-tenant-id": "another-tenant",
					},
				});
				expect(response.statusCode).toBe(401);
				expect(response.json()).toEqual({ error: "authentication_required" });
			} finally {
				await app.close();
			}
		},
	);
	it("rejects malformed bodies as client errors without detail", async () => {
		const app = createServer();
		try {
			const response = await app.inject({
				method: "POST",
				url: "/v1/contacts",
				headers: { "content-type": "application/json" },
				payload: "{not json",
			});
			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: "bad_request" });
		} finally {
			await app.close();
		}
	});
	it("logs unexpected failures but returns a safe envelope", async () => {
		const lines: string[] = [];
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				lines.push(String(chunk));
				return true;
			});
		const app = createServer();
		try {
			app.get("/boom", async () => {
				throw new Error("unexpected failure");
			});
			const response = await app.inject("/boom");
			expect(response.statusCode).toBe(500);
			expect(response.json()).toEqual({ error: "internal_error" });
			const failure = lines
				.map((line) => JSON.parse(line))
				.find((entry) => entry.msg === "request failed");
			expect(failure).toMatchObject({
				level: 50,
				err: { message: "unexpected failure" },
			});
		} finally {
			write.mockRestore();
			await app.close();
		}
	});
});
