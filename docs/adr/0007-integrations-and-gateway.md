# ADR 0007-integrations-and-gateway: Rights-aware integrations and bounded outbound gateway

Status: Proposed — derived from seed and current user instruction; repository reconciliation pending.

## Context
The seed defines product boundaries but lacks implementation-level invariants. No current repository decision has been verified.

## Decision
Shared IntegrationConnection records contain tenant, provider, credential reference, granted OAuth scopes, entitled resources/purposes, contract dates, retention/export limits and revocation state. Credentials live in a secrets store, never domain payloads or logs. ExternalDataRightsPolicy is checked before read, persistence, display, export and AI processing. Expired/unconfirmed rights deny these operations. An IDX advertising entitlement is not evidence of operational MLS, analytics or AI-training rights.

The Mac gateway is an outbound authenticated execution device with revocable short-lived credentials, heartbeat and tenant-bound capabilities. It never becomes the database or authoritative job queue. Local temporary data is minimized/encrypted and cleared under approved policy. Allowlist filesystem roots with canonical path/symlink checks, provider origins and exact supported tool operations; no arbitrary shell/browser control by default. FileVault, dedicated service account and Keychain are deployment prerequisites to verify on the actual Mac.

Hermes/Codex/MCP/model adapters implement a narrow tool contract and cannot expand permission based on prompt content. Treat retrieved documents/web content as untrusted data. Offline gateway jobs expire; L3 execution requires online approval verification. Core API/workers continue when a Mac is unavailable. Adapter retries/status semantics need provider-specific tests.

## Consequences
Shared domain rules and tenant-scoped persistence are required. Unconfirmed policies and entitlements stay configurable and disabled by default. Existing repository decisions must be compared before adoption; document any conflict rather than silently replacing it.

## Verification before acceptance
Trace to the relevant reconciled GitHub issue, review the core model/security implications, and add automated tests for tenant isolation, invalid transitions, least privilege and applicable approval/replay/concurrency boundaries. Verify migration and recovery implications. Legal or brokerage policy choices require the named accountable reviewer.
