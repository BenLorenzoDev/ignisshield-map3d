// Checks the browser fire model (public/fire.js) against IgnisShield-Web's original Python model.
// Run: node tests/parity.mjs   (needs IgnisShield-Web/.venv with shapely and pyproj)
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const F = require('../public/fire.js');
const here = new URL('.', import.meta.url);
const python = new URL('../../IgnisShield-Web/.venv/Scripts/python.exe', here);

// Real building outlines from the app, a 120-building patch around Sitio Polo
const ai = JSON.parse(readFileSync(new URL('../public/data/ai-buildings.geojson', here), 'utf8')).features;
const centre = [123.7141, 10.5068];
const features = ai.map(f => ({f, d: Math.hypot(f.geometry.coordinates[0][0][0] - centre[0], f.geometry.coordinates[0][0][1] - centre[1])}))
  .sort((a, b) => a.d - b.d).slice(0, 120).map(x => x.f);

const rng = new F.PyRandom(7); // deterministic varied inputs
const pick = (lo, hi, step) => Math.round((lo + rng.random() * (hi - lo)) / step) * step;
const perBuilding = features.map(() => ({
  bldg_dens: pick(0, 1, 0.01), bldg_mat: pick(1, 3, 1), house_cnt: pick(1, 6, 1),
  alley_wd: pick(0.5, 8, 0.1), oxygen_v: pick(0.5, 2, 0.1)
}));
const scenarios = [
  {humidity: 70, temp_c: 30, wind_dir: 45, wind_spd: 15, seed: 42, minutes: 60},
  {humidity: 30, temp_c: 38, wind_dir: 270, wind_spd: 40, seed: 0, minutes: 120},
  {humidity: 90, temp_c: 22, wind_dir: 180, wind_spd: 0, seed: 2147483647, minutes: 30},
  {humidity: 50, temp_c: 33, wind_dir: 90, wind_spd: 25, seed: 12345, minutes: 240}
];

const {cells, adjacency} = F.buildCells(features, () => ({}));
const pairs = [];
for (const [i, list] of adjacency) for (const [j] of list) if (i < j && pairs.length < 400) pairs.push([i, j]);

const runs = scenarios.map((s, n) => {
  const {cells, adjacency} = F.buildCells(features, f => ({...perBuilding[features.indexOf(f)], humidity: s.humidity, temp_c: s.temp_c, wind_dir: s.wind_dir, wind_spd: s.wind_spd}));
  const ignition = [0, 17, 55, 101][n];
  return {s, ignition, cells, adjacency, js: F.simulate(features, f => ({...perBuilding[features.indexOf(f)], humidity: s.humidity, temp_c: s.temp_c, wind_dir: s.wind_dir, wind_spd: s.wind_spd}), ignition, s.seed, s.minutes)};
});

const job = {
  features, pairs,
  runs: runs.map(r => ({cells: r.cells, adjacency: Object.fromEntries(r.adjacency), ignition: r.ignition, seed: r.s.seed, minutes: r.s.minutes}))
};
const out = spawnSync(fileURLToPath(python), [fileURLToPath(new URL('parity_check.py', here))], {input: JSON.stringify(job), maxBuffer: 1 << 28});
if (out.status !== 0) { console.error(out.error ?? out.stderr.toString()); process.exit(1); }
const py = JSON.parse(out.stdout);

let failures = 0;
const check = (ok, label) => { if (!ok) { failures++; console.log('FAIL', label); } };

// Geometry vs shapely/pyproj
let worst = {xy: 0, area: 0, per: 0, gap: 0};
py.geometry.cells.forEach(([x, y, area, per], i) => {
  const c = cells[i];
  worst.xy = Math.max(worst.xy, Math.hypot(c.x - x, c.y - y));
  worst.area = Math.max(worst.area, Math.abs(c.area - area) / area);
  worst.per = Math.max(worst.per, Math.abs(c.perimeter - per) / per);
});
for (const [i, j, g] of py.geometry.gaps) worst.gap = Math.max(worst.gap, Math.abs(adjacency.get(i).find(e => e[0] === j)[1] - g));
console.log(`geometry: ${cells.length} buildings, ${pairs.length} neighbour gaps; worst centroid ${worst.xy.toExponential(2)} m, area ${worst.area.toExponential(2)} rel, perimeter ${worst.per.toExponential(2)} rel, gap ${worst.gap.toExponential(2)} m`);
check(worst.xy < 1e-3 && worst.area < 1e-6 && worst.per < 1e-6 && worst.gap < 1e-3, 'geometry matches shapely/pyproj');

// Fire runs vs model.py
runs.forEach((r, n) => {
  const p = py.runs[n];
  const sameFrames = p.frames.length === r.js.frames.length && p.frames.every((f, k) => f.every((v, i) => v === r.js.frames[k].states[i]));
  const sameTimeline = p.timeline.every((row, k) => Object.keys(row).every(key => Math.abs(row[key] - r.js.timeline[k][key]) <= 1e-9 * Math.max(1, Math.abs(row[key]))));
  const sameMetrics = Object.keys(p.metrics).every(key => typeof p.metrics[key] === 'string' ? p.metrics[key] === r.js.metrics[key] : Math.abs(p.metrics[key] - r.js.metrics[key]) <= 1e-6);
  const burnt = r.js.frames.at(-1).states.filter(v => v > 0).length;
  console.log(`run ${n + 1} (seed ${r.s.seed}, wind ${r.s.wind_spd} km/h from ${r.s.wind_dir}°, ${r.s.minutes} min): ${r.js.frames.length} frames, ${burnt} buildings ignited; frames ${sameFrames ? 'identical' : 'DIFFER'}, timeline ${sameTimeline ? 'identical' : 'DIFFERS'}, metrics ${sameMetrics ? 'identical' : 'DIFFER'}`);
  if (!sameMetrics) console.log('  python', p.metrics, '\n  js    ', r.js.metrics);
  check(sameFrames && sameTimeline && sameMetrics, `run ${n + 1}`);
});
console.log(failures ? `${failures} check(s) failed` : 'All parity checks passed.');
process.exit(failures ? 1 : 0);
