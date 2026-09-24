// Keep a student's graphics choice on this device, separate from shared scenario inputs.
const graphicsSelect = document.querySelector('#graphics-quality');
const graphicsStatus = document.querySelector('#graphics-status');
graphicsSelect.value = renderPerformance.mode;
let graphicsApplying = false;
function applyRenderQuality() {
  if (!map.getLayer('fire-gl')) return;
  graphicsApplying = true;
  const quality = renderPerformance.profile;
  const terrainChanged = Boolean(map.getTerrain()) !== quality.terrain;
  if (terrainChanged) map.setTerrain(quality.terrain ? {source:'dem',exaggeration:1.3} : null);
  map.setLayoutProperty('hillshade','visibility',quality.terrain?'visible':'none');
  map.setLayoutProperty('fire-glow','visibility',quality.simple?'none':'visible');
  syncRenderResolution();
  if (renderPerformance.level === 2 && view !== '2d') setView('2d', {duration:0});
  if (renderPerformance.level === 2) map.setMaxPitch(0);
  ui.view.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  fireGL.setQuality(quality.simple);
  windFX.setQuality(quality);
  if (run) {
    if (terrainChanged) { run.fx.shapes.clear(); evacActors?.setRun(evacShown?.groups ?? []); }
    evacRepresentatives = null;
    showFrame(frameIndex);
    evacTick(displayMinute);
    fireGL.setClock(displayMinute,clock);
    evacActors?.setClock(displayMinute,clock);
  }
  graphicsStatus.textContent = renderPerformance.mode==='auto' ? `Auto · ${quality.name}` : quality.name;
  graphicsStatus.title = quality.simple ? 'Lighter effects; all fire states, routes and people counts are retained.' : 'Full terrain and effects. Uses more graphics power.';
  renderPerformance.reset();
  graphicsApplying = false;
}
function syncRenderResolution() {
  const p=renderPerformance.profile;
  const ratio=Math.min(window.devicePixelRatio||1,playTimer?p.playbackRatio:p.ratio);
  if(map.getPixelRatio()!==ratio)map.setPixelRatio(ratio);
}
graphicsSelect.addEventListener('change',()=>{
  renderPerformance.setMode(graphicsSelect.value);
  try {localStorage.setItem('ignisshield-map3d.graphics',renderPerformance.mode);} catch { /* session only */ }
  applyRenderQuality();
});
map.on('render',()=>{
  if(graphicsApplying)return;
  if(renderPerformance.observe(performance.now(),Boolean(playTimer)||map.isMoving(),!document.hidden)) {
    // Change resolution/terrain outside MapLibre's current render pass.
    requestAnimationFrame(()=>{
      applyRenderQuality();
      showHint('Switched to Low power for smoother playback. Calculations and people counts are unchanged.',6500);
    });
  }
});
document.addEventListener('visibilitychange',()=>renderPerformance.reset());
