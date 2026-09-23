/* global maplibregl, IgnisPaper */
const centre = [123.7141, 10.5068]; // Sitio Polo study-area boundary
const STOREY_M = 3;
const STORE_KEY = 'ignisshield-map3d.traced';
const AI_RELEASE = 'microsoft-2026-02-03';
const COLOR = {user: '#2d7ff9', ai: '#35c6d6', selected: '#ffd33d'};
const FIRE = {burnA: '#ff3b1f', burnB: '#ff7a00', burned: '#2a2522', flame: '#ffb01f'};
const empty = () => ({type: 'FeatureCollection', features: []});

const buildingColor = burning => ['match', ['coalesce', ['feature-state', 'fire'], 'safe'],
  'burning', burning, 'burned', FIRE.burned,
  ['case', ['all', ['==', ['get', 'origin'], 'ai'], ['!', ['coalesce', ['get', 'edited'], false]]], COLOR.ai, COLOR.user]];

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: centre, zoom: 16.4, pitch: 60, bearing: -20, maxPitch: 85,
  canvasContextAttributes: {antialias: true}
});
map.addControl(new maplibregl.NavigationControl({visualizePitch: true}));
map.addControl(new maplibregl.ScaleControl());

const EDIT_HINT = 'Drag a yellow corner to move it. Drag a white dot to add a corner. Click a corner, then press Delete to remove it. Drag inside the shape to move the whole building.';
const $ = s => document.querySelector(s);
const ui = {
  base: document.querySelectorAll('[data-base]'),
  view: document.querySelectorAll('[data-view]'),
  showInventory: $('#show-inventory'), showAi: $('#show-ai'),
  trace: $('#trace'), exportBtn: $('#export'), count: $('#count'), hint: $('#hint'),
  panel: $('#panel'), panelTitle: $('#panel-title'), panelSource: $('#panel-source'),
  storeys: $('#storeys'), height: $('#height'), editHint: $('#edit-hint'),
  removeCorner: $('#remove-corner'), revert: $('#revert'), del: $('#delete')
};

let view = '3d';
let drawing = null;        // [lng, lat][] while tracing
let selectedId = null;
let original = null;       // geometry of the selected building before this editing session
let selectedVertex = null; // index of the highlighted corner
let drag = null;           // {type: 'vertex', i} | {type: 'move', last}

// ---------- saved buildings (browser storage) ----------
// One collection holds traced buildings and AI outlines alike, so they edit the same way.
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || empty(); } catch { return empty(); }
}
const localStore = loadStore();
// Buildings saved before the paper's inputs existed carry model-unit fields; convert them once
if (localStore.features.map(f => IgnisPaper.migrate(f.properties)).some(Boolean)) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(localStore)); } catch { /* retried on next save */ }
}
// Shared mode (config.js set): buildings come from Supabase after the map loads; this browser's copy is kept for the first upload.
const store = cloud.enabled ? empty() : localStore;
let storeVersion = 0; // bumped on every save so derived data (measured density) can be refreshed
let studyData = null; // IgnisShield inventory: boundary, buildings and roads
const synced = new Map(); // shared mode: building id -> content last saved to or received from Supabase
let syncTimer = null;

const canEdit = () => !cloud.enabled || cloud.editor;
function requireEdit() {
  if (canEdit()) return true;
  showHint(cloud.user ? 'Your account is not approved as an editor yet, so the shared map is view-only for you. Ask the project owner to approve it.'
    : 'The shared map is view-only until you sign in as a class editor (Sign in, top right).', 6000);
  return false;
}
// jsonb reorders object keys, so compare content with sorted keys
const stable = v => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v);
const rowJson = f => JSON.stringify(stable([f.geometry, f.properties]));

