# GitHub planning reconciliation procedure

Import already completed: 113 items (20 epics + 93 children) map to issues #1–#113. On 7 October 2026 all unique seed markers and titles were reconciled against the complete open/closed issue export. No duplicate import occurred. Twelve milestones were created and all 113 issue assignments were read back. Original archive comparison remains unavailable; see DECISION_REGISTER.md. The procedure below remains the repeatable future reconciliation process.

1. Read current repository metadata/default branch/rules/AGENTS.md, all docs/backlog and active branches; enumerate all open/closed issues and PRs, milestones, labels, Actions and existing Project items with pagination.
2. Compare seed path hashes with current contents and inspect changed decisions. Preserve better/newer work. Map each seed item to existing issue intent: domain, user outcome, acceptance criteria and dependency. Title similarity is only a candidate signal. Record match rationale, existing URL, state and discrepancies.
3. Resolve ambiguous/multiple intent matches before writing. Closed completed issues remain matched, not reopened/imported automatically. Existing implementations require direct verification before status changes. Distinct slices may share an epic but must not duplicate outcomes.
4. Add stable seed markers only when mapped intentionally, such as <!-- real-estate-ops-seed:REO-SEED-001 -->. IDs in seed-index.json identify this recovered seed version, not GitHub issue numbers. Do not use generated row IDs alone to deduplicate a future reordered seed.
5. Create missing milestones by exact full title and missing labels after inspection. Map M0..M11 to the full titles in proposed-project-config.json. Use existing numbers/IDs from readback.
6. Import only unmapped intents, parent epics first, then children. Record returned issue numbers; attach parent/dependency links and milestone. Use structured bodies with explicit criteria/permissions/audit/QA/dependencies; do not claim generic seed acceptance text is implementation-ready.
7. Reconcile Project by title/organization and existing repository relationship. Do not change organization permissions. Inspect capabilities before creating requested fields. Assign native milestone/assignee fields when supported; document platform limitations rather than creating misleading copies.
8. Read back every mutation. Persist an issue-map with seed ID, intent, action, rationale, issue URL, milestone and evidence. On partial failure refresh before retry so no duplicate is created.

## Proposed dependency corrections
- Seed index values here are 0-based `seed_index` values, one less than the issue number. Seed index 083 = REO-SEED-084 = issue #84 (outbox) belongs to M1 infrastructure; deterministic automation rules stay M8. Reassign the matched issue or split its already-defined scope with explicit links; never create another outbox issue blindly.
- Seed indices 075/076 = issues #76/#77 (action classification/approval tokens) require M1 shared authorization/approval primitives. M7 retains gateway execution/device-specific tests. Reconcile existing scope before splitting.
- Seed index 064 = issue #65 (data-rights enforcement) must precede the first entitled external-data persistence; establish disabled contracts in M1, provider behaviour in the integration milestone.
- Synthetic fixture capability is required in M1; the M10 demo dataset can remain larger pilot content. Avoid duplicate fixture issues.
- Brokerage/core data modelling, approved retention policies and integration rights are M0 prerequisites even where feature implementations occur later.

## Project configuration gaps
The seed lists Status, Priority, Area, Risk, Security review and Client decision. Add requested Owner, Dependency and Pilot requirement; use GitHub-native Milestone and Assignees where feasible. Owner is accountable human/team, not an invented assignee. Dependency should link blocking issue IDs and explain whether the relation blocks implementation, pilot or production. Project configuration remains proposed. The current GitHub CLI credential lacks read:project; listing/creation/field/privacy verification cannot proceed without Project access. This is tracked by existing issue #115; repository permissions were not changed.
