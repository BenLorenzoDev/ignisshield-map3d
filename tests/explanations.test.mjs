// Explanations must describe the actual decisions without changing outcomes or the random sequence.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const F = createRequire(import.meta.url)('../public/fire.js');
const values = {bldg_dens: 0.6, bldg_mat: 3, humidity: 40, temp_c: 32, house_cnt: 2,
  wind_dir: 135, wind_spd: 18, alley_wd: 1.5, oxygen_v: 1};
const cells = Array.from({length: 16}, (_, id) => ({id, x: (id % 4) * 8, y: Math.floor(id / 4) * 8,
  area: 36, perimeter: 24, values: {...values}}));
const adjacency = new Map(cells.map(c => [c.id, cells.filter(t => t.id !== c.id).map(t => [t.id, Math.max(0, Math.hypot(c.x - t.x, c.y - t.y) - 6)])]));
function run(explain, suppression) {
  let calls = 0;
  const hook = suppression ? minute => { calls++; return {extinguish: minute === 2 ? [0] : [], protect: new Map([[15, 0.25]])}; } : null;
  const m = new F.FireModel(cells, adjacency, 0, 42, 1, 30, hook, explain);
  const frames = [[...m.states.values()]];
  while (!m.finished) { m.step(); frames.push([...m.states.values()]); }
  return {m, frames, calls};
}
for (const suppression of [false, true]) {
  const plain = run(false, suppression), traced = run(true, suppression);
  assert.deepEqual(traced.frames, plain.frames);
  assert.deepEqual(traced.m.timeline, plain.m.timeline);
  assert.deepEqual(traced.m.metrics(), plain.m.metrics());
  assert.equal(traced.m.rng.random(), plain.m.rng.random(), 'same random state after the run');
  assert.equal(traced.calls, plain.calls, 'recording must not call the suppression hook again');
  assert.equal(traced.m.explanations.length, traced.frames.length - 1);
  traced.m.explanations.forEach((step, k) => {
    assert.equal(step.from, k); assert.equal(step.to, k + 1);
    assert.ok(step.top.length <= 3);
    assert.ok(step.top.every((e, i, a) => !i || a[i - 1].probability >= e.probability));
    const changed = traced.frames[k + 1].flatMap((s, id) => s === 'burning' && traced.frames[k][id] === 'safe' ? [id] : []);
    assert.deepEqual(step.ignited.map(e => e.id), changed);
    for (const e of [...step.top, ...step.ignited]) {
      assert.equal(traced.frames[k][e.id], 'safe');
      assert.equal(traced.frames[k][e.sourceId], 'burning');
      assert.ok(!step.extinguished.includes(e.sourceId));
      assert.ok(e.probability >= 0 && e.probability <= 1);
      assert.ok(e.sourceCount >= 1);
    }
    for (const e of step.ignited) assert.ok(e.draw < e.probability);
    for (const e of step.top) assert.ok(!('draw' in e), 'risk rankings must not include future random draws');
    for (const id of step.extinguished) assert.equal(traced.frames[k + 1][id], 'extinguished');
  });
}
// With equal exposure, BFP wetting must be reflected in the displayed probability.
const small = cells.slice(0, 3).map(c => ({...c, values: {...values, wind_spd: 0}}));
const neighbours = new Map([[0, [[1, 2], [2, 2]]], [1, []], [2, []]]);
const wet = new F.FireModel(small, neighbours, 0, 42, 1, 2,
  () => ({protect: new Map([[1, 0.25]])}), true);
wet.step();
const damp = wet.explanations[0].top.find(e => e.id === 1), dry = wet.explanations[0].top.find(e => e.id === 2);
assert.equal(damp.protection, 0.25);
assert.ok(damp.probability < dry.probability);
assert.ok(Math.abs(damp.probability - (1 - (1 - dry.probability) ** 0.25)) < 1e-12);
assert.equal(damp.windFactor, 1);
console.log('Explanation checks passed: identical outcomes and RNG, correct event timing, ranked risks, BFP protection.');
