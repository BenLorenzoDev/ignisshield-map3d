import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const P=require('../public/performance.js');
const W=require('../public/route-window.js');
const quality=P.create();
assert.equal(quality.profile.terrain,false,'automatic mode starts without expensive terrain');
for(let t=0;t<=3000;t+=33)assert.equal(quality.observe(t,true),false,'30 fps does not trigger fallback');
let switches=0;
for(let t=3033;t<8000;t+=100)if(quality.observe(t,true))switches++;
assert.equal(switches,1,'sustained 10 fps triggers a single stable fallback');
assert.equal(quality.level,2);
assert.equal(quality.profile.smoke,0);
quality.setMode('auto');
quality.observe(0,true);quality.observe(10000,false);quality.observe(20000,true,false);
for(let t=30000;t<34000;t+=33)assert.equal(quality.observe(t,true),false,'idle/hidden time is not counted as rendering lag');
quality.setMode('detailed');
for(let t=0;t<=5000;t+=100)assert.equal(quality.observe(t,true),false,'manual detailed choice is respected');
assert.equal(quality.profile.terrain,true);
quality.setMode('low');assert.equal(quality.level,2);
quality.setMode('invalid');assert.equal(quality.mode,'auto');

const routes=new Map([
  [1,{times:[0,0.2,1,1,2.5,4],segments:[-1,0,66,-1,132,198]}],
  [2,{times:[2,3,5],segments:[-1,264,330]}]
]);
for(let minute=0;minute<=6;minute+=0.05) {
  for(const ids of [[],[1],[2],[1,2]]) {
    const expected=[];
    for(const id of ids) {
      const {times,segments}=routes.get(id);
      for(let i=1;i<times.length;i++)if(segments[i]>=0&&times[i]>Math.floor(minute)&&times[i-1]<Math.floor(minute)+1)expected.push(segments[i]);
    }
    assert.deepEqual(W.select(routes,ids,minute),expected,'retains every possibly active original leg and excludes unrelated journeys');
  }
}
assert.deepEqual(W.select(routes,[1],0.5),[0,66],'rewind restores earlier legs');
assert.deepEqual(W.select(routes,[99],2),[]);
const long=new Map([[1,{times:Array.from({length:1001},(_,i)=>i/10),segments:Array.from({length:1001},(_,i)=>i?66*(i-1):-1)}]]);
const selected=W.select(long,[1],50.5);
assert.equal(selected.length,10);
console.log(`Performance checks passed: stable automatic fallback, idle/manual handling, exact route windows; ${selected.length} of 1000 legs submitted for a long journey.`);
