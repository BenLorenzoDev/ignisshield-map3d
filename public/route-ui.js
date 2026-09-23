/* global map, showHint, $, IgnisRouting, runBuildings, modelInputs, fireAffectedNow, openSide, SIDE, playTimer, frameIndex, run */
// Evacuation and fire-truck routing on the inventory's road network (IgnisShield-Web's routing model).
const rui = {
  btn: $('#routes-btn'), panel: $('#routes'), showRoads: $('#show-roads'),
  mode: $('#rt-mode'), purpose: $('#rt-purpose'), speed: $('#rt-speed'), width: $('#rt-width'),
  avoid: $('#rt-avoid'), clearance: $('#rt-clearance'), ret: $('#rt-return'), stopsRow: $('#rt-stops-row'),
  pickStart: $('#pick-start'), pickEnd: $('#pick-end'), pickStops: $('#pick-stops'), clearPicks: $('#clear-picks'),
  picks: $('#rt-picks'), find: $('#rt-find'), usable: $('#rt-usable'), result: $('#rt-result')
};
SIDE.routes = [rui.btn, rui.panel];
rui.btn.addEventListener('click', () => openSide('routes'));

let roads = [];
let net = null;       // result of IgnisRouting.buildGraph for the current settings
let picking = null;   // 'start' | 'end' | 'stops'
const picks = {start: null, end: null, stops: []};
let rebuildTimer = null;

