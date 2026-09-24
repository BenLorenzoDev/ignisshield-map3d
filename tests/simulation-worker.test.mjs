import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),F=require('../public/fire.js'),B=require('../public/bfp.js'),E=require('../public/evac.js');
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const features=read('../public/data/ai-buildings.geojson').features.slice(0,40);
const roads=read('../public/data/source.geojson').features.filter(f=>f.properties.kind==='road');
const inputs=features.map(()=>({bldg_dens:0.5,bldg_mat:2,house_cnt:1,alley_wd:2,oxygen_v:1,humidity:65,temp_c:30,wind_dir:45,wind_spd:15}));
const data={features,inputs,densities:inputs.map(m=>m.bldg_dens),households:features.map(()=>1),roads,paths:[],tracks:[],water:[],safePoints:[],obstacles:[]};
const messages=[],scope=vm.createContext({performance,self:{postMessage:m=>messages.push(structuredClone(m))}});
scope.importScripts=(...names)=>names.forEach(name=>vm.runInContext(readFileSync(new URL('../public/'+name.split('?')[0],import.meta.url),'utf8'),scope));
vm.runInContext(readFileSync(new URL('../public/evac-preview-worker.js',import.meta.url),'utf8'),scope);
const request=(action,data)=>{messages.length=0;scope.self.onmessage({data:{id:1,action,data:structuredClone(data)}});const last=messages.at(-1);assert.ok(!last.error,last.error);assert.ok('value'in last);return last.value;};
const plain=v=>JSON.parse(JSON.stringify(v));
for(const preview of [false,true])for(const response of [false,true]){
  const bfp=response?{station:[123.71327,10.50537],params:{callMin:0,turnoutMin:0}}:null;
  request('prepare',{...data,preview,bfp});
  const actual=request('run',{index:0,seed:42,minutes:10,number:'1 of 1'});
  const truck=bfp?B.prepare({...data,station:bfp.station,params:bfp.params}).create():null;
  const expected=F.simulate(features,f=>inputs[features.indexOf(f)],0,42,10,truck?()=>truck.hook:null,true);
  delete actual.result.metrics.Total_Simulation_Time_Sec;delete expected.metrics.Total_Simulation_Time_Sec;
  assert.deepEqual(plain(actual.result),plain(expected),`same fire in worker: preview=${preview}, BFP=${response}`);
  assert.deepEqual(plain(actual.bfp),plain(truck?.timeline??null),'BFP behavior is unchanged');
  if(!preview)assert.deepEqual(plain(actual.evac),plain(E.prepare(data).evaluate(expected.frames)),'original evacuation unchanged in worker');
  else assert.deepEqual(plain(actual.evac.preview.baseline),plain(E.prepare(data).evaluate(expected.frames).summary),'comparison uses the identical fire frames');
}
console.log('Worker parity passed in both routing modes, with and without BFP: identical fire frames, explanations, model metrics, response and original evacuation.');
