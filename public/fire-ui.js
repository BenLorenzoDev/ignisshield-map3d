/* global drawing, pathDraft, cloud, canEdit, requireEdit, map, store, storeVersion, studyData, selected, saveStore, select, showHint, updatePanel, STOREY_M, FIRE, buildingColor, empty, $, IgnisFire, IgnisPaper */
// Fire scenario UI: the paper's inputs, Trials A–D, repeated runs, playback and the run log.
const P = IgnisPaper;
const SCENARIO_KEY = 'ignisshield-map3d.scenario';
const LOG_KEY = 'ignisshield-map3d.runs';
const LOG_LIMIT = 1000;

const fui = {
  xInputs: $('#x-inputs'), inputsNote: $('#inputs-note'), ignite: $('#ignite'),
  source: $('#scenario-source'), trialText: $('#trial-text'),
  resetTrial: $('#reset-trial'), runInputs: $('#run-inputs'), rules: $('#rules'),
  boundaryOnly: $('#boundary-only'), panelClose: $('#panel-close'), guide: $('#guide'), guideHide: $('#guide-hide'), help: $('#help-btn'),
  playback: $('#playback'), play: $('#play'), restart: $('#restart'), frame: $('#frame'), minute: $('#minute'),
  speed: $('#speed'), status: $('#run-status'), windArrow: $('#wind-arrow'), windText: $('#wind-text'),
  metrics: $('#metrics'), headline: $('#result-headline'), bfpSummary: $('#bfp-summary'), results: $('#results'), runningNote: $('#running-note'), skip: $('#skip-results'), clearFire: $('#clear-fire'), batchRun: $('#batch-run'), outputNotes: $('#output-notes'),
  logBtn: $('#log-btn'), log: $('#log'), logBody: $('#log-body'), logCount: $('#log-count'),
  logCsv: $('#log-csv'), logClear: $('#log-clear'),
  live: $('#weather-block'), wxLoad: $('#wx-load'), wxHour: $('#wx-hour'), wxStatus: $('#wx-status')
};

// ---------- scenario settings (saved in this browser) ----------
const RUN_FIELDS = [
  {key: 'seed', name: 'Replay number', unit: '', min: 0, max: 2147483647, step: 1},
  {key: 'repeats', name: 'Number of runs', unit: '', min: 1, max: 20, step: 1}
];
const draftTrials = () => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(P.TRIALS).map(([k, t]) => [k, t.values]))));
function loadScenario() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SCENARIO_KEY)) || {}; } catch { /* use defaults */ }
  if ('humidity' in s) { // settings saved by an older version, in model units
    s = {custom: {Hr: s.humidity, Ta: s.temp_c, Tw: s.wind_dir, Uw: Math.round(s.wind_spd / 3.6 * 10) / 10}, seed: s.seed, minutes: s.minutes};
  }
  const weather = Object.fromEntries(P.INPUTS.filter(v => v.scope === 'weather').map(v => [v.key, v.def]));
  return {source: 'custom', seed: 42, repeats: 3, minutes: 60, speed: '0.5', boundaryOnly: false, ...s,
    custom: {...weather, ...s.custom}, trials: {...draftTrials(), ...s.trials}};
}
const scenario = loadScenario();
const saveScenario = () => { try { localStorage.setItem(SCENARIO_KEY, JSON.stringify(scenario)); } catch { /* session only */ } };

function readField(v, input, allowBlank = false) {
  if (allowBlank && input.value === '') return null;
  return P.check(v.key, input.value === '' ? NaN : Number(input.value));
}

/** Run settings (step 2) and anything else that depends on the scenario, then the open building form. */
function renderScenario() {
  fui.runInputs.innerHTML = RUN_FIELDS.map(v => `<label class="field" data-info="${v.key}"><span>${v.name} <span class="x-i">ⓘ</span></span><input id="run-${v.key}" type="number" min="${v.min}" max="${v.max}" step="${v.step}" value="${scenario[v.key]}"></label>`).join('');
  fui.boundaryOnly.checked = scenario.boundaryOnly;
  renderSim();
  if (typeof renderBfpForm === 'function') renderBfpForm();
  updateWind();
  if (selected()) updatePanel();
}
fui.rules.innerHTML = P.RULE_TEXT.map(t => `<li>${t}</li>`).join('');
const simMinutes = $('#sim-minutes'), simSpeed = $('#sim-speed'), simNote = $('#sim-note');
function renderSim() {
  simMinutes.value = scenario.minutes;
  simSpeed.value = scenario.speed;
  fui.speed.value = scenario.speed;
  const x = Math.round(Number(scenario.speed) * 60), watch = scenario.minutes / Number(scenario.speed) / 60; // real minutes to watch
  simNote.textContent = x <= 1
    ? `Plays in real time: people walk at their true pace and the ${scenario.minutes}-minute fire takes ${scenario.minutes} minutes to watch.`
    : `Plays ${x}× faster than real time: the ${scenario.minutes}-minute fire takes about ${watch < 1 ? Math.round(watch * 60) + ' seconds' : Math.round(watch * 10) / 10 + ' minutes'} to watch.`;
  simNote.textContent += ' Playback slows on busy devices to keep each fire step visible.';
}
simMinutes.addEventListener('change', () => {
  const n = Number(simMinutes.value);
  if (!Number.isInteger(n) || n < 1 || n > 240) { showHint('Simulation time must be a whole number of minutes from 1 to 240.', 6000); renderSim(); return; }
  scenario.minutes = n; saveScenario(); renderSim();
});
simSpeed.addEventListener('change', () => { scenario.speed = simSpeed.value; saveScenario(); renderSim(); });
fui.outputNotes.innerHTML = P.OUTPUT_NOTES.map(t => `<li>${t}</li>`).join('');

fui.runInputs.addEventListener('change', e => {
  const v = RUN_FIELDS.find(f => `run-${f.key}` === e.target.id);
  const n = Number(e.target.value);
  if (e.target.value === '' || !Number.isInteger(n) || n < v.min || n > v.max) { showHint(`${v.name} must be a whole number from ${v.min} to ${v.max}.`, 6000); e.target.value = scenario[v.key]; return; }
  scenario[v.key] = n; saveScenario();
});
fui.boundaryOnly.addEventListener('change', () => { scenario.boundaryOnly = fui.boundaryOnly.checked; saveScenario(); });
fui.resetTrial.addEventListener('click', () => {
  if (!requireEdit()) return;
  scenario.trials[scenario.source] = draftTrials()[scenario.source];
  saveScenario(); shareTrials(); renderScenario();
});
let trialsTimer = null;
function shareTrials() {
  if (!cloud.enabled) return;
  clearTimeout(trialsTimer);
  trialsTimer = setTimeout(() => cloud.saveSetting('trials', scenario.trials).catch(err => showHint(`Could not share the trial values: ${err.message}`, 8000)), 500);
}

// Right-hand panels: only one open at a time
const SIDE = {log: [fui.logBtn, fui.log]};
function openSide(name) {
  for (const [key, [btn, panel]] of Object.entries(SIDE)) {
    const open = key === name && panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-pressed', String(open));
  }
  if (typeof onSideChange === 'function') onSideChange(name);
}
fui.logBtn.addEventListener('click', () => { renderLog(); openSide('log'); });

// ---------- step 1: the nine inputs X1–X9 for the selected building ----------
let densityCache = {version: -1, byId: null};
function measuredDensity() {
  if (densityCache.version !== storeVersion) {
    const list = P.localDensity(store.features);
    densityCache = {version: storeVersion, byId: new Map(store.features.map((f, i) => [f.properties.id, list[i]]))};
  }
  return densityCache.byId;
}
const BUILDING_FIELDS = P.INPUTS.filter(v => v.scope === 'building');
const num = v => (typeof v === 'number' ? v : '');

