# ADR 0002-domain-model: Party, property, engagement and transaction boundaries

Status: Proposed for policy review — current repository reconciled on 7 October 2026; not brokerage-approved.

## Context
The imported seed and current planning/tooling branches were inspected on 7 October 2026. These proposals preserve the existing architecture. The original seed archive is not currently exposed by either connected Drive account, so byte-for-byte archive comparison remains unverified. Brokerage-specific choices require the accountable reviewer recorded in DECISION_REGISTER.md.

## Decision
Party is either person or organization, with exactly one matching profile. Household is an optional effective-dated grouping of parties, not a person, legal counterparty or permission boundary. Relationship is typed, directed and effective-dated; document relationship provenance without treating it as verified beneficial ownership. Client is a role on an engagement/transaction, not a duplicate contact entity. Auth principal and Party are independent.

Property is the durable physical asset, PropertyUnit a subspace, Listing a time-bounded marketing instruction and Transaction a trade process. An address or MLS number cannot serve as a universal property identifier. Preserve raw addresses, normalized search fields, unit distinctions and provenance; use human-reviewed duplicate suggestions. Listing requires brokerage context and entitled ExternalReference records. OwnershipInterest records source and effective dates and is not asserted legal title.

ServiceEngagement is the shared service case; zero or many Transactions may belong to it. Each Transaction has typed parties, responsible brokerage, workflow version and dates. Property-management engagements extend with Tenancy, inspection and maintenance references; do not force rent collection or accounting into a sale transaction. Use typed associations for activities/documents and enforce tenant-scoped foreign keys; avoid unvalidated polymorphic IDs.

Open decisions: actual supported service variants, representation roles and property-management policies.

## Consequences
Shared domain rules and tenant-scoped persistence are required. Unconfirmed policies and entitlements stay configurable and disabled by default. Existing repository decisions must be compared before adoption; document any conflict rather than silently replacing it.

## Verification before acceptance
Trace to the relevant reconciled GitHub issue, review the core model/security implications, and add automated tests for tenant isolation, invalid transitions, least privilege and applicable approval/replay/concurrency boundaries. Verify migration and recovery implications. Legal or brokerage policy choices require the named accountable reviewer.
