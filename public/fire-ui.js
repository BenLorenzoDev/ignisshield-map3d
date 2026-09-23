/* global map, store, storeVersion, studyData, selected, saveStore, select, showHint, updatePanel, STOREY_M, FIRE, buildingColor, empty, $, IgnisFire, IgnisPaper */
// Fire scenario UI: the paper's inputs, Trials A–D, repeated runs, playback and the run log.
const P = IgnisPaper;
const SCENARIO_KEY = 'ignisshield-map3d.scenario';
const LOG_KEY = 'ignisshield-map3d.runs';
const LOG_LIMIT = 1000;

const fui = {
  buildingInputs: $('#building-inputs'), inputsNote: $('#inputs-note'), ignite: $('#ignite'),
  scenarioBtn: $('#scenario-btn'), scenario: $('#scenario'), source: $('#scenario-source'), trialText: $('#trial-text'),
  scenarioInputs: $('#scenario-inputs'), resetTrial: $('#reset-trial'), runInputs: $('#run-inputs'), rules: $('#rules'),
  boundaryOnly: $('#boundary-only'),
  playback: $('#playback'), play: $('#play'), restart: $('#restart'), frame: $('#frame'), minute: $('#minute'),
  speed: $('#speed'), status: $('#run-status'), windArrow: $('#wind-arrow'), windText: $('#wind-text'),
  metrics: $('#metrics'), clearFire: $('#clear-fire'), batchRun: $('#batch-run'), outputNotes: $('#output-notes'),
  logBtn: $('#log-btn'), log: $('#log'), logBody: $('#log-body'), logCount: $('#log-count'),
  logCsv: $('#log-csv'), logClear: $('#log-clear'),
  live: $('#live-weather'), wxLoad: $('#wx-load'), wxHour: $('#wx-hour'), wxStatus: $('#wx-status')
};

// ---------- scenario settings (saved in this browser) ----------
const RUN_FIELDS = [
  {key: 'seed', name: 'First random seed', unit: '', min: 0, max: 2147483647, step: 1},
  {key: 'repeats', name: 'Runs (seeds seed, seed+1, …)', unit: '', min: 1, max: 20, step: 1},
  {key: 'minutes', name: 'Maximum model minutes', unit: 'min', min: 1, max: 240, step: 1}
];
const draftTrials = () => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(P.TRIALS).map(([k, t]) => [k, t.values]))));
function loadScenario() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SCENARIO_KEY)) || {}; } catch { /* use defaults */ }
  if ('humidity' in s) { // settings saved by the previous version, in model units
    s = {custom: {Hr: s.humidity, Ta: s.temp_c, Tw: s.wind_dir, Uw: Math.round(s.wind_spd / 3.6 * 10) / 10}, seed: s.seed, minutes: s.minutes};
  }
  const weather = Object.fromEntries(P.INPUTS.filter(v => v.scope === 'weather').map(v => [v.key, v.def]));
  return {source: 'custom', seed: 42, repeats: 3, minutes: 60, boundaryOnly: false, ...s,
    custom: {...weather, ...s.custom}, trials: {...draftTrials(), ...s.trials}};
}
const scenario = loadScenario();
const saveScenario = () => { try { localStorage.setItem(SCENARIO_KEY, JSON.stringify(scenario)); } catch { /* session only */ } };

const inputField = (v, id, value, placeholder = '') =>
  `<label class="field"><span><b>${v.sym}</b> ${v.name} <i>${v.unit}</i></span>` +
  `<input id="${id}" type="number" min="${v.min}" max="${v.max}" step="${v.step}" value="${typeof value === 'number' ? value : ''}" placeholder="${placeholder}"></label>`;

function readField(v, input, allowBlank = false) {
  if (allowBlank && input.value === '') return null;
  return P.check(v.key, input.value === '' ? NaN : Number(input.value));
}

