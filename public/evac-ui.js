/* global map, $, cloud, canEdit, requireEdit, showHint, empty, esc, IgnisEvac, rui, roads, fieldPaths */
// Evacuation display: residents walking to safety during fire playback, and the class's safe areas.
const SAFE_KEY = 'ignisshield-map3d.safe-areas';
const eui = {list: $('#safe-list'), add: $('#add-safe'), toggle: $('#evac-toggle'), summary: $('#evac-summary'), live: $('#evac-live')};
let safeAreas = [];
let safePicking = false;
let evacShown = null;      // evacuation result on screen
let evacLastRoutes = -1;   // minute whose routes are drawn
let evacLastMarkers = '', evacLastCounts = '', evacLastView = '';
let evacLastPeople = '';
let evacRepresentatives = null, evacLastSelection = -Infinity, evacSelectionCamera = '';
let evacMarkerKeys = {};
let evacActors = null;
let waterPolys = [];       // sea, river and ponds (OpenStreetMap): nobody walks across them
let evacLoading = Promise.resolve();
const routingReview = $('#evac-routing-review');
map.on('moveend', () => { if (evacShown) evacTick(typeof displayMinute === 'number' ? displayMinute : 0); });

async function initEvac() {
  try {
    const w = await (await fetch('data/water.geojson')).json();
    waterPolys = w.features.filter(f => f.properties.kind === 'water').flatMap(f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates));
    map.addSource('bridges', {type: 'geojson', data: {type: 'FeatureCollection', features: w.features.filter(f => f.properties.kind === 'bridge')}});
    map.addLayer({id: 'bridges', type: 'line', source: 'bridges', layout: {'line-cap': 'butt'},
      paint: {'line-color': '#6d4c41', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 4, 19, 12], 'line-opacity': 0.55}}, 'roads');
  } catch { /* evacuation still works, without the water check */ }
  // Preserve tight alley bends: map tiling must not simplify a safe detour into a shortcut.
  map.addSource('evac-routes', {type: 'geojson', data: empty(), tolerance:0});
  map.addSource('survey-walks', {type: 'geojson', data: empty(), tolerance:0});
  map.addLayer({id: 'survey-walks', type: 'line', source: 'survey-walks',
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': '#b216a6', 'line-width': 2.5, 'line-opacity': 0.85}}, 'buildings-3d');
  map.addLayer({id: 'evac-routes', type: 'line', source: 'evac-routes', layout: {'line-cap': 'round', 'line-join': 'round'},
    filter: ['!', ['get', 'access']], paint: {'line-color': '#00e676', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 4], 'line-opacity': 0.75}});
  // House access uses the recorded detour geometry, with entrances still inferred.
  // Both layers use the same source; inverse-scaled dash lengths keep the outline aligned.
  map.addLayer({id: 'evac-access-outline', type: 'line', source: 'evac-routes', filter: ['get', 'access'],
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': '#10382b', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.6, 19, 2.4, 22, 3.2],
      'line-opacity': 0.65, 'line-dasharray': [1.25, 1.5625]}}, 'evac-routes');
  map.addLayer({id: 'evac-access', type: 'line', source: 'evac-routes', filter: ['get', 'access'],
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': '#00ff88', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 1.5, 22, 2],
      'line-opacity': 0.9, 'line-dasharray': [2, 2.5]}}, 'evac-routes');
  evacActors = IgnisWalkers.create(map, personImages());
  // Say what each group means directly; viewers should not have to decode symbols.
  for (const [status, color, label] of [
    ['arrived', '#24643b', 'Reached safety'], ['trapped', '#785000', 'No safe route'], ['nopath', '#435361', 'Path unknown']
  ]) {
    const source = `evac-${status}`;
    map.addSource(source, {type: 'geojson', data: empty(), cluster: true, clusterRadius: 150, clusterMaxZoom: 21, maxzoom: 22,
      clusterProperties: {people: ['+', ['get', 'people']]}});
    map.addLayer({id: `${source}-label`, type: 'symbol', source,
      layout: {'text-field': ['concat', ['to-string', ['get', 'people']], ' people\n', label], 'text-font': ['Noto Sans Bold'],
        'text-size': 11, 'text-line-height': 1.2, 'text-padding': 8, 'text-allow-overlap': false, 'text-ignore-placement': false},
      paint: {'text-color': color, 'text-halo-color': '#fff', 'text-halo-width': 2}});
  }
  map.addSource('safe-areas', {type: 'geojson', data: empty()});
  map.addLayer({id: 'safe-areas', type: 'circle', source: 'safe-areas',
    paint: {'circle-radius': 9, 'circle-color': '#00c853', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5}});
  map.addLayer({id: 'safe-area-labels', type: 'symbol', source: 'safe-areas',
    layout: {'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.4], 'text-anchor': 'top'},
    paint: {'text-color': '#1b5e20', 'text-halo-color': '#fff', 'text-halo-width': 2}});
  try {
    const stored = cloud.enabled ? await cloud.loadSetting('safe_areas') : JSON.parse(localStorage.getItem(SAFE_KEY) || 'null');
    if (Array.isArray(stored)) safeAreas = stored;
  } catch { /* none yet */ }
  renderSafe();
}

