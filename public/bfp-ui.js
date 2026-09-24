/* global map, $, cloud, canEdit, requireEdit, showHint, empty, IgnisBFP, roads, fieldPaths, scenario, saveScenario, clock */
// Optional BFP fire-truck response: form options, station, truck and water animation.
const BFP_STATION_KEY = 'ignisshield-map3d.bfp-station';
const BFP_DEFAULT_STATION = {lonlat: [123.71327, 10.50537], name: 'BFP Balamban (approximate: Municipal Hall)', approximate: true};
const bui = {
  toggle: $('#bfp-toggle'), fields: $('#bfp-fields'), stationInfo: $('#bfp-station-info'), setStation: $('#bfp-set-station'),
  status: $('#bfp-status'), summary: $('#bfp-summary')
};
const BFP_FIELDS = [
  ['callMin', 'Call received after', 'min', 0, 60, 0.5],
  ['turnoutMin', 'Crew turnout', 'min', 0, 15, 0.5],
  ['speedKmh', 'Truck speed', 'km/h', 5, 80, 1],
  ['reachM', 'Hose reach', 'm', 10, 200, 5],
  ['perMin', 'Buildings put out per minute', '', 1, 10, 1]
];
let bfpStation = BFP_DEFAULT_STATION;
let bfpPicking = false;
let bfpShown = null; // timeline of the run on screen
let bfpVisualsEmpty = false;

function bfpSettings() { return {on: false, ...IgnisBFP.DEFAULTS, ...(scenario.bfp || {})}; }
function renderBfpForm() {
  const s = bfpSettings();
  bui.toggle.checked = s.on;
  bui.fields.hidden = !s.on;
  bui.fields.querySelector('.bfp-grid').innerHTML = BFP_FIELDS.map(([k, name, unit, min, max, step]) =>
    `<label class="field" data-info="bfp-${k}"><span>${name} ${unit ? `<i>${unit}</i>` : ''}</span><input id="bfp-${k}" type="number" min="${min}" max="${max}" step="${step}" value="${s[k]}"></label>`).join('');
  bui.stationInfo.textContent = `Station: ${bfpStation.name}.`;
  bui.setStation.hidden = !canEdit();
}
bui.toggle.addEventListener('change', () => { scenario.bfp = {...bfpSettings(), on: bui.toggle.checked}; saveScenario(); renderBfpForm(); });
bui.fields.addEventListener('change', e => {
  const f = BFP_FIELDS.find(x => `bfp-${x[0]}` === e.target.id);
  if (!f) return;
  const v = Number(e.target.value);
  if (!Number.isFinite(v) || v < f[3] || v > f[4]) { showHint(`${f[1]} must be from ${f[3]} to ${f[4]}.`, 6000); renderBfpForm(); return; }
  scenario.bfp = {...bfpSettings(), [f[0]]: f[0] === 'perMin' ? Math.round(v) : v};
  saveScenario();
});

