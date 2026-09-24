/* global $, esc, SIDE, map, maplibregl */
// A presentation of recorded model decisions. This panel never participates in simulation calculations.
const activity = (() => {
  const panel = $('#activity'), body = $('#activity-body'), toggle = $('#activity-toggle');
  const state = $('#activity-state'), time = $('#activity-time');
  let current = null, busy = false, lastStatus = '', links = [], linkMinute = 0, focused = null;
  let linkCanvas = null;
  let lastLinksKey = '', lastMinute = 0;
  let inspectedId = null;
  const title = $('#activity-title'), note = panel.querySelector('.activity-playback-note');
  map.on('move', () => drawLinks(lastMinute));
  const centres = new Map();
  SIDE.activity = [toggle, panel];
  toggle.addEventListener('click', () => openSide('activity'));
  $('#activity-close').addEventListener('click', () => {
    panel.hidden = true; toggle.setAttribute('aria-pressed', 'false');
    if (inspectedId !== null) { focused = null; lastLinksKey = ''; drawLinks(lastMinute); }
  });
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--activity-playback-height', `${$('#playback').getBoundingClientRect().height}px`);
  }).observe($('#playback'));

  const pct = p => p > 0 && p < 0.001 ? '<0.1%' : p < 1 && p >= 0.999 ? '>99.9%' : `${(p * 100).toFixed(1)}%`;
  const name = id => `Building ${id + 1}`;
  const locate = (id, sourceId) => `<button class="activity-locate" data-building="${id}" ${sourceId === undefined ? '' : `data-source="${sourceId}"`} aria-label="Locate ${name(id)} on the map">Locate on map ↗</button>`;
  function reason(e) {
    const v = current.inputs[e.id];
    const distance = e.gap < 0.1 ? 'touching footprints' : `${e.gap.toFixed(1)} m away`;
    const wind = v.wind_spd === 0 ? 'Calm wind.' : e.windFactor > 1.05 ? 'Wind increased exposure.' :
      e.windFactor < 0.95 ? 'Wind reduced exposure.' : 'Little wind effect.';
    return `Strongest exposure: <b>${name(e.sourceId)}</b>, ${distance}. Ignition chance this step: <b>${pct(e.probability)}</b>. <span class="activity-wind">${wind}</span>` +
      (e.protection < 1 ? ' BFP wetting reduced the ignition chance.' : '');
  }

  const changeSummary = step => [
    step.ignited.length ? `${step.ignited.length} new ${step.ignited.length === 1 ? 'fire' : 'fires'}` : '',
    step.burned.length ? `${step.burned.length} burned out` : '',
    step.extinguished.length ? `${step.extinguished.length} put out by BFP` : ''
  ].filter(Boolean).join(' · ');

  function open() {
    for (const [btn, p] of Object.values(SIDE)) { p.hidden = p !== panel; btn.setAttribute('aria-pressed', String(p === panel)); }
  }

  async function stage(label, description) {
    busy = true;
    open();
    panel.setAttribute('aria-busy', 'true');
    state.textContent = 'Calculating';
    state.dataset.mode = 'calculating';
    time.textContent = '';
    body.innerHTML = `<p class="activity-stage">${esc(label)}</p><p>${esc(description)}</p><p class="activity-footnote">Preparing the run before playback starts.</p>`;
    await new Promise(resolve => setTimeout(resolve, 30)); // paint the actual next stage before its synchronous work
  }

  function show(r) {
    busy = false;
    current = r;
    centres.clear();
    linkCanvas = document.createElement('canvas');
    linkCanvas.className = 'activity-links';
    linkCanvas.setAttribute('aria-hidden', 'true');
    map.getCanvasContainer().appendChild(linkCanvas);
    lastStatus = '';
    lastLinksKey = '';
    panel.removeAttribute('aria-busy');
    if (window.innerWidth > 700) open();
  }

  function render(r, k) {
    if (busy || r !== current) return;
    if (inspectedId !== null && k === r.result.frames.length - 1) {
      if (!panel.hidden) inspect(inspectedId);
      return;
    }
    inspectedId = null;
    title.textContent = 'Live activity';
    note.textContent = 'Updates with playback · recorded model decisions';
    const steps = r.result.explanations, previous = steps?.[k - 1], next = steps?.[k];
    if (!steps) {
      body.innerHTML = '<p>Detailed explanations are not available for this older run. Start a new run to record ignition chances and reasons.</p>';
      links = []; focused = null;
      return;
    }
    const row = r.result.timeline[k], frames = r.result.frames;
    const recent = previous?.ignited ?? [];
    links = recent.slice(0, 3);
    linkMinute = frames[k].minute;
    focused = null;
    lastLinksKey = '';
    const origin = frames[0].states.findIndex(s => s === 1);
    const first = recent[0], risk = next?.top[0];
    const headline = k === 0 ? `${name(origin)} · fire started` : first ?
      `${name(first.id)}${recent.length > 1 ? ` + ${recent.length - 1} more` : ''} ignited` :
      changeSummary(previous) || 'No new fires this minute';
    const history = [];
    for (let i = k - 2; i >= 0 && history.length < 2; i--) {
      const summary = changeSummary(steps[i]);
      if (summary) history.push(`<li><time>${steps[i].to}:00</time><span>${esc(summary)}</span></li>`);
    }
    body.innerHTML = `<section class="activity-latest" aria-label="Latest update">
      <div class="activity-latest-label">Latest update <time>${frames[k].minute}:00</time></div>
      <h3>${esc(headline)}</h3>
      <p>${k === 0 ? 'Your selected starting point.' : first ? reason(first) : 'The model checked nearby buildings for spread.'}</p>
      ${first && (previous.burned.length || previous.extinguished.length) ? `<p class="activity-secondary">${esc(changeSummary({...previous, ignited: []}))}</p>` : ''}
      ${first ? locate(first.id, first.sourceId) : k === 0 ? locate(origin) : ''}
    </section>
    <p class="activity-next-brief">${risk ? `<b>Watch next:</b> ${name(risk.id)} · <strong>${esc(pct(risk.probability))}</strong> chance <em>Possible, not certain.</em>` :
      next ? 'No other buildings are exposed this step.' : `<b>Run ended.</b> ${row.Burning ? 'Time limit reached; some buildings are still burning.' : 'No buildings remain burning.'}`}</p>
    ${history.length ? `<section class="activity-history"><h3>Earlier</h3><ol>${history.join('')}</ol></section>` : ''}
    <p class="activity-footnote">The model uses ignition chances, not nearest-house order. A farther house can ignite while a nearer one does not. Amber links show calculated exposure; ember flight is not simulated.</p>`;
    panel.scrollTop = 0; // each new playback step starts with the latest update in view
  }

  function inspect(buildingId) {
    if (!current) return;
    inspectedId = buildingId;
    const h = IgnisBuildingHistory.read(current, buildingId);
    title.textContent = 'Building details';
    note.textContent = 'Saved run history · times measured from the start of the fire';
    open();
    const back = '<button class="history-back" data-history-back>Back to live activity</button>';
    if (!h) {
      body.innerHTML = `<p>This building was not included in this run. No fire outcome was calculated for it.</p>${back}`;
      focused = null; links = []; lastLinksKey = ''; drawLinks(lastMinute);
      return;
    }
    const stamp = m => { const s = Math.round(m * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`; };
    const labels = ['Did not ignite', 'Still burning at the end', 'Burned out', 'Put out by BFP'];
    const skipped = {
      'unavailable':'This house did not ignite. This older run did not save all non-ignition decisions, so a specific reason cannot be established. Start a new run to record them.',
      'not-assessed':'No burning neighbor was assessed for this house during the run under the model’s 60 m gap rule. This is not evidence that a wall shielded it.',
      'zero-chance':'The model assessed this house, but its calculated ignition chance was zero at every check. This does not mean the actual building is fireproof.',
      'draw-not-triggered':'This house was exposed in the model, but the saved random decision did not trigger ignition at any assessed step. It was not deliberately skipped in favor of a farther house.'
    };
    const decision = h.exposure ? {...h.exposure,...h.interval} : h.peak;
    const why = h.origin ? 'This is the starting house selected by the user. Its fire begins at 0:00.'
      : h.ignitedAt === null ? skipped[h.nonIgnition]
      : h.exposure ? reason(h.exposure) + (h.exposure.sourceCount > 1 ? ` It was exposed to ${h.exposure.sourceCount} burning buildings in that step.` : '')
      : 'The run recorded when this house ignited, but did not save a detailed explanation for that event.';
    const row = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    const stopped = h.finalState === 3 ? 'Put out by BFP' : 'Burned out';
    body.innerHTML = `<section class="activity-latest building-history" aria-label="Building history">
      <div class="activity-latest-label">${h.origin ? 'Selected starting house' : 'Recorded building outcome'}</div>
      <h3>${name(h.index)}</h3><p class="history-outcome" data-state="${h.finalState}">${labels[h.finalState]}</p>
      <dl>${row('Fire started', h.ignitedAt === null ? 'Did not ignite' : stamp(h.ignitedAt))}
      ${h.stoppedAt !== null ? row(stopped, stamp(h.stoppedAt)) : ''}
      ${h.burningMinutes !== null ? row(h.stoppedAt === null ? 'Burning time observed' : 'Time burning', `${stamp(h.burningMinutes)} (min:sec)`) : ''}
      ${row('Run ended', stamp(h.end))}</dl>
    </section>
    <section class="history-material" aria-label="Material used in this run"><h3>Material used in this run</h3>
      <p><b>${esc(h.material.label)}</b> <span class="history-assumption">${h.material.assumed ? 'Assumed' : 'Unverified'}</span></p>
      <p>${h.material.fuelLoad === null ? 'Fuel load was not saved.' : `Fuel load: <b>${h.material.fuelLoad} MJ/m²</b>.`} ${esc(h.material.source)}.</p>
      <small>${h.material.verification}. The class is inferred from fuel load; a traced roof does not identify its materials.</small>
    </section>
    <section class="history-reason"><h3>${h.ignitedAt === null ? 'Why it did not ignite' : 'Why the model ignited it'}</h3><p>${why}</p>
      ${h.ignitedAt === null && h.peak ? `<p><b>Highest-chance step: ${stamp(h.peak.from)}–${stamp(h.peak.to)}.</b> ${reason(h.peak)}</p>` : ''}
      ${h.interval ? `<p class="activity-secondary">Ignition recorded in the ${stamp(h.interval.from)}–${stamp(h.interval.to)} model step.</p>` : ''}
      ${h.exposure ? '<p class="activity-secondary">The source shown contributed the strongest exposure; it is not proof of a specific real-world ignition mechanism.</p>' : ''}
      ${h.finalState === 1 ? '<p class="activity-secondary">The run stopped while this house was still burning. Its eventual burnout time was not observed.</p>' : ''}
    </section>
    ${decision && Number.isFinite(decision.draw) ? `<details class="history-decisions"><summary>Recorded ignition decision</summary>
      <p>Ignition occurs only when the saved random number is <b>below</b> the ignition probability. Both numbers use the 0–1 scale.</p>
      <dl>${row('Probability', String(decision.probability))}${row('Saved random number', String(decision.draw))}
      ${row('Outcome',decision.draw < decision.probability ? 'Ignited' : 'Did not ignite')}</dl>
      <p>These are the original numbers from the simulation, not a new random decision.</p></details>` : ''}
    ${h.checks.length ? `<details class="history-decisions"><summary>All recorded checks (${h.checks.length})</summary><table>
      <thead><tr><th>Model step</th><th>Chance</th><th>Decision</th></tr></thead><tbody>${h.checks.map(c=>`<tr><td>${stamp(c.from)}–${stamp(c.to)}</td><td>${esc(pct(c.probability))}</td><td>${c.ignited?'Ignited':'Did not ignite'}</td></tr>`).join('')}</tbody></table></details>` : ''}
    ${decision ? `<button class="activity-locate" data-building="${decision.sourceId}" aria-label="Locate strongest exposure source">Locate source: ${name(decision.sourceId)} ↗</button>` : ''}
    ${back}<p class="activity-footnote">Recorded model predictions. A farther house can ignite before a nearer one. This model does not calculate shielding by intervening buildings, accumulated heat, or ember flight.</p>`;
    focused = {id:h.index, sourceId:decision?.sourceId};
    lastLinksKey = ''; drawLinks(lastMinute); panel.scrollTop = 0;
  }

  function status(minute, playing) {
    if (busy || !current) return;
    const ended = minute >= current.result.frames.at(-1).minute;
    const label = ended ? 'Run complete' : playing ? 'Playing recorded run' : 'Paused';
    if (label !== lastStatus) {
      state.textContent = label; lastStatus = label;
      state.dataset.mode = ended ? 'complete' : playing ? 'playing' : 'paused';
    }
    const seconds = Math.floor(minute * 60);
    const stamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (time.textContent !== stamp) time.textContent = stamp;
    lastMinute = minute;
    drawLinks(minute);
  }

  function centreOf(id) {
    if (!centres.has(id)) {
      const bounds = new maplibregl.LngLatBounds();
      current.features[id].geometry.coordinates[0].forEach(p => bounds.extend(p));
      centres.set(id, bounds.getCenter());
    }
    return centres.get(id);
  }

  function drawLinks(minute) {
    if (!linkCanvas) return;
    const ctx = linkCanvas.getContext('2d'), {clientWidth: w, clientHeight: h} = map.getContainer();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const shown = focused ? [focused] : minute - linkMinute < 0.6 ? links : [];
    const centre = map.getCenter();
    const key = shown.length ? [w, h, ratio, centre.lng, centre.lat, map.getZoom(), map.getBearing(), map.getPitch(), shown.map(e => `${e.sourceId}:${e.id}`).join(',')].join('|') : 'empty';
    if (key === lastLinksKey) return;
    lastLinksKey = key;
    if (linkCanvas.width !== Math.round(w * ratio) || linkCanvas.height !== Math.round(h * ratio)) {
      linkCanvas.width = Math.round(w * ratio); linkCanvas.height = Math.round(h * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w, h);
    for (const e of shown) {
      const b = map.project(centreOf(e.id));
      ctx.setLineDash([]);
      ctx.lineWidth = focused ? 4 : 2; ctx.strokeStyle = focused ? '#fff' : '#a85b00';
      ctx.beginPath(); ctx.arc(b.x, b.y, focused ? 13 : 9, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#a85b00';
      if (focused) { ctx.beginPath(); ctx.arc(b.x, b.y, 13, 0, Math.PI * 2); ctx.stroke(); }
      if (e.sourceId === undefined) continue;
      const a = map.project(centreOf(e.sourceId));
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.lineWidth = 2; ctx.strokeStyle = '#a85b00'; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(b.x - 8 * Math.cos(angle - 0.5), b.y - 8 * Math.sin(angle - 0.5));
      ctx.lineTo(b.x, b.y); ctx.lineTo(b.x - 8 * Math.cos(angle + 0.5), b.y - 8 * Math.sin(angle + 0.5)); ctx.stroke();
    }
  }

  function clear() {
    inspectedId = null;
    title.textContent = 'Live activity';
    note.textContent = 'Updates with playback · recorded model decisions';
    current = null; busy = false; panel.hidden = true; panel.removeAttribute('aria-busy');
    toggle.setAttribute('aria-pressed', 'false');
    linkCanvas?.remove(); linkCanvas = null; links = []; focused = null; centres.clear();
    lastLinksKey = '';
  }

  function fail(message) {
    busy = false;
    current = null;
    panel.removeAttribute('aria-busy');
    state.textContent = 'Calculation stopped';
    state.dataset.mode = 'error';
    body.textContent = message;
  }

  body.addEventListener('click', event => {
    if (event.target.closest('[data-history-back]') && current) {
      inspectedId = null; render(current, current.result.frames.length - 1); drawLinks(lastMinute); return;
    }
    const button = event.target.closest('[data-building]');
    if (!button || !current) return;
    const id = Number(button.dataset.building), ring = current.features[id].geometry.coordinates[0];
    focused = {id, sourceId: button.dataset.source === undefined ? undefined : Number(button.dataset.source)};
    lastLinksKey = '';
    const bounds = new maplibregl.LngLatBounds();
    ring.forEach(p => bounds.extend(p));
    map.easeTo({center: bounds.getCenter(), zoom: Math.max(map.getZoom(), 18), duration: 500,
      padding: {top: 80, bottom: $('#playback').getBoundingClientRect().height + 50, left: 20, right: window.innerWidth > 700 ? 400 : 20}});
    drawLinks(lastMinute);
  });

  return {stage, show, render, status, clear, fail, inspect};
})();