// ---------- safe areas ----------
function renderSafe() {
  map.getSource('safe-areas')?.setData({type: 'FeatureCollection', features: safeAreas.map(s => ({type: 'Feature', geometry: {type: 'Point', coordinates: s.lonlat}, properties: {name: s.name}}))});
  const edit = canEdit();
  eui.list.innerHTML = safeAreas.length
    ? safeAreas.map((s, i) => `<div class="track-row"><input data-safe="${i}" value="${esc(s.name)}" maxlength="40" ${edit ? '' : 'disabled'}>${edit ? `<button data-del="${i}">Delete</button>` : ''}</div>`).join('')
    : '<span class="muted">None yet: people walk to the main road.</span>';
  eui.add.hidden = !edit;
}
async function saveSafe() {
  try {
    if (cloud.enabled) await cloud.saveSetting('safe_areas', safeAreas);
    else localStorage.setItem(SAFE_KEY, JSON.stringify(safeAreas));
  } catch (err) { showHint(`Could not save the safe areas: ${err.message}`, 8000); }
  renderSafe();
}
function onRemoteSafeAreas(value) { if (Array.isArray(value)) { safeAreas = value; renderSafe(); } }
eui.add.addEventListener('click', () => {
  if (!requireEdit()) return;
  safePicking = !safePicking;
  eui.add.textContent = safePicking ? 'Click the map…' : 'Add safe area';
  map.getCanvas().style.cursor = safePicking ? 'crosshair' : '';
  if (safePicking) showHint('Click the map where people should gather (an open space such as a covered court or plaza).', 6000);
});
eui.list.addEventListener('change', e => {
  const i = e.target.dataset.safe;
  if (i === undefined || !requireEdit()) return;
  safeAreas[i].name = e.target.value.trim().slice(0, 40) || `Safe area ${Number(i) + 1}`;
  saveSafe();
});
eui.list.addEventListener('click', e => {
  const i = e.target.dataset.del;
  if (i === undefined || !requireEdit()) return;
  safeAreas.splice(Number(i), 1);
  saveSafe();
});
/** Map click while adding a safe area. Returns true when used (app.js). */
function safeClick(e) {
  if (!safePicking) return false;
  safePicking = false;
  eui.add.textContent = 'Add safe area';
  map.getCanvas().style.cursor = '';
  safeAreas.push({lonlat: [+e.lngLat.lng.toFixed(7), +e.lngLat.lat.toFixed(7)], name: `Safe area ${safeAreas.length + 1}`});
  saveSafe();
  showHint('Safe area added. Rename it in the Routes panel. It is used by the next fire you start.', 6000);
  return true;
}

/** Evacuation calculator for a batch of runs. Normal routes always check mapped obstacles. */
async function prepareEvac(features, inputs, households) {
  await Promise.all([fieldLoading, evacLoading]);
  const settings = bfpSettings();
  const data = {features, inputs, densities: inputs.map(m => m.bldg_dens), households, roads, paths: fieldPaths(), safePoints: safeAreas, water: waterPolys,
    routingMode: 'obstacle-aware', bfp: settings.on ? {station: bfpStation.lonlat, params: settings} : null};
  {
    const worker = new Worker('evac-preview-worker.js?v=20260924-routes1'), pending = new Map();
    let sequence = 0;
    const dispose = () => { worker.terminate(); for (const p of pending.values()) p.reject(new Error('Simulation preparation stopped.')); pending.clear(); };
    worker.onmessage = ({data: message}) => {
      const p = pending.get(message.id); if (!p) return;
      if (message.progress) { activity.stage('Preparing simulation', message.progress); return; }
      if (message.warning) { showHint(message.warning, 8000); return; }
      pending.delete(message.id);
      if (message.error) p.reject(new Error(message.error)); else p.resolve(message.value);
    };
    worker.onerror = event => { for (const p of pending.values()) p.reject(new Error(event.message || 'Could not prepare surveyed routes.')); pending.clear(); worker.terminate(); };
    const request = (action, data) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, {resolve, reject}); worker.postMessage({id, action, data}); });
    try {
      await request('prepare', {...data, tracks: tracks.features, obstacles: store.features});
      return {run: args => request('run', args), dispose, routingMode:data.routingMode, bfpSettings:settings};
    } catch (err) { dispose(); throw err; }
  }
}

