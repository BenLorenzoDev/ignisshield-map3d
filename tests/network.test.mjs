// Checks prepareNetwork (public/routing.js): field-surveyed paths join the road network correctly.
// Run: node tests/network.test.mjs
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const R = require('../public/routing.js');
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
const mE = 1 / (111320 * Math.cos(10.51 * Math.PI / 180)), mN = 1 / 110540; // degrees per metre
const at = (e, nn) => [123.712 + e * mE, 10.508 + nn * mN];
const road = (id, a, b, coords, extra = {}) => ({type: 'Feature', geometry: {type: 'MultiLineString', coordinates: [coords]},
  properties: {id, kind: 'road', from_node: a, to_node: b, alley_wd: 4, walk_ok: 1, access_ok: 1, oneway: 0, ...extra}});
const path = (id, coords, extra = {}) => ({type: 'Feature', geometry: {type: 'LineString', coordinates: coords}, properties: {id, width_m: 1, access: 'walk', ...extra}});

// A straight 100 m road running east, with a side road going north from its east end
const roads = [road('r1', 'A', 'B', [at(0, 0), at(50, 0), at(100, 0)]), road('r2', 'B', 'C', [at(100, 0), at(100, 60)])];

test('no paths: roads come back unchanged (routing still matches IgnisShield-Web)', () => {
  const out = R.prepareNetwork(roads, []);
  assert.equal(out.length, 2);
  assert.ok(out.every((f, i) => f === roads[i]));
});

test('a path ending partway along a road splits the road into a T-junction', () => {
  const out = R.prepareNetwork(roads, [path('p1', [at(30, 40), at(30, 20), at(30, 1.2)])]);
  const pieces = out.filter(f => f.properties.id.startsWith('r1~'));
  assert.equal(pieces.length, 2);
  const p1 = out.find(f => f.properties.id === 'p1');
  assert.equal(pieces[0].properties.from_node, 'A');
  assert.equal(pieces[0].properties.to_node, p1.properties.to_node);
  assert.equal(pieces[1].properties.from_node, p1.properties.to_node);
  assert.equal(pieces[1].properties.to_node, 'B');
  // the path end was moved exactly onto the road
  assert.deepEqual(p1.geometry.coordinates.at(-1), pieces[0].geometry.coordinates.at(-1));
});

test('routing walks through the new alley', () => {
  const out = R.prepareNetwork(roads, [path('p1', [at(30, 40), at(30, 1.2)])]);
  const g = R.buildGraph(out, [], [], {mode: 'Walking'});
  const start = out.find(f => f.properties.id === 'p1').properties.from_node;
  const r = R.route(g, {purpose: 'Evacuation', start, end: 'C'});
  assert.ok(r.optimized.edges.includes('p1'));
  assert.ok(Math.abs(r.optimized.length - (40 + 70 + 60)) < 1.5, `length ${r.optimized.length}`);
});

test('a fire engine cannot use a walk-only alley; a vehicle path it can', () => {
  const walk = R.prepareNetwork(roads, [path('p1', [at(30, 40), at(30, 1.2)])]);
  const node = walk.find(f => f.properties.id === 'p1').properties.from_node;
  assert.throws(() => R.route(R.buildGraph(walk, [], [], {mode: 'Fire engine'}), {purpose: 'Evacuation', start: node, end: 'C'}));
  const car = R.prepareNetwork(roads, [path('p1', [at(30, 40), at(30, 1.2)], {width_m: 3, access: 'vehicle'})]);
  const r = R.route(R.buildGraph(car, [], [], {mode: 'Fire engine'}), {purpose: 'Evacuation', start: node, end: 'C'});
  assert.ok(r.optimized.edges.includes('p1'));
});

test('path ends near a junction reuse it; path ends meet each other', () => {
  const out = R.prepareNetwork(roads, [path('p1', [at(0, 30), at(1.5, 1)]), path('p2', [at(0, 30.8), at(-20, 50)])]);
  const p1 = out.find(f => f.properties.id === 'p1'), p2 = out.find(f => f.properties.id === 'p2');
  assert.equal(p1.properties.to_node, 'A');           // 1.8 m from junction A
  assert.equal(p2.properties.from_node, p1.properties.from_node); // 0.8 m apart
  assert.equal(out.filter(f => f.properties.id.startsWith('r1')).length, 1); // no split needed
});

test('a path can end on another path (split of the path)', () => {
  const out = R.prepareNetwork(roads, [path('p1', [at(30, 40), at(30, 1.2)]), path('p2', [at(60, 20), at(30.8, 20)])]);
  assert.equal(out.filter(f => f.properties.id.startsWith('p1~')).length, 2);
  const g = R.buildGraph(out, [], [], {mode: 'Walking'});
  const r = R.route(g, {purpose: 'Evacuation', start: out.find(f => f.properties.id === 'p2').properties.from_node, end: 'A'});
  assert.ok(r.optimized.minutes > 0);
});

test('works with the real inventory roads: a path between two real roads builds a valid graph', () => {
  const real = JSON.parse(readFileSync(new URL('../public/data/source.geojson', import.meta.url), 'utf8')).features.filter(f => f.properties.kind === 'road');
  const a = real[10].geometry.coordinates[0], b = real[40].geometry.coordinates[0];
  const mid = (l) => { const i = Math.floor((l.length - 1) / 2); return [(l[i][0] + l[i + 1][0]) / 2, (l[i][1] + l[i + 1][1]) / 2]; };
  const out = R.prepareNetwork(real, [path('p1', [mid(a), mid(b)])]);
  assert.equal(out.length, real.length + 1 + 2); // two roads split in two, plus the path
  const g = R.buildGraph(out, [], [], {mode: 'Walking'});
  assert.ok(g.graph.adj.size > 300);
});

console.log(`All ${n} network tests passed.`);
