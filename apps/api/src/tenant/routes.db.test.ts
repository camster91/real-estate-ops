import { type AuthConfig, readAuthConfig } from "@reo/config";
import {
	createTestDatabase,
	grant,
	type SeedIds,
	seedTwoTenants,
	type TestDatabase,
} from "@reo/db/testing";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type FakeIssuer, startFakeIssuer } from "../auth/fake-issuer.js";
import { requireSession } from "../auth/guard.js";
import { PUBLIC_URL, SESSION_COOKIE, signInAs } from "../auth/testing.js";
import { createServer } from "../server.js";
import { inTenant, NOT_MEMBER } from "./context.js";

let db: TestDatabase;
let ids: SeedIds;
let fake: FakeIssuer;
let config: AuthConfig;
let app: FastifyInstance;
let pool: pg.Pool;
let token: string;
let recordGranted: string;
let recordHidden: string;
let grantId: string;

const get = (url: string, sessionToken = token) =>
	app.inject({ url, cookies: { [SESSION_COOKIE]: sessionToken } });
const branches = (org: string, sessionToken = token) =>
	get(`/v1/organizations/${org}/branches`, sessionToken);
const names = (response: { json(): { branches: { name: string }[] } }) =>
	response.json().branches.map((branch) => branch.name);

async function withMembership<T>(
	org: string,
	status: string,
	work: () => Promise<T>,
) {
	await db.admin.query(
		"INSERT INTO membership (organization_id, principal_id, status, approved_by_principal_id, approved_at, effective_from) VALUES ($1, $2, $3, $4, now(), now() - interval '1 day')",
		[org, ids.pa, status, ids.approver],
	);
	try {
		return await work();
	} finally {
		await db.admin.query(
			"DELETE FROM membership WHERE organization_id = $1 AND principal_id = $2",
			[org, ids.pa],
		);
	}
}

function buildApp() {
	const server = createServer({
		auth: { pool, config, allowInsecureIssuer: true },
	});
	// Test-only routes that decide record access through the real session.
	for (const purpose of ["client_service", "marketing"])
		server.get<{ Params: { organizationId: string; id: string } }>(
			`/v1/organizations/:organizationId/fixture-${purpose}/:id`,
			{ preHandler: requireSession(pool) },
			async (request, reply) => {
				const result = await inTenant(
					pool,
					request,
					purpose,
					async ({ context, decide }) =>
						decide("record.read", "fixture_record", {
							tenantId: context.organizationId,
							id: request.params.id,
							classification: "operational",
						}),
				);
				if (result === NOT_MEMBER)
					return reply.code(404).send({ error: "not_found" });
				return { allowed: result.allowed };
			},
		);
	return server;
}

beforeAll(async () => {
	db = await createTestDatabase();
	ids = await seedTwoTenants(db.admin);
	pool = db.app as pg.Pool;
	fake = await startFakeIssuer();
	await db.admin.query("UPDATE principal SET oidc_issuer = $1", [fake.issuer]);
	await db.admin.query(
		"INSERT INTO branch (organization_id, name) VALUES ($1, 'Synthetic Branch A2')",
		[ids.orgA],
	);
	await db.admin.query(`
		CREATE TABLE fixture_record (
			organization_id uuid NOT NULL REFERENCES organization,
			id uuid NOT NULL DEFAULT gen_random_uuid(),
			PRIMARY KEY (organization_id, id)
		);
	`);
	recordGranted = (
		await db.admin.query(
			"INSERT INTO fixture_record (organization_id) VALUES ($1) RETURNING id",
			[ids.orgA],
		)
	).rows[0].id;
	recordHidden = (
		await db.admin.query(
			"INSERT INTO fixture_record (organization_id) VALUES ($1) RETURNING id",
			[ids.orgA],
		)
	).rows[0].id;
	grantId = await grant(db.admin, {
		org: ids.orgA,
		principal: ids.pa,
		action: "record.read",
		resourceType: "fixture_record",
		resourceId: recordGranted,
		grantor: ids.approver,
	});
	config = readAuthConfig({
		NODE_ENV: "test",
		REO_PUBLIC_URL: PUBLIC_URL,
		REO_LOGIN_COOKIE_SECRET: "synthetic-cookie-secret-0123456789abcdef",
		REO_GOOGLE_CLIENT_ID: fake.clientId,
		REO_GOOGLE_CLIENT_SECRET: fake.clientSecret,
		REO_TEST_OIDC_ISSUER: fake.issuer,
	}) as AuthConfig;
	app = buildApp();
	token = await signInAs(app, fake, "synthetic-a");
});