/** One table row: symbol, meaning, value box, unit (the paper's Notations table). */
function inputRow(v, value, placeholder, note) {
  const weather = v.scope === 'weather';
  return `<label class="x-row${weather ? ' weather' : ''}" data-key="${v.key}" data-info="${v.key}">` +
    `<span class="x-sym">${v.sym.replace(/ \((X\d)\)/, ' <i>$1</i>')}</span>` +
    `<span class="x-name">${v.name} <span class="x-i" aria-hidden="true">ⓘ</span>${weather ? ' <em>whole fire</em>' : ''}${note ? `<small>${note}</small>` : ''}</span>` +
    `<input id="x-${v.key}" type="number" min="${v.min}" max="${v.max}" step="${v.step}" value="${num(value)}" placeholder="${placeholder}">` +
    `<span class="x-unit">${v.unit.split(' (')[0].replace('count in this structure', 'count')}</span></label>`;
}

function renderInputs(f) {
  const trial = P.TRIALS[scenario.source], p = f.properties, local = measuredDensity().get(p.id);
  fui.source.value = scenario.source;
  fui.trialText.textContent = trial
    ? `Trial ${scenario.source} conditions (paper Table 1): ${trial.text} These nine values are used for every building in the run. Draft numbers: the paper gives none${cloud.enabled ? '. Shared by the class.' : '.'} The severity is not set here: the simulation works it out.`
    : 'X1, X2, X3, X6 and X7 belong to this building. X4, X5, X8 and X9 are the weather for the whole fire.';
  const values = trial ? scenario.trials[scenario.source] : {...Object.fromEntries(BUILDING_FIELDS.map(v => [v.key, p[v.key]])), ...scenario.custom};
  const signature = `${p.id}|${scenario.source}|${canEdit()}`;
  const rows = P.INPUTS.map(v => ({v,
    placeholder: v.auto ? local.Db.toFixed(4) : (trial ? '' : String(v.def)),
    note: v.auto && values.Db == null ? 'measured from the map'
      : v.key === 'Mb' ? `≈ ${Math.round((values.Mb ?? v.def) / P.RULES.woodMJPerKg)} kg/m² of wood` : v.key === 'O2' ? '1 = normal air (20.9 % O₂)' : ''}));
  if (fui.xInputs.dataset.signature !== signature) {
    fui.xInputs.innerHTML = rows.map(r => inputRow(r.v, values[r.v.key], r.placeholder, r.note)).join('');
    fui.xInputs.dataset.signature = signature;
  } else {
    for (const r of rows) {
      const el = document.getElementById(`x-${r.v.key}`);
      if (el !== document.activeElement) el.value = num(values[r.v.key]);
      el.placeholder = r.placeholder;
      const small = el.closest('.x-row').querySelector('.x-name small');
      if (small) small.textContent = r.note;
    }
  }
  // Who may change what: building values and class trial values need an editor; custom weather is this device only
  fui.xInputs.querySelectorAll('input').forEach(el => {
    const scope = P.BY_KEY[el.id.slice(2)].scope;
    el.disabled = trial ? (cloud.enabled && !canEdit()) : scope === 'building' && !canEdit();
  });
  renderWeather(values, trial);
  fui.resetTrial.hidden = !trial || (cloud.enabled && !canEdit());
  if (infoAnchor) setTimeout(() => showInfo(infoAnchor), 0);
  let m;
  try { m = P.toModel(buildingPaperValues(f), local); } catch (err) { fui.inputsNote.textContent = err.message; return; }
  $('#material-current').textContent = `Model material: class ${m.bldg_mat} · ${['', 'Concrete / lower fuel', 'Mixed / medium fuel', 'Wood, nipa or plywood / higher fuel'][m.bldg_mat]}`;
  $('#material-source').textContent = trial ? `From Trial ${scenario.source}: ${values.Mb} MJ/m². Assumed for every building; actual construction is not verified.`
    : typeof p.Mb === 'number' ? `From entered fuel load: ${p.Mb} MJ/m². Field verification is not recorded.`
      : `From default fuel load: ${P.DEFAULTS.Mb} MJ/m². An assumption; actual construction is unknown.`;
  fui.inputsNote.innerHTML = [
    `The model uses: coverage ${m.bldg_dens.toFixed(2)}, material ${m.bldg_mat} (${['', 'concrete', 'mixed', 'wood/nipa'][m.bldg_mat]}), wind ${m.wind_spd.toFixed(1)} km/h.`,
    trial ? '' : (p.inputs_src === 'entered' ? 'Some building values entered by you.' : 'Grey numbers are defaults (assumptions, not measurements): type to replace them.')
  ].filter(Boolean).join(' ');
}

fui.source.addEventListener('change', () => { scenario.source = fui.source.value; saveScenario(); renderScenario(); });
fui.xInputs.addEventListener('change', e => {
  const f = selected(), v = P.BY_KEY[e.target.id.slice(2)], trial = P.TRIALS[scenario.source];
  try {
    if (trial) {
      if (!requireEdit()) { updatePanel(); return; }
      scenario.trials[scenario.source][v.key] = readField(v, e.target, v.auto);
      saveScenario(); shareTrials();
    } else if (v.scope === 'weather') {
      scenario.custom[v.key] = readField(v, e.target);
      scenario.custom.source = 'Weather edited by hand.';
      saveScenario();
    } else {
      if (!requireEdit()) { updatePanel(); return; }
      const value = e.target.value === '' ? null : readField(v, e.target);
      if (value === null) delete f.properties[v.key]; else f.properties[v.key] = value;
      f.properties.inputs_src = 'entered';
      saveStore();
    }
  } catch (err) { showHint(err.message, 6000); }
  updateWind();
  updatePanel();
});