// ---------- station ----------
async function initBfp() {
  for (const [name, img] of truckImages()) map.addImage(name, img, {pixelRatio: 2});
  map.addSource('bfp-station', {type: 'geojson', data: empty()});
  map.addLayer({id: 'bfp-station', type: 'symbol', source: 'bfp-station', layout: {'icon-image': 'bfp-station', 'icon-size': 0.8, 'icon-allow-overlap': true,
    'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-optional': true},
    paint: {'text-color': '#b71c1c', 'text-halo-color': '#fff', 'text-halo-width': 2}});
  map.addSource('bfp-route', {type: 'geojson', data: empty()});
  map.addLayer({id: 'bfp-route', type: 'line', source: 'bfp-route', layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': '#d50000', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2, 19, 5], 'line-dasharray': [2, 1.5], 'line-opacity': 0.85}});
  map.addSource('bfp-water', {type: 'geojson', data: empty()});
  map.addLayer({id: 'bfp-water-jet', type: 'line', source: 'bfp-water', filter: ['==', ['geometry-type'], 'LineString'],
    paint: {'line-color': '#4fc3f7', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 5], 'line-opacity': 0.55, 'line-blur': 1}});
  map.addLayer({id: 'bfp-water-drops', type: 'circle', source: 'bfp-water', filter: ['==', ['geometry-type'], 'Point'],
    paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 4], 'circle-color': '#e1f5fe', 'circle-stroke-color': '#0288d1', 'circle-stroke-width': 1}});
  map.addSource('bfp-truck', {type: 'geojson', data: empty()});
  map.addLayer({id: 'bfp-truck', type: 'symbol', source: 'bfp-truck', layout: {'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
    'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 17, 0.75, 19, 1.1]}});
  try {
    const stored = cloud.enabled ? await cloud.loadSetting('bfp_station') : JSON.parse(localStorage.getItem(BFP_STATION_KEY) || 'null');
    if (stored?.lonlat) bfpStation = stored;
  } catch { /* default */ }
  showStation();
  renderBfpForm();
}
function showStation() {
  map.getSource('bfp-station')?.setData({type: 'FeatureCollection', features: [{type: 'Feature', geometry: {type: 'Point', coordinates: bfpStation.lonlat}, properties: {name: bfpStation.approximate ? 'BFP (approx.)' : 'BFP station'}}]});
  renderBfpForm();
}
function onRemoteBfpStation(v) { if (v?.lonlat) { bfpStation = v; showStation(); } }
bui.setStation.addEventListener('click', () => {
  if (!requireEdit()) return;
  bfpPicking = !bfpPicking;
  bui.setStation.textContent = bfpPicking ? 'Click the map…' : 'Set station location';
  map.getCanvas().style.cursor = bfpPicking ? 'crosshair' : '';
  if (bfpPicking) showHint('Click the map where the BFP Balamban fire station is (the truck starts there).', 6000);
});
/** Map click while setting the station (app.js). */
function bfpClick(e) {
  if (!bfpPicking) return false;
  bfpPicking = false;
  bui.setStation.textContent = 'Set station location';
  map.getCanvas().style.cursor = '';
  bfpStation = {lonlat: [+e.lngLat.lng.toFixed(7), +e.lngLat.lat.toFixed(7)], name: 'BFP Balamban fire station', approximate: false};
  (cloud.enabled ? cloud.saveSetting('bfp_station', bfpStation) : Promise.resolve(localStorage.setItem(BFP_STATION_KEY, JSON.stringify(bfpStation))))
    .catch(err => showHint(`Could not save the station: ${err.message}`, 8000));
  showStation();
  showHint('Station location saved. Fires started from now on send the truck from here.', 6000);
  return true;
}

/** Controller factory for a batch of runs (null when the BFP response is off). */
function prepareBfp(features, inputs) {
  const s = bfpSettings();
  if (!s.on) return null;
  try {
    return IgnisBFP.prepare({features, densities: inputs.map(m => m.bldg_dens), roads, paths: fieldPaths(), station: bfpStation.lonlat, params: s});
  } catch (err) { showHint(`The BFP response could not be set up: ${err.message}`, 8000); return null; }
}

// ---------- truck and water ----------
function truckImages() {
  const draw = mirror => {
    const W = 44, H = 24, k = 2, c = document.createElement('canvas');
    c.width = W * k; c.height = H * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    if (mirror) { g.translate(W, 0); g.scale(-1, 1); }
    g.lineJoin = 'round';
    g.fillStyle = '#c62828'; g.strokeStyle = '#3e0a0a'; g.lineWidth = 1.5;
    g.beginPath(); g.rect(2, 6, 28, 12); g.fill(); g.stroke();                       // body
    g.beginPath(); g.moveTo(30, 18); g.lineTo(30, 8); g.lineTo(37, 8); g.lineTo(42, 13); g.lineTo(42, 18); g.closePath(); g.fill(); g.stroke(); // cab
    g.fillStyle = '#bbdefb'; g.fillRect(32, 9.5, 5, 4);                              // window
    g.strokeStyle = '#eceff1'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(4, 5); g.lineTo(28, 2); g.stroke(); // ladder
    for (let x = 7; x < 28; x += 5) { g.beginPath(); g.moveTo(x, 4.6); g.lineTo(x, 3); g.stroke(); }
    g.fillStyle = '#fff'; g.fillRect(4, 11, 24, 2);                                 // stripe
    g.fillStyle = '#212121';
    for (const x of [9, 24, 36]) { g.beginPath(); g.arc(x, 19, 3.2, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#ffeb3b'; g.fillRect(33, 5.5, 3, 2);                             // light
    return g.getImageData(0, 0, W * k, H * k);
  };
  const station = (() => {
    const S = 30, k = 2, c = document.createElement('canvas');
    c.width = c.height = S * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    g.fillStyle = '#b71c1c'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(15, 3); g.lineTo(27, 12); g.lineTo(27, 27); g.lineTo(3, 27); g.lineTo(3, 12); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 9px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('BFP', 15, 23);
    return g.getImageData(0, 0, S * k, S * k);
  })();
  return [['bfp-truck', draw(false)], ['bfp-truck-l', draw(true)], ['bfp-station', station]];
}
function bfpShow(r, features) {
  bfpVisualsEmpty = false;
  bfpShown = r?.bfp ? {tl: r.bfp, features} : null;
  map.getSource('bfp-route')?.setData({type: 'FeatureCollection', features: bfpShown ? bfpShown.tl.drives.map(d => ({type: 'Feature', geometry: {type: 'LineString', coordinates: d.coords}, properties: {}})) : []});
  bui.status.hidden = !bfpShown;
  bfpTick(0);
}
const bldgCentre = f => { const r = f.geometry.coordinates[0], n = r.length - 1; let x = 0, y = 0; for (let k = 0; k < n; k++) { x += r[k][0]; y += r[k][1]; } return [x / n, y / n]; };
/** Called with the playback minute (fire-ui loop). */
function bfpTick(minute) {
  if (!bfpShown) {
    if (!bfpVisualsEmpty) { map.getSource('bfp-truck')?.setData(empty()); map.getSource('bfp-water')?.setData(empty()); bfpVisualsEmpty = true; }
    return;
  }
  bfpVisualsEmpty = false;
  const tl = bfpShown.tl, t = IgnisBFP.truckAt(tl, minute);
  map.getSource('bfp-truck').setData({type: 'FeatureCollection', features: [{type: 'Feature', geometry: {type: 'Point', coordinates: t.at}, properties: {icon: t.dir < 0 ? 'bfp-truck-l' : 'bfp-truck'}}]});
  const water = [];
  for (const s of tl.sprays) {
    if (minute < s.minute || minute >= s.minute + 1.2) continue;
    const to = bldgCentre(bfpShown.features[s.target]);
    water.push({type: 'Feature', geometry: {type: 'LineString', coordinates: [s.at, to]}, properties: {}});
    for (let k = 0; k < 6; k++) { // drops travelling along the jet
      const f = ((typeof clock === 'number' ? clock : 0) * 1.6 + k / 6) % 1, arc = Math.sin(f * Math.PI) * 0.00006;
      water.push({type: 'Feature', geometry: {type: 'Point', coordinates: [s.at[0] + (to[0] - s.at[0]) * f, s.at[1] + (to[1] - s.at[1]) * f + arc]}, properties: {}});
    }
  }
  map.getSource('bfp-water').setData({type: 'FeatureCollection', features: water});
  const fmt = m => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;
  const P = bfpSettings(), call = P.callMin, leave = tl.dispatch ?? call + P.turnoutMin, first = tl.arrivals[0]?.minute;
  bui.status.textContent = minute < call ? `BFP: not yet called (call at ${fmt(call)})`
    : minute < leave ? `BFP: call received at ${fmt(call)} — crew getting the truck ready`
    : first === undefined ? 'BFP: the truck could not find an open road to the fire'
    : minute < first ? `BFP: truck on the way (left ${fmt(leave)}, arrives ${fmt(first)})`
    : t.state === 'spraying' ? `BFP: spraying water · ${tl.sprays.filter(s => s.minute <= minute).length} buildings put out`
    : t.state === 'driving' ? 'BFP: moving to the next part of the fire'
    : `BFP: standing by · ${tl.sprays.filter(s => s.minute <= minute).length} buildings put out`;
}
function bfpSummaryHtml(r, noBfpIgnited) {
  if (!r.bfp) return '';
  const tl = r.bfp, fmt = m => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`, P = bfpSettings();
  const ignited = r.result.frames.at(-1).states.filter(s => s > 0).length;
  const first = tl.arrivals[0];
  return `<b>BFP response</b> (optional, not part of the paper's model): call at ${fmt(P.callMin)}, truck left ${fmt(tl.dispatch ?? P.callMin + P.turnoutMin)}${first ? `, first on scene ${fmt(first.minute)} (${Math.round(first.gap)} m from the flames)` : ', never reached the fire'}; ${tl.extinguished} buildings put out.
    Same fire and replay number <b>without</b> the BFP: ${noBfpIgnited.toLocaleString()} buildings caught fire; <b>with</b> it: ${ignited.toLocaleString()}.${tl.notes.length ? ` <span class="muted">${tl.notes[0]}</span>` : ''}`;
}
