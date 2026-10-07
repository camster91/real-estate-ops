# ADR 0005-evidence-and-retention: Evidence versions, retention policies and audit integrity

Status: Proposed — derived from seed and current user instruction; repository reconciliation pending.

## Context
The seed defines product boundaries but lacks implementation-level invariants. No current repository decision has been verified.

## Decision
Document points to immutable DocumentVersions with checksum, classification, encrypted object key, scan status, uploader and timestamps. Quarantine uploads until file type/size validation and malware inspection succeed. Download links are short-lived and authorized; tenant IDs and storage prefixes are not authorization. Signature packages snapshot exact versions and approved recipients. Never overwrite completed evidence; corrections create a new version with supersession rationale.

RetentionPolicy is versioned by record class, purpose, jurisdiction, trigger event and effective date. Multiple applicable rules and legal holds can extend retention. Unknown required trigger or unapproved policy prevents automatic purge. Archive is not deletion. Expiry produces a human-review candidate; destruction must respect holds, approved policy, dependencies, storage versions and restore procedures. Audit metadata also has an approved privacy/retention policy rather than indefinite PII retention.

Database grants/triggers make audit append-only for application identities. Tamper evidence uses a specified canonical serialization and hash chain with periodic externally retained signed checkpoints/immutable storage. A hash chain stored only in the same mutable database is not proof against privileged database compromise. Audit verification, sensitive reads/exports and privileged maintenance are in scope. Recovery must preserve evidence and revocations.

Do not hard-code a blanket five-year expiry. FINTRAC triggers differ by record type; RECO/TRESA and contractual/legal-hold requirements require a separate reviewed schedule.

## Consequences
Shared domain rules and tenant-scoped persistence are required. Unconfirmed policies and entitlements stay configurable and disabled by default. Existing repository decisions must be compared before adoption; document any conflict rather than silently replacing it.

## Verification before acceptance
Trace to the relevant reconciled GitHub issue, review the core model/security implications, and add automated tests for tenant isolation, invalid transitions, least privilege and applicable approval/replay/concurrency boundaries. Verify migration and recovery implications. Legal or brokerage policy choices require the named accountable reviewer.
