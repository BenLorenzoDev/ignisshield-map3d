import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const E = createRequire(import.meta.url)('../public/evac.js');
// An access detour followed by a street with another bend. Times encode the actual travel cost.
const coords = [[123.71,10.5],[123.7101,10.5],[123.7101,10.5001],[123.7102,10.5001],[123.7102,10.5003]];
const g = {depart: 0, arrive: 6, status: 'safe', coords, times: [0,1,2,4,6], accessEnd: 2};
const legs = [g.coords.slice(0,g.accessEnd+1),g.coords.slice(g.accessEnd)];
const onSegment = (p,a,b) => Math.abs((p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]))<1e-14
  && p[0]>=Math.min(a[0],b[0])-1e-10 && p[0]<=Math.max(a[0],b[0])+1e-10 && p[1]>=Math.min(a[1],b[1])-1e-10 && p[1]<=Math.max(a[1],b[1])+1e-10;
for(let t=0;t<6;t+=0.025) {
  const p=E.positionAt(g,t);
  assert.equal(p.state,'moving');
  assert.ok(legs.some(l=>l.some((b,i)=>i&&onSegment(p.at,l[i-1],b))), `runner remains on the displayed route at ${t}`);
}
assert.deepEqual(E.positionAt(g,1).at,coords[1]);
assert.deepEqual(E.positionAt(g,2).at,coords[2]);
assert.ok(Math.abs(E.positionAt(g,0.5).heading-Math.PI/2)<1e-10,'faces east on eastbound leg');
assert.ok(Math.abs(E.positionAt(g,1.5).heading)<1e-10,'faces north after turning');
assert.ok(Math.sin(E.positionAt(g,0.5).heading-Math.PI)<0,'eastbound runner faces left when the camera faces south');
const trapped={...g,status:'trapped',coords:coords.slice(0,3),times:[0,1,2]};
assert.equal(E.positionAt(trapped,1.5).state,'moving');
assert.equal(E.positionAt(trapped,2).state,'trapped');
assert.equal(E.positionAt(g,6).state,'arrived');
console.log('Runner playback checks passed: follows every route bend, correct turn direction, camera-relative facing, arrival and stopping.');
