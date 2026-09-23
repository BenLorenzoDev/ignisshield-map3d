// Checks the optional BFP response (public/bfp.js) on the real map. Run: node tests/bfp.test.mjs
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const F = require('../public/fire.js'), P = require('../public/paper.js'), BFP = require('../public/bfp.js');
const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
const roads = read('../public/data/source.geojson').features.filter(f => f.properties.kind === 'road');
const ai = read('../public/data/ai-buildings.geojson').features, local = P.localDensity(ai);
const x = {Db: null, Mb: 900, O2: 1, Hr: 70, Ta: 30, Nh: 1, Wr: 3, Uw: 4.2, Tw: 45}, inputs = ai.map((f, i) => P.toModel(x, local[i]));
const ctx = BFP.prepare({features: ai, densities: inputs.map(m => m.bldg_dens), roads, station: [123.71327, 10.50537]});
const ign = ai.findIndex(f => f.properties.id === 'ms-310');
const run = hook => F.simulate(ai, f => inputs[ai.indexOf(f)], ign, 42, 40, hook);
const ignited = r => r.frames.at(-1).states.filter(s => s > 0).length;

test('without the BFP checkbox nothing changes (no hook = the paper model)', () => {
  assert.deepEqual(run().metrics.Burned_Area_M2, run(null).metrics.Burned_Area_M2);
});
test('the truck leaves after call + turnout, arrives, and puts buildings out', () => {
  const c = ctx.create(), r = run(() => c.hook);
  assert.equal(c.timeline.dispatch, 4);
  assert.ok(c.timeline.arrivals[0].minute > 4);
  assert.ok(c.timeline.arrivals[0].gap >= 10, 'parks at least 10 m from the flames');
  assert.ok(c.timeline.extinguished > 0);
  assert.equal(r.frames.at(-1).states.filter(s => s === 3).length, c.timeline.extinguished);
  assert.ok(ignited(r) < ignited(run()), 'fewer buildings catch fire with the BFP');
});
test('put-out buildings stay out and no longer spread fire', () => {
  const c = ctx.create(), r = run(() => c.hook);
  const firstOut = r.frames.findIndex(f => f.states.includes(3)), id = r.frames[firstOut].states.indexOf(3);
  assert.ok(r.frames.slice(firstOut).every(f => f.states[id] === 3));
});
test('the truck position moves from the station along its route', () => {
  const c = ctx.create();
  run(() => c.hook);
  const d = c.timeline.drives[0];
  assert.equal(BFP.truckAt(c.timeline, 0).state, 'station');
  assert.equal(BFP.truckAt(c.timeline, (d.times[0] + d.times.at(-1)) / 2).state, 'driving');
});
console.log(`All ${n} BFP tests passed.`);
