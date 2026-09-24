import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const B=createRequire(import.meta.url)('../public/bfp.js');
const k=[111320*Math.cos(10.51*Math.PI/180),110540];
const at=(x,y)=>[123.712+x/k[0],10.508+y/k[1]];
const roads=Array.from({length:30},(_,i)=>({type:'Feature',geometry:{type:'MultiLineString',coordinates:[[at(i*20,0),at((i+1)*20,0)]]},
  properties:{id:`r${i}`,kind:'road',from_node:`n${i}`,to_node:`n${i+1}`,alley_wd:6,walk_ok:1,access_ok:1,oneway:0}}));
const features=Array.from({length:20},(_,i)=>{const x=160+i*20;return {type:'Feature',properties:{id:`b${i}`},geometry:{type:'Polygon',coordinates:[[at(x-3,32),at(x+3,32),at(x+3,38),at(x-3,38),at(x-3,32)]]}};});
const data={features,densities:features.map(()=>0),roads,station:at(0,0)};
const fleet=B.prepare({...data,params:{truckCount:10,callMin:0,turnoutMin:0,perMin:1}}).create();
const states=new Map(features.map((_,i)=>[i,i===19?'safe':'burning']));
fleet.hook(0,states);
assert.equal(fleet.timeline.trucks.length,10,'ten independent controllers, not one multiplied capacity');
assert.deepEqual(fleet.timeline.trucks.map(t=>t.truckId),[1,2,3,4,5,6,7,8,9,10]);
assert.ok(fleet.timeline.trucks.every(t=>t.drives.length),'each truck gets a route');
assert.equal(new Set(fleet.timeline.trucks.map(t=>JSON.stringify(t.arrivals[0].at))).size,10,'separate parking destinations');
assert.equal(fleet.timeline.trucks[9].dispatch,0.9,'six-second departure spacing');
assert.equal(B.trucksAt(fleet.timeline,0.05).filter(t=>t.state==='driving').length,1,'departure queue animates individual trucks');
assert.equal(B.trucksAt(fleet.timeline,0.75).length,10);
let total=0, simultaneous=0;
for(let minute=1;minute<12;minute++) {
  const original=[...states];
  const action=fleet.hook(minute,states);
  assert.deepEqual([...states],original,'BFP hook does not mutate the fire model states');
  const out=action?.extinguish??[];
  assert.equal(new Set(out).size,out.length,'no duplicate extinguishing across trucks');
  assert.ok(out.length<=10,'each truck retains capacity one');
  for(const id of out){assert.equal(states.get(id),'burning');states.set(id,'extinguished');}
  for(const factor of action?.protect?.values()??[])assert.equal(factor,0.25,'overlapping hoses do not compound protection');
  simultaneous=Math.max(simultaneous,out.length);total+=out.length;
}
assert.ok(simultaneous>1,'multiple trucks act in the same minute');
assert.equal(total,fleet.timeline.extinguished);
assert.equal(total,fleet.timeline.trucks.reduce((sum,t)=>sum+t.extinguished,0));
assert.equal(new Set(fleet.timeline.sprays.map(s=>s.target)).size,total,'each target counted once across the run');
for(const truck of fleet.timeline.trucks) {
  for(const spray of truck.sprays)assert.equal(spray.truckId,truck.truckId,'water belongs to the spraying truck');
  for(const drive of truck.drives)for(let t=drive.times[0];t<drive.times.at(-1);t+=0.03) {
    const p=B.truckAt(truck,t);assert.ok(Math.abs(p.at[1]-at(0,0)[1])<1e-10,'moving trucks stay on the road');
  }
}
// Bearing is clockwise from north for a north-facing, map-aligned top-down icon.
const turning={station:at(0,0),dispatch:0,drives:[{coords:[at(0,0),at(0,20),at(20,20),at(20,0),at(0,0)],times:[0,1,2,3,4]}],sprays:[]};
for(const [minute,angle] of [[0.5,0],[1.5,90],[2.5,180],[3.5,270],[5,270]])assert.ok(Math.abs(B.truckAt(turning,minute).bearing-angle)<1e-6,`correct road heading at ${minute}`);
assert.equal(B.truckAt(turning,4).state,'standby','arrival is not still driving');
const stationary={station:at(0,0),dispatch:0,drives:[{coords:[at(0,0)],times:[0]}],sprays:[{minute:0,target:0}]};
assert.deepEqual(B.truckAt(stationary,0).at,at(0,0),'zero-length route at station is safe');
stationary.drives[0].bearing=90;
assert.equal(B.truckAt(stationary,0).bearing,90,'already-at-scene truck uses the adjacent road heading');
const later={...turning,drives:[...turning.drives,{coords:[at(0,0),at(0,-20)],times:[10,11]}]};
assert.equal(B.truckAt(later,8).bearing,270,'parked truck keeps its previous heading until the next journey');
assert.equal(B.truckAt(later,10.5).bearing,180);
const blocked=B.prepare({...data,params:{truckCount:10,standoffM:10000}}).create();blocked.hook(4,new Map(features.map((_,i)=>[i,'burning'])));
assert.equal(B.trucksAt(blocked.timeline,5).length,10,'an unavailable route does not remove vehicles');
assert.ok(B.trucksAt(blocked.timeline,5).every(t=>t.state==='blocked'),'blocked trucks wait for access instead of driving through fire');
assert.equal(blocked.timeline.extinguished,0);
assert.throws(()=>B.prepare({...data,roads:[]}),/No usable connected roads/);
for(const truckCount of [0,11,1.5,NaN])assert.throws(()=>B.prepare({...data,params:{truckCount}}),/whole number/);
console.log('Fleet checks passed: ten separate trucks, queued departures, distinct road positions, individual suppression, no double-counting, non-stacking protection, route headings, arrival and blocked access.');
