# Authorization review matrix

Proposed baseline; actual grants require brokerage approval. Every Allow below also requires active membership, tenant match, purpose/data-classification permission, record scope and applicable state guards. R = read, W = internal write, A = approval by an explicitly entitled human, — = denied by default.

| Capability | Owner | BOR | Manager | Agent | Operations | Finance | Partner/client | System agent |
|---|---|---|---|---|---|---|---|---|
| Assigned CRM/work | R/W scoped | R/W scoped | R/W team | R/W assigned | R/W assigned | R scoped | R limited explicit grant | L0/L1 explicit policy |
| Restricted KYC evidence | — | R/A compliance scope | — | Metadata only by grant | R/W by compliance grant | — | Own upload workflow only | — |
| Compliance determination | — | A accountable brokerage | — | Submit evidence | Prepare by grant | Prepare financial evidence | — | Advisory draft only |
| Financial estimates | R scoped | R scoped | R scoped | Own permitted estimate | — | R/W scope | — | L1 calculations by rule |
| Trust reconciliation | — | R/A | — | — | Prepare by grant | R/W prepare | — | Compare/draft only |
| External communications/calendar/signatures | A by send grant | A by send grant | A by send grant | A assigned records | Draft; A by grant | Draft; A by grant | — | L2 draft; approved L3 executor only |
| Access grants/revocations | A by access-admin grant | — unless separate grant | — | — | — | — | — | Never self-grant |
| Money movement/security bypass | No autonomous execution | No autonomous execution | No autonomous execution | No autonomous execution | No autonomous execution | No autonomous execution | — | L4 deny |

Access administration is separate from executive ownership. External invitations, new permissions and partner access require a named approving human and audited scope/expiry. Read-own-document grants do not expose staff notes, other household members or counterparties. System agent permission is the intersection of requester, service identity, capability policy and approval, never the union.

Required fixtures: two tenants, two branches, two teams, assigned/unassigned contacts, inactive membership, expiring partner grant, restricted KYC record, unauthorized owner, BOR from the wrong brokerage, revoked gateway. Test list/detail/search/export/aggregate/background/storage access, horizontal and vertical escalation, forged tenant IDs, cross-tenant joins, stale roles, reused approvals, payload edits, self-approval and revocation immediately before execution.
