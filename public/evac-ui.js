/* global map, $, cloud, canEdit, requireEdit, showHint, empty, esc, IgnisEvac, rui, roads, fieldPaths */
// Evacuation display: residents walking to safety during fire playback, and the class's safe areas.
const SAFE_KEY = 'ignisshield-map3d.safe-areas';
const eui = {list: $('#safe-list'), add: $('#add-safe'), toggle: $('#evac-toggle'), summary: $('#evac-summary')};
let safeAreas = [];
let safePicking = false;
let evacShown = null;      // evacuation result on screen
let evacLastRoutes = -1;   // minute whose routes are drawn

async function initEvac() {
  map.addSource('evac-routes', {type: 'geojson', data: empty()});
  map.addLayer({id: 'evac-routes', type: 'line', source: 'evac-routes', layout: {'line-cap': 'round', 'line-join': 'round'},
    filter: ['!', ['get', 'access']], paint: {'line-color': '#00e676', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 4], 'line-opacity': 0.75}});
  // home to the nearest mapped road or alley: the actual way out is not mapped yet
  map.addLayer({id: 'evac-access', type: 'line', source: 'evac-routes', filter: ['get', 'access'],
    paint: {'line-color': '#00e676', 'line-width': 1.2, 'line-opacity': 0.55, 'line-dasharray': [1, 2]}}, 'evac-routes');
  map.addSource('evac-people', {type: 'geojson', data: empty()});
  map.addLayer({id: 'evac-people', type: 'circle', source: 'evac-people', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, ['+', 2, ['sqrt', ['get', 'people']]], 19, ['+', 5, ['*', 1.6, ['sqrt', ['get', 'people']]]]],
    'circle-color': ['match', ['get', 'state'], 'moving', '#ffffff', 'arrived', '#00c853', 'trapped', '#ff1744', '#9e9e9e'],
    'circle-stroke-color': ['match', ['get', 'state'], 'moving', '#00a152', '#263238'], 'circle-stroke-width': 2}});
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

/** Evacuation calculator for a batch of runs (null if the network is not ready). */
function prepareEvac(features, inputs, households) {
  try {
    return IgnisEvac.prepare({features, densities: inputs.map(m => m.bldg_dens), households, roads, paths: fieldPaths(), safePoints: safeAreas});
  } catch (err) {
    showHint(`Evacuation routes could not be worked out: ${err.message}`, 8000);
    return null;
  }
}

// ---------- playback ----------
function evacShow(r) {
  evacShown = r?.evac ?? null;
  evacLastRoutes = -1;
  const s = evacShown?.summary;
  eui.summary.innerHTML = s ? `<b>Evacuation on foot:</b> ${s.people.toLocaleString()} people from ${s.buildings.toLocaleString()} buildings left home.
    <span class="ev-safe">${s.safe.toLocaleString()} reached safety</span> (average ${s.avgMin.toFixed(1)} min, longest ${s.maxMin.toFixed(1)} min)${s.trapped ? `, <span class="ev-trapped">${s.trapped.toLocaleString()} had no safe route</span>` : ''}${s.nopath ? `, ${s.nopath.toLocaleString()} live where no path is mapped yet` : ''}.` : '';
  eui.summary.hidden = !s;
  evacTick(0);
}
/** Called every animation update with the playback minute (fire-ui loop). */
function evacTick(minute) {
  const on = eui.toggle.checked && evacShown;
  if (!on) { if (evacLastRoutes !== -2) { map.getSource('evac-people')?.setData(empty()); map.getSource('evac-routes')?.setData(empty()); evacLastRoutes = -2; } return; }
  const people = [];
  for (const g of evacShown.groups) {
    const p = IgnisEvac.positionAt(g, minute);
    if (p) people.push({type: 'Feature', geometry: {type: 'Point', coordinates: p.at}, properties: {state: p.state, people: g.people}});
  }
  map.getSource('evac-people').setData({type: 'FeatureCollection', features: people});
  const m = Math.floor(minute);
  if (m !== evacLastRoutes) { // routes of everyone who has set off, redrawn once a minute
    evacLastRoutes = m;
    map.getSource('evac-routes').setData({type: 'FeatureCollection', features: evacShown.groups
      .filter(g => g.status === 'safe' && g.depart <= minute)
      .flatMap(g => [
        {type: 'Feature', geometry: {type: 'LineString', coordinates: g.coords.slice(0, 2)}, properties: {access: true}},
        ...(g.coords.length > 2 ? [{type: 'Feature', geometry: {type: 'LineString', coordinates: g.coords.slice(1)}, properties: {access: false}}] : [])])});
  }
}
function evacClear() { evacShown = null; evacTick(0); eui.summary.hidden = true; }
eui.toggle.addEventListener('change', () => { evacLastRoutes = -1; evacTick(typeof displayMinute === 'number' ? displayMinute : 0); });
