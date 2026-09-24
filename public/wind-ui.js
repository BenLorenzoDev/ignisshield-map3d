// Flowing breeze trails for the weather saved with the visible run. Display only: never feeds the model.
const windFX = (() => {
  let map, canvas, ctx, wind, started = null;
  let sprite = null, lastCamera = '', lastSeconds = NaN, lastDraw = -Infinity, direction = null;
  let quality = {wind:12,windRatio:1};
  const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  function clear() {
    canvas?.remove();
    canvas = ctx = map = wind = null;
    started = null;
    sprite = null; lastCamera = ''; lastSeconds = NaN; lastDraw = -Infinity; direction = null;
  }

  function set(m, weather) {
    clear();
    if (!(weather.Uw > 0)) return;
    map = m;
    wind = {...weather}; // a replay keeps its own weather, even if the form changes
    canvas = document.createElement('canvas');
    canvas.className = 'wind-streaks';
    canvas.setAttribute('aria-hidden', 'true');
    map.getCanvasContainer().appendChild(canvas);
    ctx = canvas.getContext('2d');
    sprite = breezeSprite(70 + Math.min(55, wind.Uw * 5));
  }

  // Paint the gradients and curves once per run, then composite this small image for each trail.
  function breezeSprite(trail) {
    const image = document.createElement('canvas'), ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = trail + 28, height = 40;
    image.width = Math.ceil(width * ratio); image.height = height * ratio;
    const g = image.getContext('2d');
    g.scale(ratio, ratio); g.translate(trail + 4, 20); g.lineCap = 'round';
    for (let strand = 0; strand < 3; strand++) {
      const tail = trail * (strand === 1 ? 1 : 0.7), head = strand === 1 ? 0 : -12 - strand * 3;
      const offset = (strand - 1) * 6;
      g.globalAlpha = strand === 1 ? 0.95 : 0.6;
      g.beginPath(); g.moveTo(head - tail, offset);
      g.bezierCurveTo(head - tail * 0.65, offset - 8, head - tail * 0.3, offset + 8, head, offset);
      const shadow = g.createLinearGradient(head - tail, 0, head, 0);
      shadow.addColorStop(0, 'rgba(19, 56, 72, 0)'); shadow.addColorStop(1, 'rgba(19, 56, 72, 0.75)');
      g.strokeStyle = shadow; g.lineWidth = 4; g.stroke();
      const light = g.createLinearGradient(head - tail, 0, head, 0);
      light.addColorStop(0, 'rgba(216, 247, 255, 0)'); light.addColorStop(0.6, 'rgba(216, 247, 255, 0.8)'); light.addColorStop(1, '#f1fcff');
      g.strokeStyle = light; g.lineWidth = strand === 1 ? 2.2 : 1.5; g.stroke();
    }
    return {image, width, height, origin: trail + 4};
  }

  function tick(seconds) {
    if (!ctx) return;
    started ??= seconds;
    const {clientWidth: width, clientHeight: height} = map.getContainer();
    const ratio = Math.min(window.devicePixelRatio || 1, quality.windRatio);
    const centre = map.getCenter();
    const camera = [centre.lng, centre.lat, map.getZoom(), map.getBearing(), map.getPitch(), width, height, ratio, reducedMotion?.matches].join(',');
    if (seconds === lastSeconds && camera === lastCamera) return;
    const now = performance.now();
    if (now - lastDraw < 32) return; // breeze motion at 30 fps; camera and fire rendering keep their own cadence
    lastDraw = now; lastSeconds = seconds;
    const cameraChanged = camera !== lastCamera;
    lastCamera = camera;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!width || !height || reducedMotion?.matches) return;

    // Project a short east/north vector onto the current camera, including bearing and pitch.
    if (cameraChanged || !direction) {
      const toward = (wind.Tw + 180) * Math.PI / 180;
      const a = map.project(centre);
      const b = map.project([centre.lng + Math.sin(toward) * 10 / (111320 * Math.cos(centre.lat * Math.PI / 180)),
        centre.lat + Math.cos(toward) * 10 / 110540]);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 0.001) return;
      direction = {dx: (b.x - a.x) / length, dy: (b.y - a.y) / length};
    }
    const {dx, dy} = direction;
    // Readable screen speed, not a measurement of individual air parcels.
    const speed = 24 + Math.sqrt(wind.Uw) * 18;
    const travelDistance = 380;
    const cycle = travelDistance / speed;
    // More visible coverage, with a fixed cap and the same cached sprite to keep drawing light.
    const count = Math.min(quality.wind, Math.max(8, Math.round(width * height / 65000)));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < count; i++) {
      const phase = ((seconds - started) / cycle + i * 0.618034) % 1;
      const travel = (phase - 0.5) * travelDistance;
      const x = ((i * 0.754878 + 0.12) % 1) * width + dx * travel;
      const y = ((i * 0.56984 + 0.08) % 1) * height + dy * travel;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.globalAlpha = Math.sin(phase * Math.PI);
      ctx.drawImage(sprite.image, -sprite.origin, -20, sprite.width, sprite.height);
      ctx.restore();
    }
  }

  return {set, tick, clear, setQuality:value=>{quality=value;lastCamera='';}};
})();
