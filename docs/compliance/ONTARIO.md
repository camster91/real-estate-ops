# Ontario brokerage compliance requirements

> Product requirements, not legal advice. Final workflows must be reviewed by the brokerage's broker of record/compliance advisers.

## RECO / TRESA
The product must support:
- trade record sheets and complete transaction files;
- trust-money receipt/transaction evidence;
- monthly trust reconciliation workflow and broker-of-record review/sign-off evidence;
- shortfall exception/escalation;
- compliance exceptions and remediation history;
- annual financial filing preparation/evidence;
- retention/export for inspection readiness.

### 2026 annual financial filing
Treat this as P0. Store the data/evidence needed to prepare the filing, including financial statement fields, trust assets/liabilities, unclaimed trust monies, compliance attestations and filing confirmation metadata. Submission through RECO MyWeb remains a human-approved action.

### 2027 monthly reporting readiness
Design the reconciliation schema so a future monthly reporting/export layer can be added without remodelling historical data.

## FINTRAC
Support, where applicable:
- identity verification status and evidence references;
- information records;
- receipt-of-funds records;
- large cash / large virtual currency records where applicable;
- third-party determinations;
- beneficial ownership;
- business relationship and ongoing monitoring;
- risk assessments;
- copies/references to submitted reports as appropriate;
- five-year retention policies for applicable records;
- ability to retrieve/produce records within required timeframes.

Do not expose identity documents or sensitive KYC data to AI unless required for an approved task. Prefer metadata/status over document contents.

## CASL
Marketing email/SMS functionality must track consent basis, proof/source, expiry where applicable, sender identification and unsubscribe state. Operational/transactional communications should be classified separately from marketing campaigns.
