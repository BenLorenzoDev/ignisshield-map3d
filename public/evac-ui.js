/* global map, $, cloud, canEdit, requireEdit, showHint, empty, esc, IgnisEvac, rui, roads, fieldPaths */
// Evacuation display: residents walking to safety during fire playback, and the class's safe areas.
const SAFE_KEY = 'ignisshield-map3d.safe-areas';
const eui = {list: $('#safe-list'), add: $('#add-safe'), toggle: $('#evac-toggle'), summary: $('#evac-summary')};
let safeAreas = [];
let safePicking = false;
let evacShown = null;      // evacuation result on screen
let evacLastRoutes = -1;   // minute whose routes are drawn
let waterPolys = [];       // sea, river and ponds (OpenStreetMap): nobody walks across them

async function initEvac() {
  try {
    const w = await (await fetch('data/water.geojson')).json();
    waterPolys = w.features.filter(f => f.properties.kind === 'water').flatMap(f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates));
    map.addSource('bridges', {type: 'geojson', data: {type: 'FeatureCollection', features: w.features.filter(f => f.properties.kind === 'bridge')}});
    map.addLayer({id: 'bridges', type: 'line', source: 'bridges', layout: {'line-cap': 'butt'},
      paint: {'line-color': '#6d4c41', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 4, 19, 12], 'line-opacity': 0.55}}, 'roads');
  } catch { /* evacuation still works, without the water check */ }
  map.addSource('evac-routes', {type: 'geojson', data: empty()});
  map.addLayer({id: 'evac-routes', type: 'line', source: 'evac-routes', layout: {'line-cap': 'round', 'line-join': 'round'},
    filter: ['!', ['get', 'access']], paint: {'line-color': '#00e676', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 4], 'line-opacity': 0.75}});
  // home to the nearest mapped road or alley: the actual way out is not mapped yet
  map.addLayer({id: 'evac-access', type: 'line', source: 'evac-routes', filter: ['get', 'access'],
    paint: {'line-color': '#00e676', 'line-width': 1.2, 'line-opacity': 0.55, 'line-dasharray': [1, 2]}}, 'evac-routes');
  map.addSource('evac-people', {type: 'geojson', data: empty()});
  for (const [name, img] of personImages()) map.addImage(name, img, {pixelRatio: 2});
  map.addLayer({id: 'evac-people', type: 'symbol', source: 'evac-people', layout: {
    'icon-image': ['get', 'icon'], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
    'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.35, 17, 0.6, 19, 1, 21, 1.4], 'symbol-sort-key': ['get', 'order']}});
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
    return IgnisEvac.prepare({features, densities: inputs.map(m => m.bldg_dens), households, roads, paths: fieldPaths(), safePoints: safeAreas, water: waterPolys});
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
// ---------- human figures (drawn once, used as map icons) ----------
const FIGURE = {moving: ['#ffffff', '#1b2a33'], arrived: ['#00c853', '#0b3d1d'], trapped: ['#ff1744', '#4a0010'], nopath: ['#b0bec5', '#37474f']};
const POSES = {
  // [head centre, [limbs as polylines]] on a 28 × 40 box, feet at the bottom
  runA: [[16, 7], [[[15, 12], [12, 24]], [[12, 24], [17, 30], [21, 37]], [[12, 24], [8, 31], [3, 34]], [[14.5, 14], [19, 19], [23, 16]], [[14.5, 14], [9, 18], [6, 23]]]],
  runB: [[16, 7], [[[15, 12], [12, 24]], [[12, 24], [14, 31], [10, 38]], [[12, 24], [17, 29], [20, 33]], [[14.5, 14], [10, 19], [7, 16]], [[14.5, 14], [19, 18], [21, 23]]]],
  stand: [[14, 7], [[[14, 12], [14, 25]], [[14, 25], [11, 38]], [[14, 25], [17, 38]], [[14, 14], [9, 23]], [[14, 14], [19, 23]]]],
  help: [[14, 8], [[[14, 13], [14, 26]], [[14, 26], [11, 38]], [[14, 26], [17, 38]], [[14, 15], [8, 4]], [[14, 15], [20, 4]]]]
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
  out.push(['p-arrived', drawPerson('stand', FIGURE.arrived)], ['p-trapped', drawPerson('help', FIGURE.trapped)], ['p-nopath', drawPerson('stand', FIGURE.nopath)]);
  return out;
}
// legend images in the playback bar
for (const [el, pose, state] of [['moving', 'runA', 'moving'], ['arrived', 'stand', 'arrived'], ['trapped', 'help', 'trapped'], ['nopath', 'stand', 'nopath']]) {
  const img = drawPerson(pose, FIGURE[state]), c = document.createElement('canvas');
  c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0);
  document.querySelectorAll(`.fig-${el}`).forEach(i => { i.src = c.toDataURL(); });
}
// small deterministic scatter so a family does not stand on one spot
const jitter = (i, k, m) => { const h = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453, u = h - Math.floor(h), v = (h * 7.1) % 1; const r = m * (0.35 + 0.65 * Math.abs(v)), a = u * Math.PI * 2; return [r * Math.cos(a) / 109480, r * Math.sin(a) / 110540]; };
const FOLLOW = 0.03; // minutes between family members walking in single file (≈ 1.8 s)

/** Called every animation update with the playback minute (fire-ui loop). */
function evacTick(minute) {
  const on = eui.toggle.checked && evacShown;
  if (!on) { if (evacLastRoutes !== -2) { map.getSource('evac-people')?.setData(empty()); map.getSource('evac-routes')?.setData(empty()); evacLastRoutes = -2; } return; }
  const people = [];
  const stride = Math.floor((typeof clock === 'number' ? clock : 0) * 6); // legs swap about 3 times a second (real time)
  for (const g of evacShown.groups) {
    const shown = Math.min(g.people, 5);
    for (let k = 0; k < shown; k++) {
      const p = IgnisEvac.positionAt(g, minute - k * FOLLOW);
      if (!p) continue;
      let at = p.at, icon;
      if (p.state === 'moving') icon = `p-${(stride + k + g.i) % 2 ? 'runB' : 'runA'}${p.dir < 0 ? '-l' : ''}`;
      else { const [dx, dy] = jitter(g.i, k, p.state === 'arrived' ? 7 : 3); at = [at[0] + dx, at[1] + dy]; icon = `p-${p.state}`; }
      people.push({type: 'Feature', geometry: {type: 'Point', coordinates: at}, properties: {icon, order: p.state === 'moving' ? 2 : 1}});
    }
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
