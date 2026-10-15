# Read-only backlog reconciliation

No network access or GitHub writes. Supports exported open AND closed issues, proposed seed index and explicit reviewed decisions. A title match is a candidate, not permission to import; semantic matches require a human/agent-reviewed rationale. An issue may satisfy several seed intents only when every matching decision has a non-empty string shared_scope_rationale (rationale fields must be non-empty strings); duplicate seed IDs are rejected. Full repository pagination is the caller’s responsibility; never treat an empty/incomplete export as authoritative.

Run:

```bash
python3 tools/reconcile_backlog.py --seed backlog/seed-index.json --issues current-issues.json --decisions reviewed-decisions.json --output reconciliation-plan.json
python3 -m unittest discover -s tools -p 'test_*.py' -v
```

Decision example (illustrative number, not an actual repository issue):

```json
{"REO-SEED-001":{"action":"match","issue_number":7,"intent_reviewed":true,"rationale":"Reviewed existing issue covers same service-definition outcome"}}
```

Create requires action=create, intent_reviewed=true, all_existing_intents_reviewed=true and rationale. Existing exact-title/marker candidates block proposed creation. defer records a blocker. The output is a manual review plan, never a mutation script. A ready plan does not prove current GitHub state or authorize main merges/production.