// ---------- information card: explains any element marked data-info (inputs, settings, weather, outputs) ----------
// Plain-language help for the controls that are not paper inputs (X1–X9 are in paper.js INFO, outputs in OUT_INFO)
const HELP = {
  preset: {title: 'Preset',
    what: 'Where the nine input values come from. Custom uses this building’s own values (X1, X2, X3, X6, X7) plus the weather. Trial A–D are the paper’s four experimental conditions (Table 1): the same nine values for every building.',
    get: 'Use Custom to explore a real situation. For the paper’s experiments, pick each Trial and run it three times (Run settings), then compare the results in the Run log.',
    sim: 'Only changes which inputs go in. The fire severity is always worked out by the simulation: it is an output, never chosen here.'},
  weather: {title: 'Wind & weather', sub: 'X4, X5, X8, X9',
    what: 'The weather during the fire: humidity, temperature, wind speed and wind direction. It is the same for every building.',
    get: '“Use live forecast” loads the current conditions or any hour of the next two days for Sitio Polo (Open-Meteo). Or set the wind with the dial and slider, or type the values in the table.',
    sim: 'Dry, hot air makes buildings easier to ignite; the wind pushes the fire downwind and lets it jump wider gaps.'},
  seed: {title: 'Replay number', sub: 'called the “random seed” in research',
    what: 'The simulation is probabilistic, like the paper’s probabilistic cellular automaton: every minute the inputs give each building next to the fire a probability of catching (for example 6.6 % per minute for a house 10 m away in a 4.2 m/s wind). Whether it actually catches is then decided the way real fires are uncertain: embers, open windows and what is stacked inside cannot be known in advance. The replay number fixes that sequence of decisions, so the same inputs and number always reproduce exactly the same fire.',
    get: 'Keep 42 to start. Note the replay number of any run you present, so it can be shown again exactly. Anyone with your inputs and this number can check your result.',
    sim: 'It does not change the probabilities: the nine inputs do. It only makes a run repeatable. Without it every press of Start would give a different fire, so results could not be checked, and comparing Trial A with Trial B would mix the effect of the inputs with chance. In the CSV export this column is called “seed”, the usual research term.'},
  repeats: {title: 'Number of runs',
    what: 'How many times to simulate the same inputs, each with the next replay number (42, 43, 44, …). Each run is one possible outcome of the same conditions.',
    get: 'The paper runs each trial three times; more runs give a more reliable result. Report the average and the spread (± SD) from the Run log, not a single run.',
    sim: 'Together the runs show the typical outcome and how much it can vary, which is how probabilistic simulations, weather forecasts and engineering risk studies report their results.'},
  minutes: {title: 'Simulation time',
    what: 'The longest time the simulated fire is allowed to burn (1–240 minutes).',
    get: 'Use 60 for a first look. Try the time the fire truck needs to arrive to see what burns before help comes.',
    sim: 'The run stops earlier if the fire goes out. Total simulation time (Y8) can never be longer than this.'},
  evac: {title: 'Evacuation on foot',
    what: 'Where the residents go. When the fire comes within 30 m of a building, or the building itself catches, its residents leave and walk to the nearest safe place: a safe area set by the class (Routes panel) or the main road, which the paper describes as cemented and passable. People per building = households (X6) × 5, the Baliwagan average (2026 census).',
    get: 'White figures represent groups walking to safety. The counts include everyone, even when figures or labels overlap. These are not death counts. Solid green lines follow mapped roads and alleys; dashed house connections bend around mapped buildings and water. If a clear connection cannot be found, the group is marked Path unknown. Door locations and passage access still need field checking.',
    sim: 'Each family steps out of its door onto the nearest road or alley it can reach without crossing water or passing a burning house, then walks the network (roads plus the alleys from the GPS walks). They see where the fire is: streets beside burning buildings are closed, streets within 30 m of the fire are avoided, and every minute they check the way ahead — if the fire has blocked it, they turn back or take another street. It does not change the fire. Times assume people leave at once and walk at 4.5 km/h; no crowding, so real evacuations are slower.'},
  bfp: {title: 'BFP fire truck response (optional)',
    what: 'Adds the Bureau of Fire Protection: the station receives the call and sends the selected number of trucks. Each drives on truck-usable roads, parks near the fire and sprays its own targets. The students’ paper model does not include this; leave it unticked for the paper’s runs.',
    get: 'Choose the number of actual trucks separately from each truck’s capacity. Call and turnout times, speed, hose reach and suppression capacity are draft assumptions. Editors set the station location.',
    sim: 'The truck uses the fire-truck road rules (width, access, one-way) and avoids streets beside the flames. It parks at the reachable road point closest to the fire, at least 10 m away, puts out the nearest burning buildings within reach and wets the others within reach so they catch 4× less easily. When nothing burns within reach it drives to the next part of the fire. The results compare the same fire with and without the BFP.'},
  'bfp-truckCount': {title: 'Number of fire trucks',
    what: 'The actual number of separate trucks in the response, from 1 to 10. Each numbered vehicle has its own road route, arrival time and water targets.',
    get: 'Use the number of trucks available for this scenario. This is separate from buildings put out per truck per minute.',
    sim: 'Trucks leave the same station six seconds apart, seek separate stand-by positions at least 8 m apart, and do not count the same extinguished building twice. Overlapping wetting does not multiply protection. These are fleet assumptions, not traffic or water-supply simulation.'},
  'bfp-callMin': {title: 'Call received after',
    what: 'Minutes from the first flame until the BFP receives the call: someone notices the fire, finds a phone and reports it.',
    get: 'Ask the BFP for their typical reporting delay in Sitio Polo. 3 minutes is a draft value; night-time fires are often reported later.',
    sim: 'Nothing happens before this minute. The whole response starts from it.'},
  'bfp-turnoutMin': {title: 'Crew turnout',
    what: 'Minutes from receiving the call until the truck leaves the station (crew gets dressed and aboard).',
    get: 'BFP stations aim for about 1 minute; ask the Balamban station.',
    sim: 'The first truck leaves at the first model step at or after call + turnout. Additional trucks are queued six seconds apart.'},
  'bfp-speedKmh': {title: 'Truck speed',
    what: 'Average driving speed of the fire truck on open roads.',
    get: '30 km/h is a draft for town streets; narrow or crowded roads are slower automatically.',
    sim: 'Travel time per road uses the same rules as the fire-engine routes (slower on narrow and crowded roads).'},
  'bfp-reachM': {title: 'Hose reach',
    what: 'How far from the parked truck the crew can bring water: hose length plus the water jet.',
    get: 'A few hose lengths of about 15–20 m each plus the jet; ask the BFP. 60 m is a draft value.',
    sim: 'Only burning buildings within this distance of the truck can be put out; safe buildings within it are wetted and catch 4× less easily.'},
  'bfp-perMin': {title: 'Buildings put out per truck per minute',
    what: 'How many burning buildings the crew can put out each minute while spraying.',
    get: 'Depends on water supply and hose lines; 1 per minute is a draft for one truck.',
    sim: 'Each minute the nearest burning buildings within reach are put out (they turn blue-grey and stop spreading fire).'},
  gpspaths: {title: 'Turn walks into escape paths',
    what: 'GPS walks are only a record of where students walked; evacuation cannot use them directly because phone GPS wobbles 3–5 m and walks go back and forth. This button turns them into proper paths that evacuation does use.',
    get: 'It keeps only the parts of the walks that are not already on a road or path (so the main road and alleys walked twice are not duplicated), smooths the wobble, and joins each end onto the road it meets. Each new path is a 1 m walking path marked “from GPS walk”: click it afterwards to enter the measured width, fix its position, or delete it.',
    sim: 'Residents step out of their door onto the nearest road or path, so the alleys give people near them a real way out (and people whose alley is blocked by fire are counted as cut off). Walks imported later can be converted again: only new parts are added.'},
  safe: {title: 'Safe areas',
    what: 'Places where people should gather in a fire: open spaces away from buildings, such as a covered court, plaza or school ground.',
    get: 'Editors click “Add safe area”, then the map. Name each one (e.g. “Baliwagan Covered Court”). Ask the BFP or barangay which places are official.',
    sim: 'Every evacuee walks to the quickest reachable safe area or the main road. A safe area stops counting if the fire gets within 16 m of it. It applies to fires started after it is added.'},
  speed: {title: 'Playback speed',
    what: 'How fast the simulated time plays on screen. The simulation itself always uses real minutes; this only changes how quickly you watch it.',
    get: '“Real time” shows people walking at their true pace (about 1.25 m/s) — a 60-minute fire then takes an hour to watch. 30× shows one simulated minute every 2 seconds, good for following people; 120× or more to see the whole fire spread quickly.',
    sim: 'The clock shows simulated minutes and seconds. On a busy device, playback slows to show every recorded fire step instead of jumping ahead; the calculated results stay the same.'},
  boundary: {title: 'Only buildings inside the study boundary',
    what: 'Limits the fire to the buildings inside the red dashed line, the study area of Sitio Polo.',
    get: 'Tick it for results about Sitio Polo only. Untick it to let the fire reach every mapped building around.',
    sim: 'Buildings outside cannot catch fire. The severity index (Y1) then compares the burned area with the study area only, so the same fire scores higher.'}
};
const infoCard = $('#input-info'), infoLine = $('#input-info-line');
let infoAnchor = null;   // element the card explains
let focusAnchor = null;  // element being typed in (the card returns to it after a hover)
const WIND_WORDS = [[0.5, 'calm'], [3.4, 'light breeze'], [5.5, 'gentle breeze'], [8, 'moderate breeze'], [10.8, 'fresh breeze'], [17.2, 'strong wind'], [Infinity, 'gale or typhoon']];
const windWords = ms => WIND_WORDS.find(([hi]) => ms < hi)[1];

