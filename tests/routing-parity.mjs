// Checks public/routing.js against IgnisShield-Web's engine.run_route (Python).
// Run: node tests/routing-parity.mjs   (needs IgnisShield-Web/.venv with shapely and pyproj)
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const F = require('../public/fire.js');
const R = require('../public/routing.js');
const here = new URL('.', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, here), 'utf8'));

const roads = read('../public/data/source.geojson').features.filter(f => f.properties.kind === 'road');
const rng = new F.PyRandom(11);
const buildings = read('../public/data/ai-buildings.geojson').features
  .map(f => ({...f, properties: {...f.properties, bldg_dens: Math.round(rng.random() * 100) / 100}}));
const boundary = {type: 'Feature', properties: {kind: 'boundary', id: 'b', source_ref: 'parity test', mapped_by: 'test'},
  geometry: {type: 'Polygon', coordinates: [[[123.69, 10.49], [123.74, 10.49], [123.74, 10.53], [123.69, 10.53], [123.69, 10.49]]]}};
const dataset = {type: 'FeatureCollection', features: [boundary, ...buildings, ...roads]};

// Junctions usable on foot, to pick test endpoints from
const walkNodes = [...R.buildGraph(roads, [], [], {mode: 'Walking'}).coords.keys()].sort();
const pick = n => Array.from({length: n}, () => walkNodes[Math.floor(rng.random() * walkNodes.length)]);
const hazards = buildings.slice(200, 260).map(f => f.properties.id);
const cases = [];
for (const [mode, extra] of [['Walking', {}], ['Fire engine', {}], ['Walking', {affected: hazards, clearance: 8}], ['Fire engine', {affected: hazards, clearance: 15, speed: 20, width: 3}]]) {
  for (let i = 0; i < 4; i++) { const [start, end] = pick(2); cases.push({mode, ...extra, purpose: 'Evacuation', start, end}); }
  for (const k of [3, 6, 14]) { const [start, end, ...checkpoints] = pick(k + 2); cases.push({mode, ...extra, purpose: 'Checkpoints', start, end, checkpoints: [...new Set(checkpoints)].filter(c => c !== start && c !== end)}); }
  const [s, ...cps] = pick(5); cases.push({mode, ...extra, purpose: 'Checkpoints', start: s, end: s, checkpoints: [...new Set(cps)].filter(c => c !== s)});
}

const out = spawnSync(fileURLToPath(new URL('../../IgnisShield-Web/.venv/Scripts/python.exe', here)), [fileURLToPath(new URL('routing_check.py', here))],
  {input: JSON.stringify({dataset, cases}), maxBuffer: 1 << 28});
if (out.status !== 0) { console.error(out.error ?? out.stderr.toString()); process.exit(1); }
const py = JSON.parse(out.stdout);

let failures = 0, compared = 0, errorsMatched = 0, ties = 0;
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
cases.forEach((c, i) => {
  const p = py[i];
  const byId = new Set(c.affected ?? []);
  let js;
  try {
    const g = R.buildGraph(roads, buildings.map(f => ({feature: f, bldg_dens: f.properties.bldg_dens})), buildings.filter(f => byId.has(f.properties.id)), c);
    const r = R.route(g, c);
    js = {nodes: [...g.coords.keys()].sort(), excluded: r.excluded, saved: r.saved_minutes, method: r.method, baseline: r.baseline, optimized: r.optimized};
  } catch (e) { js = {error: e.message}; }
  const label = `${c.mode} ${c.purpose}${c.affected ? ' (fire exclusion)' : ''} ${c.start}→${c.end}${c.checkpoints ? ` +${c.checkpoints.length} checkpoints` : ''}`;
  if (p.error || js.error) {
    if (p.error === js.error) errorsMatched++;
    else { failures++; console.log('FAIL', label, '\n  python:', p.error, '\n  js:    ', js.error); }
    return;
  }
  compared++;
  const ok = same(p.excluded, js.excluded) && p.method === js.method && close(p.saved, js.saved)
    && ['baseline', 'optimized'].every(k => close(p[k].minutes, js[k].minutes) && close(p[k].length, js[k].length) && same(p[k].nodes, js[k].nodes) && same(p[k].edges, js[k].edges));
  if (!ok) {
    // A different route whose cost matches to ~1e-9 is a floating-point tie (projection noise ~1e-9 m), not a logic difference
    const tie = ['baseline', 'optimized'].every(k => close(p[k].minutes, js[k].minutes)) && same(p.excluded, js.excluded);
    if (tie) { ties++; console.log('TIE ', label, JSON.stringify({python: p.optimized.nodes.length + ' nodes ' + p.optimized.minutes, js: js.optimized.nodes.length + ' nodes ' + js.optimized.minutes})); }
    else { failures++; console.log('FAIL', label, JSON.stringify({py: p.optimized.minutes, js: js.optimized.minutes})); }
  }
});
console.log(`routing: ${cases.length} cases (${compared} routes compared, ${ties} equal-cost ties, ${errorsMatched} identical refusals)`);
console.log(failures ? `${failures} routing check(s) failed` : 'All routing parity checks passed.');
process.exit(failures ? 1 : 0);