// ---------- playback ----------
function evacShow(r) {
  evacShown = r?.evac ?? null;
  evacActors?.setRun(evacShown?.groups ?? []);
  evacLastRoutes = -1;
  evacLastMarkers = evacLastCounts = evacLastView = '';
  evacLastPeople = '';
  evacRepresentatives = null; evacLastSelection = -Infinity; evacSelectionCamera = ''; evacMarkerKeys = {};
  const s = evacShown?.summary;
  const preview = evacShown?.preview;
  routingReview.hidden = !preview; routingReview.open = false;
  if (preview) {
    const d = preview.diagnostics, old = preview.baseline;
    const row = (label, before, after) => `<tr><th scope="row">${label}</th><td>${before}</td><td>${after}</td></tr>`;
    routingReview.innerHTML = `<summary>Routes avoid buildings · Compare with original assumptions</summary>
      <p><b>${d.paths} GPS-derived alley sections</b> prepared. <b>${evacShown.groups.filter(g => g.usesSurveyedAlley).length} groups of residents</b> use surveyed alleys in this run. Purple lines show candidate alleys; green shows the route people take.</p>
      <p>House connections avoid mapped footprints and water. GPS positions were adjusted where necessary; doors, widths and passage access still need field review.</p>
      <p>Calculated evacuation outcomes below can extend beyond the fire playback. The live people counts above show the current minute.</p>
      <table><thead><tr><th>People / travel time</th><th>Original assumptions</th><th>Avoiding obstacles</th></tr></thead><tbody>
      ${row('Reached safety', old.safe, s.safe)}${row('No safe route', old.trapped, s.trapped)}${row('Path unresolved', old.nopath, s.nopath)}
      ${row('Average time for those reaching safety', `${old.avgMin.toFixed(1)} min`, `${s.avgMin.toFixed(1)} min`)}</tbody></table>
      <p>Same recorded fire in both comparisons. ${d.unresolvedSegments} GPS connections could not be resolved; ${d.excludedObstacles} unusable network sections were excluded. Original survey data is unchanged.</p>`;
  }
  map.getSource('survey-walks')?.setData({type: 'FeatureCollection', features: preview?.derived ?? []});
  if (map.getLayer('survey-walks')) map.setLayoutProperty('survey-walks', 'visibility', pui.showTracks.checked ? 'visible' : 'none');
  if (map.getLayer('tracks')) map.setPaintProperty('tracks', 'line-opacity', preview ? 0.2 : 0.75);
  eui.summary.innerHTML = s ? `<b>Evacuation on foot:</b> ${s.people.toLocaleString()} people from ${s.buildings.toLocaleString()} buildings left home.
    <span class="ev-safe">${s.safe.toLocaleString()} reached safety</span> (average ${s.avgMin.toFixed(1)} min, longest ${s.maxMin.toFixed(1)} min)${s.trapped ? `, <span class="ev-trapped">${s.trapped.toLocaleString()} had no safe route</span>` : ''}${s.nopath ? `, ${s.nopath.toLocaleString()} live where no path is mapped yet` : ''}. These are route outcomes; injuries and deaths are not calculated.` : '';
  eui.summary.hidden = !s;
  evacTick(0);
}
// ---------- human figures (drawn once, used as map icons) ----------
const FIGURE = {moving: ['#ffffff', '#1b2a33']};
const POSES = {
  // [head centre, [limbs as polylines]] on a 28 × 40 box, feet at the bottom
  runA: [[16, 7], [[[15, 12], [12, 24]], [[12, 24], [17, 30], [21, 37]], [[12, 24], [8, 31], [3, 34]], [[14.5, 14], [19, 19], [23, 16]], [[14.5, 14], [9, 18], [6, 23]]]],
  runB: [[16, 7], [[[15, 12], [12, 24]], [[12, 24], [14, 31], [10, 38]], [[12, 24], [17, 29], [20, 33]], [[14.5, 14], [10, 19], [7, 16]], [[14.5, 14], [19, 18], [21, 23]]]],
};
function drawPerson(pose, [fill, stroke], mirror) {
  const W = 28, H = 40, k = 2, c = document.createElement('canvas');
  c.width = W * k; c.height = H * k;
  const g = c.getContext('2d');
  g.scale(k, k);
  if (mirror) { g.translate(W, 0); g.scale(-1, 1); }
  g.lineCap = g.lineJoin = 'round';
  const [head, limbs] = POSES[pose];
  const pass = (color, grow) => {
    g.strokeStyle = g.fillStyle = color;
    for (const l of limbs) { g.lineWidth = 3.4 + grow; g.beginPath(); g.moveTo(...l[0]); for (const p of l.slice(1)) g.lineTo(...p); g.stroke(); }
    g.beginPath(); g.arc(head[0], head[1], 4.3 + grow / 2, 0, Math.PI * 2); g.fill();
  };
  pass(stroke, 2.6);  // outline
  pass(fill, 0);
  return g.getImageData(0, 0, W * k, H * k);
}
function personImages() {
  const out = [];
  for (const pose of ['runA', 'runB']) for (const m of [false, true]) out.push([`p-${pose}${m ? '-l' : ''}`, drawPerson(pose, FIGURE.moving, m)]);
  return out;
}
// legend images in the playback bar
for (const [el, pose, state] of [['moving', 'runA', 'moving']]) {
  const img = drawPerson(pose, FIGURE[state]), c = document.createElement('canvas');
  c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0);
  document.querySelectorAll(`.fig-${el}`).forEach(i => { i.src = c.toDataURL(); });
}