function infoContent(key) {
  const sec = (h, t) => `<h4>${h}</h4><p>${t}</p>`;
  if (P.BY_KEY[key]) {
    const f = selected(), v = P.BY_KEY[key], info = P.INFO[key], trial = P.TRIALS[scenario.source];
    let now;
    try {
      const x = buildingPaperValues(f), el = document.getElementById(`x-${key}`);
      if (el && el.value !== '') x[key] = P.check(key, Number(el.value)); // preview the number being typed
      now = info.now(x, P.toModel(x, measuredDensity().get(f.properties.id)));
    } catch (err) { now = err.message; }
    return `<div class="info-head"><span class="x-sym">${v.sym}</span> ${v.name} <span class="info-unit">${v.unit}</span></div>
      ${v.scope === 'weather' ? '<div class="info-tag">Weather: the same value applies to every building in the fire.</div>' : ''}
      ${sec('What it is', info.what)}${sec('How to get the value', info.get)}${sec('How the simulation uses it', info.sim)}
      <p class="info-up">${info.up}</p>
      <h4>With the value${trial ? ` of Trial ${scenario.source}` : ''} now</h4><p class="info-now">${now}</p>
      ${['Mb', 'Db', 'O2'].includes(key) ? '<p class="muted small">The link from this paper unit to the model is a draft rule until the students give their formula.</p>' : ''}`;
  }
  if (key.startsWith('out-')) {
    const i = Number(key.slice(4)), o = P.outputs(run.result.metrics)[i], info = P.OUT_INFO[i];
    return `<div class="info-head"><span class="x-sym">${o.sym}</span> ${o.name} <span class="info-unit">${o.unit}</span></div>
      ${sec('What it means', info.what)}${sec('How it is calculated', info.how)}${sec('How to read it', info.read)}
      <h4>In this run</h4><p class="info-now">${outputNow(i, o)}</p>`;
  }
  const h = HELP[key];
  if (!h) return '';
  return `<div class="info-head">${h.title}${h.sub ? ` <span class="info-unit">${h.sub}</span>` : ''}</div>
    ${sec('What it is', h.what)}${sec('How to use it', h.get)}${sec('In the simulation', h.sim)}`;
}

/** A sentence about this run's value of output i. */
function outputNow(i, o) {
  const r = run.result, frames = r.frames, last = frames.at(-1), ignited = last.states.filter(s => s > 0).length;
  const peak = r.timeline.reduce((b, row) => (row.HRR_MW > b.HRR_MW ? row : b), r.timeline[0]);
  const toward = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((run.wind.Tw + 180) % 360) / 45) % 8];
  switch (i) {
    case 0: return `${o.text}: ${(o.value * 100).toFixed(1)} % of the floor area in this run caught fire (${ignited.toLocaleString()} of ${run.ids.length.toLocaleString()} buildings).`;
    case 1: return `${o.text} kW/m at the fiercest minute.`;
    case 2: return `${o.text} m/min ≈ ${Math.round(o.value * 60).toLocaleString()} m per hour.`;
    case 3: return `${o.text}, reached at minute ${peak.Minute} with ${peak.Burning} buildings burning at once.`;
    case 4: return `${o.text} m² across ${ignited.toLocaleString()} buildings.`;
    case 5: return `${o.text}; the wind was blowing toward ${toward}.`;
    case 6: return `Buildings in this run burned for ${o.text} minutes each on average.`;
    default: return r.status === 'Extinguished' ? `The fire went out after ${o.text}.` : `${o.text}: the fire was still burning when the run limit was reached.`;
  }
}

function showInfo(anchor) {
  const key = anchor?.dataset.info;
  if (!key || (P.BY_KEY[key] && !selected()) || (key.startsWith('out-') && !run)) { hideInfo(); return; }
  infoAnchor = anchor;
  infoCard.innerHTML = '<button class="info-close" aria-label="Close explanation">×</button>' + infoContent(key);
  infoCard.hidden = false;
  placeInfo();
}
function placeInfo() {
  if (infoCard.hidden || !infoAnchor) return;
  if (!document.body.contains(infoAnchor)) { // the form was redrawn: find the same item again
    infoAnchor = document.querySelector(`[data-info="${infoAnchor.dataset.info}"]`);
    if (!infoAnchor) { hideInfo(); return; }
  }
  // One predictable reading location; never follows the hovered field or cursor.
  infoCard.classList.toggle('sheet', window.innerWidth <= 700);
  infoCard.style.left = infoCard.style.top = '';
  infoLine.hidden = true;
}
function hideInfo() { infoAnchor = null; infoCard.hidden = infoLine.hidden = true; }
infoCard.addEventListener('click', e => { if (e.target.closest('.info-close')) hideInfo(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideInfo(); });

const helpZone = el => el?.closest?.('#panel, #playback, #routes');
document.addEventListener('mouseover', e => {
  if (e.target.closest?.('#input-info')) return;
  const a = e.target.closest?.('[data-info]');
  if (a && helpZone(a)) { if (a !== infoAnchor) showInfo(a); }
});
document.addEventListener('focusin', e => {
  const a = e.target.closest?.('[data-info]');
  if (a && helpZone(a)) { focusAnchor = a; showInfo(a); }
});
document.addEventListener('focusout', () => setTimeout(() => {
  const a = document.activeElement?.closest?.('[data-info]');
  if (!a || !helpZone(a)) focusAnchor = null;
}, 0));
fui.xInputs.addEventListener('input', () => { if (infoAnchor) setTimeout(() => showInfo(infoAnchor), 0); });
fui.xInputs.closest('#panel').addEventListener('scroll', placeInfo);
window.addEventListener('resize', placeInfo);

// ---------- wind dial and speed slider (write to X9 and X8, so the table and the dial always agree) ----------
const dial = $('#wind-dial'), speed = $('#wb-speed');
dial.querySelector('.dial-ticks').innerHTML = Array.from({length: 16}, (_, k) => {
  const a = k * 22.5 * Math.PI / 180, r1 = k % 4 ? 49 : 46;
  return `<line x1="${(Math.sin(a) * r1).toFixed(1)}" y1="${(-Math.cos(a) * r1).toFixed(1)}" x2="${(Math.sin(a) * 52).toFixed(1)}" y2="${(-Math.cos(a) * 52).toFixed(1)}"/>`;
}).join('');
function setInput(key, value) {
  const el = document.getElementById(`x-${key}`);
  if (!el || el.disabled) { showHint('These weather values come from the Trial preset and cannot be changed here.', 5000); return; }
  el.value = value;
  el.dispatchEvent(new Event('change', {bubbles: true}));
}
function dialAngle(e) {
  const r = dial.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  return (Math.round(Math.atan2(dx, -dy) * 180 / Math.PI / 5) * 5 + 360) % 360; // where the click is = where the wind comes from
}
dial.addEventListener('click', e => setInput('Tw', dialAngle(e)));
dial.addEventListener('keydown', e => {
  const step = {ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15}[e.key];
  if (!step) return;
  e.preventDefault();
  const cur = Number(document.getElementById('x-Tw')?.value) || 0;
  setInput('Tw', (cur + step + 360) % 360);
});
speed.addEventListener('input', () => { $('#wb-speed-val').textContent = `${Number(speed.value).toFixed(1)} m/s · ${windWords(Number(speed.value))}`; });
speed.addEventListener('change', () => setInput('Uw', Number(speed.value)));

/** Draw the dial, slider and summary for the wind in use. */
function renderWeather(values, trial) {
  const Tw = values.Tw ?? 0, Uw = values.Uw ?? 0, c = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], dir = d => c[Math.round(d / 45) % 8];
  dial.querySelector('#dial-arrow').setAttribute('transform', `rotate(${Tw})`);
  speed.value = Math.min(20, Uw);
  $('#wb-speed-val').textContent = `${Uw} m/s · ${windWords(Uw)}`;
  $('#wb-summary').innerHTML = `From <b>${dir(Tw)}</b> (${Tw}°) at <b>${Uw} m/s</b> (${(Uw * 3.6).toFixed(0)} km/h): the fire is pushed toward <b>${dir((Tw + 180) % 360)}</b>. Humidity ${values.Hr} %, ${values.Ta} °C.`;
  const locked = trial ? (cloud.enabled && !canEdit()) : false;
  dial.classList.toggle('locked', locked);
  speed.disabled = locked;
  fui.wxLoad.disabled = Boolean(trial);
  fui.wxLoad.title = trial ? 'The Trial preset has its own weather. Switch Preset to Custom to use the live forecast.' : '';
  fui.wxHour.hidden = Boolean(trial) || !forecast;
  fui.wxStatus.textContent = trial ? `Trial ${scenario.source} sets its own weather. Switch Preset to Custom to use the live forecast.` : (scenario.custom.source ?? 'Weather entered by hand.');
}

