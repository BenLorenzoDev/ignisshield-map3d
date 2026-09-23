// One-time: extract water areas (sea, rivers, ponds) and bridges around Sitio Polo from OpenFreeMap vector tiles
// (OpenStreetMap data, ODbL) into public/data/water.geojson. Run: node scripts/water.mjs
import {VectorTile} from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import {writeFileSync} from 'node:fs';

const BBOX = [123.702, 10.498, 123.727, 10.522]; // covers the mapped buildings and roads
const Z = 14;
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const url = tj.tiles[0];
const t2x = lon => Math.floor((lon + 180) / 360 * 2 ** Z);
const t2y = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** Z); };
const features = [];
for (let x = t2x(BBOX[0]); x <= t2x(BBOX[2]); x++) for (let y = t2y(BBOX[3]); y <= t2y(BBOX[1]); y++) {
  const buf = Buffer.from(await (await fetch(url.replace('{z}', Z).replace('{x}', x).replace('{y}', y))).arrayBuffer());
  const tile = new VectorTile(new Protobuf(buf));
  const water = tile.layers.water;
  if (water) for (let i = 0; i < water.length; i++) {
    const f = water.feature(i).toGeoJSON(x, y, Z);
    features.push({type: 'Feature', geometry: f.geometry, properties: {kind: 'water', class: f.properties.class ?? 'water'}});
  }
  const tr = tile.layers.transportation;
  if (tr) for (let i = 0; i < tr.length; i++) {
    const vf = tr.feature(i);
    if (vf.properties.brunnel !== 'bridge') continue;
    const f = vf.toGeoJSON(x, y, Z);
    features.push({type: 'Feature', geometry: f.geometry, properties: {kind: 'bridge', class: vf.properties.class}});
  }
}
const round = c => (typeof c[0] === 'number' ? [+c[0].toFixed(6), +c[1].toFixed(6)] : c.map(round));
for (const f of features) f.geometry.coordinates = round(f.geometry.coordinates);
writeFileSync('public/data/water.geojson', JSON.stringify({type: 'FeatureCollection', source: 'OpenStreetMap via OpenFreeMap (ODbL), zoom 14 tiles', features}));
const count = k => features.filter(f => f.properties.kind === k).length;
console.log(`water areas ${count('water')}, bridges ${count('bridge')}`, [...new Set(features.map(f => f.properties.class))].join(', '));