function saveStore() {
  storeVersion++;
  if (cloud.enabled) { clearTimeout(syncTimer); syncTimer = setTimeout(pushShared, 400); }
  else {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
    catch { showHint('Could not save to browser storage. Use Export to keep your buildings.'); }
  }
  map.getSource('buildings')?.setData(store);
  renderEdit();
  ui.count.textContent = store.features.length;
}
/** Send buildings that changed since the last sync; delete the ones removed here. */
async function pushShared() {
  const ids = new Set(), changed = [];
  for (const f of store.features) {
    ids.add(f.properties.id);
    const j = rowJson(f);
    if (synced.get(f.properties.id) !== j) changed.push([f, j]);
  }
  const gone = [...synced.keys()].filter(id => !ids.has(id));
  if (!changed.length && !gone.length) return;
  try {
    await cloud.saveBuildings(changed.map(([f]) => f), gone);
    for (const [f, j] of changed) synced.set(f.properties.id, j);
    for (const id of gone) synced.delete(id);
  } catch (err) {
    showHint(`Could not save to the shared map: ${err.message}. Your change is only on this screen until it saves.`, 9000);
  }
}
async function startShared() {
  const features = await cloud.loadBuildings();
  features.forEach(f => IgnisPaper.migrate(f.properties));
  store.features = features;
  synced.clear();
  for (const f of features) synced.set(f.properties.id, rowJson(f));
  cloud.subscribe({building: applyRemote, run: row => onRemoteRun(row), setting: row => onRemoteSetting(row)});
  await loadSharedData();
}
/** A building changed by someone else (or the echo of our own save). */
function applyRemote(row, oldId) {
  const id = row ? row.id : oldId;
  if (!id || (drag && id === selectedId)) return;
  const i = store.features.findIndex(f => f.properties.id === id);
  if (!row) {
    if (i < 0) return;
    store.features.splice(i, 1);
    synced.delete(id);
    if (selectedId === id) select(null);
  } else {
    const f = {type: 'Feature', geometry: row.geometry, properties: {...row.properties, id}};
    const j = rowJson(f);
    if (i >= 0 && rowJson(store.features[i]) === j) { synced.set(id, j); return; }
    synced.set(id, j);
    if (i < 0) store.features.push(f); else store.features[i] = f;
    if (selectedId === id) original = structuredClone(f.geometry);
  }
  storeVersion++;
  map.getSource('buildings')?.setData(store);
  renderEdit();
  updatePanel();
  ui.count.textContent = store.features.length;
}
const selected = () => store.features.find(f => f.properties.id === selectedId);
const ring = f => f.geometry.coordinates[0].slice(0, -1);
const setRing = (f, pts) => { f.geometry.coordinates = [[...pts, pts[0]]]; };

