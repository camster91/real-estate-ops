# Core model and lifecycle proposal

Status: Provisional. IDs are opaque UUIDs; tenant records use (organization_id, id) identity in associations. Store instants in UTC; user-facing dates use America/Toronto. Contractual date-only deadlines are date fields with jurisdiction/timezone, not silently converted to midnight UTC. Use optimistic versions for editable aggregates; stale writes return a conflict instead of last-write-wins. Classify fields as operational, personal, sensitive financial or restricted compliance. Search indexes, exports, caches and background jobs enforce the same scope as direct reads.

| Aggregate | Required separation/invariants |
|---|---|
| Organization / BrokerageRegistration | Tenant security boundary versus accountable legal brokerage; registrations and BOR assignments effective-dated |
| Principal / Membership / Grant | OIDC issuer + subject uniquely identifies principal; invited membership is approved, never provisioned merely by email domain |
| Party / profiles | Person or company identity; separate from auth and client/vendor roles; no shared household consent |
| Relationship / Household | Source/effective dates; grouping never inherits consent or access |
| ContactPoint / ConsentRecord | Verification state and purpose/channel-specific consent, proof, withdrawal and policy expiry |
| Lead / LeadAssignment / Opportunity | Intake/source distinct from person identity and representation; reviewed qualification/assignment |
| ServiceType / ServiceEngagement | Versioned taxonomy and accountable owner; cases can exist without trades |
| Property / Unit / Listing | Physical asset versus marketed instruction; duplicate detection proposes, never auto-merges |
| Transaction / TransactionParty | Responsible brokerage and typed party roles; stage workflow/version independent from service case |
| WorkflowTemplate / Instance / Task | Versioned template snapshot; dependencies scoped to case and no cycles; blocked/waiting are explicit |
| Document / Version / Requirement | Metadata versus immutable evidence; requirements classified as applicable/not applicable/unknown with reviewed rationale |
| Communication / Activity | Provider thread/message metadata and explicit associations; body ingestion opt-in and scoped |
| ComplianceCase / Record | Rule applicability, source/effective dates, evidence and named human review; unknown != compliant |
| Commission / ledger references | Versioned exact calculations versus externally authoritative payment/trust ledger |
| Event / Job / Approval / Audit | Durable state plus minimized events; execution approval bound to exact intended action |

## Service taxonomy
Initial configurable codes: buyer_representation, seller_representation, lease_representation, commercial_representation, referral, property_management, other_service. Residential/commercial, trade/non-trade and supported jurisdiction are attributes. These are seed-derived candidate services, not a claim the company offers them. Templates are disabled until an operations/BOR-approved version exists. Legal representation/agency status is an explicit reviewed value with evidence, never inferred from a lead becoming qualified.

## Candidate lifecycles
- Lead: new → assigned → contacted → qualified → converted. Disqualified/lost require reasons; qualified may enter nurturing; reopening is explicit and audited. Conversion atomically links existing/new parties and an opportunity/engagement, preserves provenance and is idempotent. Never auto-send a response.
- Engagement: draft → active → on_hold → active → completed → archived; cancelled is a separate outcome with reason. Completion requires its applicable work/evidence gates.
- Listing: draft → approved → active → suspended/expired/withdrawn/completed. Activation requires accountable brokerage, reviewed marketing instruction and rights. Provider status mapping is versioned and disagreements create an exception.
- Transaction: draft → active → conditional → firm → closing_ready → closed → archived, with cancellation and amendment events. These are internal candidate stages, not universal legal status. Stage guard policies depend on approved templates. No AI decision sets firm/closed or overrides a compliance blocker.
- Task: ready/in_progress/waiting/blocked/completed/cancelled. Dependency completion and responsible owner required; an approval task cannot be completed by its requesting agent. Recurring instances use deterministic occurrence keys. Holiday/business-day policies remain configurable.
- Document requirement: unknown → required/not_applicable (reviewed) → pending → satisfied → expired/superseded. Waivers retain reviewer, reason, policy authority and evidence. Malware quarantine cannot satisfy a document requirement.
- Compliance: applicability_pending → evidence_pending → human_review → approved/exception → remediation. Record a staff determination with actor/source; AI advisory text is separately labelled and cannot approve.
- External action: draft → approval_pending → approved → executing → succeeded/failed/unknown_outcome. Material edits invalidate approval; unknown outcome requires reconciliation before retry. Provider acknowledgement is distinct from delivery or signature completion.

## Workflows and role experiences
Buyer/seller: intake → representation review → property/listing work → offer/conditions → deposit/evidence → closing readiness → closed → archive. Lease/commercial vary by approved template. Referral: consent and scope → approved referral draft/send → acceptance evidence → fee reference → complete. Property management: engagement → tenancy/inspection/maintenance work → periodic review → terminate/archive; rent/trust flows depend on finance policy. Every template specifies owner, applicable evidence, permission, deadline policy, exception path and completion guard.

Home shows personal priorities; manager view shows assigned team scope; BOR view shows authorized brokerage compliance; finance view shows approved financial scope. Primary navigation: Home / Command Centre, Leads, Contacts, Properties, Transactions, Work, Calendar, More. Operations Inbox is an exception queue with source, owner, reason, next action and resolution evidence. Contact 360, Property 360 and Transaction Workspace show role-scoped linked records. Restricted records are filtered before aggregation; counts and search results must not leak hidden records.
