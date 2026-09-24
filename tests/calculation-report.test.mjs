import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url), F=require('../public/fire.js'), P=require('../public/paper.js'), C=require('../public/calculation-report.js');
const all=JSON.parse(readFileSync(new URL('../public/data/ai-buildings.geojson',import.meta.url))).features.slice(0,35);
const locals=P.localDensity(all);
let checked=0;
for(const mode of ['baseline','mixed','bfp','no-spread']) {
  const features=structuredClone(all);
  const paper=features.map((f,i)=>({...P.DEFAULTS,Db:mode==='no-spread'?0:null,
    Mb:mode==='baseline'?600:mode==='no-spread'?0:[600,900,1400][i%3],Hr:mode==='no-spread'?100:mode==='baseline'?85:30,Uw:mode==='no-spread'?0:8}));
  const inputs=paper.map((p,i)=>P.toModel(p,locals[i]));
  const meta={utc:'2026-09-24T08:00:00Z',originIndex:0,maxMinutes:mode==='no-spread'?1:20,trial:null,extent:'Test geometry',weatherSource:'Entered <script>alert(1)</script>'};
  const calculation=C.capture(features,paper,locals,meta);
  const bfp=mode==='bfp'?()=>minute=>({extinguish:minute===1?[0]:[],protect:new Map()}):null;
  const result=F.simulate(features,f=>inputs[features.indexOf(f)],0,42,meta.maxMinutes,bfp,true);
  const run={id:'test-<img src=x onerror=alert(1)>',features,inputs,result,calculation,seed:42,bfp:mode==='bfp'?{}:null};
  const before=JSON.stringify(run), d=C.derive(run);
  const stored=P.outputs(result.metrics).map(x=>x.value);
  d.values.forEach((value,i)=> {
    const decimals=i===5?2:4;
    assert.equal(value===''?'':Math.round(value*10**decimals)/10**decimals,stored[i],`${mode} Y${i+1} reproduces the existing stored output`);
    checked++;
  });
  const html=C.html(run);
  assert.equal(JSON.stringify(run),before,'report creation does not mutate inputs, frames or results');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),'source text is escaped');
  assert.ok(!html.includes('<img src=x'),'run metadata cannot inject markup');
  assert.ok(html.includes('Y8 · Total simulation time')&&html.includes('Y1 · Fire severity index'));
  assert.ok(html.includes('beforeprint')&&html.includes('afterprint'),'all supporting tables can be included in print');
  assert.ok(!/<(?:link|script)[^>]+(?:src|href)=/.test(html),'downloaded report has no external asset dependency');
  if(mode==='baseline')assert.ok(Math.abs(d.origin.heat-13.72)<1e-10,'student heat example matches the actual model');
  if(mode==='no-spread') {
    assert.equal(d.values[2],0);assert.equal(d.values[5],'');
    assert.ok(d.values[6]>d.end,'assigned burn duration is distinguished from a truncated simulation');
  }
  paper[0].Mb=5000;locals[0].Db+=1;features[0].properties.Mb=5000;
  assert.notEqual(calculation.buildings[0].paper.Mb,5000,'saved paper values survive later edits');
  assert.notEqual(calculation.buildings[0].local.Db,locals[0].Db,'saved density survives map edits');
  locals[0].Db-=1;
}
const snapshot=C.capture([{properties:{id:'example',Mb:600}}],[{...P.DEFAULTS,Db:0.00106,Mb:600}],[{Db:0.02,meanArea:121.56}],{trial:null});
assert.match(snapshot.buildings[0].sources.Mb,/verification not recorded/);
assert.match(snapshot.buildings[0].sources.O2,/Default assumption/);
const customWeather=C.capture([{properties:{id:'weather-test'}}],[{...P.DEFAULTS,Mb:600,Hr:71}],locals.slice(0,1),
  {trial:'A',weatherOverride:true,weatherSource:'Open-Meteo test forecast'});
assert.equal(customWeather.buildings[0].sources.Mb,'Trial A assumption');
assert.equal(customWeather.buildings[0].sources.Hr,'Open-Meteo test forecast','custom weather must not be reported as the original trial');
assert.throws(()=>C.derive({}),/older run/);
console.log(`Calculation report: ${checked} output comparisons passed, including mixed inputs, BFP, no spread, student heat example, snapshot isolation and escaped standalone HTML.`);
