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

  // ---------- Trials A–D (paper Table 1): input CONDITIONS. Numbers are DRAFT placeholders: the paper describes them only in words.
  // The severity level is an output of each run (Sf, Y1), never an input.
  const TRIALS = {
    A: {text: 'Baseline: moderate density, lower fuel load, high humidity, calm wind, wider alleys.',
      values: {Db: null, Mb: 600, O2: 1, Hr: 85, Ta: 27, Nh: 1, Wr: 4, Uw: 1, Tw: 45}},
    B: {text: 'More flammable construction; wind speed and temperature moderately higher.',
      values: {Db: null, Mb: 900, O2: 1, Hr: 70, Ta: 31, Nh: 2, Wr: 3, Uw: 4, Tw: 45}},
    C: {text: 'Denser buildings, narrower alleys, lower humidity, stronger wind (SW monsoon direction).',
      values: {Db: 0.004, Mb: 1200, O2: 1, Hr: 55, Ta: 33, Nh: 2, Wr: 1.5, Uw: 7, Tw: 225}},
    D: {text: 'Worst case: maximum density, highly combustible materials, minimal humidity, high heat, strong wind, narrowest alleys.',
      values: {Db: 0.006, Mb: 1500, O2: 1.2, Hr: 35, Ta: 36, Nh: 3, Wr: 1, Uw: 10, Tw: 225}}
  };

  // ---------- plain-language help for each input (shown beside the form) ----------
  // "sim" and now() follow the model's own formulas in fire.js (susceptibility, ignitionRate, burn duration).
  const MATERIAL_NAME = {1: 'concrete', 2: 'mixed', 3: 'wood/nipa'};
  const burnMinutes = m => (4 + 3 * m.bldg_mat + Math.log1p(m.house_cnt)) * (0.8 + m.humidity / 200) / Math.sqrt(m.oxygen_v);
  const x2 = v => `×${v.toFixed(2)}`;
  const INFO = {
    Db: {
      what: 'How tightly packed the buildings are around this one: structures per square metre of ground. 0.002 means about 20 buildings in a 100 m × 100 m block.',
      get: 'Leave it blank and the app counts the buildings within 30 m on the map. Or count the structures in a measured area on site.',
      sim: 'Turned into the share of ground covered by roofs. Crowded buildings catch fire from each other more easily. It also slows walking and fire-truck travel on nearby roads.',
      up: 'Denser → fire spreads more easily.',
      now: (x, m) => `${Math.round(m.bldg_dens * 100)} % of the ground within 30 m is roof → ignition ${x2(0.6 + 1.2 * m.bldg_dens)}.`
    },
    Mb: {
      what: 'How much can burn in this building, per square metre of floor: furniture, clothes and stored goods, plus light walls and roofs of wood, plywood, bamboo or tarpaulin.',
      get: 'Typical: concrete house with little inside 500–700; mixed 700–1,100; wood, nipa or plywood 1,100–1,600 or more. 1 kg of dry wood ≈ 17.5 MJ.',
      sim: `Draft rule: sorted into a material class (below ${RULES.fuelClassMJ[0]} concrete, below ${RULES.fuelClassMJ[1]} mixed, above that wood/nipa). The class sets how easily the building ignites (×0.35 / ×0.85 / ×1.4), how long it burns and how much heat it gives off.`,
      up: 'More fuel → catches faster, burns longer and hotter.',
      now: (x, m) => `class ${m.bldg_mat} (${MATERIAL_NAME[m.bldg_mat]}) → ignition ${x2({1: 0.35, 2: 0.85, 3: 1.4}[m.bldg_mat])}, burns about ${Math.round(burnMinutes(m))} min once alight.`
    },
    O2: {
      what: 'How much air can reach a fire inside. 1 = normal open air (20.9 % oxygen). Below 1: closed, cramped rooms with few openings. Above 1: open-sided structures or strong through-draughts.',
      get: 'Most houses are 0.8–1.2. Use below 1 for sealed concrete rooms, above 1 for open sheds, stalls or houses on stilts.',
      sim: 'Multiplies how easily the building ignites and how much heat it gives off. More air also makes it burn out sooner.',
      up: 'More air → hotter, faster fire that burns out sooner.',
      now: (x, m) => `ignition and heat ${x2(m.oxygen_v)}; burn time ${x2(1 / Math.sqrt(m.oxygen_v))}.`
    },
    Hr: {
      what: 'Moisture in the air. Rainy days are often 80–90 %; dry summer afternoons can drop to 50–60 %.',
      get: 'Press “Use live weather”, or read it from PAGASA or a weather app for the day you are simulating.',
      sim: 'Dry air lets walls and roofs catch more easily. Humid air slightly lowers heat output and makes buildings burn a little longer.',
      up: 'More humid → fire spreads more slowly.',
      now: (x, m) => `dryness factor ${x2(0.25 + 0.75 * (1 - m.humidity / 100))} on ignition (dry 0 % = ×1.00).`
    },
    Ta: {
      what: 'Outdoor air temperature. Balamban is usually 25–33 °C.',
      get: 'Press “Use live weather”, or use PAGASA or a weather app.',
      sim: 'Warmer materials ignite a little more easily: about 2 % more per °C above 25 °C.',
      up: 'Hotter → spreads slightly faster.',
      now: (x, m) => `temperature factor ${x2(Math.exp((m.temp_c - 25) / 45))} on ignition.`
    },
    Nh: {
      what: 'How many households live in this one structure. A building split into three rented rooms counts as 3.',
      get: 'Ask residents or the barangay; count doors or electric meters.',
      sim: 'More households mean more belongings to burn: slightly easier ignition and a longer burn.',
      up: 'More households → a little easier to ignite, burns longer.',
      now: (x, m) => `household factor ${x2(0.7 + 0.3 * Math.log1p(m.house_cnt))} on ignition.`
    },
    Wr: {
      what: 'Width of the alley or road beside this building: the gap a fire has to cross to reach it.',
      get: 'Measure the narrowest point with a tape measure. Many interior alleys in Polo are 1 m or less.',
      sim: 'The gap is one of the strongest effects in the model: ignition ×2 ÷ (width + 0.7). A 1 m alley is about twice as easy for fire to cross as a 3 m road.',
      up: 'Wider → harder for fire to cross.',
      now: (x, m) => `gap factor ${x2(2 / (m.alley_wd + 0.7))} on ignition (1 m alley = ×1.18, 3 m = ×0.54).`
    },
    Uw: {
      what: 'Wind speed. About 1 m/s is a calm breeze, 4 m/s moves leaves and small branches, 8 m/s is strong, and typhoon winds are over 17 m/s.',
      get: 'Press “Use live weather”, or use PAGASA or a weather app. The forecast is measured 10 m above ground; wind in narrow alleys is usually lower.',
      sim: 'Pushes the fire downwind: buildings downwind become more likely to catch, upwind ones less. Stronger wind also lets fire jump across wider gaps.',
      up: 'Stronger → faster spread downwind and longer jumps.',
      now: (x, m) => `downwind ignition up to ${x2(Math.exp(Math.min(2, 0.9 * m.wind_spd / 30)))}, upwind ${x2(Math.exp(-Math.min(2, 0.9 * m.wind_spd / 30)))}; a jump of ${Math.round(6 + 0.4 * m.wind_spd)} m keeps about a third of its strength.`
    },
    Tw: {
      what: 'Direction the wind blows FROM, in degrees clockwise from north: 0 = N, 90 = E, 180 = S, 270 = W. The Amihan (Nov–Apr) comes from about 45° (NE); the Habagat (Jun–Oct) from about 225° (SW).',
      get: 'Press “Use live weather”, or read it from a weather app (it shows where the wind comes from).',
      sim: 'The fire leans the opposite way: it spreads mostly toward the direction the wind blows to.',
      up: 'Sets which neighbours are downwind.',
      now: (x, m) => { const c = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], i = d => c[Math.round(d / 45) % 8]; return `wind from ${i(m.wind_dir)} → the fire is pushed toward ${i((m.wind_dir + 180) % 360)}.`; }
    }
  };

  // ---------- plain-language help for each output Y1..Y8 (same order as outputs()) ----------
  const OUT_INFO = [
    {what: 'One overall score for how bad the fire was, from 0 (nothing burned) to 1 (everything burned).',
      how: 'The share of the floor area of all buildings in the run that caught fire. Below 0.1 is Low, below 0.3 Moderate, below 0.6 High, otherwise Catastrophic.',
      read: 'It depends on how many buildings are in the run: the same fire scores higher when only the study boundary is included.'},
    {what: 'How much heat the fire front gives off per metre of its edge: how hard it would be to approach or fight.',
      how: 'At the worst minute: the heat output of all burning buildings divided by the total length of their outlines. An estimate from assumed heat per m², not a measurement.',
      read: 'Higher means a fiercer front that is harder to get close to.'},
    {what: 'How fast the fire front moved away from the building where it started.',
      how: 'The farthest distance the fire reached from the start, divided by the minutes it took to get there.',
      read: 'Multiply by 60 for metres per hour. Compare it with how long the fire truck needs to arrive.'},
    {what: 'The total heat being given off by everything burning, at the worst minute of the fire.',
      how: 'For every burning building: floor area × 80 kW/m² × material factor × dryness × ventilation, added up. An estimate from assumed values, not a measurement.',
      read: 'Shown in megawatts (MW) and kilowatts (kW): 1 MW = 1,000 kW.'},
    {what: 'The total floor area of all buildings that caught fire.',
      how: 'Adds up the footprint area of every building that ignited, including any still burning when the run ended.',
      read: 'Divide by about 60–100 m² to get a rough number of homes.'},
    {what: 'The main direction the fire spread from the starting building, in degrees clockwise from north.',
      how: 'The average direction from the starting building to every building that burned, weighted by each building’s area.',
      read: 'Usually close to the direction the wind blows toward, unless buildings or gaps steer the fire another way.'},
    {what: 'How long a building keeps burning once it catches fire, on average.',
      how: 'The model gives each building a burn time from its material, number of households, humidity and ventilation; this is the average over the buildings that ignited. Draft definition, pending the students’ formula.',
      read: 'Longer burning gives the fire more time to reach neighbours, and firefighters more to put out.'},
    {what: 'How long the simulated fire lasted, from the first flame until it went out or the run limit was reached.',
      how: 'The minutes simulated by the model, shown in minutes, seconds and hours. It is the modelled fire time, not how long the computer took.',
      read: 'If it equals the maximum model minutes you set, the fire was still burning when the run stopped.'}
  ];

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

  const api = {INPUTS, BY_KEY, DEFAULTS, RULES, RULE_TEXT, TRIALS, OUTPUT_NOTES, INFO, OUT_INFO, materialClass, localDensity, check, toModel, level, outputs, migrate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IgnisPaper = api;
})(globalThis);
