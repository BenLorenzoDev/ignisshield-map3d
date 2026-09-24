/* global map, $, cloud, canEdit, requireEdit, showHint, empty, IgnisBFP, roads, fieldPaths, scenario, saveScenario, clock */
// Optional BFP fire-truck response: form options, station, truck and water animation.
const BFP_STATION_KEY = 'ignisshield-map3d.bfp-station';
const BFP_DEFAULT_STATION = {lonlat: [123.71327, 10.50537], name: 'BFP Balamban (approximate: Municipal Hall)', approximate: true};
const bui = {
  toggle: $('#bfp-toggle'), fields: $('#bfp-fields'), stationInfo: $('#bfp-station-info'), setStation: $('#bfp-set-station'),
  status: $('#bfp-status'), summary: $('#bfp-summary')
};
const BFP_FIELDS = [
  ['truckCount', 'Number of fire trucks', 'vehicles', 1, 10, 1],
  ['callMin', 'Call received after', 'min', 0, 60, 0.5],
  ['turnoutMin', 'Crew turnout', 'min', 0, 15, 0.5],
  ['speedKmh', 'Truck speed', 'km/h', 5, 80, 1],
  ['reachM', 'Hose reach', 'm', 10, 200, 5],
  ['perMin', 'Buildings put out per truck per minute', '', 1, 10, 1]
];
let bfpStation = BFP_DEFAULT_STATION;
let bfpPicking = false;
let bfpShown = null; // timeline of the run on screen
let bfpVisualsEmpty = false;
let bfpStationLabel = '';

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
  if (['perMin','truckCount'].includes(f[0]) && !Number.isInteger(v)) { showHint(`${f[1]} must be a whole number.`, 6000); renderBfpForm(); return; }
  scenario.bfp = {...bfpSettings(), [f[0]]: v};
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
  map.addLayer({id: 'bfp-truck', type: 'symbol', source: 'bfp-truck', filter:['==',['get','deployed'],true], layout: {
    'icon-image': 'bfp-truck', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
    'icon-rotate':['get','bearing'], 'icon-rotation-alignment':'map', 'icon-pitch-alignment':'map',
    'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 17, 0.75, 19, 1.1],
    'text-field':['to-string',['get','truckId']], 'text-font':['Noto Sans Bold'], 'text-size':10,
    'text-allow-overlap':true, 'text-ignore-placement':true},
    paint:{'text-color':'#fff','text-halo-color':'#7f1111','text-halo-width':1.5}});
  try {
    const stored = cloud.enabled ? await cloud.loadSetting('bfp_station') : JSON.parse(localStorage.getItem(BFP_STATION_KEY) || 'null');
    if (stored?.lonlat) bfpStation = stored;
  } catch { /* default */ }
  showStation();
  renderBfpForm();
}
function showStation() {
  bfpStationLabel = '';
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
  const draw = () => {
    // Roof view, nose pointing north/up at zero rotation. MapLibre rotates this in the road plane.
    const W = 24, H = 44, k = 2, c = document.createElement('canvas');
    c.width = W * k; c.height = H * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    g.lineJoin = 'round';
    g.fillStyle = '#17232e';
    for (const x of [1,19]) for (const y of [8,29,35]) g.fillRect(x,y,4,6);
    g.fillStyle = '#d62c2c'; g.strokeStyle = '#fff'; g.lineWidth = 1.4;
    g.beginPath();g.roundRect(4,2,16,40,3);g.fill();g.stroke();
    g.fillStyle = '#a9e2ff';g.fillRect(6,5,12,5); // windshield near the front
    g.fillStyle = '#fff';g.fillRect(5,13,14,2);g.fillRect(6,2,3,2);g.fillRect(15,2,3,2);
    g.fillStyle = '#287eff';g.fillRect(6,11,5,2);g.fillStyle = '#ffec69';g.fillRect(13,11,5,2);
    g.strokeStyle = '#f2f5f7';g.lineWidth = 1.4;
    g.strokeRect(8,26,8,13);for(let y=28;y<39;y+=3){g.beginPath();g.moveTo(8,y);g.lineTo(16,y);g.stroke();}
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
  return [['bfp-truck', draw()], ['bfp-station', station]];
}
function bfpShow(r, features) {
  bfpVisualsEmpty = false;
  bfpShown = r?.bfp ? {tl: r.bfp, features} : null;
  if (!bfpShown) showStation();
  map.getSource('bfp-route')?.setData({type: 'FeatureCollection', features: bfpShown ? bfpShown.tl.drives.filter(d=>d.coords.length>1).map(d => ({type: 'Feature', geometry: {type: 'LineString', coordinates: d.coords}, properties: {truckId:d.truckId??1}})) : []});
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
  const tl = bfpShown.tl, trucks = IgnisBFP.trucksAt(tl, minute);
  map.getSource('bfp-truck').setData({type: 'FeatureCollection', features: trucks.map(t=>({type: 'Feature', geometry: {type: 'Point', coordinates: t.at}, properties: {truckId:t.truckId,bearing:t.bearing,deployed:t.deployed}}))});
  const waiting = trucks.filter(t=>!t.deployed).length;
  const stationLabel = `BFP station${waiting?` · ${waiting} ${waiting===1?'truck':'trucks'} waiting`:''}`;
  if (stationLabel !== bfpStationLabel) {
    bfpStationLabel = stationLabel;
    map.getSource('bfp-station')?.setData({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:tl.station},properties:{name:stationLabel}}]});
  }
  const water = [];
  for (const s of tl.sprays) {
    if (minute < s.minute || minute >= s.minute + 1) continue;
    const to = bldgCentre(bfpShown.features[s.target]);
    water.push({type: 'Feature', geometry: {type: 'LineString', coordinates: [s.at, to]}, properties: {}});
    for (let k = 0; k < 6; k++) { // drops travelling along the jet
      const f = ((typeof clock === 'number' ? clock : 0) * 1.6 + k / 6) % 1, arc = Math.sin(f * Math.PI) * 0.00006;
      water.push({type: 'Feature', geometry: {type: 'Point', coordinates: [s.at[0] + (to[0] - s.at[0]) * f, s.at[1] + (to[1] - s.at[1]) * f + arc]}, properties: {}});
    }
  }
  map.getSource('bfp-water').setData({type: 'FeatureCollection', features: water});
  const fmt = m => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;
  const P = tl.params ?? bfpSettings(), call = P.callMin, leave = tl.dispatch ?? call + P.turnoutMin;
  const count = state => trucks.filter(t=>t.state===state).length;
  const states = [['driving','on the road'],['spraying','spraying'],['standby','standing by'],['station','at station'],['blocked','waiting for access']]
    .filter(([state])=>count(state)).map(([state,label])=>`${count(state)} ${label}`).join(' · ');
  bui.status.textContent = `BFP · ${trucks.length} ${trucks.length===1?'truck':'trucks'}: ` + (minute < call ? `call at ${fmt(call)}`
    : minute < leave ? `crews preparing · first departure ${fmt(leave)}`
    : `${states} · ${tl.sprays.filter(s=>s.minute<=minute).length} buildings put out`);
}
function bfpSummaryHtml(r, noBfpIgnited) {
  if (!r.bfp) return '';
  const tl = r.bfp, fmt = m => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`, P = tl.params ?? r.calculation?.bfp ?? bfpSettings();
  const ignited = r.result.frames.at(-1).states.filter(s => s > 0).length;
  const first = tl.arrivals[0];
  return `<b>BFP response · ${tl.truckCount??1} ${(tl.truckCount??1)===1?'truck':'trucks'}</b> (optional, not part of the paper's model): capacity ${P.perMin} buildings per truck per minute; call at ${fmt(P.callMin)}, first departure ${fmt(tl.dispatch ?? P.callMin + P.turnoutMin)}${first ? `, first on scene ${fmt(first.minute)} (${Math.round(first.gap)} m from the flames)` : ', never reached the fire'}; ${tl.extinguished} buildings put out.
    Same fire and replay number <b>without</b> the BFP: ${noBfpIgnited.toLocaleString()} buildings caught fire; <b>with</b> it: ${ignited.toLocaleString()}.${tl.notes.length ? ` <span class="muted">${tl.notes[0]}</span>` : ''}`;
}