map.on('load', async () => {
  const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol').id;

  // Terrain: free AWS Terrarium elevation tiles (no API key)
  map.addSource('dem', {
    type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    attribution: 'Elevation: Mapzen / AWS Terrain Tiles'
  });
  map.setTerrain({source: 'dem', exaggeration: 1.3});
  map.addLayer({id: 'hillshade', type: 'hillshade', source: 'dem',
    paint: {'hillshade-shadow-color': '#473B24', 'hillshade-exaggeration': 0.4}}, 'building');
  map.setSky({'sky-color': '#9ec9ec', 'horizon-color': '#e8f1f8', 'fog-color': '#ffffff', 'sky-horizon-blend': 0.5});

  // Satellite: Esri World Imagery. Native imagery here stops at z18, so overzoom beyond it.
  map.addSource('satellite', {
    type: 'raster', tileSize: 256, maxzoom: 18,
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics'
  });
  map.addLayer({id: 'satellite', type: 'raster', source: 'satellite', layout: {visibility: 'none'}}, firstSymbol);

  // Study-area buildings from the shared IgnisShield inventory (no heights recorded: 6 m display height)
  const data = studyData = await (await fetch('data/source.geojson')).json();
  const isBuilding = ['==', ['get', 'kind'], 'building'];
  map.addSource('study', {type: 'geojson', data});
  map.addLayer({id: 'study-3d', type: 'fill-extrusion', source: 'study', filter: isBuilding,
    paint: {'fill-extrusion-color': '#e8793a', 'fill-extrusion-height': 6, 'fill-extrusion-opacity': 0.9}});
  map.addLayer({id: 'study-2d', type: 'line', source: 'study', filter: isBuilding,
    paint: {'line-color': '#e8793a', 'line-width': 2}});
  map.addLayer({id: 'study-boundary', type: 'line', source: 'study',
    filter: ['==', ['get', 'kind'], 'boundary'],
    paint: {'line-color': '#c0392b', 'line-width': 2.5, 'line-dasharray': [2, 1]}});

  if (cloud.enabled) {
    try { await startShared(); } catch (err) {
      cloud.enabled = false;
      Object.assign(store, localStore);
      showHint(`Could not reach the shared map (${err.message}). Working on this browser's own copy instead.`, 12000);
    }
  }
  // Local mode, first run with this AI release: add its outlines to the saved collection
  if (!cloud.enabled && store.ai_release !== AI_RELEASE) {
    const ai = await (await fetch('data/ai-buildings.geojson')).json();
    const have = new Set(store.features.map(f => f.properties.id));
    store.features.push(...ai.features.filter(f => !have.has(f.properties.id)));
    store.ai_release = AI_RELEASE;
    saveStore();
  }

  // Saved buildings: untouched AI outlines (cyan), traced or edited buildings (blue)
  // Fire state comes from feature-state during playback (see showFrame)
  const height = ['*', ['coalesce', ['get', 'storeys'], 1], STOREY_M];
  map.addSource('buildings', {type: 'geojson', data: store, promoteId: 'id'});
  map.addLayer({id: 'buildings-3d', type: 'fill-extrusion', source: 'buildings',
    paint: {'fill-extrusion-color': buildingColor(FIRE.burnA), 'fill-extrusion-opacity': 0.92, 'fill-extrusion-height': height}});
  map.addLayer({id: 'buildings-2d', type: 'fill', source: 'buildings',
    paint: {'fill-color': buildingColor(FIRE.burnA), 'fill-opacity': ['match', ['feature-state', 'fire'], 'burning', 0.75, 'burned', 0.8, 0.15]}});
  map.addLayer({id: 'buildings-2d-line', type: 'line', source: 'buildings', paint: {'line-color': buildingColor(FIRE.burnA), 'line-width': 1.5}});

  // Flames above burning buildings
  map.addSource('flames', {type: 'geojson', data: empty()});
  map.addLayer({id: 'flames-3d', type: 'fill-extrusion', source: 'flames',
    paint: {'fill-extrusion-color': FIRE.flame, 'fill-extrusion-opacity': 0.6,
      'fill-extrusion-base': ['get', 'h'], 'fill-extrusion-height': ['+', ['get', 'h'], 3]}});
  map.addLayer({id: 'flames-2d', type: 'line', source: 'flames',
    paint: {'line-color': FIRE.flame, 'line-width': 4, 'line-blur': 3}});

  // Selected building and its corner handles
  map.addSource('edit', {type: 'geojson', data: empty()});
  const shape = ['==', ['geometry-type'], 'Polygon'];
  map.addLayer({id: 'edit-3d', type: 'fill-extrusion', source: 'edit', filter: shape,
    paint: {'fill-extrusion-color': COLOR.selected, 'fill-extrusion-opacity': 0.95, 'fill-extrusion-height': height}});
  map.addLayer({id: 'edit-fill', type: 'fill', source: 'edit', filter: shape,
    paint: {'fill-color': COLOR.selected, 'fill-opacity': 0.25}});
  map.addLayer({id: 'edit-line', type: 'line', source: 'edit', filter: shape,
    paint: {'line-color': COLOR.selected, 'line-width': 2.5}});
  map.addLayer({id: 'edit-mid', type: 'circle', source: 'edit', filter: ['==', ['get', 'handle'], 'mid'],
    paint: {'circle-radius': 4, 'circle-color': '#fff', 'circle-opacity': 0.9, 'circle-stroke-color': '#000', 'circle-stroke-width': 1}});
  map.addLayer({id: 'edit-vertex', type: 'circle', source: 'edit', filter: ['==', ['get', 'handle'], 'vertex'],
    paint: {'circle-radius': 6, 'circle-stroke-color': '#000', 'circle-stroke-width': 1.5,
      'circle-color': ['case', ['get', 'active'], '#ff3b30', COLOR.selected]}});

  // Outline being drawn
  map.addSource('draft', {type: 'geojson', data: empty()});
  map.addLayer({id: 'draft-line', type: 'line', source: 'draft', filter: ['==', ['geometry-type'], 'LineString'],
    paint: {'line-color': '#ffd33d', 'line-width': 2.5}});
  map.addLayer({id: 'draft-points', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'],
    paint: {'circle-radius': 5, 'circle-color': '#ffd33d', 'circle-stroke-color': '#000', 'circle-stroke-width': 1}});

  ui.count.textContent = store.features.length;
  initRoutes(data);
  applyLayers();
});

