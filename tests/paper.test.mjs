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
  for (const [k, t] of Object.entries(P.TRIALS)) { F.validate(P.toModel(t.values, local)); assert.equal(t.level, undefined, `${k}: severity is an output, not a preset`); }
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
test('a logged trial batch gives back its settings and values for every building', () => {
  const rec = {batch: 'b1', run_in_batch: 1, seed: 42, ignition: 'traced-1', max_minutes: 5, extent: 'all mapped buildings', n_buildings: 404,
    inputs: 'trial values, all buildings', scenario: 'Trial B conditions', bfp_response: 'off', Y1_Sf: 0.037,
    X1_Db: 0.0063, X2_Mb_MJ_m2: 600, X3_O2_ratio: 1, X4_Hr_pct: 80, X5_Ta_C: 28, X6_Nh: 1, X7_Wr_m: 1.8, X8_Uw_m_s: 2.1, X9_Tw_deg: 210};
  const s = P.rerunSettings([{...rec, run_in_batch: 3, seed: 44, Y1_Sf: 0.0947}, rec, {...rec, run_in_batch: 2, seed: 43, Y1_Sf: 0.039}]);
  assert.deepEqual([s.seed, s.repeats, s.minutes, s.boundaryOnly, s.mode], [42, 3, 5, false, 'all']);
  assert.deepEqual(s.expected, {42: 0.037, 43: 0.039, 44: 0.0947});
  assert.deepEqual(P.rerunPaperValues(s, {Mb: 900}), {Db: 0.0063, Mb: 600, O2: 1, Hr: 80, Ta: 28, Nh: 1, Wr: 1.8, Uw: 2.1, Tw: 210});
});
test('a logged custom batch keeps each building\'s own values and a measured density', () => {
  const rec = {batch: 'b2', run_in_batch: 1, seed: 42, inputs: 'per building + weather', extent: 'study boundary', bfp_response: 'off',
    X1_Db: 'measured 0.01521', X2_Mb_MJ_m2: 700, X3_O2_ratio: 1, X4_Hr_pct: 71, X5_Ta_C: 29, X6_Nh: 1, X7_Wr_m: 2, X8_Uw_m_s: 1.1, X9_Tw_deg: 259};
  const s = P.rerunSettings([rec]);
  assert.equal(s.values.Db, null);
  assert.equal(s.boundaryOnly, true);
  assert.deepEqual(P.rerunPaperValues(s, {Db: null, Mb: 900, O2: 1, Nh: 2, Wr: 3, Hr: 50, Ta: 20, Uw: 9, Tw: 0}),
    {Db: null, Mb: 900, O2: 1, Nh: 2, Wr: 3, Hr: 71, Ta: 29, Uw: 1.1, Tw: 259});
  assert.throws(() => P.rerunSettings([{...rec, bfp_response: 'on'}]), /BFP/);
});
console.log(`All ${n} paper conversion tests passed.`);