function renderScenario() {
  fui.source.value = scenario.source;
  const trial = P.TRIALS[scenario.source];
  fui.trialText.textContent = trial ? `Expected level: ${trial.level}. ${trial.text} Draft numbers: the paper gives none.` : 'Each building uses its own inputs (click a building). Weather below applies to all.';
  fui.resetTrial.hidden = !trial;
  fui.live.hidden = Boolean(trial);
  fui.wxStatus.textContent = scenario.custom.source ?? 'Weather entered by hand.';
  const fields = trial ? P.INPUTS : P.INPUTS.filter(v => v.scope === 'weather');
  const values = trial ? scenario.trials[scenario.source] : scenario.custom;
  fui.scenarioInputs.innerHTML = fields.map(v => inputField(v, `sc-${v.key}`, values[v.key], v.auto ? 'measured' : '')).join('');
  if (trial && cloud.enabled) {
    // Trial values are shared by the whole class; only editors change them
    fui.trialText.textContent += ' These trial values are shared by the class.';
    if (!canEdit()) fui.scenarioInputs.querySelectorAll('input').forEach(el => { el.disabled = true; });
    fui.resetTrial.hidden = !canEdit();
  }
  fui.runInputs.innerHTML = RUN_FIELDS.map(v => `<label class="field"><span>${v.name}</span><input id="run-${v.key}" type="number" min="${v.min}" max="${v.max}" step="${v.step}" value="${scenario[v.key]}"></label>`).join('');
  fui.boundaryOnly.checked = scenario.boundaryOnly;
  updateWind();
  if (selected()) updatePanel();
}
fui.rules.innerHTML = P.RULE_TEXT.map(t => `<li>${t}</li>`).join('');
fui.outputNotes.innerHTML = P.OUTPUT_NOTES.map(t => `<li>${t}</li>`).join('');

fui.source.addEventListener('change', () => { scenario.source = fui.source.value; saveScenario(); renderScenario(); });
fui.scenarioInputs.addEventListener('change', e => {
  const v = P.BY_KEY[e.target.id.slice(3)];
  const trial = P.TRIALS[scenario.source];
  const target = trial ? scenario.trials[scenario.source] : scenario.custom;
  if (trial && !requireEdit()) { renderScenario(); return; }
  try {
    target[v.key] = readField(v, e.target, v.auto);
    if (target === scenario.custom) { scenario.custom.source = 'Weather edited by hand.'; fui.wxStatus.textContent = scenario.custom.source; }
    saveScenario();
    if (trial) shareTrials();
  } catch (err) { showHint(err.message, 6000); e.target.value = target[v.key] ?? ''; }
  updateWind();
});
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
const SIDE = {scenario: [fui.scenarioBtn, fui.scenario], log: [fui.logBtn, fui.log]};
function openSide(name) {
  for (const [key, [btn, panel]] of Object.entries(SIDE)) {
    const open = key === name && panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-pressed', String(open));
  }
  if (typeof onSideChange === 'function') onSideChange(name);
}
fui.scenarioBtn.addEventListener('click', () => openSide('scenario'));
fui.logBtn.addEventListener('click', () => { renderLog(); openSide('log'); });

// ---------- per-building inputs (paper X1, X2, X3, X6, X7) ----------
let densityCache = {version: -1, byId: null};
function measuredDensity() {
  if (densityCache.version !== storeVersion) {
    const list = P.localDensity(store.features);
    densityCache = {version: storeVersion, byId: new Map(store.features.map((f, i) => [f.properties.id, list[i]]))};
  }
  return densityCache.byId;
}
const BUILDING_FIELDS = P.INPUTS.filter(v => v.scope === 'building');

