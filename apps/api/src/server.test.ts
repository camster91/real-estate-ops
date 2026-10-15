import { describe, expect, it } from "vitest";
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
});
