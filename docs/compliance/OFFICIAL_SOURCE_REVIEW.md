# Compliance and integration source review

Checked 7 October 2026. Findings are product inputs; brokerage-specific applicability/policies remain unapproved. No legal determination or provider entitlement is asserted.

| Topic | Confirmed public source finding | Product implication / unresolved boundary |
|---|---|---|
| RECO annual filing | Initial fiscal-year filing is due 30 October 2026; ongoing specified filings are due within 90 days of fiscal year-end; MyWeb and BOR attestation are required | Fiscal-period-aware preparation and evidence; do not label this unknown brokerage overdue or submit automatically |
| RECO trust oversight | Monthly reconciliation and BOR review/signature form part of annual compliance evidence | Immutable period evidence, assigned reviewer, corrections and shortfall escalation; actual ledger remains authoritative |
| 2027 reporting | RECO plans monthly trust reconciliation reporting in 2027; details are forthcoming | Versioned export extension; no invented schema, frequency start date or API |
| FINTRAC records | Receipt-of-funds record retention is at least five years from creation; information-record retention is five years from last business transaction; records must be producible within 30 days | Distinct trigger dates and applicable record classes; reviewed retrieval/export workflow and legal holds |
| CASL | Commercial messages generally require consent, identification and unsubscribe; express consent can be withdrawn; unsubscribe requests must be processed within 10 business days, links remain valid at least 60 days | Purpose/channel-specific proof and suppression; approval cannot override withdrawal; classify messages with reviewed rules |
| PropTx IDX | Public RESO IDX terms describe opted-in listing advertising on member/brokerage websites | Do not treat as unrestricted internal MLS access, analytics or model-training rights |
| SkySlope | Public partner docs describe REST and OAuth authorization-code flow with PKCE | Partner access/scopes and supported production resources require a provider spike; do not implement endpoints marked future |

## Official sources
- RECO requirements: https://www.reco.on.ca/agents-and-brokerages/annual-financial-filing/submission-and-information-requirements/
- RECO FAQs and future reporting: https://www.reco.on.ca/agents-and-brokerages/annual-financial-filing/annual-financial-filing-faqs/
- RECO filing instructions: https://www.reco.on.ca/agents-and-brokerages/annual-financial-filing/support-and-training-resources/annual-financial-filing-instructions/
- FINTRAC recordkeeping: https://fintrac-canafe.canada.ca/guidance-directives/recordkeeping-document/record/real-eng.php
- CRTC CASL FAQs: https://crtc.gc.ca/eng/com500/faq500.htm/
- PropTx IDX terms: https://webapp.proptx.ca/oas/common/IDX_Data_Feed.jsp
- SkySlope partner reference: https://forms.skyslope.com/partner/api/docs

The retrieved source findings are paraphrased and intentionally limited. This review is not an exhaustive Ontario/FINTRAC compliance matrix. TRESA/RECO retention schedule, all FINTRAC applicability and verification methods, third-party/beneficial ownership details, risk/ongoing-monitoring policy, suspicious transaction handling, tax/commission rules, permitted AI processors and contractual data rights require further official-source analysis and accountable review. Sensitive report information may require additional restricted handling; never expose it to broad timelines or AI.

## Integration spike exit criteria
For every provider: approved contract/data rights and purpose; granted scopes; sandbox; token expiry/revocation behaviour; rate limits; webhook verification/replay guarantees; provider idempotency/status lookup; permitted storage, retention, export and AI use; failure/reconciliation procedure; owner and review date. Without this evidence, expose a disabled capability with an entitlement_required reason. Provider unavailability or lack of an API does not itself authorize browser automation.