/** Called every animation update with the playback minute (fire-ui loop). */
function evacTick(minute) {
  const on = eui.toggle.checked && evacShown;
  if (!on) {
    if (evacLastRoutes !== -2) {
      for (const source of ['evac-routes', 'evac-arrived', 'evac-trapped', 'evac-nopath']) map.getSource(source)?.setData(empty());
      evacActors?.setVisible([]);
      evacLastRoutes = -2; evacLastMarkers = ''; evacLastView = ''; evacLastPeople = ''; evacRepresentatives = null; evacMarkerKeys = {};
    }
    eui.live.hidden = !evacShown;
    if (evacShown) eui.live.textContent = 'Evacuation overlay hidden. Turn it on to see route status and current counts.';
    evacLastCounts = '';
    return;
  }
  const people = [], stationary = {arrived: [], trapped: [], nopath: []};
  const counts = {moving: 0, arrived: 0, trapped: 0, nopath: 0}, activeRoutes = [];
  const stride = Math.floor((typeof clock === 'number' ? clock : 0) * 6); // legs swap about 3 times a second (real time)
  for (const g of evacShown.groups) {
    const p = IgnisEvac.positionAt(g, minute);
    if (!p) continue;
    counts[p.state] += g.people;
    if (p.state === 'moving') {
      const faceLeft = Math.sin(p.heading - map.getBearing() * Math.PI / 180) < -0.001;
      people.push({type: 'Feature', geometry: {type: 'Point', coordinates: p.at}, properties: {
        icon: `p-${(stride + g.i) % 2 ? 'runB' : 'runA'}${faceLeft ? '-l' : ''}`, order: g.i}});
      activeRoutes.push(g);
    } else stationary[p.state].push({type: 'Feature', geometry: {type: 'Point', coordinates: p.at}, properties: {people: g.people}});
  }
  // Representative selection is independent of movement; GPU actors keep advancing on their
  // recorded segments during camera gestures without map-symbol placement or GeoJSON updates.
  const now = performance.now(), centre = map.getCenter();
  const camera = [centre.lng, centre.lat, map.getZoom(), map.getPitch(), map.getBearing()].join(',');
  if (!evacRepresentatives || now - evacLastSelection > 500) {
    evacLastSelection = now; evacSelectionCamera = camera; evacRepresentatives = new Set();
    // Approximate spacing on the Mercator plane is sufficient for representative selection.
    // The map still renders their exact recorded coordinates on the terrain.
    const occupied = new Set(), scale = 512 * 2 ** map.getZoom();
    const quality=renderPerformance.profile, bounds=map.getBounds();
    const angle = map.getBearing() * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const pitchScale = Math.max(0.25, Math.cos(map.getPitch() * Math.PI / 180));
    for (const f of people) {
      if(evacRepresentatives.size>=quality.walkers)break;
      if(!bounds.contains(f.geometry.coordinates))continue;
      const p = maplibregl.MercatorCoordinate.fromLngLat(f.geometry.coordinates);
      const x = Math.floor((p.x * cos + p.y * sin) * scale / quality.spacing);
      const y = Math.floor((-p.x * sin + p.y * cos) * scale * pitchScale / quality.spacing);
      if (occupied.has(`${x},${y}`)) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) occupied.add(`${x + dx},${y + dy}`);
      evacRepresentatives.add(f.properties.order);
    }
  }
  const visible = people.filter(f => evacRepresentatives.has(f.properties.order));
  evacActors?.setVisible(visible.map(f => f.properties.order));
  const markerKey = JSON.stringify(stationary);
  if (markerKey !== evacLastMarkers) {
    evacLastMarkers = markerKey;
    for (const [status, features] of Object.entries(stationary)) {
      const key = JSON.stringify(features);
      if (evacMarkerKeys[status] === key) continue;
      evacMarkerKeys[status] = key;
      map.getSource(`evac-${status}`).setData({type: 'FeatureCollection', features});
    }
  }
  const countKey = JSON.stringify(counts);
  if (countKey !== evacLastCounts) {
    evacLastCounts = countKey; eui.live.hidden = false;
    eui.live.innerHTML = `<b>People now</b><span>${counts.moving.toLocaleString()} walking to safety</span>
      <span class="ev-safe">${counts.arrived.toLocaleString()} reached safety</span>
      <span class="ev-trapped">${counts.trapped.toLocaleString()} have no safe route</span>
      <span>${counts.nopath.toLocaleString()} have an unknown path</span>
      <small>These are people, not death counts. “Path unknown” means the map has no usable connection for that group.</small>`;
  }
  const m = Math.floor(minute);
  const routeView = activeRoutes.map(g => g.i).join(',');
  if (m !== evacLastRoutes || routeView !== evacLastView) { // recorded routes for groups currently walking
    evacLastRoutes = m;
    evacLastView = routeView;
    map.getSource('evac-routes').setData({type: 'FeatureCollection', features: activeRoutes
      .flatMap(g => {
        const end = Math.min(g.accessEnd ?? 1, g.coords.length - 1);
        return [{type: 'Feature', geometry: {type: 'LineString', coordinates: g.coords.slice(0, end + 1)}, properties: {access: true, group: g.i}},
          ...(g.coords.length > end + 1 ? [{type: 'Feature', geometry: {type: 'LineString', coordinates: g.coords.slice(end)}, properties: {access: false, group: g.i}}] : [])];
      })});
  }
}
function evacClear() {
  evacShown = null; evacTick(0); eui.summary.hidden = true; routingReview.hidden = true;
  evacActors?.clear();
  map.getSource('survey-walks')?.setData(empty());
  if (map.getLayer('tracks')) map.setPaintProperty('tracks', 'line-opacity', 0.75);
}
eui.toggle.addEventListener('change', () => { evacLastRoutes = -1; evacTick(typeof displayMinute === 'number' ? displayMinute : 0); });

// ---------- legend ----------
const LEGEND_KEY = 'ignisshield-map3d.legend-closed';
const legend = $('#legend'), legendBtn = $('#legend-btn');
function setLegend(open) { legend.hidden = !open; document.body.classList.toggle('legend-open', open); legendBtn.setAttribute('aria-pressed', String(open)); updateGuide(); }
legendBtn.addEventListener('click', () => { setLegend(legend.hidden); try { localStorage.setItem(LEGEND_KEY, legend.hidden ? '1' : '0'); } catch { /* not remembered */ } });
$('#legend-close').addEventListener('click', () => { setLegend(false); try { localStorage.setItem(LEGEND_KEY, '1'); } catch { /* not remembered */ } });
/** Open the legend when a fire starts, unless the user closed it before or the screen is small. */
function legendForFire() {
  let closed = false;
  try { closed = localStorage.getItem(LEGEND_KEY) === '1'; } catch { /* default open */ }
  if (!closed && window.innerWidth > 1024) setLegend(true);
}
