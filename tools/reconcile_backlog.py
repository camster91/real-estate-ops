"""Read-only reconciliation. No network or GitHub writes; decisions require intent review."""
import argparse
import json
import re
from pathlib import Path


def _has_text(value):
    return isinstance(value, str) and bool(value.strip())


def build_plan(seed, issues, decisions):
    numbers = [x['number'] for x in issues]
    if len(set(numbers)) != len(numbers):
        raise ValueError('Duplicate issue numbers in export')
    by_number = {x['number']: x for x in issues}
    seed_list = [x['seed_id'] for x in seed]
    if len(set(seed_list)) != len(seed_list):
        raise ValueError('Duplicate seed IDs in seed index')
    seed_ids = set(seed_list)
    if set(decisions) - seed_ids:
        raise ValueError('Decision references unknown seed ID')
    matched = {}
    for key, decision in decisions.items():
        if decision.get('action') == 'match':
            matched.setdefault(decision.get('issue_number'), []).append(key)
    for number, keys in matched.items():
        for key in keys:
            if len(keys) > 1 and not _has_text(decisions[key].get('shared_scope_rationale')):
                raise ValueError(f'{key}: issue #{number} also matched by other seeds; shared_scope_rationale required')
    plan = []
    for item in seed:
        key = item['seed_id']
        candidates = []
        for issue in issues:
            if 'pull_request' in issue:
                continue
            marker = f'<!-- real-estate-ops-seed:{key} -->'
            reason = None
            if marker in (issue.get('body') or ''):
                reason = 'stable_marker'
            elif re.sub(r'\s+', ' ', issue['title'].casefold()).strip() == re.sub(r'\s+', ' ', item['title'].casefold()).strip():
                reason = 'exact_title_candidate'
            if reason:
                candidates.append({'number': issue['number'], 'reason': reason, 'state': issue.get('state')})
        decision = decisions.get(key)
        result = {'seed_id': key, 'title': item['title'], 'candidates': candidates, 'action': 'review_required'}
        if decision:
            if decision.get('intent_reviewed') is not True or not _has_text(decision.get('rationale')):
                raise ValueError(f'{key}: intent review and rationale required')
            action = decision.get('action')
            if action == 'match':
                number = decision.get('issue_number')
                if number not in by_number or 'pull_request' in by_number[number]:
                    raise ValueError(f'{key}: matched issue absent or is a PR')
                if any(c['reason'] == 'stable_marker' and c['number'] != number for c in candidates):
                    raise ValueError(f'{key}: conflicting stable marker')
                result.update(action='match', issue_number=number, existing_state=by_number[number].get('state'))
            elif action == 'create':
                if candidates:
                    raise ValueError(f'{key}: resolve existing candidate before create')
                if decision.get('all_existing_intents_reviewed') is not True:
                    raise ValueError(f'{key}: full intent review required before create')
                result['action'] = 'proposed_create'
            elif action == 'defer':
                result['action'] = 'defer'
            else:
                raise ValueError(f'{key}: invalid decision action')
            result['rationale'] = decision['rationale']
        plan.append(result)
    return {'mode': 'read_only', 'writes': 0, 'items': plan,
            'ready_for_manual_import_review': not any(x['action'] == 'review_required' for x in plan)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--seed', type=Path, required=True)
    p.add_argument('--issues', type=Path, required=True)
    p.add_argument('--decisions', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    plan = build_plan(json.loads(args.seed.read_text()), json.loads(args.issues.read_text()), json.loads(args.decisions.read_text()))
    args.output.write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps({'items': len(plan['items']), 'writes': 0, 'ready_for_manual_import_review': plan['ready_for_manual_import_review']}))

if __name__ == '__main__':
    main()
