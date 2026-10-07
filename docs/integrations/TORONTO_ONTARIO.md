# Toronto / Ontario integration plan

## Tier A — supported API integrations

### SkySlope Forms / DigiSign
Use the official partner REST API and OAuth where brokerage access is approved. Target capabilities: files, contacts, documents, envelopes, signed-document retrieval, signed-document webhooks and MLS import where entitled.

### CREA REALTOR.ca DDF
Use authorized DDF feeds with OAuth client credentials and RESO/OData. Treat feed permissions as the boundary of allowed data use.

### Google Workspace / Microsoft 365
Email metadata/thread association, draft creation, calendar sync, Drive/OneDrive links, meeting metadata. External sends/changes require approval by default.

## Tier B — entitlement and API discovery spikes
- TRREB/PropTx internal data access beyond IDX
- REALM
- Matrix
- BrokerBay
- GeoWarehouse
- MPAC propertyline
- Fintracker
- current accounting platform
- current phone/SMS provider

## Important PropTx rule
The publicly documented PropTx RESO IDX feed is for opted-in IDX listing advertising under the applicable agreement. Do not assume that feed authorizes unrelated internal warehousing, analytics, AI training, or brokerage operational use.

## Browser/Mac fallback
Only use the local agent for workflows that:
1. are permitted by the provider/contract,
2. lack an appropriate API,
3. have an explicit scoped business need, and
4. can be executed with approval and audit controls.

No CAPTCHA bypass, credential sharing, anti-bot evasion or unsupported scraping.
