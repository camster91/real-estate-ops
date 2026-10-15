/** Trusted server-side policy snapshots only; never construct these from request claims. */
export const actionLevels = {
	"record.read": 0,
	"task.create": 1,
	"communication.draft": 2,
	"communication.send": 3,
	"calendar.modify": 3,
	"signature.send": 3,
	"regulatory.submit": 3,
	"permission.modify": 3,
	"record.delete": 3,
	"money.move": 4,
	"security.bypass": 4,
	"compliance.bypass": 4,
	"agent.expand_permissions": 4,
} as const;
export type Action = keyof typeof actionLevels;
export type Classification =
	| "operational"
	| "personal"
	| "financial"
	| "restricted_compliance";
export interface Resource {
	readonly tenantId: string;
	readonly id: string;
	readonly classification: Classification;
}
export interface Grant {
	readonly tenantId: string;
	readonly subjectId: string;
	readonly actions: readonly Action[];
	readonly resourceIds: readonly string[];
	readonly classifications: readonly Classification[];
	readonly purposes: readonly string[];
	readonly validFrom: number;
	readonly expiresAt: number;
	readonly revoked: boolean;
}
export interface Subject {
	readonly id: string;
	readonly kind: "human" | "service";
	readonly tenantId: string;
	readonly membershipActive: boolean;
	readonly grants: readonly Grant[];
}
export interface InternalRule {
	readonly tenantId: string;
	readonly action: "task.create";
	readonly purpose: string;
	readonly approved: boolean;
	readonly reversible: boolean;
	readonly auditRequired: boolean;
	readonly validFrom: number;
	readonly expiresAt: number;
}
export interface PolicyRequest {
	readonly subject: Subject;
	readonly requester?: Subject;
	readonly resource: Resource;
	readonly action: Action;
	readonly purpose: string;
	/** Server clock; epoch milliseconds. */
	readonly now: number;
	readonly internalRule?: InternalRule;
}
export type Denial =
	| "invalid_context"
	| "membership_required"
	| "tenant_mismatch"
	| "grant_required"
	| "requester_required"
	| "internal_rule_required"
	| "human_approval_required"
	| "never_autonomous";
export type Decision =
	| {
			readonly allowed: true;
			readonly level: 0 | 1 | 2;
			readonly auditRequired: true;
	  }
	| { readonly allowed: false; readonly reason: Denial };
const deny = (reason: Denial): Decision => ({ allowed: false, reason });
const classifications: readonly Classification[] = [
	"operational",
	"personal",
	"financial",
	"restricted_compliance",
];
const present = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0;
const activeWindow = (start: number, end: number, now: number) =>
	Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;

function checkSubject(
	subject: Subject,
	request: PolicyRequest,
): Denial | undefined {
	if (
		!present(subject.id) ||
		!present(subject.tenantId) ||
		!["human", "service"].includes(subject.kind) ||
		!Array.isArray(subject.grants)
	)
		return "invalid_context";
	if (subject.membershipActive !== true) return "membership_required";
	if (subject.tenantId !== request.resource.tenantId) return "tenant_mismatch";
	const matching = subject.grants.some(
		(grant) =>
			grant &&
			grant.tenantId === subject.tenantId &&
			grant.subjectId === subject.id &&
			grant.revoked === false &&
			activeWindow(grant.validFrom, grant.expiresAt, request.now) &&
			Array.isArray(grant.actions) &&
			grant.actions.includes(request.action) &&
			Array.isArray(grant.resourceIds) &&
			grant.resourceIds.includes(request.resource.id) &&
			Array.isArray(grant.classifications) &&
			grant.classifications.includes(request.resource.classification) &&
			Array.isArray(grant.purposes) &&
			grant.purposes.includes(request.purpose),
	);
	return matching ? undefined : "grant_required";
}

/** Fail-closed decision only. Does not authenticate, query records, write audit, or execute actions. */
export function authorize(request: PolicyRequest): Decision {
	try {
		if (
			!request ||
			!Number.isFinite(request.now) ||
			!present(request.purpose) ||
			!request.resource ||
			!present(request.resource.id) ||
			!present(request.resource.tenantId) ||
			!classifications.includes(request.resource.classification) ||
			!Object.hasOwn(actionLevels, request.action)
		)
			return deny("invalid_context");
		const level = actionLevels[request.action];
		// No approval object supplied by a caller can unlock consequential execution here.
		if (level === 4) return deny("never_autonomous");
		const subjectDenial = checkSubject(request.subject, request);
		if (subjectDenial) return deny(subjectDenial);
		if (request.subject.kind === "service") {
			if (request.requester?.kind !== "human")
				return deny("requester_required");
			const requesterDenial = checkSubject(request.requester, request);
			if (requesterDenial) return deny(requesterDenial);
			if (request.resource.classification === "restricted_compliance")
				return deny("grant_required");
		}
		if (level === 3) return deny("human_approval_required");
		if (level === 1) {
			const rule = request.internalRule;
			if (
				!rule ||
				rule.tenantId !== request.resource.tenantId ||
				rule.action !== request.action ||
				rule.purpose !== request.purpose ||
				rule.approved !== true ||
				rule.reversible !== true ||
				rule.auditRequired !== true ||
				!activeWindow(rule.validFrom, rule.expiresAt, request.now)
			) {
				return deny("internal_rule_required");
			}
		}
		return { allowed: true, level, auditRequired: true };
	} catch {
		return deny("invalid_context");
	}
}
