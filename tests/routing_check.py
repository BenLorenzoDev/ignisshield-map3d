"""Reference side of tests/routing-parity.mjs: runs IgnisShield-Web's engine.run_route on the same cases."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'IgnisShield-Web' / 'backend'))
from engine import run_route  # noqa: E402

job = json.load(sys.stdin)
out = []
for case in job['cases']:
    payload = {'dataset': job['dataset'], **case}
    try:
        r = run_route(payload)
        out.append({'excluded': r['excluded'], 'saved': r['saved_minutes'], 'method': r['method'],
                    'baseline': {k: r['baseline'][k] for k in ['minutes', 'length', 'nodes', 'edges']},
                    'optimized': {k: r['optimized'][k] for k in ['minutes', 'length', 'nodes', 'edges']}})
    except ValueError as e:
        out.append({'error': str(e)})
json.dump(out, sys.stdout)
