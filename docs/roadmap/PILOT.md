# Pilot plan: one complete workflow, live with one brokerage

Owner decision (23 October 2026): build one complete, polished workflow and run it live with one real brokerage team, rather than many shallow features. This plan orders the work. Each slice is one or two reviewable PRs with tests, an ADR and screens from the design system (ADR 0018).

**The workflow:** a client's deal from first contact to closing:
- client
- deal (trade)
- key dates
- documents
- e-signing
- FINTRAC records
- closing checklist

## Slices

| # | Slice | Roadmap | Main owner inputs needed |
|---|---|---|---|
| 1 | **Clients:** add and view your clients (person, email, phone), private to the assigned agent. Done (ADR 0019). | M2 | None to build. Staff roles come later (#24). |
| 2 | **Consent and contact rules:** purpose-based consent with proof and withdrawal; quiet editing with version checks. Built with placeholder wording (ADR 0020). | M2 | Consent wording and retention, from the privacy owner |
| 3 | **Deals:** a buyer or seller deal linked to clients and a property address; stages from draft to closed. Built with placeholder stages (ADR 0021). | M3/M4 | Stage names and rules, from the BOR or operations |
| 4 | **Key dates and checklist:** conditions, deposit and closing dates in Toronto time; deal tasks from a reviewed template | M4 | The pilot checklist template, from the BOR |
| 5 | **Documents:** upload, versioning and required documents per deal; encrypted storage in Canada | M1-E/M5 | Hosting region and storage vendor, from the owner |
| 6 | **FINTRAC records:** identity verification and receipt-of-funds records with BOR review; restricted access | M5 | Compliance review of the forms, from the BOR or compliance |
| 7 | **E-signing:** send for signature through a provider sandbox, with human approval before every send | M5/M6 | Provider and account (DocuSign or Authentisign), from the owner |
| 8 | **Go live for the pilot:** hosting, backups and restore test, monitoring, real Google or Microsoft sign-in, data import, support runbook | M10/M11 | Hosting account, provider registration and the pilot team |

## Enterprise checklist (before selling to a large brokerage)

- An independent security test, and a SOC 2 plan.
- Company single sign-on (SAML) and admin roles.
- Audit export, and data kept in Canada.
- Uptime targets and a support process.
- Import from the brokerage's current systems.

These follow the pilot and are not part of slices 1–8.
