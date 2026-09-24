import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const D = require('../public/evac-display.js'), E = require('../public/evac.js');
const groups = [
  {i:0,people:5,status:'safe',to:'the main road',depart:0,arrive:2,coords:[[0,0],[1,0],[1,1]],times:[0,1,2]},
  {i:1,people:10,status:'safe',to:'the main road',depart:0,arrive:2,coords:[[2,0],[1,0],[1,1]],times:[0,1,2]},
  {i:2,people:20,status:'safe',to:'Covered court',coords:[[0,0],[2,2]]},
  {i:3,people:30,status:'trapped',coords:[[0,0],[3,3]]},
  {i:4,people:40,status:'nopath',coords:[[4,4]]}
];
const before = JSON.stringify(groups);
assert.deepEqual(D.destinations(groups), [
  {at:[1,1],label:'Main road exit',people:15},
  {at:[2,2],label:'Covered court',people:20}
], 'destinations are actual successful route endpoints, never trapped/unknown positions');
assert.deepEqual(D.separate([{id:0,x:0,y:0},{id:1,x:27,y:0},{id:2,x:60,y:0}],28),[0,2]);
assert.deepEqual(D.separate([{id:0,x:-1,y:-1},{id:1,x:1,y:1}],28),[0], 'cell boundaries cannot allow overlapping figures');
// Groups converge in an alley then share a path: one icon, unchanged coordinates and people.
for (let t=0;t<2;t+=0.02) {
  const points=groups.slice(0,2).map(g=>{const p=E.positionAt(g,t);return {id:g.i,x:p.at[0]*100,y:p.at[1]*100};});
  const ids=D.separate(points,28), visible=points.filter(p=>ids.includes(p.id));
  if(t>=1)assert.equal(ids.length,1);
  for(const a of visible)for(const b of visible)if(a!==b)assert.ok(Math.abs(a.x-b.x)>=28||Math.abs(a.y-b.y)>=28);
}
assert.equal(JSON.stringify(groups),before,'display does not alter routes, times, counts or outcomes');
console.log('Evacuation display passed: real destinations, shared exits, alley convergence, spacing boundaries and immutable outcomes.');
