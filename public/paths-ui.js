/* global view, setView, map, $, cloud, canEdit, requireEdit, showHint, select, selectedId, studyData, esc, empty, IgnisField, IgnisRouting, rebuild, rui, stopTrace, drawing */
// Field data: GPS tracks from the students' walks, and the paths (alleys) they draw along them. Paths join routing.
const PATHS_KEY = 'ignisshield-map3d.paths';
const TRACKS_KEY = 'ignisshield-map3d.tracks';
const ACCESS = {walk: 'People on foot only', motorcycle: 'Motorcycles too', vehicle: 'Cars and fire trucks'};

const pui = {
  draw: $('#draw-path'), showTracks: $('#show-tracks'), gpx: $('#gpx-input'), tracksList: $('#tracks-list'),
  toPaths: $('#tracks-to-paths'), panel: $('#path-panel'), meta: $('#path-meta'), width: $('#path-width'), access: $('#path-access'), note: $('#path-note'), del: $('#path-delete')
};

const loadLocal = key => { try { return JSON.parse(localStorage.getItem(key)) || empty(); } catch { return empty(); } };
const saveLocal = (key, fc) => { try { localStorage.setItem(key, JSON.stringify(fc)); } catch { showHint('Could not save in this browser.', 6000); } };
const paths = empty(), tracks = empty();
let pathDraft = null;      // [lng, lat][] while drawing a path
let snap = null;           // snapped point under the cursor while drawing
let selectedPath = null;
let fieldReady = false;
let fieldLoading = Promise.resolve();

/** Field-surveyed paths, for routing (route-ui.js). */
const fieldPaths = () => paths.features;

