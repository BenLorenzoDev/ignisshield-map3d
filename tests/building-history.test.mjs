import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const H = createRequire(import.meta.url)('../public/building-history.js');
const event = {id:0,sourceId:2,probability:0.25,sourceCount:2,gap:12,windFactor:1.3,protection:1,draw:0.1};
const run = {ids:['later','unburned','origin','put-out','burning'],result:{
  frames:[
    {minute:0,states:Uint8Array.from([0,0,1,0,0])},
    {minute:1,states:Uint8Array.from([0,0,1,1,0])},
    {minute:2,states:Uint8Array.from([1,0,1,3,1])},
    {minute:5,states:Uint8Array.from([2,0,2,3,1])}
  ],explanations:[{from:1,to:2,ignited:[event]}]
}};
const before=JSON.stringify(run);
const origin=H.read(run,'origin');
assert.equal(origin.index,2,'resolve the clicked stable ID rather than current map order');
assert.equal(origin.origin,true); assert.equal(origin.ignitedAt,0); assert.equal(origin.stoppedAt,5);
const later=H.read(run,'later');
assert.equal(later.ignitedAt,2); assert.equal(later.burningMinutes,3); assert.deepEqual(later.exposure,event);
assert.deepEqual(later.interval,{from:1,to:2});
const safe=H.read(run,'unburned');
assert.equal(safe.ignitedAt,null); assert.equal(safe.burningMinutes,null); assert.equal(safe.exposure,null);
assert.equal(H.read(run,'outside-boundary'),null,'outside this run is different from did not ignite');
const out=H.read(run,'put-out');
assert.equal(out.finalState,3); assert.equal(out.stoppedAt,2); assert.equal(out.burningMinutes,1);
const burning=H.read(run,'burning');
assert.equal(burning.finalState,1); assert.equal(burning.stoppedAt,null); assert.equal(burning.burningMinutes,3);
const legacy=structuredClone(run); delete legacy.result.explanations;
assert.equal(H.read(legacy,'later').ignitedAt,2,'older recordings still provide observed timing');
assert.equal(H.read(legacy,'later').exposure,null,'never fabricate a cause for an older run');
const suppressed=structuredClone(run);
suppressed.result.explanations.push({from:1,to:2,ignited:[],extinguished:[3]});
assert.equal(H.read(suppressed,'put-out').stoppedAt,1,'use the recorded BFP action time at step start when available');
later.exposure.sourceId=99;
assert.equal(JSON.stringify(run),before,'reading and displaying history cannot mutate the recorded run');
const audited = {ids:['missed','zero','outside'],inputs:[{bldg_mat:1},{bldg_mat:2},{bldg_mat:3}],
  calculation:{trial:'A',buildings:[{paper:{Mb:600},sources:{Mb:'Trial A assumption'}}]},
  result:{frames:[{minute:0,states:[0,0,0]},{minute:1,states:[0,0,0]},{minute:2,states:[0,0,0]}],explanations:[
    {from:0,to:1,ignited:[],decisionFormat:1,decisions:Float64Array.from([0,0.12,0.8,4,15,1,0.7,1,1,0,0.5,4,20,1,1,0])},
    {from:1,to:2,ignited:[],decisionFormat:1,decisions:Float64Array.from([0,0.3,0.6,5,8,2,1.2,1])}
  ]}};
const missed=H.read(audited,'missed');
assert.equal(missed.nonIgnition,'draw-not-triggered');assert.equal(missed.checks.length,2);
assert.equal(missed.peak.probability,0.3);assert.equal(missed.peak.draw,0.6);assert.equal(missed.peak.sourceId,5);
assert.equal(missed.material.fuelLoad,600);assert.equal(missed.material.source,'Trial A assumption');assert.equal(missed.material.assumed,true);
assert.match(missed.material.verification,/not verified/);
assert.equal(H.read(audited,'zero').nonIgnition,'zero-chance');
assert.equal(H.read(audited,'outside').nonIgnition,'not-assessed');
assert.equal(H.read(run,'unburned').nonIgnition,'unavailable','old top-three risks cannot establish why an unburned building was skipped');
assert.equal(H.read(JSON.parse(JSON.stringify(audited)),'missed').peak.draw,0.6,'JSON recordings retain compact decision data');
const incomplete=structuredClone(audited);delete incomplete.result.explanations[1].decisions;
assert.equal(H.read(incomplete,'outside').nonIgnition,'unavailable','missing decisions cannot be presented as no exposure');
audited.calculation.trial=null;audited.calculation.buildings[0].sources.Mb='Entered value; field verification not recorded';
assert.equal(H.read(audited,'missed').material.assumed,false);
assert.match(H.read(audited,'missed').material.verification,/not verified/,'entered values are not automatically field-verified');
console.log('Building history checks passed: stable IDs, origin, spread, burnout, BFP, horizon, unburned, excluded and older runs.');
