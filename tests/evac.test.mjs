// Checks public/evac.js on a tiny synthetic street grid. Run: node tests/evac.test.mjs
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const E = require('../public/evac.js');
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
const mE = 1 / (111320 * Math.cos(10.51 * Math.PI / 180)), mN = 1 / 110540;
const at = (e, nn) => [123.712 + e * mE, 10.508 + nn * mN];
const road = (id, a, b, p, q, highway = 'residential') => ({type: 'Feature', geometry: {type: 'MultiLineString', coordinates: [[p, q]]},
  properties: {id, kind: 'road', from_node: a, to_node: b, alley_wd: 3, walk_ok: 1, access_ok: 1, oneway: 0, highway}});
const house = (e, nn) => ({type: 'Feature', geometry: {type: 'Polygon', coordinates: [[at(e - 4, nn - 4), at(e + 4, nn - 4), at(e + 4, nn + 4), at(e - 4, nn + 4), at(e - 4, nn - 4)]]}, properties: {}});
// Main road runs north-south at x = 200. Two lanes lead to it from a junction at (0, 0): one along y = 0, one along y = 60.
const roads = [
  road('main1', 'M1', 'S', at(200, -100), at(200, 0), 'tertiary'),
  road('main2', 'S', 'N', at(200, 0), at(200, 60), 'tertiary'),
  road('main3', 'N', 'M2', at(200, 60), at(200, 160), 'tertiary'),
  road('south', 'J', 'S', at(0, 0), at(200, 0)),
  road('link', 'J', 'N0', at(0, 0), at(0, 60)),
  road('north', 'N0', 'N', at(0, 60), at(200, 60))
];
// house 0 beside the junction; house 1 next to the southern lane (it will burn)
const features = [house(-10, 0), house(100, -12)];
const frames = (states) => states.map((s, m) => ({minute: m, states: Uint8Array.from(s)}));
const prep = extra => E.prepare({features, densities: [0, 0], households: [2, 1], roads, ...extra});

test('residents leave when the fire comes close and walk to the main road', () => {
  const ev = prep().evaluate(frames([[1, 0], [1, 0], [2, 0]]));
  const g = ev.groups.find(x => x.i === 0);
  assert.equal(g.depart, 0);
  assert.equal(g.status, 'safe');
  assert.equal(g.to, 'the main road');
  assert.equal(g.people, 10); // 2 households × 5
  assert.ok(g.arrive > g.depart);
});
test('routes avoid streets next to a burning building', () => {
  // house 1 burns from minute 0: the southern lane is blocked, so house 0 goes north around it
  const ev = prep().evaluate(frames([[0, 1], [1, 1]]));
  const g = ev.groups.find(x => x.i === 0);
  assert.equal(g.status, 'safe');
  assert.ok(g.coords.some(c => Math.abs(c[1] - at(0, 60)[1]) < 1e-7), 'takes the northern lane');
});
test('with every way out blocked, residents are counted as cut off', () => {
  const blockedRoads = roads.filter(r => !['link', 'north'].includes(r.properties.id)); // only the burning southern lane is left
  const ev = E.prepare({features, densities: [0, 0], households: [1, 1], roads: blockedRoads}).evaluate(frames([[0, 1], [1, 1]]));
  assert.equal(ev.groups.find(x => x.i === 0).status, 'trapped');
  assert.equal(ev.summary.trapped, 5);
});
test('a nearer safe area is used instead of the main road', () => {
  const ev = prep({safePoints: [{lonlat: at(0, 60), name: 'Court'}]}).evaluate(frames([[1, 0]]));
  assert.equal(ev.groups.find(x => x.i === 0).to, 'Court');
});
test('position moves along the route over time', () => {
  const g = prep().evaluate(frames([[1, 0]])).groups.find(x => x.i === 0);
  assert.equal(E.positionAt(g, -1), null);
  assert.equal(E.positionAt(g, (g.depart + g.arrive) / 2).state, 'moving');
  assert.equal(E.positionAt(g, g.arrive + 1).state, 'arrived');
});
console.log(`All ${n} evacuation tests passed.`);
