# Mac agent gateway

## Role
A dedicated Mac (ideally Mac mini) is a controlled execution gateway for local files, desktop/browser workflows, MCP tools and optional local inference. It is not the source of truth.

## Components
- dedicated macOS service account
- FileVault
- macOS Keychain or equivalent secret store
- gateway daemon
- Hermes supervisor/orchestrator
- Codex specialist tool via MCP/CLI integration
- browser profile dedicated to business workflows
- optional local model exposed through an OpenAI-compatible endpoint
- structured local audit/diagnostic logs

## Network model
Outbound authenticated connection to cloud job API. Prefer short-lived device credentials, rotation, heartbeat and explicit revocation. No public inbound port.

## Job envelope
Each job includes:
- job ID + idempotency key
- organization/user context
- purpose
- permitted capabilities
- approved domains/resources
- data classification
- approval requirement
- timeout/retry policy

## Safety
- allowlisted tools/domains
- filesystem sandbox
- no arbitrary shell by default
- browser actions scoped to approved workflows
- approval token required for L3 actions
- kill switch and device revocation
- offline queue with expiry; never execute stale consequential jobs

## Initial use cases
1. Read local/downloaded documents and extract approved metadata.
2. Operate permitted provider portals that lack APIs.
3. Prepare drafts or forms for human review.
4. Run local scripts for migration/normalization.
5. Use Codex for bounded technical/operational tasks.