// ---------- what is shown ----------
function applyLayers() {
  const is3d = view === '3d';
  const show = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  show('study-3d', is3d && ui.showInventory.checked);
  show('study-2d', !is3d && ui.showInventory.checked);
  for (const id of ['buildings-3d', 'edit-3d', 'flames-3d']) show(id, is3d);
  for (const id of ['buildings-2d', 'buildings-2d-line', 'edit-fill', 'edit-line', 'edit-mid', 'edit-vertex', 'flames-2d']) show(id, !is3d);
  // The selected building is drawn from the edit source, so leave it out of the main layers
  const filter = ['all', ['!=', ['get', 'id'], selectedId ?? '']];
  if (!ui.showAi.checked) filter.push(['!', ['all', ['==', ['get', 'origin'], 'ai'], ['!', ['coalesce', ['get', 'edited'], false]]]]);
  for (const id of ['buildings-3d', 'buildings-2d', 'buildings-2d-line']) map.setFilter(id, filter);
}

function setBase(next) {
  ui.base.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.base === next)));
  const sat = next === 'satellite';
  map.setLayoutProperty('satellite', 'visibility', sat ? 'visible' : 'none');
  // OSM buildings would cover the roofs in the photo
  for (const id of ['building', 'building-3d']) map.setLayoutProperty(id, 'visibility', sat ? 'none' : 'visible');
}

function setView(next, camera = {}) {
  view = next;
  ui.view.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  applyLayers();
  renderEdit();
  if (view === '3d') { map.setMaxPitch(85); map.easeTo({pitch: 60, duration: 600, ...camera}); }
  else { map.easeTo({pitch: 0, bearing: 0, duration: 600, ...camera}); map.once('moveend', () => { if (view === '2d') map.setMaxPitch(0); }); }
}

// ---------- tracing ----------
function startTrace() {
  if (!requireEdit()) return;
  select(null);
  const camera = map.getZoom() < 18 ? {zoom: 18.5} : {}; // roofs are too small to trace further out
  if (view !== '2d') setView('2d', camera);
  else if (camera.zoom) map.easeTo({...camera, duration: 600});
  drawing = [];
  map.doubleClickZoom.disable();
  map.getCanvas().style.cursor = 'crosshair';
  ui.trace.textContent = 'Cancel tracing';
  showHint('Click each roof corner. Click the first corner (or press Enter) to finish. Backspace undoes a corner, Esc cancels.');
}
function stopTrace() {
  drawing = null;
  map.doubleClickZoom.enable();
  map.getCanvas().style.cursor = '';
  ui.trace.textContent = 'Trace building';
  ui.hint.hidden = true;
  map.getSource('draft').setData(empty());
}
function renderDraft(cursor) {
  const pts = cursor ? [...drawing, cursor] : drawing;
  const features = drawing.map(c => ({type: 'Feature', geometry: {type: 'Point', coordinates: c}, properties: {}}));
  if (pts.length > 1) features.push({type: 'Feature', geometry: {type: 'LineString', coordinates: pts}, properties: {}});
  map.getSource('draft').setData({type: 'FeatureCollection', features});
}
function finishTrace() {
  if (drawing.length < 3) { showHint('A building needs at least 3 corners.'); return; }
  const id = `traced-${Date.now()}`;
  store.features.push({
    type: 'Feature',
    geometry: {type: 'Polygon', coordinates: [[...drawing, drawing[0]]]},
    properties: {id, kind: 'building', storeys: 1, origin: 'traced',
      source: 'Traced from Esri World Imagery roof outline', traced_at: new Date().toISOString()}
  });
  stopTrace();
  select(id);
  saveStore();
}
function nearFirst(point) {
  if (drawing.length < 3) return false;
  const p = map.project(drawing[0]);
  return Math.hypot(p.x - point.x, p.y - point.y) < 12;
}
let hintTimer = null;
function showHint(text, hideAfterMs) {
  clearTimeout(hintTimer);
  ui.hint.textContent = text;
  ui.hint.hidden = false;
  if (hideAfterMs) hintTimer = setTimeout(() => { if (!drawing) ui.hint.hidden = true; }, hideAfterMs);
}

