/* The research paper's variables (Chapter 2, Notations) and the DRAFT rules that turn them into the
 * IgnisShield model's inputs. The paper gives no formulas yet, so every conversion below is a provisional,
 * disclosed assumption kept in this one file. Replace them when the students supply their equations.
 * Paper unit typos fixed here: alley/road width is metres (paper says °), wind direction is degrees (paper says metres). */
(function (root) {
  const F = typeof module !== 'undefined' && module.exports ? require('./fire.js') : root.IgnisFire;

  // X1..X9 in the paper's order. scope: 'building' = per structure, 'weather' = whole scenario.
  const INPUTS = [
    {key: 'Db', sym: 'Db (X1)', name: 'Building density', unit: 'structures/m²', scope: 'building', min: 0, max: 0.1, step: 0.0001, auto: true,
      help: 'Blank = measured from the map: structures whose centre is within 30 m, per m².'},
    {key: 'Mb', sym: 'Mb (X2)', name: 'Fuel load density', unit: 'MJ/m²', scope: 'building', min: 0, max: 5000, step: 10, def: 900,
      help: 'Burnable energy per m² of floor, including light walls and roof (wood ≈ 17.5 MJ/kg).'},
    {key: 'O2', sym: 'O₂ (X3)', name: 'Oxygen availability', unit: 'ratio φO₂', scope: 'building', min: 0.1, max: 2, step: 0.05, def: 1,
      help: '1 = normal open air (20.9 % O₂). Below 1 = enclosed / poorly ventilated; above 1 = extra airflow.'},
    {key: 'Hr', sym: 'Hr (X4)', name: 'Relative humidity', unit: '%', scope: 'weather', min: 0, max: 100, step: 1, def: 70},
    {key: 'Ta', sym: 'Ta (X5)', name: 'Ambient temperature', unit: '°C', scope: 'weather', min: -10, max: 60, step: 0.1, def: 30},
    {key: 'Nh', sym: 'Nh (X6)', name: 'Number of houses', unit: 'count in this structure', scope: 'building', min: 1, max: 1000, step: 1, def: 1},
    {key: 'Wr', sym: 'Wr (X7)', name: 'Alley/road width', unit: 'm', scope: 'building', min: 0.1, max: 50, step: 0.1, def: 3},
    {key: 'Uw', sym: 'Uw (X8)', name: 'Wind speed', unit: 'm/s', scope: 'weather', min: 0, max: 41.6, step: 0.1, def: 4.2},
    {key: 'Tw', sym: 'Θw (X9)', name: 'Wind direction', unit: '° (blowing FROM, N = 0)', scope: 'weather', min: 0, max: 360, step: 1, def: 45}
  ];
  const BY_KEY = Object.fromEntries(INPUTS.map(v => [v.key, v]));
  const DEFAULTS = Object.fromEntries(INPUTS.filter(v => 'def' in v).map(v => [v.key, v.def]));

  // ---------- DRAFT conversion rules (paper units -> model inputs) ----------
  const RULES = {
    densityRadiusM: 30,           // Db measured from structures whose centroid lies within this radius
    fuelClassMJ: [700, 1100],     // Mb below 700 -> material 1 (concrete), below 1100 -> 2 (mixed), else 3 (wood/nipa)
    woodMJPerKg: 17.5,            // shown as a kg/m² wood-equivalent beside Mb
    airO2Percent: 20.9,           // φO₂ = O₂ % / 20.9
    kmhPerMs: 3.6                 // Uw m/s -> model km/h (exact)
  };
  const RULE_TEXT = [
    'Db → model coverage fraction: Db × average footprint area of the structures within 30 m (capped at 1).',
    `Mb → model material class: below ${RULES.fuelClassMJ[0]} MJ/m² = 1 concrete, below ${RULES.fuelClassMJ[1]} = 2 mixed, otherwise 3 wood/nipa.`,
    'O₂ → model ventilation multiplier: φO₂ used directly (1 = 20.9 % O₂).',
    'Uw → model km/h: × 3.6.   Nh, Wr, Hr, Ta, Θw: used directly.'
  ];

  const materialClass = mb => (mb < RULES.fuelClassMJ[0] ? 1 : mb < RULES.fuelClassMJ[1] ? 2 : 3);

  /** Measured Db and the average footprint area around each building (projected metres). */
  function localDensity(features) {
    const fp = F.footprints(features), R = RULES.densityRadiusM, area = Math.PI * R * R;
    const cell = new Map(), key = (x, y) => `${Math.floor(x / R)},${Math.floor(y / R)}`;
    fp.forEach((c, i) => { const k = key(c.x, c.y); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(i); });
    return fp.map(c => {
      let n = 0, sum = 0;
      const gx = Math.floor(c.x / R), gy = Math.floor(c.y / R);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const j of cell.get(`${gx + dx},${gy + dy}`) || []) {
          if (Math.hypot(fp[j].x - c.x, fp[j].y - c.y) <= R) { n++; sum += fp[j].area; }
        }
      }
      return {Db: n / area, meanArea: sum / n};
    });
  }

  function check(key, value) {
    const v = BY_KEY[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < v.min || value > v.max || (v.step === 1 && !Number.isInteger(value))) {
      throw new Error(`${v.sym} ${v.name} must be ${v.step === 1 ? 'a whole number' : 'a number'} from ${v.min} to ${v.max} ${v.unit.split(' ')[0]}.`);
    }
    return value;
  }

  /** Paper values (Db may be null = measured) -> the nine model inputs. local = localDensity() entry. */
  function toModel(x, local) {
    for (const k of Object.keys(BY_KEY)) if (!(k === 'Db' && (x.Db === null || x.Db === undefined))) check(k, x[k]);
    const Db = x.Db ?? local.Db;
    return {
      bldg_dens: Math.round(Math.min(1, Db * local.meanArea) * 1e6) / 1e6,
      bldg_mat: materialClass(x.Mb),
      oxygen_v: x.O2,
      humidity: x.Hr,
      temp_c: x.Ta,
      house_cnt: x.Nh,
      alley_wd: x.Wr,
      wind_spd: x.Uw * RULES.kmhPerMs,
      wind_dir: x.Tw
    };
  }

  // ---------- Trials A–D (paper Table 1). Numbers are DRAFT placeholders: the paper describes them only in words. ----------
  const TRIALS = {
    A: {level: 'Low', text: 'Baseline: moderate density, lower fuel load, high humidity, calm wind, wider alleys.',
      values: {Db: null, Mb: 600, O2: 1, Hr: 85, Ta: 27, Nh: 1, Wr: 4, Uw: 1, Tw: 45}},
    B: {level: 'Moderate', text: 'More flammable construction; wind speed and temperature moderately higher.',
      values: {Db: null, Mb: 900, O2: 1, Hr: 70, Ta: 31, Nh: 2, Wr: 3, Uw: 4, Tw: 45}},
    C: {level: 'High', text: 'Denser buildings, narrower alleys, lower humidity, stronger wind (SW monsoon direction).',
      values: {Db: 0.004, Mb: 1200, O2: 1, Hr: 55, Ta: 33, Nh: 2, Wr: 1.5, Uw: 7, Tw: 225}},
    D: {level: 'Catastrophic', text: 'Worst case: maximum density, highly combustible materials, minimal humidity, high heat, strong wind, narrowest alleys.',
      values: {Db: 0.006, Mb: 1500, O2: 1.2, Hr: 35, Ta: 36, Nh: 3, Wr: 1, Uw: 10, Tw: 225}}
  };

  // ---------- outputs Y1..Y8 ----------
  const LEVELS = [[0.1, 'Low'], [0.3, 'Moderate'], [0.6, 'High'], [Infinity, 'Catastrophic']]; // model.py thresholds; "Extreme" renamed per the paper
  const level = sf => LEVELS.find(([hi]) => sf < hi)[1];
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const fmt = (v, d = 2) => Number(v.toFixed(d)).toLocaleString('en-US', {maximumFractionDigits: d});

  /** The paper's eight outputs from a run's metrics. Values keep full precision for export. */
  function outputs(m) {
    const sf = m.Fire_Severity_Index, dir = m.Spread_Direction_Deg, t = m.Burning_Duration_Min;
    return [
      {sym: 'Sf (Y1)', name: 'Fire severity index', value: sf, text: `${fmt(sf, 3)} · ${level(sf)}`, unit: '0–1'},
      {sym: 'If (Y2)', name: 'Fire line intensity', value: m.Fire_Intensity, text: fmt(m.Fire_Intensity), unit: 'kW/m'},
      {sym: 'R (Y3)', name: 'Fire spread rate', value: m.Fire_Spread_Rate, text: fmt(m.Fire_Spread_Rate), unit: 'm/min'},
      {sym: 'Q (Y4)', name: 'Heat release rate', value: m.Heat_Release_Rate, text: `${fmt(m.Heat_Release_Rate)} MW · ${fmt(m.Heat_Release_Rate * 1000, 0)} kW`, unit: 'MW / kW'},
      {sym: 'Ab (Y5)', name: 'Total burned area', value: m.Burned_Area_M2, text: fmt(m.Burned_Area_M2, 1), unit: 'm²'},
      {sym: 'φs (Y6)', name: 'Spread direction', value: dir, text: dir === '' ? '—' : `${fmt(dir, 1)} (${COMPASS[Math.round(dir / 45) % 8]})`, unit: '°'},
      {sym: 'τb (Y7)', name: 'Burning duration', value: m.Mean_Building_Burn_Min, text: fmt(m.Mean_Building_Burn_Min, 1), unit: 'min per building'},
      {sym: 'Tsim (Y8)', name: 'Total simulation time', value: t, text: `${fmt(t, 0)} min · ${fmt(t * 60, 0)} s · ${fmt(t / 60, 2)} h`, unit: 'min / s / h'}
    ];
  }
  const OUTPUT_NOTES = [
    'Sf = share of the run\'s building floor area that ignited (0–1). Levels: below 0.1 Low, below 0.3 Moderate, below 0.6 High, otherwise Catastrophic.',
    'If and Q are peak values; both are model proxies from assumed heat output per m², not measurements.',
    'τb = average time an ignited building burns (draft definition). Tsim = modelled time from ignition until the fire is out or the run limit is reached.'
  ];

  /** Old per-building fields (model units) -> paper fields, for buildings saved before this version. */
  function migrate(p) {
    let changed = false;
    const move = (from, to, f = v => v) => { if (typeof p[from] === 'number') { if (p[to] === undefined) p[to] = f(p[from]); delete p[from]; changed = true; } };
    move('bldg_mat', 'Mb', c => ({1: 500, 2: 900, 3: 1300})[c]);
    move('oxygen_v', 'O2');
    move('house_cnt', 'Nh');
    move('alley_wd', 'Wr');
    if ('bldg_dens' in p) { delete p.bldg_dens; changed = true; } // now measured from the map (Db)
    return changed;
  }

  const api = {INPUTS, BY_KEY, DEFAULTS, RULES, RULE_TEXT, TRIALS, OUTPUT_NOTES, materialClass, localDensity, check, toModel, level, outputs, migrate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IgnisPaper = api;
})(globalThis);
