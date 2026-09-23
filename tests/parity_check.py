"""Reference side of tests/parity.mjs: runs IgnisShield-Web's original model and geometry on the same input."""
import json, sys
from pathlib import Path
backend = Path(__file__).resolve().parents[2] / 'IgnisShield-Web' / 'backend'
sys.path.insert(0, str(backend))
from model import Cell, FireModel  # noqa: E402
from shapely.geometry import shape  # noqa: E402
from shapely.ops import transform  # noqa: E402
from pyproj import Transformer  # noqa: E402

PROJECT = Transformer.from_crs(4326, 32651, always_xy=True).transform
job = json.load(sys.stdin)

# Geometry exactly as engine.run_fire prepares it
geoms = [transform(PROJECT, shape(f['geometry'])) for f in job['features']]
geometry = {'cells': [[g.centroid.x, g.centroid.y, g.area, g.length] for g in geoms],
            'gaps': [[i, j, geoms[i].distance(geoms[j])] for i, j in job['pairs']]}

runs = []
for run in job['runs']:
    cells = [Cell(c['id'], c['x'], c['y'], c['area'], c['perimeter'], c['values']) for c in run['cells']]
    adjacency = {int(k): [tuple(e) for e in v] for k, v in run['adjacency'].items()}
    model = FireModel(cells, adjacency, run['ignition'], run['seed'], 1, run['minutes'])
    code = {'safe': 0, 'burning': 1, 'burned': 2}
    frames = [[code[model.states[i]] for i in sorted(model.states)]]
    while not model.finished:
        model.step()
        frames.append([code[model.states[i]] for i in sorted(model.states)])
    runs.append({'frames': frames, 'timeline': model.timeline, 'metrics': model.metrics()})
json.dump({'geometry': geometry, 'runs': runs}, sys.stdout)