// ---------- selecting and editing ----------
function select(id) {
  selectedId = id;
  selectedVertex = null;
  const f = selected();
  original = f ? structuredClone(f.geometry) : null;
  applyLayers();
  renderEdit();
  updatePanel();
}
function updatePanel() {
  const f = selected();
  ui.panel.hidden = !f;
  if (!f) return;
  const p = f.properties;
  ui.panelTitle.textContent = p.origin === 'ai' ? (p.edited ? 'AI outline (edited)' : 'AI outline') : 'Traced building';
  ui.panelSource.textContent = p.source ?? '';
  ui.storeys.value = p.storeys;
  ui.height.textContent = p.storeys * STOREY_M;
  const editable = canEdit();
  ui.editHint.hidden = editable && view !== '2d';
  ui.editHint.textContent = editable ? EDIT_HINT : 'View only: sign in as a class editor to change this building. You can still start a fire here.';
  ui.storeys.disabled = ui.del.disabled = !editable;
  ui.removeCorner.disabled = !editable || selectedVertex === null || ring(f).length <= 3;
  ui.revert.disabled = !editable || JSON.stringify(f.geometry) === JSON.stringify(original);
  renderBuildingInputs(f);
}
function renderEdit() {
  const src = map.getSource('edit');
  if (!src) return;
  const f = selected();
  if (!f) { src.setData(empty()); return; }
  const features = [f];
  if (view === '2d' && canEdit()) {
    const pts = ring(f);
    pts.forEach((c, i) => {
      const n = pts[(i + 1) % pts.length];
      features.push({type: 'Feature', geometry: {type: 'Point', coordinates: c}, properties: {handle: 'vertex', i, active: i === selectedVertex}});
      features.push({type: 'Feature', geometry: {type: 'Point', coordinates: [(c[0] + n[0]) / 2, (c[1] + n[1]) / 2]}, properties: {handle: 'mid', i}});
    });
  }
  src.setData({type: 'FeatureCollection', features});
}
function commitEdit() {
  const f = selected();
  if (f.properties.origin === 'ai') f.properties.edited = true;
  saveStore();
  updatePanel();
}
function removeCorner() {
  if (!requireEdit()) return;
  const f = selected();
  const pts = ring(f);
  if (selectedVertex === null || pts.length <= 3) return;
  pts.splice(selectedVertex, 1);
  setRing(f, pts);
  selectedVertex = null;
  commitEdit();
}

