import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {advance} = createRequire(import.meta.url)('../public/playback.js');

assert.equal(advance(0, 3, 4, 12, false), 0, 'initial fire must be drawn before time advances');
assert.equal(advance(0, 3, 4, 12, true), 0.4, 'a three-second stall must not jump straight to the final result');
assert.equal(advance(0.9, 3, 4, 12, true), 1, 'new ignition minute must be shown before continuing');
assert.equal(advance(1, 3, 4, 12, false), 1, 'wait for the map to draw the new ignition');
assert.equal(advance(11.95, 3, 4, 12, true), 12, 'stop at the recorded end');
assert.equal(advance(5, 0, 4, 12, true), 5, 'returning to the tab must not add hidden time');
assert.equal(advance(5, -1, 4, 12, true), 5);

for (const speed of [1 / 60, 0.5, 1, 2, 4]) {
  let minute = 0;
  for (let i = 0; i < 60; i++) minute = advance(minute, 1 / 60, speed, 240, true);
  assert.ok(Math.abs(minute - speed) < 0.07, `normal playback follows selected speed ${speed}`);
}
// Irregular slow frames: every recorded state is presented, in order, without skipping.
let minute = 0;
const seen = [0];
for (let i = 0; minute < 12 && i < 1000; i++) {
  const before = minute;
  minute = advance(minute, [0.016, 0.5, 3][i % 3], 4, 12, i % 4 !== 0);
  if (Math.floor(minute) !== Math.floor(before)) seen.push(Math.floor(minute));
}
assert.deepEqual(seen, Array.from({length: 13}, (_, i) => i));
console.log('Playback checks passed: render wait, stall recovery, every recorded step, speed and end time.');