function renderBuildingInputs(f) {
  const p = f.properties, local = measuredDensity().get(p.id);
  fui.buildingInputs.innerHTML = BUILDING_FIELDS.map(v => inputField(v, `in-${v.key}`, typeof p[v.key] === 'number' ? p[v.key] : '', v.auto ? `measured ${local.Db.toFixed(4)}` : `default ${v.def}`)).join('');
  if (!canEdit()) fui.buildingInputs.querySelectorAll('input').forEach(el => { el.disabled = true; });
  const x = buildingPaperValues(f);
  const trial = P.TRIALS[scenario.source];
  let m;
  try { m = P.toModel(x, local); } catch (err) { fui.inputsNote.textContent = err.message; return; }
  fui.inputsNote.innerHTML = [
    trial ? `<b>Trial ${scenario.source} is selected:</b> its values replace these for every building in the run.` : '',
    `Model sees: coverage ${m.bldg_dens.toFixed(2)}, material ${m.bldg_mat} (${['', 'concrete', 'mixed', 'wood/nipa'][m.bldg_mat]}), ventilation ${m.oxygen_v}. Fuel load ≈ ${Math.round(x.Mb / P.RULES.woodMJPerKg)} kg/m² wood-equivalent; O₂ ≈ ${(x.O2 * P.RULES.airO2Percent).toFixed(1)} %.`,
    p.inputs_src === 'entered' ? 'Some values entered by you.' : 'Blank fields use defaults: scenario assumptions, not measurements.'
  ].filter(Boolean).join('<br>');
}
fui.buildingInputs.addEventListener('change', e => {
  const f = selected(), v = P.BY_KEY[e.target.id.slice(3)];
  if (!requireEdit()) { updatePanel(); return; }
  try {
    const value = e.target.value === '' ? null : readField(v, e.target);
    if (value === null) delete f.properties[v.key]; else f.properties[v.key] = value;
    f.properties.inputs_src = 'entered';
    saveStore();
  } catch (err) { showHint(err.message, 6000); }
  updatePanel();
});

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
  const w = P.TRIALS[scenario.source] ? scenario.trials[scenario.source] : scenario.custom;
  fui.windArrow.style.transform = `rotate(${(w.Tw + 180 - map.getBearing()) % 360}deg)`; // arrow points where the wind blows TO
  fui.windText.textContent = `Wind from ${COMPASS[Math.round(w.Tw / 45) % 8]} (${w.Tw}°), ${w.Uw} m/s`;
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
      <table><thead><tr><th>Seed</th><th>Sf</th><th>Level</th><th>If kW/m</th><th>R m/min</th><th>Q MW</th><th>Ab m²</th><th>φs °</th><th>τb min</th><th>Tsim min</th><th></th></tr></thead><tbody>
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
let shown = null; // fire state currently drawn for each building
let frameIndex = 0, playTimer = null, flickerTimer = null, flickerOn = false;
const STATE_NAMES = ['safe', 'burning', 'burned'];