map.on('mousedown', e => {
  if (drawing || !selectedId || view !== '2d' || !canEdit()) return;
  const f = selected();
  const handle = map.queryRenderedFeatures(e.point, {layers: ['edit-vertex', 'edit-mid']})
    .sort((a, b) => (a.properties.handle === 'vertex' ? 0 : 1) - (b.properties.handle === 'vertex' ? 0 : 1))[0];
  if (handle) {
    let i = handle.properties.i;
    if (handle.properties.handle === 'mid') { // new corner halfway along this edge
      const pts = ring(f);
      i += 1;
      pts.splice(i, 0, [e.lngLat.lng, e.lngLat.lat]);
      setRing(f, pts);
    }
    selectedVertex = i;
    drag = {type: 'vertex', i};
  } else if (map.queryRenderedFeatures(e.point, {layers: ['edit-fill']}).length) {
    drag = {type: 'move', last: e.lngLat};
  } else return;
  e.preventDefault();
  map.dragPan.disable();
  map.getCanvas().style.cursor = 'grabbing';
  renderEdit();
  updatePanel();
});
map.on('mousemove', e => {
  if (drawing) {
    map.getCanvas().style.cursor = nearFirst(e.point) ? 'pointer' : 'crosshair';
    if (drawing.length) renderDraft([e.lngLat.lng, e.lngLat.lat]);
    return;
  }
  if (drag) {
    const f = selected();
    const pts = ring(f);
    if (drag.type === 'vertex') pts[drag.i] = [e.lngLat.lng, e.lngLat.lat];
    else {
      const dx = e.lngLat.lng - drag.last.lng, dy = e.lngLat.lat - drag.last.lat;
      pts.forEach(p => { p[0] += dx; p[1] += dy; });
      drag.last = e.lngLat;
    }
    setRing(f, pts);
    renderEdit();
    return;
  }
  if (selectedId && view === '2d') {
    const onHandle = map.queryRenderedFeatures(e.point, {layers: ['edit-vertex', 'edit-mid']}).length;
    const onShape = map.queryRenderedFeatures(e.point, {layers: ['edit-fill']}).length;
    map.getCanvas().style.cursor = onHandle ? 'pointer' : onShape ? 'move' : '';
  }
});
map.on('mouseup', () => {
  if (!drag) return;
  drag = null;
  map.dragPan.enable();
  map.getCanvas().style.cursor = '';
  commitEdit();
});

map.on('click', e => {
  if (routeClick(e)) return;
  if (drawing) {
    if (nearFirst(e.point)) return finishTrace();
    drawing.push([e.lngLat.lng, e.lngLat.lat]);
    renderDraft();
    return;
  }
  const editLayers = view === '3d' ? ['edit-3d'] : ['edit-vertex', 'edit-mid', 'edit-fill'];
  if (selectedId && map.queryRenderedFeatures(e.point, {layers: editLayers}).length) return;
  const layers = view === '3d' ? ['buildings-3d'] : ['buildings-2d'];
  const hit = map.queryRenderedFeatures(e.point, {layers})[0];
  select(hit ? hit.properties.id : null);
});

document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  if (drawing) {
    if (e.key === 'Escape') stopTrace();
    else if (e.key === 'Enter') finishTrace();
    else if (e.key === 'Backspace') { e.preventDefault(); drawing.pop(); renderDraft(); }
  } else if (selectedId) {
    if (e.key === 'Escape') select(null);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedVertex !== null) { e.preventDefault(); removeCorner(); }
  }
});

// ---------- panel ----------
ui.storeys.addEventListener('change', () => {
  if (!requireEdit()) { updatePanel(); return; }
  const f = selected();
  f.properties.storeys = Math.max(1, Math.min(20, Math.round(Number(ui.storeys.value) || 1)));
  saveStore();
  updatePanel();
});
ui.removeCorner.addEventListener('click', removeCorner);
ui.revert.addEventListener('click', () => {
  if (!requireEdit()) return;
  selected().geometry = structuredClone(original);
  selectedVertex = null;
  saveStore();
  updatePanel();
});
ui.del.addEventListener('click', () => {
  if (!requireEdit()) return;
  store.features = store.features.filter(f => f.properties.id !== selectedId);
  select(null);
  saveStore();
});

// ---------- toolbar ----------
ui.base.forEach(b => b.addEventListener('click', () => setBase(b.dataset.base)));
ui.view.forEach(b => b.addEventListener('click', () => { if (drawing) stopTrace(); setView(b.dataset.view); updatePanel(); }));
ui.showInventory.addEventListener('change', applyLayers);
ui.showAi.addEventListener('change', applyLayers);
ui.trace.addEventListener('click', () => (drawing ? stopTrace() : startTrace()));
ui.exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({type: 'FeatureCollection', features: store.features}, null, 2)], {type: 'application/geo+json'});
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: `ignisshield-buildings-${new Date().toISOString().slice(0, 10)}.geojson`
  });
  a.click();
  URL.revokeObjectURL(a.href);
});
