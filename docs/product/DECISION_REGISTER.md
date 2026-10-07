# M0 decision and approval register

Repository: camster91/real-estate-ops. Empty-state comparison is complete; no previous implementation was overwritten. ADRs are proposed for human review, with constrained implementation defaults below. No issue is closed solely because documents exist.

| Area | Seed/instruction-derived direction | Unresolved input | Owner / issue |
|---|---|---|---|
| Organization | Tenant distinct from legal company/brokerage registration; effective branch/team/BOR assignments | Actual companies, registrations and shared-service scopes | Company owner/BOR; #2, #25 |
| Party/relationships | Person/company profiles, separate auth identities, household grouping; per-person consent/access | Merge and duplicate-review operating policy | Operations; #27–#30 |
| Services/leads | Versioned services, lead lifecycle and conversion links; representation never inferred from qualification | Actual offered services, SLAs and templates | Operations/BOR; #21, #22, #31–#34 |
| Property/listing | Durable asset/unit distinct from marketing instruction and transaction | Entitled source IDs/rights and duplicate-review policy | Brokerage administrator; #35–#38, #59 |
| Engagement/transaction/work | Non-trade service cases; brokerage-scoped trades; versioned guarded workflow/tasks | Signed-off buyer/seller/lease/commercial/referral/management variants and deadlines | Operations/BOR; #39–#46 |
| Documents/compliance | Immutable versions, classification, quarantine, requirement applicability and human review | Record-specific retention/trigger/holds, reviewer assignments, filing period and exceptions | BOR/compliance; #47–#58 |
| Communications | Metadata-first activity association, channel/purpose consent and content-bound approvals | Actual Workspace/M365 tenants and consent policy | Operations/privacy; #30, #66–#69 |
| Finance | Exact versioned calculations and ledger references; no autonomous money movement | Ledger provider, contracts, splits, HST and rounding/reconciliation policy | Finance/BOR; #88–#90 |
| External partners | Expiring record-specific safe projections; default deny | Approved partner scopes/invitation reviewers | Owner/access administrator; #23, #24 |
| Authorization | Role + tenant + record + classification + state guards; owner != BOR | Approved real membership/access matrix and OIDC issuer/MFA | Security/BOR; #24–#26, #96, #97 |
| Events/approvals | Atomic state/audit/outbox; at-least-once dedupe; L3 approved exact content; L4 deny autonomous restricted actions | Provider retry guarantees, actual approver grants and audited execution policy | Engineering/security; #45, #76, #77, #84 |
| Integrations | Supported sanctioned APIs and rights registry; expired/unknown entitlement fails closed | Provider agreements/scopes/sandbox/retention/export/AI rights | Brokerage administrator; #49, #59–#65 |
| Mac gateway | Outbound revocable device; bounded capabilities; cloud authority; offline consequential actions fail closed | Actual Mac, permitted workflows and supported Hermes/Codex interfaces | Gateway maintainer; #70–#75 |
| UX | Role-specific navigation/Command Centre/360/workspaces/inbox; reusable accessible components | Actual Figma artefact and reviewed flows | Design/product; #19, #103–#107 |
| Hosting/recovery | Private separated environments and encrypted Canadian-region storage where practical | Approved vendor/residency, RPO/RTO and restore evidence | Owner/security; #99–#102 |

## Model gate and completion
The architecture boundaries support a narrow tooling scaffold. This does not settle brokerage policy or allow broad operational features to bypass M0. Unknowns must be configurable and disabled until approved. No operational records are enabled in PR #116. Before schema/domain feature work, connect the above decisions to reviewed ADRs and representative approved workflows; do not infer a legal determination from a generated draft.

## Administration blocker
Project/milestone creation and field configuration are tracked in #115. Imported issues #1–#113 have stable markers and an issue-map. Priority/milestone/label intent in issue bodies is not equivalent to configured GitHub fields. No organization permissions were changed.