async function startFire() {
  const origin = selected();
  if (!origin) return;
  fui.ignite.disabled = true;
  fui.ignite.textContent = 'Calculating…';
  await new Promise(r => setTimeout(r, 30)); // let the button repaint before the calculation
  try {
    const features = runBuildings();
    const index = features.indexOf(origin);
    if (index < 0) throw new Error('This building is outside the study boundary. Untick "Only buildings inside the study boundary" or choose another building.');
    const inputs = modelInputs(features);
    const byFeature = new Map(features.map((f, i) => [f, inputs[i]]));
    const batch = `b${Date.now()}`, utc = new Date().toISOString();
    const trial = P.TRIALS[scenario.source];
    const x = buildingPaperValues(origin), local = measuredDensity().get(origin.properties.id);
    const ids = features.map(f => f.properties.id);
    let first = null;
    const records = [];
    for (let k = 0; k < scenario.repeats; k++) {
      const seed = scenario.seed + k;
      const result = IgnisFire.simulate(features, f => byFeature.get(f), index, seed, scenario.minutes);
      const id = `${batch}-${k}`;
      sessionRuns.set(id, {id, result, features, ids, seed});
      const out = P.outputs(result.metrics);
      records.push({
        id, batch, utc, run_in_batch: k + 1, scenario: trial ? `Trial ${scenario.source} (${trial.level})` : 'Custom',
        ignition: origin.properties.id, seed, max_minutes: scenario.minutes, n_buildings: features.length,
        extent: scenario.boundaryOnly ? 'study boundary' : 'all mapped buildings', inputs: trial ? 'trial values, all buildings' : 'per building + weather',
        X1_Db: x.Db ?? `measured ${local.Db.toFixed(5)}`, X2_Mb_MJ_m2: x.Mb, X3_O2_ratio: x.O2, X4_Hr_pct: x.Hr, X5_Ta_C: x.Ta,
        X6_Nh: x.Nh, X7_Wr_m: x.Wr, X8_Uw_m_s: x.Uw, X9_Tw_deg: x.Tw,
        weather_source: trial ? 'trial values' : (scenario.custom.source ?? 'entered by hand'),
        Y1_Sf: out[0].value, level: P.level(out[0].value), Y2_If_kW_m: out[1].value, Y3_R_m_min: out[2].value, Y4_Q_MW: out[3].value,
        Y5_Ab_m2: out[4].value, Y6_phi_deg: out[5].value, Y7_tau_min: out[6].value, Y8_Tsim_min: out[7].value,
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
    fui.batchRun.innerHTML = Array.from({length: scenario.repeats}, (_, k) => `<option value="${batch}-${k}">Run ${k + 1} of ${scenario.repeats} · seed ${scenario.seed + k}</option>`).join('');
    select(null);
    showRun(first);
  } catch (err) {
    showHint(`The fire model could not run: ${err.message}`, 9000);
  } finally {
    fui.ignite.disabled = false;
    fui.ignite.textContent = 'Start fire here';
  }
}

function showRun(id) {
  clearFire();
  run = sessionRuns.get(id);
  if (![...fui.batchRun.options].some(o => o.value === id)) {
    fui.batchRun.innerHTML = `<option value="${id}">Logged run · seed ${run.seed}</option>`;
  }
  fui.batchRun.value = id;
  shown = new Uint8Array(run.features.length);
  fui.frame.max = run.result.frames.length - 1;
  fui.metrics.innerHTML = P.outputs(run.result.metrics).map(o =>
    `<div class="metric"><span>${o.sym} ${o.name}</span><strong>${o.text}</strong><small>${o.unit}</small></div>`).join('');
  fui.playback.hidden = false;
  flickerTimer = setInterval(flicker, 200);
  showFrame(0);
  play();
}
fui.batchRun.addEventListener('change', () => showRun(fui.batchRun.value));

function showFrame(k) {
  frameIndex = k;
  const frames = run.result.frames, states = frames[k].states, burning = [];
  states.forEach((s, i) => {
    if (shown[i] !== s) { map.setFeatureState({source: 'buildings', id: run.ids[i]}, {fire: STATE_NAMES[s]}); shown[i] = s; }
    if (s === 1) burning.push(run.features[i]);
  });
  map.getSource('flames').setData({type: 'FeatureCollection', features: burning.map(f => ({
    type: 'Feature', geometry: f.geometry, properties: {h: (f.properties.storeys ?? 1) * STOREY_M}
  }))});
  const row = run.result.timeline[k];
  fui.frame.value = k;
  fui.minute.textContent = `Minute ${frames[k].minute} of ${frames.at(-1).minute}`;
  fui.status.textContent = `${row.Burning} burning · ${row.Burned} burned${k === frames.length - 1 ? ` · ${run.result.status}` : ''}`;
  if (typeof onFireFrame === 'function') onFireFrame();
}
/** Buildings burning or burned at the minute on screen (for routing around the fire). */
function fireAffectedNow() {
  if (!run) return [];
  return run.features.filter((f, i) => run.result.frames[frameIndex].states[i] > 0);
}

function flicker() {
  flickerOn = !flickerOn;
  const burn = flickerOn ? FIRE.burnB : FIRE.burnA;
  map.setPaintProperty('buildings-3d', 'fill-extrusion-color', buildingColor(burn));
  map.setPaintProperty('buildings-2d', 'fill-color', buildingColor(burn));
  map.setPaintProperty('flames-3d', 'fill-extrusion-height', ['+', ['get', 'h'], flickerOn ? 4.5 : 2.5]);
  map.setPaintProperty('flames-2d', 'line-width', flickerOn ? 6 : 3);
}
function play() {
  pause();
  if (frameIndex >= run.result.frames.length - 1) showFrame(0);
  fui.play.textContent = 'Pause';
  playTimer = setInterval(() => {
    if (frameIndex >= run.result.frames.length - 1) pause();
    else showFrame(frameIndex + 1);
  }, 1000 / Number(fui.speed.value));
}
function pause() {
  clearInterval(playTimer);
  playTimer = null;
  fui.play.textContent = 'Play';
}
function clearFire() {
  pause();
  clearInterval(flickerTimer);
  run = null;
  if (!map.getSource('flames')) return;
  map.removeFeatureState({source: 'buildings'});
  map.getSource('flames').setData(empty());
  map.setPaintProperty('buildings-3d', 'fill-extrusion-color', buildingColor(FIRE.burnA));
  map.setPaintProperty('buildings-2d', 'fill-color', buildingColor(FIRE.burnA));
  fui.playback.hidden = true;
  if (typeof onFireFrame === 'function') onFireFrame();
}

fui.ignite.addEventListener('click', startFire);
fui.play.addEventListener('click', () => (playTimer ? pause() : play()));
fui.restart.addEventListener('click', () => { showFrame(0); play(); });
fui.frame.addEventListener('input', () => { pause(); showFrame(Number(fui.frame.value)); });
fui.speed.addEventListener('change', () => { if (playTimer) play(); });
fui.clearFire.addEventListener('click', clearFire);

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