// ---------- close, and the "How to run a fire" guide ----------
const GUIDE_KEY = 'ignisshield-map3d.guide-hidden';
let guideHidden = (() => { try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch { return false; } })();
function updateGuide() {
  if (!selected()) hideInfo();
  const busy = Boolean(selected()) || !fui.playback.hidden || Boolean(drawing) || (typeof pathDraft !== 'undefined' && pathDraft);
  fui.guide.hidden = guideHidden || busy || !document.querySelector('#legend').hidden; // one card in that corner at a time
}
fui.guideHide.addEventListener('click', () => { guideHidden = true; try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* not remembered */ } updateGuide(); });
fui.help.addEventListener('click', () => { guideHidden = false; try { localStorage.removeItem(GUIDE_KEY); } catch { /* ignore */ } select(null); updateGuide(); });
fui.panelClose.addEventListener('click', () => select(null));

/** The nine paper inputs used for a building in the current scenario. */
function buildingPaperValues(f) {
  if (P.TRIALS[scenario.source]) return {...scenario.trials[scenario.source]};
  const p = f.properties, own = {};
  for (const v of BUILDING_FIELDS) own[v.key] = typeof p[v.key] === 'number' ? p[v.key] : (v.auto ? null : v.def);
  const {Hr, Ta, Uw, Tw} = scenario.custom;
  return {...own, Hr, Ta, Uw, Tw};
}
/** Model inputs for each feature, in the current scenario. Throws with the building's id when a value is invalid. */
function modelInputs(features) {
  const local = measuredDensity();
  return features.map(f => {
    try { return P.toModel(buildingPaperValues(f), local.get(f.properties.id)); }
    catch (err) { throw new Error(`Building ${f.properties.id}: ${err.message}`); }
  });
}

/**
 * Buildings taking part in a run: all saved buildings, or those whose centre is inside the study boundary.
 * Sorted by id so the same map and seed give the same run on every computer.
 */
function runBuildings() {
  const all = store.features.slice().sort((a, b) => (a.properties.id < b.properties.id ? -1 : a.properties.id > b.properties.id ? 1 : 0));
  if (!scenario.boundaryOnly) return all;
  const b = studyData.features.find(f => f.properties.kind === 'boundary');
  const ring = b.geometry.coordinates[0].map(IgnisFire.UTM);
  const fp = IgnisFire.footprints(all);
  return all.filter((f, i) => IgnisFire.inside([fp[i].x, fp[i].y], ring));
}

// ---------- wind indicator ----------
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function updateWind() {
  // during playback, describe the wind the run on screen used
  const w = run ? run.wind : P.TRIALS[scenario.source] ? scenario.trials[scenario.source] : scenario.custom;
  fui.windArrow.style.transform = `rotate(${(w.Tw + 180 - map.getBearing()) % 360}deg)`; // arrow points where the wind blows TO
  fui.windArrow.hidden = w.Uw === 0;
  fui.windText.textContent = w.Uw === 0 ? 'Calm · 0 m/s' : `Wind from ${COMPASS[Math.round(w.Tw / 45) % 8]} (${w.Tw}°) → toward ${COMPASS[Math.round(((w.Tw + 180) % 360) / 45) % 8]} · ${w.Uw} m/s`;
}
map.on('rotate', updateWind);

// ---------- run log ----------
function loadLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch { return []; } }
// Runs saved on this device have shared: false; in shared mode editors' runs come from Supabase (shared: true).
const runLog = loadLog().map(r => ({...r, shared: false}));
const sessionRuns = new Map(); // run id -> {result, features, ids}: frames are kept only for this session
function saveLog() {
  const local = runLog.filter(r => !r.shared);
  while (local.length > LOG_LIMIT) runLog.splice(runLog.indexOf(local.shift()), 1);
  try { localStorage.setItem(LOG_KEY, JSON.stringify(local)); } catch { showHint('Run log is too large for browser storage. Export it as CSV, then clear it.', 8000); }
  fui.logCount.textContent = runLog.length;
}
fui.logCount.textContent = runLog.length;

/** Shared mode: the class's trial values and run log. Called once the shared map has loaded. */
async function loadSharedData() {
  const [trials, runs] = await Promise.all([cloud.loadSetting('trials'), cloud.loadRuns()]);
  if (trials) { scenario.trials = {...draftTrials(), ...trials}; renderScenario(); }
  const have = new Set(runLog.map(r => r.id));
  runLog.push(...runs.filter(r => !have.has(r.id)));
  runLog.sort((a, b) => (a.utc < b.utc ? -1 : a.utc > b.utc ? 1 : 0));
  fui.logCount.textContent = runLog.length;
  if (!fui.log.hidden) renderLog();
}
function onRemoteRun(row) {
  if (runLog.some(r => r.id === row.id)) return;
  runLog.push({...row.record, id: row.id, by: row.created_by, shared: true});
  fui.logCount.textContent = runLog.length;
  if (!fui.log.hidden) renderLog();
}
function onRemoteSetting(row) {
  if (row?.key === 'bfp_station') { onRemoteBfpStation(row.value); return; }
  if (row?.key === 'safe_areas') { onRemoteSafeAreas(row.value); return; }
  if (row?.key !== 'trials') return;
  scenario.trials = {...draftTrials(), ...row.value};
  if (P.TRIALS[scenario.source]) renderScenario();
}

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => (a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / (a.length - 1)) : 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

