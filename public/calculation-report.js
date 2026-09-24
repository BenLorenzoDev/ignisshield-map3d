/* Read-only explanations of a saved run. This module never feeds the simulation or its RNG. */
(function(root) {
  const F = typeof module !== 'undefined' && module.exports ? require('./fire.js') : root.IgnisFire;
  const P = typeof module !== 'undefined' && module.exports ? require('./paper.js') : root.IgnisPaper;
  const factors = [0, 0.35, 0.85, 1.4];
  const names = ['', 'Concrete-class / lower fuel', 'Mixed-class / medium fuel', 'Wood, nipa or plywood-class / higher fuel'];
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n = (x, digits = 6) => Number.isFinite(x) ? Number(x.toFixed(digits)).toLocaleString('en-US', {maximumFractionDigits:digits}) : '—';
  const sum = (rows, fn) => rows.reduce((a, b) => a + fn(b), 0);

  function capture(features, paper, local, meta) {
    return structuredClone({...meta, buildings: features.map((f, i) => ({id:f.properties.id,
      paper:paper[i], local:local[i], sources:Object.fromEntries(P.INPUTS.map(v => [v.key,
        v.key === 'Db' && paper[i].Db == null ? 'Measured from mapped footprints'
          : v.scope === 'weather' && meta.weatherOverride ? (meta.weatherSource || 'Custom weather on this device')
          : meta.trial ? `Trial ${meta.trial} assumption`
          : v.scope === 'weather' ? (meta.weatherSource || 'Scenario weather')
          : typeof f.properties[v.key] === 'number' ? 'Entered value; field verification not recorded' : 'Default assumption']))}))});
  }

  function derive(run) {
    if (!run.calculation) throw new Error('This older run has no saved calculation inputs. Start a new run to create a report.');
    const geometry = F.footprints(run.features), origin = run.calculation.originIndex;
    const ignition = geometry.map(() => null), stopped = geometry.map(() => null);
    for (const frame of run.result.frames) frame.states.forEach((state, i) => {
      if (state > 0 && ignition[i] === null) ignition[i] = frame.minute;
      if (state >= 2 && stopped[i] === null) stopped[i] = {minute:frame.minute, reason:state===3?'BFP put out':'Burned out'};
    });
    const rows = geometry.map((g, i) => {
      const v = run.inputs[i], material = factors[v.bldg_mat];
      const heat = 80 * material * (1 - 0.6 * v.humidity / 100) * v.oxygen_v;
      return {...g, i, saved:run.calculation.buildings[i], values:v, material, heat,
        kw:g.area * heat, ignition:ignition[i], stopped:stopped[i], duration:(4 + 3*v.bldg_mat + Math.log1p(v.house_cnt)) * (0.8 + v.humidity/200) / Math.sqrt(v.oxygen_v),
        dx:(g.x-geometry[origin].x)*g.area, dy:(g.y-geometry[origin].y)*g.area,
        distance:Math.hypot(g.x-geometry[origin].x,g.y-geometry[origin].y)};
    });
    const affected = rows.filter(r => r.ignition !== null);
    const minutes = run.result.frames.map(frame => {
      const burning = rows.filter(r => frame.states[r.i] === 1);
      const kw = sum(burning, r=>r.kw), perimeter = sum(burning,r=>r.perimeter);
      return {minute:frame.minute, burning:burning.length, kw, perimeter, intensity:perimeter?kw/perimeter:0};
    });
    const peakHeat = minutes.reduce((a,b)=>b.kw>a.kw?b:a), peakIntensity = minutes.reduce((a,b)=>b.intensity>a.intensity?b:a);
    const area = sum(affected,r=>r.area), totalArea = sum(rows,r=>r.area), dx = sum(affected,r=>r.dx), dy = sum(affected,r=>r.dy);
    const lastIgnition = Math.max(...affected.map(r=>r.ignition)), maxDistance = Math.max(...affected.map(r=>r.distance));
    const durationSum = sum(affected,r=>r.duration), end = run.result.frames.at(-1).minute;
    return {rows, affected, minutes, origin:rows[origin], peakHeat, peakIntensity, area, totalArea, dx, dy, lastIgnition, maxDistance, durationSum, end,
      values:[area/totalArea, peakIntensity.intensity, lastIgnition?maxDistance/lastIgnition:0, peakHeat.kw/1000, area,
        Math.hypot(dx,dy)>0.001?((Math.atan2(dx,dy)*180/Math.PI)%360+360)%360:'',durationSum/affected.length,end]};
  }
  const table = (headers, rows) => `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const equation = text => `<p class="equation">${esc(text)}</p>`;
  const section = (title, formula, steps, result, meaning) => `<section class="calculation"><h3>${esc(title)}</h3>${equation(formula)}<ol>${steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol><p class="answer">${esc(result)}</p><p>${esc(meaning)}</p></section>`;

  function html(run) {
    const d = derive(run), meta = run.calculation, o = d.origin, v = o.values, p = o.saved.paper, local = o.saved.local;
    const outputs = P.outputs(run.result.metrics), db = p.Db ?? local.Db;
    const moisture = 0.25+0.75*(1-v.humidity/100), temp = Math.exp((v.temp_c-25)/45), houses = 0.7+0.3*Math.log1p(v.house_cnt);
    const worked = [
      section('Building coverage', 'C = min(1, Db × Ā₃₀)', [
        `Db = ${n(db,10)} structures/m² (${o.saved.sources.Db}). Ā₃₀ = ${n(local.meanArea)} m², the mean footprint area of mapped buildings with centres within 30 m.`,
        `${n(db,10)} × ${n(local.meanArea)} = ${n(db*local.meanArea,10)}. Cap at 1, then round to 6 decimal places for the model.`],
        `C = ${n(v.bldg_dens)} (${n(v.bldg_dens*100,4)}%)`, 'This is the local coverage proxy. It is not the percentage of buildings that will burn.'),
      section('Material class', 'Mb < 700 → class 1; 700 ≤ Mb < 1,100 → class 2; Mb ≥ 1,100 → class 3',
        [`Mb = ${n(p.Mb)} MJ/m². Select class ${v.bldg_mat}: ${names[v.bldg_mat]}.`, 'Look up the assumed factor: class 1 → 0.35; class 2 → 0.85; class 3 → 1.40.'],
        `M = ${n(o.material)}`, 'The factor is a lookup assumption, not fuel load multiplied by a conversion constant. This class does not verify the actual building material.'),
      section('Oxygen and wind units', 'φO₂ = entered multiplier; Umodel = Uw × 3.6',
        [`φO₂ = ${n(v.oxygen_v)}. Normal air uses 1, corresponding to approximately 20.9% oxygen; do not enter 0.21 for normal air.`,
          `${n(p.Uw)} m/s × 3.6 = ${n(v.wind_spd)} km/h. Wind FROM ${n(v.wind_dir)}° blows TOWARD ${n((v.wind_dir+180)%360)}°.`],
        `Oxygen factor ${n(v.oxygen_v)}; model wind ${n(v.wind_spd)} km/h`, 'Humidity, temperature, house count and alley width retain their entered units.'),
      section('Heat output per unit area', 'q″ = 80 × M × (1 − 0.6 × Hr / 100) × φO₂',
        [`Humidity term: 1 − 0.6 × ${n(v.humidity)} / 100 = ${n(1-0.6*v.humidity/100)}.`,
          `80 × ${n(o.material)} × ${n(1-0.6*v.humidity/100)} × ${n(v.oxygen_v)} = ${n(o.heat)} kW/m².`,
          `Building heat: footprint area ${n(o.area)} m² × ${n(o.heat)} kW/m² = ${n(o.kw)} kW while burning.`],
        `q″ = ${n(o.heat)} kW/m²`, 'The constant 80 and material factors are model assumptions. This is a heat-output proxy, not a measured fire temperature or heat flux.'),
      section('Susceptibility of the starting building', 'S = M × (0.6 + 1.2C) × [0.25 + 0.75(1 − Hr/100)] × exp((Ta − 25)/45) × [0.7 + 0.3 ln(1 + Nh)] × φO₂ × 2/(Wr + 0.7)',
        [`Coverage factor = ${n(0.6+1.2*v.bldg_dens)}; moisture = ${n(moisture)}; temperature = ${n(temp)}; household factor = ${n(houses)}; alley factor = ${n(2/(v.alley_wd+0.7))}.`,
          `${n(o.material)} × ${n(0.6+1.2*v.bldg_dens)} × ${n(moisture)} × ${n(temp)} × ${n(houses)} × ${n(v.oxygen_v)} × ${n(2/(v.alley_wd+0.7))}`],
        `S = ${n(F.susceptibility(v),10)}`, 'Each target building has its own S. The selected origin is ignited directly; spread decisions then use target susceptibility, distance, wind and the saved random sequence.')
    ].join('');
    const cards = [
      section('Y1 · Fire severity index', 'Sf = Σ area of buildings that ignited / Σ area of all buildings in the run',
        [`${d.affected.length} buildings ignited out of ${d.rows.length}. Add their areas: ${n(d.area)} m².`, `Total included area = ${n(d.totalArea)} m². ${n(d.area)} / ${n(d.totalArea)} = ${n(d.values[0],10)}.`],
        `${outputs[0].text} (stored index ${n(outputs[0].value,4)})`, 'Thresholds applied to the stored index: < 0.1 Low; < 0.3 Moderate; < 0.6 High; otherwise Catastrophic. This is an area fraction, not a death count.'),
      section('Y2 · Fire line intensity', 'If = max over recorded minutes [Σ burning-building heat (kW) / Σ burning-building perimeter (m)]',
        [`At peak intensity, minute ${d.peakIntensity.minute}: heat sum = ${n(d.peakIntensity.kw)} kW; perimeter sum = ${n(d.peakIntensity.perimeter)} m.`, `${n(d.peakIntensity.kw)} / ${n(d.peakIntensity.perimeter)} = ${n(d.values[1],10)} kW/m.`],
        `${n(outputs[1].value,4)} kW/m`, 'The denominator adds individual footprint perimeters, including any shared edges. Peak intensity and peak total heat may occur at different minutes.'),
      section('Y3 · Fire spread rate', 'R = maximum centroid distance from origin among ignited buildings / last ignition minute',
        [`Maximum distance = ${n(d.maxDistance)} m; last ignition = minute ${d.lastIgnition}.`, d.lastIgnition?`${n(d.maxDistance)} / ${d.lastIgnition} = ${n(d.values[2],10)} m/min.`:'No later ignition: the model returns 0 m/min.'],
        `${n(outputs[2].value,4)} m/min`, 'The last ignition can be a different building from the farthest one. This is the model’s aggregate spread proxy, not a measured flame-front velocity.'),
      section('Y4 · Heat release rate', 'Q = max over recorded minutes [Σ(area × q″)] / 1,000',
        [`At peak heat, minute ${d.peakHeat.minute}, ${d.peakHeat.burning} buildings burn. Their heat contributions total ${n(d.peakHeat.kw)} kW.`, `${n(d.peakHeat.kw)} / 1,000 = ${n(d.values[3],10)} MW.`],
        `${n(outputs[3].value,4)} MW`, 'Each building uses its own material, humidity and oxygen inputs. See the building ledger and minute totals below.'),
      section('Y5 · Total burned area', 'Ab = Σ footprint area of every building that ignited',
        [`Add the ${d.affected.length} ignited-building areas in the ledger: ${n(d.area)} m².`], `${n(outputs[4].value,4)} m²`,
        'The existing metric includes buildings still burning or put out by BFP, not only fully burned-out buildings. Footprint area is not multiplied by storeys.'),
      section('Y6 · Spread direction', 'Dx = Σ[(xi − x₀)Ai]; Dy = Σ[(yi − y₀)Ai]; φs = atan2(Dx, Dy) × 180/π, wrapped to [0, 360)',
        [`Area-weighted east displacement Dx = ${n(d.dx)} m³; north displacement Dy = ${n(d.dy)} m³.`, d.values[5]===''?'The weighted displacement magnitude is at most 0.001; the model leaves direction undefined.':`atan2(${n(d.dx)}, ${n(d.dy)}) converted to degrees and wrapped = ${n(d.values[5],10)}°.`],
        outputs[5].value===''?'No defined spread direction':`${n(outputs[5].value,2)}° clockwise from north`, 'Coordinates are projected in UTM zone 51N. This is the direction of the weighted displacement, not an arithmetic mean of compass angles.'),
      section('Y7 · Mean burning duration', 'τi = (4 + 3 × classi + ln(1 + Nhi)) × (0.8 + Hri/200) / √φO₂i; τb = Στi / number ignited',
        [`Starting building: (4 + 3 × ${v.bldg_mat} + ln(1 + ${v.house_cnt})) × (0.8 + ${v.humidity}/200) / √${v.oxygen_v} = ${n(o.duration)} min.`,
          `Across ignited buildings: ${n(d.durationSum)} / ${d.affected.length} = ${n(d.values[6],10)} min.`], `${n(outputs[6].value,4)} min per building`,
        'This is the mean assigned model duration. It is not shortened when BFP puts a building out or playback reaches its time limit.'),
      section('Y8 · Total simulation time', 'Tsim = final recorded model minute; seconds = Tsim × 60; hours = Tsim / 60',
        [`Final minute = ${d.end}; requested limit = ${meta.maxMinutes} min; stop status = ${run.result.status}.`, `${d.end} × 60 = ${d.end*60} seconds; ${d.end} / 60 = ${n(d.end/60)} hours.`], `${n(outputs[7].value,4)} min`,
        'This is simulated fire time. Computer calculation time and playback speed are separate and do not change this output.')
    ].join('');
    const inputRows = d.rows.map(r=>[r.i+1, ...P.INPUTS.map(x=>x.key==='Db'?n(r.saved.paper.Db??r.saved.local.Db,10):n(r.saved.paper[x.key])), n(r.saved.local.meanArea), n(r.values.bldg_dens), r.values.bldg_mat]);
    const ledger = d.rows.map(r=>[r.i+1,n(r.area),n(r.perimeter),r.ignition===null?'Did not ignite':r.ignition,r.stopped?`${r.stopped.minute} · ${r.stopped.reason}`:r.ignition===null?'—':'Still burning at end',n(r.heat),n(r.kw),n(r.duration),r.ignition===null?'—':n(r.distance),r.ignition===null?'—':n(r.dx),r.ignition===null?'—':n(r.dy)]);
    const provenance = d.rows.map(r=>[r.i+1, ...P.INPUTS.map(x=>r.saved.sources[x.key])]);
    const symbols = table(P.INPUTS.map(x=>x.key), [P.INPUTS.map(x=>`${x.name} (${x.unit})`)]);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IgnisShield calculations · ${esc(run.id)}</title><style>
      *{box-sizing:border-box}body{margin:0;background:#eef2f6;color:#203044;font:15px/1.55 system-ui,sans-serif}main{max-width:1040px;margin:24px auto;padding:32px;background:white;border-radius:12px}h1{font-size:28px;line-height:1.2;margin:8px 0}h2{margin-top:32px;font-size:22px}h3{font-size:18px;margin:0 0 12px}p{margin:10px 0}.eyebrow{font-size:12px;font-weight:700;color:#416482;letter-spacing:.09em;text-transform:uppercase}.meta{display:flex;gap:8px;flex-wrap:wrap}.meta span{background:#edf3f9;padding:5px 10px;border-radius:5px}.note{padding:14px 18px;border-left:4px solid #cf8a24;background:#fff8e9}.calculation{padding:22px 0;border-bottom:1px solid #dbe3eb;break-inside:avoid}.equation{font-family:ui-monospace,monospace;background:#edf3f9;padding:14px;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:6px}.answer{font-size:18px;font-weight:700;color:#126049;background:#edf8f2;padding:10px 14px;border-radius:5px}li{margin:8px 0}.table-wrap{overflow-x:auto;margin:14px 0}table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}th,td{border:1px solid #dce3ea;text-align:left;padding:7px;vertical-align:top}th{background:#edf3f9}details{margin:18px 0;border:1px solid #dce3ea;padding:14px;border-radius:6px}summary{font-weight:650;cursor:pointer}button{background:#1859a5;color:white;border:0;border-radius:5px;padding:9px 14px;font:inherit;cursor:pointer}nav{display:flex;gap:16px;flex-wrap:wrap;margin-top:18px}a{color:#1859a5}@media(max-width:600px){main{margin:0;padding:18px;border-radius:0}h1{font-size:24px}.equation{font-size:12px}}
      @media print{@page{size:A4;margin:12mm}body{background:white;font-size:10pt}main{max-width:none;margin:0;padding:0}.no-print{display:none!important}h2{break-after:avoid}.table-wrap{overflow:visible}table{font-size:7pt;table-layout:fixed;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}details{border:0;padding:0}.calculation{break-inside:auto}.answer{break-before:avoid}}
      </style></head><body><main><div class="eyebrow">IgnisShield · calculation record</div><h1>How this run’s results were calculated</h1>
      <p>Saved run <b>${esc(run.id)}</b> · ${esc(meta.utc)} · model ${esc(run.result.model)}</p>
      <div class="meta"><span>${esc(meta.trial?`Trial ${meta.trial}${meta.weatherOverride ? " building inputs + custom weather" : ""}`:'Custom inputs')}</span><span>Replay #${esc(run.seed)}</span><span>${d.rows.length} included buildings</span><span>Origin: Building ${o.i+1}</span><span>${esc(meta.extent)}</span><span>BFP ${run.bfp?'on':'off'}</span></div>
      <p>Routing: ${esc(run.evac?.preview?'Surveyed alleys with obstacle avoidance':'Original straight-connection assumptions')}. The routing mode does not change the fire equations.</p>
      ${run.bfp&&meta.bfp?`<p>BFP: ${n(meta.bfp.truckCount??1)} trucks; call after ${n(meta.bfp.callMin)} min; crew turnout ${n(meta.bfp.turnoutMin)} min; speed ${n(meta.bfp.speedKmh)} km/h; hose reach ${n(meta.bfp.reachM)} m; capacity ${n(meta.bfp.perMin)} buildings per truck per minute; standoff ${n(meta.bfp.standoffM)} m; wetting multiplies ignition hazard by ${n(meta.bfp.wetFactor)}.</p>`:''}
      ${(run.bfp?.truckCount??1)>1?'<p>Fleet assumptions: six-second departure spacing and separate stand-by positions at least 8 m apart. Each building is assigned to one spraying truck per minute; overlapping wetting does not compound. This extension changes the optional response, not the reviewed fire equations. Traffic queues, finite water supplies and crew limits are not simulated.</p>':''}
      <nav class="no-print"><a href="#worked">Input calculations</a><a href="#outputs">Y1–Y8 results</a><a href="#ledger">Supporting tables</a><button onclick="window.print()">Print / Save PDF</button></nav>
      <p class="note">These are relative model predictions using documented assumptions, not measurements or validation against a real fire. Material classes are inferred from entered fuel load; actual construction has not been verified by tracing the map. The earlier paper’s 29-building results and statistical conclusions are historical and do not automatically apply to this ${d.rows.length}-building run.</p>
      <p>All values below come from this run’s saved inputs, geometry and recorded states. Calculations use full precision; displayed intermediate values are rounded. Stored outputs are rounded by the existing model (Y1–Y5 and Y7–Y8 to 4 decimals; Y6 to 2). No simulation is rerun to make this report.</p>
      <h2 id="worked">1. Worked inputs · Building ${o.i+1}</h2>
      ${table(['Input','Saved value','Source'],P.INPUTS.map(x=>[`${x.sym} · ${x.name}`,`${n(x.key==='Db'?db:p[x.key],10)} ${x.unit}`,o.saved.sources[x.key]]))}${worked}
      <section><h3>How spread decisions become recorded results</h3>${equation('λij = 0.7 × Sj × exp(min(2, 0.9Uj/30) × cos(θij − θtoward,j)) × exp(−gapij/(6 + 0.4Uj)) × BFP protectionj')}${equation('pj = 1 − exp(−Σλij × Δt); ignite if saved-seed random draw < pj')}
      <p>Sj is target susceptibility, Uj is wind in km/h, θij is the source-to-target centroid bearing in radians, gap is footprint separation in metres, and Δt = 1 minute. Active burning neighbours within the model’s 60 m gap limit contribute. Protection is 1 without BFP protection. The replay seed fixes the random sequence; susceptibility alone does not determine the final severity. Y1–Y8 are derived from the resulting recorded run below.</p></section>
      <h2 id="outputs">2. Final results · Y1–Y8</h2>${cards}
      <h2 id="ledger">3. Supporting tables</h2><p>Building numbers match this run’s Live activity panel. Expand a table to inspect every building or recorded minute. Printing includes all tables. Save this HTML report to keep the calculations after closing the map session.</p>
      <details><summary>All building inputs (${d.rows.length})</summary>${symbols}${table(['Building',...P.INPUTS.map(x=>x.key),'Mean area within 30 m (m²)','Model C','Class'],inputRows)}</details>
      <details><summary>Input sources · assumptions and entered values</summary><p>“Entered” means a value was saved, not that a field survey verified it. Measured density uses all mapped footprints in the 30 m neighbourhood, even when the fire run is limited to the study boundary.</p>${table(['Building',...P.INPUTS.map(x=>x.key)],provenance)}</details>
      <details><summary>Building contributions · areas, heat and durations</summary>${table(['Building','Area m²','Perimeter m','Ignition min','First recorded stop min','q″ kW/m²','Heat kW while burning','Assigned duration min','Distance m','Dx m³','Dy m³'],ledger)}</details>
      <details><summary>Recorded minute totals · verify the heat and intensity peaks</summary>${table(['Minute','Burning','Heat kW','Perimeter m','Intensity kW/m'],d.minutes.map(m=>[m.minute,m.burning,n(m.kw),n(m.perimeter),n(m.intensity)]))}</details>
      <details><summary>Building references · match report numbers to saved map IDs</summary>${table(['Building in this run','Saved map ID'],d.rows.map(r=>[r.i+1,r.saved.id]))}</details>
      ${run.bfp?.trucks?`<details><summary>Fire trucks · individual response records</summary>${table(['Truck','Dispatch min','First arrival min','Buildings put out','Status notes'],run.bfp.trucks.map(t=>[t.truckId,t.dispatch===undefined?'Not dispatched':n(t.dispatch),t.arrivals.length?n(t.arrivals[0].minute):'No arrival',t.extinguished,t.notes.join(' ')||'—']))}</details>`:''}
      <p>Evacuation counts and BFP outcomes are separate simulation outputs. The Y1–Y8 calculations above describe fire only. Model constants remain research assumptions pending field validation.</p>
      </main><script>let closed=[];addEventListener('beforeprint',()=>{closed=[...document.querySelectorAll('details:not([open])')];closed.forEach(d=>d.open=true)});addEventListener('afterprint',()=>{closed.forEach(d=>d.open=false)});</script></body></html>`;
  }
  const api={capture,derive,html};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.IgnisCalculationReport=api;
})(globalThis);
