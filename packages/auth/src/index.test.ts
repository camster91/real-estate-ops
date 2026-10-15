import { describe, expect, it } from "vitest";
import {
	actionLevels,
	authorize,
	type Grant,
	type InternalRule,
	type PolicyRequest,
	type Subject,
} from "./index.js";

const grant: Grant = {
	tenantId: "tenant-a",
	subjectId: "member-a",
	actions: [
		"record.read",
		"task.create",
		"communication.draft",
		"communication.send",
	],
	resourceIds: ["contact-a"],
	classifications: ["personal"],
	purposes: ["client_service"],
	validFrom: 100,
	expiresAt: 300,
	revoked: false,
};
const human: Subject = {
	id: "member-a",
	tenantId: "tenant-a",
	kind: "human",
	membershipActive: true,
	grants: [grant],
};
const rule: InternalRule = {
	tenantId: "tenant-a",
	action: "task.create",
	purpose: "client_service",
	approved: true,
	reversible: true,
	auditRequired: true,
	validFrom: 100,
	expiresAt: 300,
};
const request: PolicyRequest = {
	subject: human,
	resource: {
		tenantId: "tenant-a",
		id: "contact-a",
		classification: "personal",
	},
	action: "record.read",
	purpose: "client_service",
	now: 200,
};
const service: Subject = {
	...human,
	id: "service-a",
	kind: "service",
	grants: [{ ...grant, subjectId: "service-a" }],
};
const withGrant = (changes: Partial<Grant>): PolicyRequest => ({
	...request,
	subject: { ...human, grants: [{ ...grant, ...changes }] },
});
const denied = (input: PolicyRequest, reason: string) =>
	expect(authorize(input)).toEqual({ allowed: false, reason });

