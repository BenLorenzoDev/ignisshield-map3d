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
  metrics: $('#metrics'), headline: $('#result-headline'), clearFire: $('#clear-fire'), batchRun: $('#batch-run'), outputNotes: $('#output-notes'),
  logBtn: $('#log-btn'), log: $('#log'), logBody: $('#log-body'), logCount: $('#log-count'),
  logCsv: $('#log-csv'), logClear: $('#log-clear'),
  live: $('#weather-block'), wxLoad: $('#wx-load'), wxHour: $('#wx-hour'), wxStatus: $('#wx-status')
};

// ---------- scenario settings (saved in this browser) ----------
const RUN_FIELDS = [
  {key: 'seed', name: 'Replay number', unit: '', min: 0, max: 2147483647, step: 1},
  {key: 'repeats', name: 'Number of runs', unit: '', min: 1, max: 20, step: 1},
  {key: 'minutes', name: 'Maximum model minutes', unit: 'min', min: 1, max: 240, step: 1}
];
const draftTrials = () => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(P.TRIALS).map(([k, t]) => [k, t.values]))));
function loadScenario() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SCENARIO_KEY)) || {}; } catch { /* use defaults */ }
  if ('humidity' in s) { // settings saved by an older version, in model units
    s = {custom: {Hr: s.humidity, Ta: s.temp_c, Tw: s.wind_dir, Uw: Math.round(s.wind_spd / 3.6 * 10) / 10}, seed: s.seed, minutes: s.minutes};
  }
  const weather = Object.fromEntries(P.INPUTS.filter(v => v.scope === 'weather').map(v => [v.key, v.def]));
  return {source: 'custom', seed: 42, repeats: 3, minutes: 60, boundaryOnly: false, ...s,
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
  updateWind();
  if (selected()) updatePanel();
}
fui.rules.innerHTML = P.RULE_TEXT.map(t => `<li>${t}</li>`).join('');
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
  minutes: {title: 'Maximum model minutes',
    what: 'The longest time the simulated fire is allowed to burn (1–240 minutes).',
    get: 'Use 60 for a first look. Try the time the fire truck needs to arrive to see what burns before help comes.',
    sim: 'The run stops earlier if the fire goes out. Total simulation time (Y8) can never be longer than this.'},
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
  infoCard.innerHTML = infoContent(key);
  infoCard.hidden = false;
  placeInfo();
}
function placeInfo() {
  if (infoCard.hidden || !infoAnchor) return;
  if (!document.body.contains(infoAnchor)) { // the form was redrawn: find the same item again
    infoAnchor = document.querySelector(`[data-info="${infoAnchor.dataset.info}"]`);
    if (!infoAnchor) { hideInfo(); return; }
  }
  const a = infoAnchor.getBoundingClientRect(), w = infoCard.offsetWidth, h = infoCard.offsetHeight;
  const panel = infoAnchor.closest('#panel');
  if (panel) {
    // beside the form, joined to the field by a line
    const p = panel.getBoundingClientRect(), mid = a.top + Math.min(a.height, 40) / 2, left = p.right + 36;
    infoCard.style.left = `${left}px`;
    infoCard.style.top = `${Math.max(p.top, Math.min(window.innerHeight - h - 12, mid - 40))}px`;
    const field = infoAnchor.querySelector('input, select') ?? infoAnchor, from = field.getBoundingClientRect().right;
    infoLine.hidden = !(mid > p.top && mid < p.bottom);
    Object.assign(infoLine.style, {left: `${from}px`, top: `${mid - 1}px`, width: `${Math.max(0, left - from)}px`});
  } else {
    // results: above the tile
    infoCard.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, a.left + a.width / 2 - w / 2))}px`;
    infoCard.style.top = `${Math.max(8, a.top - h - 10)}px`;
    infoLine.hidden = true;
  }
}
function hideInfo() { infoAnchor = null; infoCard.hidden = infoLine.hidden = true; }

const helpZone = el => el?.closest?.('#panel, #playback');
document.addEventListener('mouseover', e => {
  if (e.target.closest?.('#input-info')) return;
  const a = e.target.closest?.('[data-info]');
  if (a && helpZone(a)) { if (a !== infoAnchor) showInfo(a); }
  else if (infoAnchor && !helpZone(e.target)) (focusAnchor ? showInfo(focusAnchor) : hideInfo());
});
document.addEventListener('focusin', e => {
  const a = e.target.closest?.('[data-info]');
  if (a && helpZone(a)) { focusAnchor = a; showInfo(a); }
});
document.addEventListener('focusout', () => setTimeout(() => {
  const a = document.activeElement?.closest?.('[data-info]');
  if (!a || !helpZone(a)) { focusAnchor = null; if (!document.querySelector('[data-info]:hover')) hideInfo(); }
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
  fui.guide.hidden = guideHidden || busy;
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
let shown = null; // fire state currently drawn for each building
let frameIndex = 0;
let playTimer = null; // truthy while playing (route-ui checks it)
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
    const w = trial ? scenario.trials[scenario.source] : scenario.custom, wind = {Tw: w.Tw, Uw: w.Uw}; // smoke drifts downwind
    let first = null;
    const records = [];
    for (let k = 0; k < scenario.repeats; k++) {
      const seed = scenario.seed + k;
      const result = IgnisFire.simulate(features, f => byFeature.get(f), index, seed, scenario.minutes);
      const id = `${batch}-${k}`;
      sessionRuns.set(id, {id, result, features, ids, seed, wind});
      const out = P.outputs(result.metrics);
      records.push({
        id, batch, utc, run_in_batch: k + 1, scenario: trial ? `Trial ${scenario.source} conditions` : 'Custom',
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
    fui.batchRun.innerHTML = Array.from({length: scenario.repeats}, (_, k) => `<option value="${batch}-${k}">Run ${k + 1} of ${scenario.repeats} · replay #${scenario.seed + k}</option>`).join('');
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
  fui.playback.hidden = false;
  updateGuide();
  displayMinute = 0;
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
const SMOKE_MAX = 260; // buildings with smoke at once, to keep the map fast

