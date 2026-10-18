import { randomUUID } from "node:crypto";
import type { Resource } from "@reo/auth";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizeInTenant, loadSubject } from "./subject.js";
import { type TenantContext, withTenant } from "./tenant.js";
import { grant, type SeedIds, seedTwoTenants } from "./testing/fixtures.js";
import { createTestDatabase, type TestDatabase } from "./testing/harness.js";

let db: TestDatabase;
let app: pg.Pool;
let ids: SeedIds;
const resA = randomUUID();
let readGrant: string;

const ctx = (purpose = "client_service"): TenantContext => ({
	organizationId: ids.orgA,
	principalId: ids.pa,
	purpose,
});
const resource = (tenantId = ids.orgA): Resource => ({
	tenantId,
	id: resA,
	classification: "personal",
});
const decide = (
	action: Parameters<typeof authorizeInTenant>[1]["action"],
	options: { context?: TenantContext; resource?: Resource; type?: string } = {},
) =>
	withTenant(app, options.context ?? ctx(), (client) =>
		authorizeInTenant(client, {
			action,
			resourceType: options.type ?? "contact",
			resource: options.resource ?? resource(),
		}),
	);

beforeAll(async () => {
	db = await createTestDatabase();
	app = db.app as pg.Pool;
	ids = await seedTwoTenants(db.admin);
	const base = {
		org: ids.orgA,
		principal: ids.pa,
		resourceType: "contact",
		resourceId: resA,
		classification: "personal",
		grantor: ids.approver,
	};
	readGrant = await grant(db.admin, { ...base, action: "record.read" });
	await grant(db.admin, { ...base, action: "communication.send" });
	await grant(db.admin, { ...base, action: "money.move" });
});

afterAll(async () => {
	await db.drop();
});

describe("authorizeInTenant", () => {
	it("allows a granted read and requires audit", async () => {
		expect(await decide("record.read")).toEqual({
			allowed: true,
			level: 0,
			auditRequired: true,
		});
	});

	it("revocation takes effect on the next call", async () => {
		expect((await decide("record.read")).allowed).toBe(true);
		await db.admin.query(
			"UPDATE access_grant SET revoked_at = now() WHERE id = $1",
			[readGrant],
		);
		try {
			expect(await decide("record.read")).toEqual({
				allowed: false,
				reason: "grant_required",
			});
		} finally {
			await db.admin.query(
				"UPDATE access_grant SET revoked_at = NULL WHERE id = $1",
				[readGrant],
			);
		}
	});

	it("wrong purpose is denied", async () => {
		expect(await decide("record.read", { context: ctx("marketing") })).toEqual({
			allowed: false,
			reason: "grant_required",
		});
	});

	it("grant for another resource type is denied", async () => {
		expect(await decide("record.read", { type: "property" })).toEqual({
			allowed: false,
			reason: "grant_required",
		});
	});

	it("other tenant resource is denied", async () => {
		expect(
			await decide("record.read", { resource: resource(ids.orgB) }),
		).toEqual({ allowed: false, reason: "tenant_mismatch" });
	});

	it("inactive membership is denied", async () => {
		const where = "organization_id = $1 AND principal_id = $2";
		await db.admin.query(
			`UPDATE membership SET status = 'suspended' WHERE ${where}`,
			[ids.orgA, ids.pa],
		);
		try {
			expect(await decide("record.read")).toEqual({
				allowed: false,
				reason: "membership_required",
			});
		} finally {
			await db.admin.query(
				`UPDATE membership SET status = 'active' WHERE ${where}`,
				[ids.orgA, ids.pa],
			);
		}
	});

	it("consequential actions stay gated", async () => {
		expect(await decide("communication.send")).toEqual({
			allowed: false,
			reason: "human_approval_required",
		});
		expect(await decide("money.move")).toEqual({
			allowed: false,
			reason: "never_autonomous",
		});
	});

	it("loadSubject never returns another principal's grants", async () => {
		await db.admin.query(
			"INSERT INTO membership (organization_id, principal_id, status, approved_by_principal_id, approved_at, effective_from) VALUES ($1, $2, 'active', $3, now(), now() - interval '1 day')",
			[ids.orgA, ids.pb, ids.approver],
		);
		const other = await grant(db.admin, {
			org: ids.orgA,
			principal: ids.pb,
			action: "record.read",
			resourceType: "contact",
			resourceId: resA,
			classification: "personal",
			grantor: ids.approver,
		});
		try {
			const subject = await withTenant(app, ctx(), (client) =>
				loadSubject(client),
			);
			expect(subject).toMatchObject({
				id: ids.pa,
				tenantId: ids.orgA,
				kind: "human",
				membershipActive: true,
			});
			expect(subject.grants).toHaveLength(3);
			for (const each of subject.grants) expect(each.subjectId).toBe(ids.pa);
		} finally {
			await db.admin.query("DELETE FROM access_grant WHERE id = $1", [other]);
			await db.admin.query(
				"DELETE FROM membership WHERE organization_id = $1 AND principal_id = $2",
				[ids.orgA, ids.pb],
			);
		}
	});
});