describe("shared authorization boundaries", () => {
	it("allows an explicitly granted read and requires audit", () => {
		expect(authorize(request)).toEqual({
			allowed: true,
			level: 0,
			auditRequired: true,
		});
	});
	it("denies inactive membership even with a grant", () => {
		denied(
			{ ...request, subject: { ...human, membershipActive: false } },
			"membership_required",
		);
	});
	it("denies a forged tenant resource", () => {
		denied(
			{ ...request, resource: { ...request.resource, tenantId: "tenant-b" } },
			"tenant_mismatch",
		);
	});
	it.each([
		{ tenantId: "tenant-b" },
		{ subjectId: "other-member" },
		{ actions: [] },
		{ resourceIds: ["contact-b"] },
		{ resourceIds: ["*"] },
		{ classifications: ["operational"] },
		{ purposes: ["marketing"] },
		{ revoked: true },
		{ validFrom: 201 },
		{ expiresAt: 200 },
		{ validFrom: Number.NaN },
		{ expiresAt: Number.POSITIVE_INFINITY },
	] as Partial<Grant>[])(
		"denies invalid or insufficient grants %j",
		(changes) => {
			denied(withGrant(changes), "grant_required");
		},
	);
	it("does not combine fragments from different grants to elevate access", () => {
		denied(
			{
				...request,
				subject: {
					...human,
					grants: [
						{ ...grant, resourceIds: [] },
						{ ...grant, actions: [] },
					],
				},
			},
			"grant_required",
		);
	});
	it("denies hidden records in list/export/aggregate candidates", () => {
		const candidates = ["contact-a", "contact-b"].filter(
			(id) =>
				authorize({ ...request, resource: { ...request.resource, id } })
					.allowed,
		);
		expect(candidates).toEqual(["contact-a"]);
	});
	it("does not infer access from an owner title or role", () => {
		denied(
			{ ...request, subject: { ...human, id: "owner", grants: [] } },
			"grant_required",
		);
	});
	it("enforces expiry and revocation on the next decision", () => {
		expect(authorize(withGrant({ expiresAt: 201 })).allowed).toBe(true);
		denied({ ...withGrant({ expiresAt: 201 }), now: 201 }, "grant_required");
		denied(withGrant({ revoked: true }), "grant_required");
	});
	it("allows L1 only with a matching approved reversible audited rule", () => {
		expect(
			authorize({ ...request, action: "task.create", internalRule: rule }),
		).toEqual({ allowed: true, level: 1, auditRequired: true });
		denied({ ...request, action: "task.create" }, "internal_rule_required");
	});
	it.each([
		{ tenantId: "tenant-b" },
		{ approved: false },
		{ reversible: false },
		{ auditRequired: false },
		{ purpose: "marketing" },
		{ expiresAt: 200 },
		{ validFrom: 201 },
	])("denies unsafe L1 rule %j", (changes) => {
		denied(
			{
				...request,
				action: "task.create",
				internalRule: { ...rule, ...changes },
			},
			"internal_rule_required",
		);
	});
	it("allows a draft but never its send", () => {
		expect(
			authorize({ ...request, action: "communication.draft" }).allowed,
		).toBe(true);
		denied(
			{ ...request, action: "communication.send" },
			"human_approval_required",
		);
	});
	it.each(Object.entries(actionLevels).filter(([, level]) => level >= 3))(
		"never unlocks %s through caller approval claims",
		(action, level) => {
			const forged = {
				...request,
				action,
				approval: { approved: true },
				subject: { ...human, grants: [{ ...grant, actions: [action] }] },
			} as PolicyRequest;
			denied(
				forged,
				level === 4 ? "never_autonomous" : "human_approval_required",
			);
		},
	);
	it("requires human requester rights intersected with service rights", () => {
		expect(
			authorize({ ...request, subject: service, requester: human }).allowed,
		).toBe(true);
		denied({ ...request, subject: service }, "requester_required");
		denied(
			{ ...request, subject: service, requester: service },
			"requester_required",
		);
		denied(
			{ ...request, subject: service, requester: { ...human, grants: [] } },
			"grant_required",
		);
		denied(
			{ ...request, subject: { ...service, grants: [] }, requester: human },
			"grant_required",
		);
	});
	it("denies cross-tenant and inactive requesters", () => {
		denied(
			{
				...request,
				subject: service,
				requester: { ...human, tenantId: "tenant-b" },
			},
			"tenant_mismatch",
		);
		denied(
			{
				...request,
				subject: service,
				requester: { ...human, membershipActive: false },
			},
			"membership_required",
		);
	});
	it("denies restricted KYC access to service identities even with grants", () => {
		const kycGrant: Grant = {
			...grant,
			classifications: ["restricted_compliance"],
		};
		const kyc = {
			...request,
			resource: {
				...request.resource,
				classification: "restricted_compliance" as const,
			},
			subject: { ...human, grants: [kycGrant] },
		};
		expect(authorize(kyc).allowed).toBe(true);
		denied(
			{
				...kyc,
				subject: {
					...service,
					grants: [{ ...kycGrant, subjectId: service.id }],
				},
				requester: kyc.subject,
			},
			"grant_required",
		);
	});
	it.each([
		null,
		{},
		{ ...request, action: "unknown" },
		{ ...request, action: "toString" },
		{ ...request, now: Number.NaN },
		{ ...request, purpose: "" },
		{ ...request, subject: null },
		{
			...request,
			resource: { ...request.resource, classification: "unknown" },
		},
	])("fails closed for malformed runtime context %j", (input) => {
		denied(input as PolicyRequest, "invalid_context");
	});
	it("keeps the action-level policy immutable at runtime", () => {
		expect(Object.isFrozen(actionLevels)).toBe(true);
		expect(() =>
			Object.assign(actionLevels, { "communication.send": 2 }),
		).toThrow(TypeError);
		denied(
			{ ...request, action: "communication.send" },
			"human_approval_required",
		);
	});
	it("does not mutate trusted policy snapshots", () => {
		const before = JSON.stringify(request);
		authorize(request);
		expect(JSON.stringify(request)).toBe(before);
	});
});