function prepareEffects(r) {
  const frames = r.result.frames, n = r.features.length;
  const ig = new Float32Array(n).fill(NaN), out = new Float32Array(n).fill(NaN);
  for (const f of frames) {
    for (let i = 0; i < n; i++) {
      const s = f.states[i];
      if (s > 0 && Number.isNaN(ig[i])) ig[i] = f.minute;
      if (s === 2 && Number.isNaN(out[i])) out[i] = f.minute;
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
  const ground = map.queryTerrainElevation([x, y]); // null until the terrain tile has loaded
  c = {centre: [x, y], spots, size: Math.sqrt(area / count), alt: ground, h: (f.properties.storeys ?? 1) * STOREY_M};
  run.fx.shapes.set(i, c);
  return c;
}

function showFrame(k) {
  frameIndex = k;
  const frames = run.result.frames, states = frames[k].states, minute = frames[k].minute, {ig, out, dur} = run.fx;
  const flames = [], points = [], smoky = [];
  states.forEach((s, i) => {
    if (shown[i] !== s) { map.setFeatureState({source: 'buildings', id: run.ids[i]}, {fire: STATE_NAMES[s], ph: phase(i)}); shown[i] = s; }
    if (s === 1) {
      const c = shapeOf(i), alt = (c.alt ?? 0) + c.h;
      c.spots.forEach((lngLat, j) => flames.push({lngLat, alt, height: 5 + c.size * 1.1, halfWidth: Math.max(2, c.size * 0.6),
        seed: seedOf(i, j), ig: ig[i], dur: dur[i]}));
      points.push({type: 'Feature', geometry: {type: 'Point', coordinates: c.centre}, properties: {ig: ig[i], dur: dur[i], ph: phase(i)}});
    }
    if (s === 1 || (s === 2 && minute - out[i] < 8)) smoky.push(i);
  });
  // Smoke: two puffs per building, drifting downwind as they rise
  smoky.sort((a, b) => ig[b] - ig[a]);
  const toward = ((run.wind.Tw + 180) % 360) * Math.PI / 180, drift = 10 + 6 * run.wind.Uw;
  const puffs = [];
  for (const i of smoky.slice(0, SMOKE_MAX)) {
    const c = shapeOf(i);
    for (let j = 0; j < 2; j++) {
      puffs.push({lngLat: c.centre, alt: (c.alt ?? 0) + c.h + 2, rise: 16 + c.size * 0.4, radius: 3 + c.size * 0.25, seed: seedOf(i, j + 7),
        out: Number.isNaN(out[i]) ? 1e9 : out[i], windDx: drift * Math.sin(toward), windDy: drift * Math.cos(toward)});
    }
  }
  fireGL.setData(flames, puffs);
  map.getSource('fire-points').setData({type: 'FeatureCollection', features: points});
  const row = run.result.timeline[k];
  fui.frame.value = k;
  fui.minute.textContent = `Minute ${minute} of ${frames.at(-1).minute}`;
  fui.status.textContent = `${row.Burning} burning · ${row.Burned} burned${k === frames.length - 1 ? ` · ${run.result.status}` : ''}`;
  paintFire();
  if (typeof onFireFrame === 'function') onFireFrame();
}

/** Ground glow at the current (fractional) minute, and the red/orange pulse of burning buildings. */
let paintCount = 0;
function paintFire() {
  const m = displayMinute, t = clock, is3d = view === '3d';
  paintCount++;
  // 0.35 -> 1 while catching (first quarter of the burn), full blaze, then dying down to embers (0.2); same as fire-gl.js
  const intensity = ['let', 'p', ['/', ['-', m, ['get', 'ig']], ['get', 'dur']],
    ['case', ['<', ['var', 'p'], 0.25], ['+', 0.35, ['*', 2.6, ['var', 'p']]], ['<', ['var', 'p'], 0.7], 1,
      ['max', 0.2, ['-', 1, ['*', 2.5, ['-', ['var', 'p'], 0.7]]]]]];
  map.setPaintProperty('fire-glow', 'heatmap-weight', ['*', intensity, ['+', 0.8, ['*', 0.2, ['sin', ['+', t * 5, ['get', 'ph']]]]]]);
  // Recolouring every building is the expensive part, so it runs on every third update (about 5 times a second)
  if (paintCount % 3) return;
  const burn = ['interpolate', ['linear'], ['sin', ['+', t * 6, ['coalesce', ['feature-state', 'ph'], 0]]], -1, '#b3230a', 1, '#ff7000'];
  map.setPaintProperty(is3d ? 'buildings-3d' : 'buildings-2d', is3d ? 'fill-extrusion-color' : 'fill-color', buildingColor(burn));
}

function loop(ts) {
  rafId = requestAnimationFrame(loop);
  const dt = lastTs ? Math.min(0.25, (ts - lastTs) / 1000) : 0; // cap: a stalled tab does not jump ahead
  lastTs = ts;
  clock += dt;
  if (playTimer) {
    const end = run.result.frames.length - 1;
    displayMinute = Math.min(end, displayMinute + dt * Number(fui.speed.value));
    const k = Math.floor(displayMinute);
    if (k !== frameIndex) showFrame(k);
    if (displayMinute >= end) pause();
  }
  fireGL.setClock(displayMinute, clock); // flames and smoke animate every frame on the GPU
  if (ts - lastPaint > 70) { lastPaint = ts; paintFire(); }
}

/** Buildings burning or burned at the minute on screen (for routing around the fire). */
function fireAffectedNow() {
  if (!run) return [];
  return run.features.filter((f, i) => run.result.frames[frameIndex].states[i] > 0);
}

function play() {
  if (frameIndex >= run.result.frames.length - 1) { displayMinute = 0; showFrame(0); }
  playTimer = true;
  fui.play.textContent = 'Pause';
}
function pause() {
  playTimer = null;
  fui.play.textContent = 'Play';
}
function clearFire() {
  pause();
  cancelAnimationFrame(rafId);
  rafId = null;
  run = null;
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
fui.restart.addEventListener('click', () => { displayMinute = 0; showFrame(0); play(); });
fui.frame.addEventListener('input', () => { pause(); displayMinute = Number(fui.frame.value); showFrame(displayMinute); });
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
updateGuide();