async function initField() {
  map.addSource('tracks', {type: 'geojson', data: tracks});
  map.addLayer({id: 'tracks', type: 'line', source: 'tracks', layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': '#ff3df2', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 2.5], 'line-opacity': 0.75}}, 'buildings-3d');
  map.addSource('paths', {type: 'geojson', data: paths, promoteId: 'id'});
  map.addLayer({id: 'paths-casing', type: 'line', source: 'paths', layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ffd33d', '#ffffff'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 19, 8]}}, 'buildings-3d');
  map.addLayer({id: 'paths-line', type: 'line', source: 'paths', layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': ['step', ['coalesce', ['get', 'width_m'], 1], '#e53935', 2, '#fb8c00', 3.5, '#fdd835', 5, '#9e9e9e'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.2, 19, 4.5], 'line-dasharray': [2, 1]}}, 'buildings-3d');
  map.addSource('path-draft', {type: 'geojson', data: empty()});
  map.addLayer({id: 'path-draft-line', type: 'line', source: 'path-draft', filter: ['==', ['geometry-type'], 'LineString'],
    paint: {'line-color': '#ffd33d', 'line-width': 3, 'line-dasharray': [2, 1]}});
  map.addLayer({id: 'path-draft-points', type: 'circle', source: 'path-draft', filter: ['==', ['geometry-type'], 'Point'],
    paint: {'circle-radius': ['case', ['get', 'snapped'], 7, 4], 'circle-color': ['case', ['get', 'snapped'], '#00e676', '#ffd33d'],
      'circle-stroke-color': '#000', 'circle-stroke-width': 1}});

  try {
    if (cloud.enabled) {
      const [p, t] = await Promise.all([cloud.loadPaths(), cloud.loadTracks()]);
      paths.features = p; tracks.features = t;
    } else {
      paths.features = loadLocal(PATHS_KEY).features; tracks.features = loadLocal(TRACKS_KEY).features;
    }
  } catch (err) {
    showHint(/relation .* does not exist|Could not find the table/i.test(err.message)
      ? 'Field paths are not set up in the shared database yet: run supabase/upgrade-2-field-paths.sql in Supabase.' : `Could not load field paths: ${err.message}`, 10000);
  }
  fieldReady = true;
  refreshField();
}

function refreshField() {
  map.getSource('paths')?.setData(paths);
  map.getSource('tracks')?.setData(tracks);
  renderTracks();
  if (typeof rebuild === 'function' && !rui.panel.hidden) rebuild();
}

// ---------- GPS tracks ----------
function renderTracks() {
  const km = t => { let s = 0; for (const l of t.geometry.coordinates) for (let i = 1; i < l.length; i++) s += Math.hypot((l[i][0] - l[i - 1][0]) * 109480, (l[i][1] - l[i - 1][1]) * 110540); return (s / 1000).toFixed(2); };
  pui.tracksList.innerHTML = tracks.features.length
    ? tracks.features.map(t => `<div class="track-row"><span>${esc(t.properties.name)} · ${esc(t.properties.walked_on ?? '')} · ${km(t)} km</span>${canEdit() ? `<button data-track="${esc(t.properties.id)}">Delete</button>` : ''}</div>`).join('')
    : '<span class="muted">No GPS tracks yet.</span>';
  pui.gpx.closest('label').hidden = !canEdit();
  pui.toPaths.hidden = !canEdit() || !tracks.features.length;
}
pui.tracksList.addEventListener('click', async e => {
  const id = e.target.dataset.track;
  if (!id || !requireEdit() || !window.confirm('Delete this GPS track? Paths already drawn along it stay.')) return;
  try {
    if (cloud.enabled) await cloud.deleteTrack(id);
    tracks.features = tracks.features.filter(t => t.properties.id !== id);
    if (!cloud.enabled) saveLocal(TRACKS_KEY, tracks);
    refreshField();
  } catch (err) { showHint(`Could not delete the track: ${err.message}`, 8000); }
});
pui.gpx.addEventListener('change', async () => {
  const files = [...pui.gpx.files];
  pui.gpx.value = '';
  if (!files.length || !requireEdit()) return;
  const done = [];
  for (const [i, file] of files.entries()) {
    try {
      const {geometry, walkedOn, stats} = IgnisField.cleanWalk(await file.text());
      const name = file.name.replace(/\.gpx$/i, '').replace(/[_-]+/g, ' ').slice(0, 60) || 'GPS walk';
      const f = {type: 'Feature', geometry, properties: {id: `track-${Date.now()}-${i}`, name, walked_on: walkedOn}};
      if (cloud.enabled) await cloud.addTrack(f);
      tracks.features.push(f);
      done.push(`${name}: ${stats.walkedKm} km walked in ${stats.lines} lines (${stats.riddenKm} km of riding and ${stats.gaps} GPS gaps left out)`);
    } catch (err) {
      showHint(`${file.name}: ${err.message}`, 10000);
    }
  }
  if (!cloud.enabled) saveLocal(TRACKS_KEY, tracks);
  pui.showTracks.checked = true;
  map.setLayoutProperty('tracks', 'visibility', 'visible');
  refreshField();
  if (done.length) showHint(`Imported ${done.join('; ')}. Times and names were not kept.`, 10000);
});
// GPS walks -> escape paths: the parts of the walks that are not on a road yet become 1 m walking paths
pui.toPaths.addEventListener('click', async () => {
  if (!requireEdit()) return;
  const lineOf = g => (g.type === 'MultiLineString' ? g.coordinates[0] : g.coordinates);
  const roadsNow = studyData.features.filter(f => f.properties.kind === 'road').map(f => lineOf(f.geometry));
  const made = IgnisField.tracksToPaths(tracks.features.map(t => t.geometry.coordinates), [...roadsNow, ...paths.features.map(f => f.geometry.coordinates)]);
  if (!made.length) { showHint('Every part of the GPS walks is already on a road or path: nothing new to add.', 7000); return; }
  if (!window.confirm(`Create ${made.length} escape paths from the GPS walks? They are saved as 1 m walking paths marked “from GPS walk”, so check their width and position afterwards.`)) return;
  pui.toPaths.disabled = true;
  const today = new Date().toISOString().slice(0, 10);
  try {
    for (const [k, coords] of made.entries()) {
      await savePath({type: 'Feature', geometry: {type: 'LineString', coordinates: coords},
        properties: {id: `path-gps-${Date.now()}-${k}`, width_m: 1, access: 'walk', note: 'From GPS walk: check the width and position', drawn_at: today, source: 'gps'}}, true);
    }
    showHint(`Created ${made.length} escape paths from the GPS walks. Evacuation uses them from the next fire. Click any path to set its measured width.`, 9000);
  } catch (err) { showHint(`Could not save the paths: ${err.message}`, 9000); }
  pui.toPaths.disabled = false;
});
pui.showTracks.addEventListener('change', () => {
  for (const id of ['tracks', 'survey-walks']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', pui.showTracks.checked ? 'visible' : 'none');
});

// ---------- drawing a path ----------
function startPathDraw() {
  if (!requireEdit()) return;
  if (drawing) stopTrace();
  select(null);
  selectPath(null);
  pathDraft = [];
  map.doubleClickZoom.disable();
  map.getCanvas().style.cursor = 'crosshair';
  pui.draw.textContent = 'Cancel path';
  const camera = map.getZoom() < 18 ? {zoom: 18.5} : {};
  if (view !== '2d') setView('2d', camera); // draw top-down, like tracing roofs
  else if (camera.zoom) map.easeTo({...camera, duration: 600});
  showHint('Click along the middle of the alley. Ends snap to roads and paths (green dot). Click the last point again or press Enter to finish; Backspace undoes, Esc cancels.');
}
function stopPathDraw() {
  if (!pathDraft) return;
  pathDraft = null;
  snap = null;
  map.doubleClickZoom.enable();
  map.getCanvas().style.cursor = '';
  pui.draw.textContent = 'Draw path';
  $('#hint').hidden = true;
  map.getSource('path-draft')?.setData(empty());
}

/** Nearest junction (within 12 px) or point along a road/path (within 10 px) of the screen point. */
function snapAt(point) {
  const roads = studyData.features.filter(f => f.properties.kind === 'road');
  const lineOf = g => (g.type === 'MultiLineString' ? g.coordinates[0] : g.coordinates);
  const box = [[point.x - 14, point.y - 14], [point.x + 14, point.y + 14]];
  const hitIds = new Set(map.queryRenderedFeatures(box, {layers: ['roads', 'paths-line']}).map(f => f.properties.id));
  const lines = [...roads, ...paths.features].filter(f => hitIds.has(f.properties.id)).map(f => lineOf(f.geometry));
  let best = null;
  for (const l of lines) for (const c of [l[0], l[l.length - 1]]) {
    const p = map.project(c), d = Math.hypot(p.x - point.x, p.y - point.y);
    if (d <= 12 && (!best || d < best.d)) best = {d, c: c.slice(), node: true};
  }
  if (best) return best.c;
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) {
    const a = map.project(l[i]), b = map.project(l[i + 1]);
    const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
    const t = L ? Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / L)) : 0;
    const d = Math.hypot(a.x + t * vx - point.x, a.y + t * vy - point.y);
    if (d <= 10 && (!best || d < best.d)) best = {d, c: [l[i][0] + (l[i + 1][0] - l[i][0]) * t, l[i][1] + (l[i + 1][1] - l[i][1]) * t]};
  }
  return best?.c ?? null;
}
function renderPathDraft(cursor) {
  const pts = cursor ? [...pathDraft, cursor] : pathDraft;
  const features = pathDraft.map(c => ({type: 'Feature', geometry: {type: 'Point', coordinates: c}, properties: {snapped: false}}));
  if (snap) features.push({type: 'Feature', geometry: {type: 'Point', coordinates: snap}, properties: {snapped: true}});
  if (pts.length > 1) features.push({type: 'Feature', geometry: {type: 'LineString', coordinates: pts}, properties: {}});
  map.getSource('path-draft').setData({type: 'FeatureCollection', features});
}
async function finishPath() {
  if (pathDraft.length < 2) { showHint('A path needs at least 2 points.', 4000); return; }
  const coords = pathDraft.map(([x, y]) => [+x.toFixed(7), +y.toFixed(7)]);
  const f = {type: 'Feature', geometry: {type: 'LineString', coordinates: coords},
    properties: {id: `path-${Date.now()}`, width_m: 1, access: 'walk', note: '', drawn_at: new Date().toISOString().slice(0, 10)}};
  stopPathDraw();
  try {
    await savePath(f, true);
    selectPath(f.properties.id);
    showHint('Path saved. Set its measured width and who can pass in the panel on the left.', 7000);
  } catch (err) { showHint(`Could not save the path: ${err.message}`, 9000); }
}
async function savePath(f, isNew) {
  if (cloud.enabled) await cloud.savePath(f);
  if (isNew && !paths.features.some(x => x.properties.id === f.properties.id)) paths.features.push(f); // the live echo may have added it
  if (!cloud.enabled) saveLocal(PATHS_KEY, paths);
  refreshField();
}

map.on('mousemove', e => {
  if (!pathDraft) return;
  snap = snapAt(e.point);
  renderPathDraft(snap ?? [e.lngLat.lng, e.lngLat.lat]);
});
document.addEventListener('keydown', e => {
  if (!pathDraft || e.target instanceof HTMLInputElement) return;
  if (e.key === 'Escape') stopPathDraw();
  else if (e.key === 'Enter') finishPath();
  else if (e.key === 'Backspace') { e.preventDefault(); pathDraft.pop(); renderPathDraft(); }
});

/** Map click while drawing or on a path. Returns true when the click was used here (app.js). */
function fieldClick(e) {
  if (!fieldReady) return false;
  if (pathDraft) {
    const pt = snapAt(e.point) ?? [e.lngLat.lng, e.lngLat.lat];
    const last = pathDraft[pathDraft.length - 1];
    if (last) { const lp = map.project(last); if (Math.hypot(lp.x - e.point.x, lp.y - e.point.y) < 8) { finishPath(); return true; } }
    pathDraft.push(pt);
    renderPathDraft();
    return true;
  }
  const hit = map.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], {layers: ['paths-line', 'paths-casing']})[0];
  if (hit) { select(null); selectPath(hit.properties.id); return true; }
  if (selectedPath) selectPath(null);
  return false;
}

// ---------- the path panel ----------
function selectPath(id) {
  if (selectedPath) map.setFeatureState({source: 'paths', id: selectedPath}, {selected: false});
  selectedPath = id;
  const f = paths.features.find(x => x.properties.id === id);
  pui.panel.hidden = !f;
  if (!f) { selectedPath = null; return; }
  map.setFeatureState({source: 'paths', id}, {selected: true});
  const p = f.properties;
  let len = 0;
  const c = f.geometry.coordinates;
  for (let i = 1; i < c.length; i++) len += Math.hypot((c[i][0] - c[i - 1][0]) * 109480, (c[i][1] - c[i - 1][1]) * 110540);
  pui.meta.textContent = `${Math.round(len)} m long · field survey${p.drawn_at ? `, drawn ${p.drawn_at}` : ''}`;
  pui.width.value = p.width_m;
  pui.access.value = p.access;
  pui.note.value = p.note ?? '';
  for (const el of [pui.width, pui.access, pui.note, pui.del]) el.disabled = !canEdit();
}
async function updatePath(change) {
  const f = paths.features.find(x => x.properties.id === selectedPath);
  if (!f || !requireEdit()) { selectPath(selectedPath); return; }
  const before = {...f.properties};
  Object.assign(f.properties, change);
  try { await savePath(f, false); } catch (err) { f.properties = before; showHint(`Could not save: ${err.message}`, 8000); }
  selectPath(f.properties.id);
}
pui.width.addEventListener('change', () => {
  const w = Number(pui.width.value);
  if (!Number.isFinite(w) || w < 0.3 || w > 20) { showHint('Width must be between 0.3 and 20 m.', 5000); selectPath(selectedPath); return; }
  updatePath({width_m: Math.round(w * 10) / 10});
});
pui.access.addEventListener('change', () => updatePath({access: pui.access.value}));
pui.note.addEventListener('change', () => updatePath({note: pui.note.value.slice(0, 200)}));
pui.del.addEventListener('click', async () => {
  if (!requireEdit() || !window.confirm('Delete this path?')) return;
  const id = selectedPath;
  try {
    if (cloud.enabled) await cloud.deletePath(id);
    paths.features = paths.features.filter(f => f.properties.id !== id);
    if (!cloud.enabled) saveLocal(PATHS_KEY, paths);
    selectPath(null);
    refreshField();
  } catch (err) { showHint(`Could not delete the path: ${err.message}`, 8000); }
});
pui.draw.addEventListener('click', () => (pathDraft ? stopPathDraw() : startPathDraw()));

// ---------- live changes from other people (shared mode) ----------
function onRemotePath(row, oldId) {
  const id = row ? row.id : oldId;
  const i = paths.features.findIndex(f => f.properties.id === id);
  if (!row) { if (i >= 0) paths.features.splice(i, 1); if (selectedPath === id) selectPath(null); }
  else {
    const f = {type: 'Feature', geometry: row.geometry, properties: {...row.properties, id}};
    if (i >= 0) paths.features[i] = f; else paths.features.push(f);
    if (selectedPath === id) selectPath(id);
  }
  refreshField();
}
function onRemoteTrack(row, oldId) {
  const id = row ? row.id : oldId;
  tracks.features = tracks.features.filter(t => t.properties.id !== id);
  if (row) tracks.features.push({type: 'Feature', geometry: row.geometry, properties: {id, name: row.name, walked_on: row.walked_on}});
  refreshField();
}
