import unittest
from reconcile_backlog import build_plan

class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.seed = [{'seed_id': 'REO-SEED-001', 'title': 'Build tenant isolation'}]
    def test_closed_match_preserved_despite_renamed_title(self):
        issues = [{'number': 7, 'title': 'Secure records', 'body': '<!-- real-estate-ops-seed:REO-SEED-001 -->', 'state': 'closed'}]
        d = {'REO-SEED-001': {'action': 'match', 'issue_number': 7, 'intent_reviewed': True, 'rationale': 'Same isolation scope'}}
        plan = build_plan(self.seed, issues, d)
        self.assertEqual(plan['items'][0]['existing_state'], 'closed')
        self.assertEqual(plan['items'][0]['action'], 'match')
        self.assertEqual(plan['writes'], 0)
    def test_candidate_or_missing_intent_review_blocks_create(self):
        issues = [{'number': 9, 'title': 'Build tenant isolation', 'state': 'open'}]
        d = {'REO-SEED-001': {'action': 'create', 'intent_reviewed': True, 'rationale': 'New', 'all_existing_intents_reviewed': True}}
        with self.assertRaises(ValueError): build_plan(self.seed, issues, d)
        d['REO-SEED-001']['all_existing_intents_reviewed'] = False
        with self.assertRaises(ValueError): build_plan(self.seed, [], d)
    def test_empty_decisions_cannot_claim_import_ready(self):
        plan = build_plan(self.seed, [], {})
        self.assertFalse(plan['ready_for_manual_import_review'])
        self.assertEqual(plan['items'][0]['action'], 'review_required')
    def test_absent_or_pr_match_rejected(self):
        d = {'REO-SEED-001': {'action': 'match', 'issue_number': 4, 'intent_reviewed': True, 'rationale': 'Same intent'}}
        with self.assertRaises(ValueError): build_plan(self.seed, [], d)
        with self.assertRaises(ValueError): build_plan(self.seed, [{'number':4,'title':'PR','pull_request':{}}], d)
    def test_semantic_match_requires_explicit_review(self):
        issues = [{'number':2,'title':'Prevent tenant data leakage','state':'open'}]
        d = {'REO-SEED-001': {'action':'match','issue_number':2,'rationale':'Same outcome'}}
        with self.assertRaises(ValueError): build_plan(self.seed, issues, d)
        d['REO-SEED-001']['intent_reviewed'] = True
        self.assertEqual(build_plan(self.seed, issues, d)['items'][0]['issue_number'],2)
    def test_duplicate_seed_ids_rejected(self):
        seed = self.seed + [{'seed_id': 'REO-SEED-001', 'title': 'Copy'}]
        d = {'REO-SEED-001': {'action': 'create', 'intent_reviewed': True, 'rationale': 'New', 'all_existing_intents_reviewed': True}}
        with self.assertRaises(ValueError): build_plan(seed, [], d)
    def test_shared_issue_match_requires_explicit_shared_scope(self):
        seed = self.seed + [{'seed_id': 'REO-SEED-002', 'title': 'Audit tenant access'}]
        issues = [{'number': 3, 'title': 'Tenant security', 'state': 'open'}]
        d = {k: {'action': 'match', 'issue_number': 3, 'intent_reviewed': True, 'rationale': 'Same'} for k in ('REO-SEED-001', 'REO-SEED-002')}
        with self.assertRaises(ValueError): build_plan(seed, issues, d)
        for v in d.values(): v['shared_scope_rationale'] = 'One issue covers isolation and its audit'
        self.assertTrue(build_plan(seed, issues, d)['ready_for_manual_import_review'])
    def test_non_string_rationales_rejected(self):
        for bad in (None, False, {}, [], 0):
            d = {'REO-SEED-001': {'action': 'defer', 'intent_reviewed': True, 'rationale': bad}}
            with self.assertRaises(ValueError): build_plan(self.seed, [], d)
        seed = self.seed + [{'seed_id': 'REO-SEED-002', 'title': 'Audit tenant access'}]
        issues = [{'number': 3, 'title': 'Tenant security', 'state': 'open'}]
        for bad in (None, False, {}, []):
            d = {k: {'action': 'match', 'issue_number': 3, 'intent_reviewed': True, 'rationale': 'Same', 'shared_scope_rationale': bad} for k in ('REO-SEED-001', 'REO-SEED-002')}
            with self.assertRaises(ValueError): build_plan(seed, issues, d)

if __name__ == '__main__': unittest.main()
