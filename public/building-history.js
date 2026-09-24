// Read recorded outcomes only; inspecting a house must never run the fire model again.
const IgnisBuildingHistory = (() => {
  function decisionsFor(step, index) {
    if (step.decisionFormat !== 1 || !step.decisions) return null;
    const rows = step.decisions.length === undefined ? Object.values(step.decisions) : step.decisions;
    for (let k=0;k<rows.length;k+=8) if (rows[k] === index) {
      const [id,probability,draw,sourceId,gap,sourceCount,windFactor,protection] = Array.from(rows.slice(k,k+8));
      return {id,probability,draw,sourceId,gap,sourceCount,windFactor,protection,from:step.from,to:step.to,ignited:draw<probability};
    }
    return null;
  }
  function materialFor(run, index) {
    const saved = run.calculation?.buildings?.[index], input = run.inputs?.[index];
    const labels = ['', 'Concrete-class / lower fuel', 'Mixed-class / medium fuel', 'Lightweight-class / higher fuel'];
    return {label:labels[input?.bldg_mat] || 'Material class unavailable',
      fuelLoad:saved?.paper?.Mb ?? null,
      source:saved?.sources?.Mb || 'No material source saved for this run',
      assumed:Boolean(run.calculation?.trial) || saved?.sources?.Mb === 'Default assumption',
      verification:'Actual construction not verified'};
  }
  function read(run, buildingId) {
    const index = run.ids.indexOf(buildingId);
    if (index < 0) return null;
    const frames = run.result.frames, end = frames.at(-1).minute;
    const first = frames.find(f => f.states[index] > 0);
    const stopped = frames.find(f => f.states[index] >= 2);
    const origin = frames[0].states[index] === 1;
    let exposure = null, interval = null, putOutAt = null;
    const checks = [], steps = run.result.explanations || [];
    const complete = Array.isArray(run.result.explanations) && steps.length === frames.length - 1
      && steps.every(s=>s.decisionFormat===1 && s.decisions != null);
    for (const step of run.result.explanations || []) {
      const event = step.ignited?.find(e => e.id === index);
      if (event && !exposure) { exposure = {...event}; interval = {from:step.from,to:step.to}; }
      // BFP acts at the start of a model step; the resulting state is recorded at its end.
      if (putOutAt === null && step.extinguished?.includes(index)) putOutAt = step.from;
      const check = decisionsFor(step,index);
      if (check) checks.push(check);
    }
    const ignitedAt = origin ? frames[0].minute : interval?.to ?? first?.minute ?? null;
    const stoppedAt = putOutAt ?? stopped?.minute ?? null;
    const peak = checks.reduce((best,c)=>!best || c.probability>best.probability ? c : best,null);
    const nonIgnition = ignitedAt !== null ? null : !complete ? 'unavailable'
      : !checks.length ? 'not-assessed' : peak.probability === 0 ? 'zero-chance' : 'draw-not-triggered';
    return {index, origin, end, ignitedAt, stoppedAt, finalState:frames.at(-1).states[index], exposure, interval,
      burningMinutes:ignitedAt === null ? null : (stoppedAt ?? end) - ignitedAt,
      checks, peak, complete, nonIgnition, material:materialFor(run,index)};
  }
  return {read};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = IgnisBuildingHistory;
