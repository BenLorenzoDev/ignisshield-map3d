// Checks the draft paper-unit conversions and output mapping in public/paper.js.
// Run: node tests/paper.test.mjs
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const P = require('../public/paper.js');
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

const base = {Db: null, Mb: 900, O2: 1, Hr: 70, Ta: 30, Nh: 1, Wr: 3, Uw: 4.2, Tw: 45};
const local = {Db: 0.002, meanArea: 100};

test('wind speed m/s becomes km/h (x3.6)', () => assert.equal(P.toModel({...base, Uw: 10}, local).wind_spd, 36));
test('fuel load thresholds pick material classes', () => {
  assert.deepEqual([0, 699, 700, 1099, 1100, 5000].map(P.materialClass), [1, 1, 2, 2, 3, 3]);
});
test('measured density x average footprint gives coverage', () => assert.equal(P.toModel(base, local).bldg_dens, 0.2));
test('entered density overrides the measured one and coverage is capped at 1', () => {
  assert.equal(P.toModel({...base, Db: 0.004}, local).bldg_dens, 0.4);
  assert.equal(P.toModel({...base, Db: 0.05}, local).bldg_dens, 1);
});
test('direct inputs pass through unchanged', () => {
  const m = P.toModel({...base, O2: 0.8, Hr: 55, Ta: 33, Nh: 4, Wr: 1.5, Tw: 225}, local);
  assert.deepEqual([m.oxygen_v, m.humidity, m.temp_c, m.house_cnt, m.alley_wd, m.wind_dir], [0.8, 55, 33, 4, 1.5, 225]);
});
test('out-of-range and non-integer inputs are refused', () => {
  assert.throws(() => P.toModel({...base, O2: 5}, local), /Oxygen availability/);
  assert.throws(() => P.toModel({...base, Nh: 1.5}, local), /whole number/);
  assert.throws(() => P.toModel({...base, Uw: 50}, local), /Wind speed/);
});
test('every draft trial converts to valid model inputs', () => {
  const F = require('../public/fire.js');
  for (const [k, t] of Object.entries(P.TRIALS)) F.validate(P.toModel(t.values, local)), assert.ok(t.level, k);
});
test('severity levels use the paper names', () => {
  assert.deepEqual([0, 0.099, 0.1, 0.29, 0.3, 0.59, 0.6, 1].map(P.level), ['Low', 'Low', 'Moderate', 'Moderate', 'High', 'High', 'Catastrophic', 'Catastrophic']);
});
test('outputs Y1..Y8 carry the paper units, Tsim in min/s/h and Q in MW/kW', () => {
  const o = P.outputs({Fire_Severity_Index: 0.35, Fire_Intensity: 120, Fire_Spread_Rate: 2.5, Heat_Release_Rate: 1.25, Burned_Area_M2: 900,
    Spread_Direction_Deg: 90, Mean_Building_Burn_Min: 12.4, Burning_Duration_Min: 90});
  assert.deepEqual(o.map(x => x.sym), ['Sf (Y1)', 'If (Y2)', 'R (Y3)', 'Q (Y4)', 'Ab (Y5)', 'φs (Y6)', 'τb (Y7)', 'Tsim (Y8)']);
  assert.equal(o[0].text, '0.35 · High');
  assert.equal(o[3].text, '1.25 MW · 1,250 kW');
  assert.equal(o[5].text, '90 (E)');
  assert.equal(o[7].text, '90 min · 5,400 s · 1.5 h');
});
test('buildings saved in model units migrate to paper fields', () => {
  const p = {bldg_mat: 3, oxygen_v: 1.2, house_cnt: 2, alley_wd: 1.5, bldg_dens: 0.4};
  assert.equal(P.migrate(p), true);
  assert.deepEqual(p, {Mb: 1300, O2: 1.2, Nh: 2, Wr: 1.5});
  assert.equal(P.migrate(p), false);
});
console.log(`All ${n} paper conversion tests passed.`);