afterAll(async () => {
	await app?.close();
	await fake?.close();
	await db?.drop();
});

describe("tenant routes", () => {
	it("member lists their organisation's branches", async () => {
		const response = await branches(ids.orgA);
		expect(response.statusCode).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(names(response)).toEqual([
			"Synthetic Branch A",
			"Synthetic Branch A2",
		]);
		expect(response.json().branches[0]).toEqual({
			id: ids.branchA,
			name: "Synthetic Branch A",
			version: 1,
		});
	});

	it("other organisation is 404", async () => {
		const response = await branches(ids.orgB);
		expect(response.statusCode).toBe(404);
		expect(response.json()).toEqual({ error: "not_found" });
	});

	it("member of two organisations sees each separately", async () => {
		await withMembership(ids.orgB, "active", async () => {
			expect(names(await branches(ids.orgA))).toEqual([
				"Synthetic Branch A",
				"Synthetic Branch A2",
			]);
			expect(names(await branches(ids.orgB))).toEqual(["Synthetic Branch B"]);
		});
	});

	it("suspended in one organisation only", async () => {
		await withMembership(ids.orgB, "active", async () => {
			const where = "organization_id = $1 AND principal_id = $2";
			await db.admin.query(
				`UPDATE membership SET status = 'suspended' WHERE ${where}`,
				[ids.orgA, ids.pa],
			);
			try {
				expect((await branches(ids.orgA)).statusCode).toBe(404);
				expect((await branches(ids.orgB)).statusCode).toBe(200);
				const me = await get("/v1/session");
				expect(me.statusCode).toBe(200);
				expect(me.json().memberships).toEqual([
					{ organizationId: ids.orgB, name: "Synthetic Org B" },
				]);
			} finally {
				await db.admin.query(
					`UPDATE membership SET status = 'active' WHERE ${where}`,
					[ids.orgA, ids.pa],
				);
			}
		});
	});

	it.each([
		["not-a-uuid"],
		["upper-case"],
		["trailing space"],
		["00000000-0000-0000-0000-000000000000"],
	])("malformed organisation id %s is 404", async (label) => {
		const org =
			label === "upper-case"
				? ids.orgA.toUpperCase()
				: label === "trailing space"
					? `${ids.orgA}%20`
					: label;
		const response = await branches(org);
		expect(response.statusCode).toBe(404);
		expect(response.json()).toEqual({ error: "not_found" });
	});

	it("no session is 401 and login-off is 401", async () => {
		const none = await app.inject(`/v1/organizations/${ids.orgA}/branches`);
		expect(none.statusCode).toBe(401);
		const off = createServer();
		try {
			const response = await off.inject(
				`/v1/organizations/${ids.orgA}/branches`,
			);
			expect(response.statusCode).toBe(401);
		} finally {
			await off.close();
		}
	});

	it("grants are decided through the session", async () => {
		const decide = async (purpose: string, record: string) =>
			(
				await get(`/v1/organizations/${ids.orgA}/fixture-${purpose}/${record}`)
			).json().allowed;
		expect(await decide("client_service", recordGranted)).toBe(true);
		expect(await decide("client_service", recordHidden)).toBe(false);
		expect(await decide("marketing", recordGranted)).toBe(false);
		await db.admin.query(
			"UPDATE access_grant SET revoked_at = now() WHERE id = $1",
			[grantId],
		);
		try {
			expect(await decide("client_service", recordGranted)).toBe(false);
		} finally {
			await db.admin.query(
				"UPDATE access_grant SET revoked_at = NULL WHERE id = $1",
				[grantId],
			);
		}
		const other = await get(
			`/v1/organizations/${ids.orgB}/fixture-client_service/${recordGranted}`,
		);
		expect(other.statusCode).toBe(404);
	});

	it("logs carry no organisation ids or tokens", async () => {
		const lines: string[] = [];
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				lines.push(String(chunk));
				return true;
			});
		const shared = app;
		app = buildApp();
		try {
			expect((await branches(ids.orgA)).statusCode).toBe(200);
			expect((await branches(ids.orgB)).statusCode).toBe(404);
		} finally {
			write.mockRestore();
			await app.close();
			app = shared;
		}
		const log = lines.join("");
		expect(log.length).toBeGreaterThan(0);
		for (const secret of [ids.orgA, ids.orgB, token])
			expect(log).not.toContain(secret);
	});
});