function initRoutes(data) {
  roads = data.features.filter(f => f.properties.kind === 'road');
  map.addSource('roads', {type: 'geojson', data: {type: 'FeatureCollection', features: roads}});
  // Colour by recorded width: red < 2 m, orange < 3.5 m, yellow < 5 m, grey wider
  map.addLayer({id: 'roads', type: 'line', source: 'roads', layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': ['step', ['get', 'alley_wd'], '#e53935', 2, '#fb8c00', 3.5, '#fdd835', 5, '#9e9e9e'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 4], 'line-opacity': 0.9}}, 'buildings-3d');
  map.addSource('route', {type: 'geojson', data: empty()});
  map.addLayer({id: 'route-base', type: 'line', source: 'route', filter: ['==', ['get', 'route'], 'baseline'],
    layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': '#37474f', 'line-width': 5, 'line-dasharray': [1.5, 1.2]}});
  map.addLayer({id: 'route-best', type: 'line', source: 'route', filter: ['==', ['get', 'route'], 'optimized'],
    layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': '#00c853', 'line-width': 6, 'line-opacity': 0.9}});
  map.addSource('route-nodes', {type: 'geojson', data: empty()});
  map.addLayer({id: 'route-nodes', type: 'circle', source: 'route-nodes', layout: {visibility: 'none'},
    paint: {'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#263238', 'circle-stroke-width': 1.5}});
  map.addSource('route-picks', {type: 'geojson', data: empty()});
  map.addLayer({id: 'route-picks', type: 'circle', source: 'route-picks',
    paint: {'circle-radius': 10, 'circle-color': ['match', ['get', 'role'], 'start', '#2e7d32', 'end', '#c62828', '#1565c0'],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 2}});
  map.addLayer({id: 'route-pick-labels', type: 'symbol', source: 'route-picks',
    layout: {'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-allow-overlap': true},
    paint: {'text-color': '#fff'}});
}

// Called by fire-ui when a right-hand panel opens or closes
function onSideChange() {
  const open = !rui.panel.hidden;
  if (!map.getLayer('route-nodes')) return;
  map.setLayoutProperty('route-nodes', 'visibility', open ? 'visible' : 'none');
  if (open) rebuild(); else setPicking(null);
}
// Called by fire-ui whenever the fire minute on screen changes
function onFireFrame() {
  if (rui.panel.hidden || !rui.avoid.checked) return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, playTimer ? 1500 : 200);
}

function settings() {
  const num = (el, lo, hi, label) => {
    const v = Number(el.value);
    if (el.value === '' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${label} must be a number from ${lo} to ${hi}.`);
    return v;
  };
  return {mode: rui.mode.value, speed: num(rui.speed, 0.1, 120, 'Speed'), width: num(rui.width, 0.1, 20, 'Minimum width'),
    clearance: num(rui.clearance, 0, 100, 'Fire clearance')};
}

function rebuild() {
  try {
    const features = runBuildings();
    const inputs = modelInputs(features);
    const hazards = rui.avoid.checked ? fireAffectedNow() : [];
    net = IgnisRouting.buildGraph(roads, features.map((f, i) => ({feature: f, bldg_dens: inputs[i].bldg_dens})), hazards, settings());
    const ex = net.excluded;
    rui.usable.textContent = `${net.graph.adj.size} usable junctions. Road segments left out: ${ex.width} too narrow, ${ex.access} no access for this mode, ${ex.fire} within the fire clearance${hazards.length ? ` (${hazards.length} buildings affected at the minute on screen)` : ''}.`;
    map.getSource('route-nodes').setData({type: 'FeatureCollection', features: [...net.coords].map(([id, c]) => ({
      type: 'Feature', geometry: {type: 'Point', coordinates: c.lonlat}, properties: {id}
    }))});
  } catch (err) {
    net = null;
    rui.usable.textContent = err.message;
    map.getSource('route-nodes').setData(empty());
  }
  renderPicks();
}

function setPicking(mode) {
  picking = mode;
  for (const [el, m] of [[rui.pickStart, 'start'], [rui.pickEnd, 'end'], [rui.pickStops, 'stops']]) el.setAttribute('aria-pressed', String(picking === m));
  rui.pickStops.textContent = picking === 'stops' ? 'Done adding' : 'Add checkpoints';
  map.getCanvas().style.cursor = picking ? 'crosshair' : '';
  if (picking) showHint(picking === 'stops' ? 'Click junction dots to add or remove checkpoints, then press Done adding.' : `Click a junction dot for the ${picking === 'start' ? 'start' : 'destination'}.`);
  else if (!rui.panel.hidden) $('#hint').hidden = true;
}

/** Map click while picking junctions. Returns true when the click was used here. */
function routeClick(e) {
  if (!picking) return false;
  const hit = map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], {layers: ['route-nodes']})[0];
  if (!hit) { showHint('No usable junction there. Click one of the white dots.', 3000); return true; }
  const id = hit.properties.id;
  if (picking === 'start') { picks.start = id; picks.stops = picks.stops.filter(s => s !== id); setPicking(null); }
  else if (picking === 'end') { picks.end = id; picks.stops = picks.stops.filter(s => s !== id); setPicking(null); }
  else if (id !== picks.start && id !== picks.end) {
    picks.stops = picks.stops.includes(id) ? picks.stops.filter(s => s !== id) : [...picks.stops, id];
    if (picks.stops.length > 20) { picks.stops.pop(); showHint('Use at most 20 checkpoints.', 4000); }
  }
  renderPicks();
  return true;
}

function renderPicks() {
  const checkpoints = rui.purpose.value === 'Checkpoints';
  rui.stopsRow.hidden = !checkpoints;
  rui.pickEnd.disabled = checkpoints && rui.ret.checked;
  const where = id => net?.coords.get(id)?.lonlat;
  const pts = [];
  if (picks.start && where(picks.start)) pts.push({id: picks.start, role: 'start', label: 'S'});
  if (!(checkpoints && rui.ret.checked) && picks.end && where(picks.end)) pts.push({id: picks.end, role: 'end', label: 'D'});
  if (checkpoints) picks.stops.forEach((id, i) => { if (where(id)) pts.push({id, role: 'stop', label: String(i + 1)}); });
  map.getSource('route-picks')?.setData({type: 'FeatureCollection', features: pts.map(p => ({
    type: 'Feature', geometry: {type: 'Point', coordinates: where(p.id)}, properties: p
  }))});
  const missing = [picks.start, picks.end, ...picks.stops].filter(id => id && net && !net.coords.has(id)).length;
  rui.picks.textContent = [
    `Start: ${picks.start ?? '—'}`,
    checkpoints && rui.ret.checked ? 'Return to start' : `Destination: ${picks.end ?? '—'}`,
    checkpoints ? `Checkpoints: ${picks.stops.length} (in the order you clicked)` : '',
    missing ? `${missing} picked junction(s) are not usable with these settings.` : ''
  ].filter(Boolean).join(' · ');
}

function findRoutes() {
  try {
    if (!net) rebuild();
    if (!net) throw new Error(rui.usable.textContent);
    const purpose = rui.purpose.value;
    const end = purpose === 'Checkpoints' && rui.ret.checked ? picks.start : picks.end;
    if (!picks.start || !end) throw new Error('Pick a start and a destination junction first.');
    const r = IgnisRouting.route(net, {purpose, start: picks.start, end, checkpoints: purpose === 'Checkpoints' ? picks.stops : []});
    const lines = [];
    for (const [key, route] of [['baseline', r.baseline], ['optimized', r.optimized]]) {
      for (const f of route.geometry.features) lines.push({type: 'Feature', geometry: f.geometry, properties: {route: key}});
    }
    map.getSource('route').setData({type: 'FeatureCollection', features: lines});
    const fmt = (m, d = 1) => Number(m.toFixed(d)).toLocaleString();
    const s = settings();
    const pct = r.baseline.minutes ? r.saved_minutes / r.baseline.minutes * 100 : 0;
    const names = purpose === 'Evacuation' ? ['Baseline: shortest distance', 'Optimised: fastest modelled time'] : ['Baseline: checkpoints in entered order', 'Optimised: best visiting order (Hamiltonian)'];
    rui.result.innerHTML = `
      <div class="route-row"><i class="swatch dash"></i><span>${names[0]}</span><b>${fmt(r.baseline.minutes)} min</b><span>${fmt(r.baseline.length, 0)} m</span></div>
      <div class="route-row"><i class="swatch best"></i><span>${names[1]}</span><b>${fmt(r.optimized.minutes)} min</b><span>${fmt(r.optimized.length, 0)} m</span></div>
      <div><b>Time saved: ${fmt(r.saved_minutes, 2)} min (${fmt(pct)} %)</b></div>
      ${purpose === 'Checkpoints' ? `<div class="small">Optimised order: ${r.optimized.order.map(id => (id === picks.start ? 'S' : id === picks.end ? 'D' : picks.stops.indexOf(id) + 1)).join(' → ')}</div>` : ''}
      <div class="muted small">${r.method}. ${s.mode} at ${s.speed} km/h on roads at least ${s.width} m wide${rui.avoid.checked ? `, ${s.clearance} m clear of the fire at the minute on screen` : ''}. Static travel times: no crowding or live traffic. A zero saving is a valid result.</div>`;
  } catch (err) {
    map.getSource('route').setData(empty());
    rui.result.textContent = err.message;
  }
}

rui.mode.addEventListener('change', () => {
  const walking = rui.mode.value === 'Walking';
  rui.speed.value = walking ? 4.5 : 15;
  rui.width.value = walking ? 0.8 : 2.5;
  rebuild();
});
for (const el of [rui.speed, rui.width, rui.clearance, rui.avoid]) el.addEventListener('change', rebuild);
rui.purpose.addEventListener('change', renderPicks);
rui.ret.addEventListener('change', renderPicks);
rui.pickStart.addEventListener('click', () => setPicking(picking === 'start' ? null : 'start'));
rui.pickEnd.addEventListener('click', () => setPicking(picking === 'end' ? null : 'end'));
rui.pickStops.addEventListener('click', () => setPicking(picking === 'stops' ? null : 'stops'));
rui.clearPicks.addEventListener('click', () => {
  picks.start = picks.end = null; picks.stops = [];
  setPicking(null); renderPicks();
  map.getSource('route').setData(empty());
  rui.result.textContent = '';
});
rui.find.addEventListener('click', findRoutes);
rui.showRoads.addEventListener('change', () => map.setLayoutProperty('roads', 'visibility', rui.showRoads.checked ? 'visible' : 'none'));
