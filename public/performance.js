// Rendering budgets only: no model inputs, random numbers or results are changed.
const IgnisPerformance = (() => {
  const profiles = [
    {name:'Detailed', terrain:true, ratio:1.5, playbackRatio:0.75, smoke:260, puffs:2, flames:5, wind:28, windRatio:1.5, walkers:160, spacing:26, simple:false},
    {name:'Light', terrain:false, ratio:1, playbackRatio:0.75, smoke:40, puffs:1, flames:1, wind:12, windRatio:1, walkers:60, spacing:34, simple:true},
    {name:'Low power', terrain:false, ratio:0.8, playbackRatio:0.6, smoke:0, puffs:0, flames:1, wind:8, windRatio:0.75, walkers:30, spacing:44, simple:true}
  ].map(Object.freeze);
  function create(initial = 'auto') {
    let mode, level, last = null, elapsed = 0, samples = 0;
    function reset() { last = null; elapsed = samples = 0; }
    function setMode(value) {
      mode = ['auto','low','detailed'].includes(value) ? value : 'auto';
      level = mode === 'detailed' ? 0 : mode === 'low' ? 2 : 1;
      reset();
    }
    function observe(now, active, visible = true) {
      if (mode !== 'auto' || level === 2 || !active || !visible) { reset(); return false; }
      if (last !== null) { elapsed += Math.max(0, now-last); samples++; }
      last = now;
      if (elapsed < 2000 || samples < 8) return false;
      const slow = samples * 1000 / elapsed < 22;
      reset();
      if (slow) { level = 2; return true; }
      return false;
    }
    setMode(initial);
    return {setMode, observe, reset, get mode(){return mode;}, get level(){return level;}, get profile(){return profiles[level];}};
  }
  return {create};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = IgnisPerformance;
