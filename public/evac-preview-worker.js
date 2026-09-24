/* Run the unchanged models off the animation/UI thread, in both routing modes. */
importScripts('fire.js?v=20260924-activity1', 'routing.js', 'bfp.js', 'field.js', 'walk-space.js?v=20260924-survey2', 'survey-preview.js?v=20260924-survey2', 'evac.js?v=20260924-walkers1');
let original, preview, diagnostics, derived, features, values, bfp;
self.onmessage = event => {
  const {id, action, data} = event.data;
  try {
    if (action === 'prepare') {
      features = data.features;
      values = new Map(features.map((f, i) => [f, data.inputs[i]]));
      preview = null; diagnostics = null; derived = [];
      if (data.preview) {
        self.postMessage({id, progress: 'Checking surveyed alleys against mapped buildings…'});
        const built = IgnisSurveyPreview.prepare(data);
        self.postMessage({id, progress: 'Finding clear connections from houses to the alley network…'});
        preview = IgnisEvac.prepare({...data, paths: built.paths, walkingSpace: built.walkingSpace});
        diagnostics = {...built.stats, excludedObstacles: preview.excludedObstacles};
        derived = built.derived;
      }
      original = null;
      try { original = IgnisEvac.prepare(data); }
      catch (err) {
        if (preview) throw err; // The preview needs its baseline comparison.
        self.postMessage({id, warning: `Evacuation could not be set up: ${err.message}`});
      }
      bfp = null;
      if (data.bfp) {
        try { bfp = IgnisBFP.prepare({...data, station: data.bfp.station, params: data.bfp.params}); }
        catch (err) { self.postMessage({id, warning: `The BFP response could not be set up: ${err.message}`}); }
      }
      self.postMessage({id, value: {diagnostics}});
    } else if (action === 'run') {
      self.postMessage({id, progress: `Calculating fire · run ${data.number}`});
      const truck = bfp?.create();
      const result = IgnisFire.simulate(features, f => values.get(f), data.index, data.seed, data.minutes, truck ? () => truck.hook : null, true);
      const noBfp = truck ? IgnisFire.simulate(features, f => values.get(f), data.index, data.seed, data.minutes) : null;
      self.postMessage({id, progress: `Calculating evacuation · run ${data.number}`});
      const evac = (preview || original)?.evaluate(result.frames) ?? null;
      if (preview) evac.preview = {diagnostics, derived, baseline: original.evaluate(result.frames).summary};
      self.postMessage({id, value: {result, evac, bfp: truck?.timeline ?? null,
        noBfpIgnited: noBfp ? noBfp.frames.at(-1).states.filter(s => s > 0).length : null}});
    }
  } catch (err) { self.postMessage({id, error: err.message}); }
};
