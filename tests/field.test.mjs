// Checks GPX cleanup (public/field.js) on synthetic walks. Run: node tests/field.test.mjs
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const F = require('../public/field.js');
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
const mE = 1 / (111320 * Math.cos(10.51 * Math.PI / 180));
// points every second along an east-west line; speed in m/s; optional time gaps
function gpx(segments) {
  let t = Date.parse('2026-09-22T06:00:00Z') / 1000, x = 0;
  const pts = [];
  for (const {seconds, speed, gap = 0} of segments) {
    t += gap;
    for (let s = 0; s < seconds; s++) { pts.push(`<trkpt lat="10.508" lon="${(123.712 + x * mE).toFixed(7)}"><ele>5</ele><time>${new Date(t * 1000).toISOString()}</time></trkpt>`); t += 1; x += speed; }
  }
  return `<gpx><metadata><name>Mark</name></metadata><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}
test('walking is kept, riding is dropped', () => {
  const r = F.cleanWalk(gpx([{seconds: 120, speed: 1.2}, {seconds: 120, speed: 8}, {seconds: 120, speed: 1.2}]));
  assert.ok(r.stats.riddenKm > 0.8 && r.stats.riddenKm < 1.1, `ridden ${r.stats.riddenKm}`);
  assert.equal(r.stats.lines, 2);
  assert.ok(r.stats.walkedKm > 0.2 && r.stats.walkedKm < 0.32, `walked ${r.stats.walkedKm}`);
});
test('a GPS gap splits the line instead of drawing a straight jump', () => {
  const r = F.cleanWalk(gpx([{seconds: 60, speed: 1.2}, {seconds: 60, speed: 1.2, gap: 120}]));
  assert.equal(r.stats.lines, 2);
  assert.equal(r.stats.gaps, 1);
});
test('no times or names are kept, only coordinates and the date', () => {
  const r = F.cleanWalk(gpx([{seconds: 60, speed: 1.2}]));
  const json = JSON.stringify(r.geometry);
  assert.ok(!/T\d\d:|Mark/.test(json));
  assert.equal(r.walkedOn, '2026-09-22');
});
test('standing still is thinned to a few points', () => {
  const r = F.cleanWalk(gpx([{seconds: 30, speed: 1.2}, {seconds: 300, speed: 0.02}, {seconds: 30, speed: 1.2}]));
  assert.ok(r.stats.kept < 40, `kept ${r.stats.kept}`);
});
test('a Strava route file (no times) is refused with advice', () => {
  assert.throws(() => F.cleanWalk('<gpx><trkpt lat="1" lon="2"></trkpt><trkpt lat="1.1" lon="2"></trkpt></gpx>'), /Strava route/);
});
const at = (e, nn) => [123.712 + e * mE, 10.508 + nn / 110540];
test('walks along a road add nothing; a walk into an alley becomes one path joined to the road', () => {
  const road = [at(0, 0), at(200, 0)];
  const along = [[at(10, 1), at(60, -1), at(120, 1)]];
  assert.equal(F.tracksToPaths([along], [road]).length, 0);
  // leave the road at x = 50, walk 40 m north (with GPS wobble), come back down the same alley, rejoin the road
  const out = [at(50, 1), at(51, 10), at(49, 20), at(51, 30), at(50, 40), at(49, 30), at(51, 20), at(50, 10), at(50, 1)];
  const made = F.tracksToPaths([[out]], [road]);
  assert.equal(made.length, 1, 'the way back is not a second path');
  const first = made[0][0];
  assert.ok(Math.abs(first[1] - 10.508) < 1e-7, 'starts exactly on the road');
});
console.log(`All ${n} field tests passed.`);