function renderLog() {
  if (!runLog.length) { fui.logBody.innerHTML = '<p class="muted">No runs yet. Select a building and press Start fire here.</p>'; return; }
  const batches = [...new Set(runLog.map(r => r.batch))].reverse();
  fui.logBody.innerHTML = batches.map(batch => {
    const rows = runLog.filter(r => r.batch === batch);
    const r0 = rows[0], sf = rows.map(r => r.Y1_Sf), ab = rows.map(r => r.Y5_Ab_m2);
    const summary = rows.length > 1
      ? `<div class="muted small">Mean Sf ${mean(sf).toFixed(3)} ± ${sd(sf).toFixed(3)} (SD) · ${P.level(mean(sf))} · mean Ab ${Math.round(mean(ab)).toLocaleString()} m²</div>` : '';
    const owner = r0.shared ? ` · by ${esc(r0.by ?? 'class')}` : cloud.enabled ? ' · <i>this device only</i>' : '';
    return `<div class="batch"><div><b>${esc(r0.scenario)}</b> · start ${esc(r0.ignition)} · ${r0.n_buildings} buildings · ${new Date(r0.utc).toLocaleString()}${owner}</div>${summary}
      <table><thead><tr><th title="Replay number (random seed)">Replay #</th><th>Sf</th><th>Level</th><th>If kW/m</th><th>R m/min</th><th>Q MW</th><th>Ab m²</th><th>φs °</th><th>τb min</th><th>Tsim min</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.seed)}</td><td>${r.Y1_Sf.toFixed(3)}</td><td>${esc(r.level)}</td><td>${r.Y2_If_kW_m.toFixed(1)}</td><td>${r.Y3_R_m_min.toFixed(2)}</td><td>${r.Y4_Q_MW.toFixed(2)}</td><td>${Math.round(r.Y5_Ab_m2).toLocaleString()}</td><td>${r.Y6_phi_deg === '' ? '—' : esc(r.Y6_phi_deg)}</td><td>${r.Y7_tau_min.toFixed(1)}</td><td>${esc(r.Y8_Tsim_min)}</td>
        <td>${sessionRuns.has(r.id) ? `<button data-replay="${esc(r.id)}">Replay</button>` : '<span class="muted small" title="Frames are kept only in the session that ran them">—</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }).join('');
}
fui.logBody.addEventListener('click', e => { const id = e.target.dataset.replay; if (id) showRun(id); });
fui.logClear.addEventListener('click', () => {
  const local = runLog.filter(r => !r.shared).length;
  if (!local) { showHint(cloud.enabled ? 'No runs saved on this device. Shared class runs can only be removed in the Supabase dashboard.' : 'The log is empty.', 6000); return; }
  if (!window.confirm(`Delete the ${local} runs saved on this device${cloud.enabled ? ' (shared class runs stay)' : ''}? Export the CSV first if you need them.`)) return;
  for (let i = runLog.length - 1; i >= 0; i--) if (!runLog[i].shared) runLog.splice(i, 1);
  saveLog(); renderLog();
});
fui.logCsv.addEventListener('click', () => {
  if (!runLog.length) return;
  const cols = [...new Set(runLog.flatMap(r => Object.keys(r)))].filter(k => k !== 'id');
  const cell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const csv = [cols.join(','), ...runLog.map(r => cols.map(c => cell(r[c] ?? '')).join(','))].join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], {type: 'text/csv'})), download: `ignisshield-runs-${new Date().toISOString().slice(0, 10)}.csv`
  });
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- running ----------
let run = null;   // run being shown: {id, result, features, ids}
let fireStarting = false;
function buildingSelectionLocked() { return fireStarting || run !== null; }
let shown = null; // fire state currently drawn for each building
let frameIndex = 0;
let playTimer = null; // truthy while playing (route-ui checks it)
// Choose the playback resolution once, avoiding framebuffer resizes during gestures.
const STATE_NAMES = ['safe', 'burning', 'burned', 'extinguished'];

async function startFire() {
  if (buildingSelectionLocked()) return;
  const origin = selected();
  if (!origin) return;
  fireStarting = true;
  fui.ignite.disabled = true;
  fui.ignite.textContent = 'Calculating…';
  let evacCtx = null;
  await new Promise(r => setTimeout(r, 30)); // let the button repaint before the calculation
  try {
    await activity.stage('Preparing building inputs', 'Reading the selected buildings, weather and replay settings.');
    const sourceFeatures = runBuildings();
    const index = sourceFeatures.indexOf(origin);
    const features = structuredClone(sourceFeatures); // keep each run independent of later map edits
    if (index < 0) throw new Error('This building is outside the study boundary. Untick "Only buildings inside the study boundary" or choose another building.');
    const inputs = modelInputs(features);
    const runSettings = structuredClone(scenario);
    const batch = `b${Date.now()}`, utc = new Date().toISOString();
    const trial = P.TRIALS[scenario.source];
    const x = buildingPaperValues(origin), local = measuredDensity().get(origin.properties.id);
    const ids = features.map(f => f.properties.id);
    const w = trial ? scenario.trials[scenario.source] : scenario.custom, wind = {Tw: w.Tw, Uw: w.Uw}; // smoke drifts downwind
    const calculation = IgnisCalculationReport.capture(features, features.map(buildingPaperValues),
      features.map(f => measuredDensity().get(f.properties.id)), {utc, trial:trial?scenario.source:null,
        weatherSource:scenario.custom.source, originIndex:index, maxMinutes:scenario.minutes,
        extent:scenario.boundaryOnly?'Study boundary only':'All mapped buildings', bfp:bfpSettings()});
    await activity.stage('Preparing roads and escape paths', 'Building the route network for evacuation and any enabled BFP response.');
    // Evacuation on foot for every run (same network and residents for the whole batch)
    evacCtx = await prepareEvac(features, inputs, calculation.buildings.map(b => b.paper.Nh));
    calculation.bfp = structuredClone(evacCtx.bfpSettings);
    let first = null;
    const records = [];
    for (let k = 0; k < runSettings.repeats; k++) {
      const seed = runSettings.seed + k;
      const computed = await evacCtx.run({index, seed, minutes: runSettings.minutes, number: `${k + 1} of ${runSettings.repeats}`});
      const {result, evac, bfp: timeline, noBfpIgnited} = computed, es = evac?.summary;
      const id = `${batch}-${k}`;
      sessionRuns.set(id, {id, result, features, ids, seed, wind, inputs, evac, bfp: timeline, noBfpIgnited, calculation});
      const out = P.outputs(result.metrics);
      records.push({
        id, batch, utc, run_in_batch: k + 1, scenario: (trial ? `Trial ${runSettings.source} conditions` : 'Custom') + ' · surveyed routes',
        ignition: origin.properties.id, seed, max_minutes: runSettings.minutes, n_buildings: features.length,
        extent: runSettings.boundaryOnly ? 'study boundary' : 'all mapped buildings', inputs: trial ? 'trial values, all buildings' : 'per building + weather',
        X1_Db: x.Db ?? `measured ${local.Db.toFixed(5)}`, X2_Mb_MJ_m2: x.Mb, X3_O2_ratio: x.O2, X4_Hr_pct: x.Hr, X5_Ta_C: x.Ta,
        X6_Nh: x.Nh, X7_Wr_m: x.Wr, X8_Uw_m_s: x.Uw, X9_Tw_deg: x.Tw,
        weather_source: trial ? 'trial values' : (runSettings.custom.source ?? 'entered by hand'),
        Y1_Sf: out[0].value, level: P.level(out[0].value), Y2_If_kW_m: out[1].value, Y3_R_m_min: out[2].value, Y4_Q_MW: out[3].value,
        Y5_Ab_m2: out[4].value, Y6_phi_deg: out[5].value, Y7_tau_min: out[6].value, Y8_Tsim_min: out[7].value,
        evac_routing: evacCtx.routingMode,
        evac_people: es?.people ?? '', evac_reached_safety: es?.safe ?? '', evac_no_safe_route: es?.trapped ?? '', evac_no_mapped_path: es?.nopath ?? '',
        bfp_response: timeline ? 'on' : 'off', bfp_first_on_scene_min: timeline?.arrivals[0] ? +timeline.arrivals[0].minute.toFixed(2) : '',
        bfp_trucks: timeline?.truckCount ?? (timeline?1:0), bfp_buildings_per_truck_min: timeline?.params?.perMin ?? '',
        bfp_buildings_put_out: timeline ? timeline.extinguished : '', bfp_ignited_without: noBfpIgnited ?? '',
        evac_avg_min: es ? +es.avgMin.toFixed(2) : '', evac_max_min: es ? +es.maxMin.toFixed(2) : '', safe_areas: safeAreas.map(s => s.name).join('; '),
        status: result.status, model: result.model, calc_s: result.metrics.Total_Simulation_Time_Sec
      });
      first ??= id;
    }
    // Editors' runs go to the class log; everyone else's stay on this device
    let shared = false;
    if (cloud.enabled && cloud.editor) {
      try { await cloud.addRuns(records); shared = true; } catch (err) { showHint(`Could not add these runs to the class log (${err.message}); they are saved on this device.`, 9000); }
    }
    // The live echo of our own insert may already have added a run
    for (const r of records) if (!runLog.some(x => x.id === r.id)) runLog.push({...r, shared, by: shared ? cloud.user.email : undefined});
    saveLog();
    if (!fui.log.hidden) renderLog();
    fui.batchRun.innerHTML = Array.from({length: runSettings.repeats}, (_, k) => `<option value="${batch}-${k}">Run ${k + 1} of ${runSettings.repeats} · replay #${runSettings.seed + k}</option>`).join('');
    select(null);
    showRun(first);
  } catch (err) {
    activity.fail(err.message);
    showHint(`The fire model could not run: ${err.message}`, 9000);
  } finally {
    evacCtx?.dispose?.();
    fireStarting = false;
    fui.ignite.disabled = run !== null;
    fui.ignite.textContent = 'Start fire here';
  }
}

function showRun(id) {
  clearFire();
  run = sessionRuns.get(id);
  select(null);
  fui.ignite.disabled = true;
  activity.show(run);
  windFX.set(map, run.wind);
  prepareEffects(run);
  if (![...fui.batchRun.options].some(o => o.value === id)) {
    fui.batchRun.innerHTML = `<option value="${id}">Logged run · replay #${run.seed}</option>`;
  }
  fui.batchRun.value = id;
  shown = new Uint8Array(run.features.length);
  fui.frame.max = run.result.frames.length - 1;
  const outs = P.outputs(run.result.metrics), sf = outs[0].value, lvl = P.level(sf);
  // The severity is the result of the run (Y1), shown first
  fui.headline.innerHTML = `Final result: <span class="sev sev-${lvl.toLowerCase()}">${lvl}</span> severity · Sf ${sf.toFixed(3)} · ${Math.round(outs[4].value).toLocaleString()} m² burned · ${outs[7].text.split(' · ')[0]}`;
  fui.metrics.innerHTML = outs.map((o, i) =>
    `<div class="metric" data-info="out-${i}" tabindex="0"><span>${o.sym} ${o.name}</span><strong>${o.text}</strong><small>${o.unit}</small></div>`).join('');
  evacShow(run);
  bfpShow(run, run.features);
  fui.bfpSummary.innerHTML = bfpSummaryHtml(run, run.noBfpIgnited);
  fui.bfpSummary.hidden = !run.bfp;
  legendForFire();
  setResults(false);
  updateWind();
  fui.playback.hidden = false;
  updateGuide();
  displayMinute = 0;
  lastVisualMinute = lastVisualClock = NaN;
  lastFirePaintKey = '';
  paintPending = true;
  showFrame(0);
  play();
  lastTs = 0;
  rafId = requestAnimationFrame(loop);
}
fui.batchRun.addEventListener('change', () => showRun(fui.batchRun.value));

// ---------- fire effects ----------
// Each burning building grows from small flames to a full blaze and dies down to embers over the burn time the
// model gives it (ignition minute to burned-out minute). Flames and smoke are GPU sprites (fire-gl.js); the ground
// glow and the red/orange pulse of burning buildings are map layers.
let displayMinute = 0, clock = 0, lastTs = 0, lastPaint = 0, rafId = null;
let playbackRendered = false;
map.on('render', () => { playbackRendered = true; });
let lastVisualMinute = NaN, lastVisualClock = NaN, lastVisualView = '', paintPending = false;
/** Simulated time as mm:ss, and how much faster than real time it plays. */
function showClock() {
  if (!run) return;
  const s = Math.round(displayMinute * 60), end = run.result.frames.at(-1).minute;
  fui.minute.textContent = `Time ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} of ${end}:00`;
}

function prepareEffects(r) {
  const frames = r.result.frames, n = r.features.length;
  const ig = new Float32Array(n).fill(NaN), out = new Float32Array(n).fill(NaN);
  for (const f of frames) {
    for (let i = 0; i < n; i++) {
      const s = f.states[i];
      if (s > 0 && Number.isNaN(ig[i])) ig[i] = f.minute;
      if (s >= 2 && Number.isNaN(out[i])) out[i] = f.minute;
    }
  }
  const finished = [];
  for (let i = 0; i < n; i++) if (!Number.isNaN(out[i])) finished.push(out[i] - ig[i]);
  finished.sort((a, b) => a - b);
  const typical = finished.length ? finished[finished.length >> 1] : 12; // for buildings still burning at the end
  const dur = new Float32Array(n);
  for (let i = 0; i < n; i++) dur[i] = Math.max(1, Number.isNaN(out[i]) ? typical : out[i] - ig[i]);
  r.fx = {ig, out, dur, shapes: new Map()};
}
const phase = i => (i * 2.39996) % (2 * Math.PI); // golden-angle spread: neighbours flicker out of step
const seedOf = (i, k) => ((i * 0.618034 + k * 0.414214) % 1);

/** Centre, ground elevation and flame positions of building i (cached per run). Big roofs get several flames. */
function shapeOf(i) {
  let c = run.fx.shapes.get(i);
  if (c && c.alt !== null) return c;
  const f = run.features[i], ring = f.geometry.coordinates[0], n = ring.length - 1;
  let x = 0, y = 0;
  for (let k = 0; k < n; k++) { x += ring[k][0]; y += ring[k][1]; }
  x /= n; y /= n;
  const kx = 111320 * Math.cos(y * Math.PI / 180), ky = 110540;
  let a2 = 0;
  for (let k = 0; k < n; k++) a2 += (ring[k][0] - x) * kx * (ring[k + 1][1] - y) * ky - (ring[k + 1][0] - x) * kx * (ring[k][1] - y) * ky;
  const area = Math.abs(a2) / 2;
  const count = Math.max(1, Math.min(5, Math.round(area / 45)));
  const spots = count === 1 ? [[x, y]] : Array.from({length: count}, (_, k) => {
    const v = ring[Math.floor(k * n / count)];
    return [x + (v[0] - x) * 0.55, y + (v[1] - y) * 0.55];
  });
  const ground = map.getTerrain() ? map.queryTerrainElevation([x, y]) : 0;
  c = {centre: [x, y], spots, size: Math.sqrt(area / count), alt: ground, h: (f.properties.storeys ?? 1) * STOREY_M};
  run.fx.shapes.set(i, c);
  return c;
}

function showFrame(k) {
  playbackRendered = false;
  const quality = renderPerformance.profile;
  frameIndex = k;
  const frames = run.result.frames, states = frames[k].states, minute = frames[k].minute, {ig, out, dur} = run.fx;
  const flames = [], points = [], smoky = [];
  states.forEach((s, i) => {
    if (shown[i] !== s) { map.setFeatureState({source: 'buildings', id: run.ids[i]}, {fire: STATE_NAMES[s], ph: phase(i)}); shown[i] = s; }
    if (s === 1) {
      const c = shapeOf(i), alt = (c.alt ?? 0) + c.h;
      const effect = fireGL.profile(run.inputs[i], c.size);
      (quality.flames===1?[c.centre]:c.spots).forEach((lngLat, j) => flames.push({lngLat, alt, ...effect,
        seed: seedOf(i, j), ig: ig[i], dur: dur[i]}));
      points.push({type: 'Feature', geometry: {type: 'Point', coordinates: c.centre}, properties: {ig: ig[i], dur: dur[i], ph: phase(i)}});
    }
    if (s === 1 || (s >= 2 && minute - out[i] < 8)) smoky.push(i);
  });
  // Smoke follows the same saved weather and building inputs as the flames and spread.
  smoky.sort((a, b) => ig[b] - ig[a]);
  const puffs = [];
  for (const i of smoky.slice(0, quality.smoke)) {
    const c = shapeOf(i), effect = fireGL.profile(run.inputs[i], c.size);
    for (let j = 0; j < quality.puffs; j++) {
      puffs.push({lngLat: c.centre, alt: (c.alt ?? 0) + c.h + 2, rise: effect.rise, radius: 3 + c.size * 0.25, seed: seedOf(i, j + 7),
        ig: ig[i], heat: effect.heat, out: Number.isNaN(out[i]) ? 1e9 : out[i], windDx: effect.smokeDx, windDy: effect.smokeDy});
    }
  }
  fireGL.setData(flames, puffs);
  map.getSource('fire-points').setData({type: 'FeatureCollection', features: points});
  const row = run.result.timeline[k];
  fui.frame.value = k;
  showClock();
  fui.status.textContent = `${row.Burning} burning · ${row.Burned} burned${row.Extinguished ? ` · ${row.Extinguished} put out` : ''}${k === frames.length - 1 ? ` · ${run.result.status}` : ''}`;
  if (k === frames.length - 1) setResults(true);
  else if (!fui.results.hidden) setResults(false);
  activity.render(run, k);
  activity.status(displayMinute, Boolean(playTimer));
  paintFire();
  if (typeof onFireFrame === 'function') onFireFrame();
}

/** Update the ground glow once per recorded minute; flame motion is handled by the GPU. */
let lastFirePaintKey = '';
function paintFire() {
  const m = Math.floor(displayMinute), is3d = view === '3d', key = `${m}:${view}`;
  if (key === lastFirePaintKey) return;
  lastFirePaintKey = key;
  // 0.35 -> 1 while catching (first quarter of the burn), full blaze, then dying down to embers (0.2); same as fire-gl.js
  const intensity = ['let', 'p', ['/', ['-', m, ['get', 'ig']], ['get', 'dur']],
    ['case', ['<', ['var', 'p'], 0.25], ['+', 0.35, ['*', 2.6, ['var', 'p']]], ['<', ['var', 'p'], 0.7], 1,
      ['max', 0.2, ['-', 1, ['*', 2.5, ['-', ['var', 'p'], 0.7]]]]]];
  map.setPaintProperty('fire-glow', 'heatmap-weight', intensity);
  // Flames already flicker on the GPU. Keep building paint stable instead of rebuilding the map style.
  map.setPaintProperty(is3d ? 'buildings-3d' : 'buildings-2d', is3d ? 'fill-extrusion-color' : 'fill-color', buildingColor(FIRE.burnB));
}

function loop(ts) {
  rafId = requestAnimationFrame(loop);
  const dt = lastTs && !document.hidden ? Math.max(0, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  if (playTimer) clock += Math.min(dt, 0.1);
  if (playTimer) {
    const end = run.result.frames.length - 1;
    const next = IgnisPlayback.advance(displayMinute, dt, Number(fui.speed.value), end, playbackRendered);
    if (next !== displayMinute) playbackRendered = false;
    displayMinute = next;
    const k = Math.floor(displayMinute);
    if (k !== frameIndex) showFrame(k);
    if (displayMinute >= end) pause();
  }
  fireGL.setClock(displayMinute, clock); // flames and smoke animate every frame on the GPU
  evacActors?.setClock(displayMinute, clock);
  windFX.tick(clock);
  // Keep camera gestures free of repeated style rebuilds; paused playback needs no data uploads.
  const moving = map.isMoving();
  if (ts - lastPaint > 200) { // counters/routes only; actors animate on every rendered frame
    lastPaint = ts;
    if (displayMinute !== lastVisualMinute || clock !== lastVisualClock || view !== lastVisualView) {
      lastVisualMinute = displayMinute; lastVisualClock = clock; lastVisualView = view;
      paintPending = true;
      evacTick(displayMinute); bfpTick(displayMinute); showClock();
    }
    if (paintPending && !moving) { paintFire(); paintPending = false; }
    activity.status(displayMinute, Boolean(playTimer));
  }
}
document.addEventListener('visibilitychange', () => { lastTs = 0; });

/** Buildings burning or burned at the minute on screen (for routing around the fire). */
function fireAffectedNow() {
  if (!run) return [];
  return run.features.filter((f, i) => run.result.frames[frameIndex].states[i] > 0);
}

function play() {
  if (frameIndex >= run.result.frames.length - 1) { displayMinute = 0; showFrame(0); }
  playTimer = true;
  syncRenderResolution();
  fui.play.textContent = 'Pause';
  activity.status(displayMinute, true);
}
function pause() {
  playTimer = null;
  syncRenderResolution();
  fui.play.textContent = 'Play';
  activity.status(displayMinute, false);
}
function clearFire() {
  activity.clear();
  windFX.clear();
  bfpShow(null);
  evacClear();
  pause();
  cancelAnimationFrame(rafId);
  rafId = null;
  run = null;
  fui.ignite.disabled = fireStarting;
  if (!map.getSource('fire-points')) return;
  map.removeFeatureState({source: 'buildings'});
  map.getSource('fire-points').setData(empty());
  fireGL.setData([], []);
  map.setPaintProperty('buildings-3d', 'fill-extrusion-color', buildingColor(FIRE.burnA));
  map.setPaintProperty('buildings-2d', 'fill-color', buildingColor(FIRE.burnA));
  fui.playback.hidden = true;
  updateGuide();
  if (typeof onFireFrame === 'function') onFireFrame();
}

fui.ignite.addEventListener('click', startFire);
fui.play.addEventListener('click', () => (playTimer ? pause() : play()));
fui.restart.addEventListener('click', () => { setResults(false); displayMinute = 0; showFrame(0); play(); });
fui.skip.addEventListener('click', () => { pause(); displayMinute = run.result.frames.length - 1; showFrame(displayMinute); });
/** Results (severity headline and Y1–Y8) are shown only once the simulated fire has finished. */
function setResults(show) {
  fui.results.hidden = !show;
  $('#view-calculations').disabled = !run?.calculation;
  fui.runningNote.hidden = show;
  if (show) { fui.results.classList.remove('reveal'); void fui.results.offsetWidth; fui.results.classList.add('reveal'); }
  else if (infoAnchor?.closest?.('#results')) hideInfo();
}
fui.frame.addEventListener('input', () => { pause(); displayMinute = Number(fui.frame.value); showFrame(displayMinute); });
fui.clearFire.addEventListener('click', clearFire);
const calculationDialog = $('#calculation-dialog'), calculationFrame = $('#calculation-frame');
let calculationDocument = '', calculationFilename = '';
$('#view-calculations').addEventListener('click', () => {
  if (!run?.calculation) return;
  pause();
  try {
    calculationDocument = IgnisCalculationReport.html(run);
    calculationFilename = `IgnisShield-calculations-${run.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
    calculationFrame.srcdoc = calculationDocument;
    calculationDialog.showModal();
  } catch (err) { showHint(`Could not prepare the calculation report: ${err.message}`, 8000); }
});
$('#calculation-close').addEventListener('click', () => calculationDialog.close());
$('#calculation-print').addEventListener('click', () => calculationFrame.contentWindow.print());
$('#calculation-download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([calculationDocument], {type:'text/html;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = calculationFilename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
fui.speed.addEventListener('change', () => { scenario.speed = fui.speed.value; saveScenario(); renderSim(); });

// ---------- live weather (Open-Meteo: free, no key, CC BY 4.0) ----------
// Wind is the 10 m model value for the grid cell over Sitio Polo; street-level wind in narrow alleys is usually lower.
const WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=10.5068&longitude=123.7141&timezone=Asia%2FManila&forecast_days=3&wind_speed_unit=ms'
  + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
  + '&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
let forecast = null;

async function loadWeather() {
  fui.wxLoad.disabled = true;
  fui.wxStatus.textContent = 'Loading the Open-Meteo forecast…';
  try {
    const res = await fetch(WX_URL);
    if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
    const j = await res.json(), c = j.current, h = j.hourly;
    forecast = [{time: c.time, label: `Now (${c.time.slice(11)})`, t: c.temperature_2m, rh: c.relative_humidity_2m,
      ws: c.wind_speed_10m, wd: c.wind_direction_10m, gust: c.wind_gusts_10m}];
    h.time.forEach((time, i) => {
      if (time <= c.time) return;
      const day = new Date(`${time}:00+08:00`).toLocaleDateString('en-PH', {weekday: 'short', timeZone: 'Asia/Manila'});
      forecast.push({time, label: `${day} ${time.slice(11)}`, t: h.temperature_2m[i], rh: h.relative_humidity_2m[i],
        ws: h.wind_speed_10m[i], wd: h.wind_direction_10m[i], gust: h.wind_gusts_10m[i]});
    });
    fui.wxHour.innerHTML = forecast.map((f, i) =>
      `<option value="${i}">${f.label} · ${f.ws.toFixed(1)} m/s from ${COMPASS[Math.round(f.wd / 45) % 8]}</option>`).join('');
    fui.wxHour.hidden = false;
    applyWeather(0);
  } catch (err) {
    fui.wxStatus.textContent = `Could not load live weather (${err.message}). Check the internet connection, or enter the weather by hand.`;
  } finally {
    fui.wxLoad.disabled = false;
  }
}
function applyWeather(i) {
  const f = forecast[i];
  const values = {Hr: Math.round(f.rh), Ta: Math.round(f.t * 10) / 10, Uw: Math.round(f.ws * 10) / 10, Tw: Math.round(f.wd) % 360};
  for (const [k, v] of Object.entries(values)) P.check(k, v);
  Object.assign(scenario.custom, values, {source: `Open-Meteo ${i === 0 ? 'current conditions' : 'forecast'} for ${f.time.replace('T', ' ')} Philippine time; gusts ${f.gust.toFixed(1)} m/s. Weather data by Open-Meteo.com (CC BY 4.0).`});
  saveScenario();
  renderScenario();
  fui.wxHour.value = String(i);
}
fui.wxLoad.addEventListener('click', loadWeather);
fui.wxHour.addEventListener('change', () => applyWeather(Number(fui.wxHour.value)));

renderScenario();
updateGuide();
