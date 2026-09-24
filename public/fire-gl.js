/* global maplibregl */
// Real-looking flames and smoke, drawn on the GPU as a MapLibre custom layer.
// Each flame is a camera-facing sprite whose fragment shader draws a flickering teardrop of fire from moving noise
// (white-yellow core, orange body, red tips). Smoke puffs rise, grow and drift downwind. Flame size follows the fire
// life cycle (catching, full blaze, dying embers) at the playback minute, so nothing needs re-uploading per frame.
const fireGL = (() => {
  const FLAME_VS = `
    precision highp float;
    uniform mat4 u_matrix;
    uniform float u_minute;
    uniform vec2 u_viewport;
    attribute vec3 a_pos;      // roof centre, mercator units relative to u_matrix origin
    attribute vec2 a_corner;   // x -1..1 across, y 0..1 up
    attribute vec4 a_data;     // height, hv width (mercator units), seed, ignition minute
    attribute float a_dur;     // burn duration (minutes)
    attribute vec2 a_wind;     // flame-tip lean, mercator units
    varying vec2 v_uv;
    varying float v_seed;
    varying float v_int;
    float lifecycle(float p) { return p < 0.25 ? 0.35 + 2.6 * p : (p < 0.7 ? 1.0 : max(0.2, 1.0 - 2.5 * (p - 0.7))); }
    void main() {
      float life = lifecycle((u_minute - a_data.w) / a_dur);
      vec4 base = u_matrix * vec4(a_pos, 1.0);
      vec4 top = u_matrix * vec4(a_pos + vec3(0.0, 0.0, a_data.x * (0.5 + 0.5 * life)), 1.0);
      vec4 bent = u_matrix * vec4(a_pos + vec3(a_wind * (0.5 + 0.5 * life), a_data.x * (0.5 + 0.5 * life)), 1.0);
      vec4 side = u_matrix * vec4(a_pos + vec3(a_data.y, 0.0, 0.0), 1.0);
      vec2 hv = u_viewport * 0.5;
      vec2 b = base.xy / base.w;
      vec2 up = (top.xy / top.w - b) * hv;
      float wpx = length((side.xy / side.w - b) * hv) * (0.7 + 0.3 * life);
      float hpx = length(up);
      vec2 dir = hpx > 0.001 ? up / hpx : vec2(0.0, 1.0);
      float minH = wpx * 2.4;                     // seen from above, keep a flame shape on screen
      if (hpx < minH) { dir = normalize(mix(vec2(0.0, 1.0), dir, hpx / minH)); hpx = minH; }
      vec2 off = dir * (a_corner.y * hpx * 1.15 - 0.12 * wpx) + vec2(-dir.y, dir.x) * (a_corner.x * wpx * 1.25);
      // Project the world-space wind separately: direction stays correct when the map rotates or tilts.
      off += (bent.xy / bent.w - top.xy / top.w) * hv * a_corner.y * a_corner.y;
      gl_Position = vec4((b + off / hv) * base.w, base.z - 0.0004 * base.w, base.w);
      v_uv = a_corner;
      v_seed = a_data.z;
      v_int = life;
    }`;
  const FLAME_FS = `
    precision highp float;
    uniform float u_time;
    varying vec2 v_uv;
    varying float v_seed;
    varying float v_int;
    uniform sampler2D u_noise;
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
      return texture2D(u_noise, (i + u + 0.5) / 128.0).r;
    }
    float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
    void main() {
      float y = v_uv.y;
      float t = u_time * 1.8 + v_seed * 17.0;
      float n = fbm(vec2(v_uv.x * 1.6 + v_seed * 9.0, y * 2.6 - t * 1.6));      // large turbulence rising up
      float n2 = fbm(vec2(v_uv.x * 4.0 - v_seed * 5.0, y * 5.0 - t * 2.4));     // fine licks
      float x = v_uv.x + (n - 0.5) * 1.1 * y + (n2 - 0.5) * 0.25 * y;         // tongues sway more near the top
      float width = mix(1.0, 0.1, pow(y, 0.7));                                // wide base, narrow top
      float shape = 1.0 - smoothstep(width * 0.35, width, abs(x));
      float tongues = smoothstep(0.2, 0.55, n2 + (1.0 - y) * 0.75);             // upper flame breaks into tongues
      float tip = 1.0 - smoothstep(0.5, 1.0, y + (n - 0.5) * 0.6);
      float heat = clamp(shape * tongues * tip * smoothstep(0.0, 0.08, y) * (0.4 + 0.8 * n + 0.3 * n2), 0.0, 1.0);
      vec3 col = mix(vec3(0.45, 0.03, 0.0), vec3(0.95, 0.25, 0.0), smoothstep(0.05, 0.35, heat));
      col = mix(col, vec3(1.0, 0.55, 0.06), smoothstep(0.35, 0.65, heat));
      col = mix(col, vec3(1.0, 0.82, 0.35), smoothstep(0.7, 0.92, heat));      // yellow only in the hottest part
      col = mix(col, vec3(1.0, 0.96, 0.85), smoothstep(0.95, 1.0, heat));     // white-hot just at the core
      float a = smoothstep(0.03, 0.25, heat) * (0.6 + 0.4 * v_int);
      gl_FragColor = vec4(col * a, a);                                         // premultiplied alpha
    }`;
  const SMOKE_VS = `
    precision highp float;
    uniform mat4 u_matrix;
    uniform float u_minute;
    uniform float u_time;
    uniform vec2 u_viewport;
    attribute vec3 a_pos;      // roof centre
    attribute vec2 a_corner;   // -1..1 square
    attribute vec4 a_data;     // rise height, puff radius (mercator units), seed, burned-out minute
    attribute vec2 a_wind;     // downwind drift over one puff's life (mercator units)
    attribute vec2 a_fire;     // ignition minute, relative heat output
    varying vec2 v_uv;
    varying float v_alpha;
    varying float v_seed;
    void main() {
      float age = (u_minute - a_fire.x) * 60.0 - a_data.z / 0.09;
      float ph = fract(max(0.0, age) * 0.09); // follows simulated time, including pause and scrubbing
      float fade = clamp(1.0 - (u_minute - a_data.w) / 8.0, 0.0, 1.0);        // dies away after burnout
      vec3 c = a_pos + vec3(a_wind * ph, a_data.x * (0.15 + ph));
      vec4 centre = u_matrix * vec4(c, 1.0);
      vec4 side = u_matrix * vec4(c + vec3(a_data.y * (0.6 + 1.6 * ph), 0.0, 0.0), 1.0);
      vec2 hv = u_viewport * 0.5;
      vec2 b = centre.xy / centre.w;
      float r = length((side.xy / side.w - b) * hv);
      gl_Position = vec4((b + a_corner * r / hv) * centre.w, centre.z - 0.0002 * centre.w, centre.w);
      v_uv = a_corner;
      v_alpha = sin(ph * 3.14159) * 0.42 * fade * step(0.0, age) * a_fire.y;
      v_seed = a_data.z;
    }`;
  const SMOKE_FS = `
    precision highp float;
    uniform float u_time;
    varying vec2 v_uv;
    varying float v_alpha;
    varying float v_seed;
    uniform sampler2D u_noise;
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
      return texture2D(u_noise, (i + u + 0.5) / 128.0).r;
    }
    void main() {
      float d = length(v_uv);
      if (v_alpha <= 0.001 || d > 1.25) discard;
      float n = noise(v_uv * 2.5 + v_seed * 13.0 + u_time * 0.15) * 0.6 + noise(v_uv * 5.0 - u_time * 0.1) * 0.4;
      float a = (1.0 - smoothstep(0.35, 1.0, d + (n - 0.5) * 0.45)) * v_alpha;
      vec3 col = mix(vec3(0.22), vec3(0.45), n);
      gl_FragColor = vec4(col * a, a);
    }`;

  let map = null, gl = null, flame = null, smoke = null;
  let noiseTexture = null, lastRepaint = -Infinity, clockDirty = false;
  const matrix = new Float32Array(16);
  let ref = [0, 0, 0];                // mercator origin for this run (keeps float32 precise)
  let minute = 0, time = 0;

  function program(vs, fs, attrs) {
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    for (const [name, size] of attrs) loc[name] = [gl.getAttribLocation(p, name), size];
    const uni = n => gl.getUniformLocation(p, n);
    return {p, loc, u: {matrix: uni('u_matrix'), minute: uni('u_minute'), time: uni('u_time'), viewport: uni('u_viewport'), noise: uni('u_noise')},
      buffer: gl.createBuffer(), count: 0, stride: attrs.reduce((s, [, n]) => s + n, 0)};
  }

  // Two triangles per sprite; every vertex carries its sprite's data plus its own corner
  function upload(prog, sprites, corners, pack) {
    const per = prog.stride, data = new Float32Array(sprites.length * 6 * per);
    let o = 0;
    for (const s of sprites) for (const c of corners) { o = pack(data, o, s, c); }
    prog.count = sprites.length * 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, prog.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  function draw(prog, matrix) {
    if (!prog.count) return;
    gl.useProgram(prog.p);
    gl.uniformMatrix4fv(prog.u.matrix, false, matrix);
    gl.uniform1f(prog.u.minute, minute);
    gl.uniform1f(prog.u.time, time);
    gl.uniform1i(prog.u.noise, 0);
    gl.uniform2f(prog.u.viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindBuffer(gl.ARRAY_BUFFER, prog.buffer);
    let offset = 0;
    const enabled = [];
    for (const [loc, size] of Object.values(prog.loc)) {
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, prog.stride * 4, offset * 4); enabled.push(loc); }
      offset += size;
    }
    gl.drawArrays(gl.TRIANGLES, 0, prog.count);
    for (const loc of enabled) gl.disableVertexAttribArray(loc);
  }

  const FLAME_CORNERS = [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]];
  const SMOKE_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];

  const layer = {
    id: 'fire-gl', type: 'custom', renderingMode: '3d',
    onAdd(m, context) {
      map = m; gl = context;
      // Bake deterministic visual noise once; no simulation RNG is consumed.
      const pixels = new Uint8Array(128 * 128 * 4);
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        const v = Math.floor((n - Math.floor(n)) * 255), i = (y * 128 + x) * 4;
        pixels.set([v, v, v, 255], i);
      }
      const boundTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
      noiseTexture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.bindTexture(gl.TEXTURE_2D, boundTexture);
      flame = program(FLAME_VS, FLAME_FS, [['a_pos', 3], ['a_corner', 2], ['a_data', 4], ['a_dur', 1], ['a_wind', 2]]);
      smoke = program(SMOKE_VS, SMOKE_FS, [['a_pos', 3], ['a_corner', 2], ['a_data', 4], ['a_wind', 2], ['a_fire', 2]]);
    },
    render(context, options) {
      if (!flame.count && !smoke.count) { clockDirty = false; return; }
      if (gl.bindVertexArray) gl.bindVertexArray(null); // do not disturb the vertex array MapLibre left bound
      // mainMatrix maps mercator units to clip space; move its origin to `ref` in double precision
      const M = options.defaultProjectionData.mainMatrix, T = matrix;
      for (let i = 0; i < 12; i++) T[i] = M[i];
      for (let r = 0; r < 4; r++) T[12 + r] = M[r] * ref[0] + M[4 + r] * ref[1] + M[8 + r] * ref[2] + M[12 + r];
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
      gl.activeTexture(gl.TEXTURE0);
      const boundTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
      draw(smoke, T); draw(flame, T);
      gl.bindTexture(gl.TEXTURE_2D, boundTexture); gl.activeTexture(activeTexture);
      clockDirty = false;
    }
  };

  /**
   * flames: [{lngLat, alt (m), height (m), halfWidth (m), seed, ig, dur}]
   * smoke:  [{lngLat, alt, rise (m), radius (m), seed, out, windDx, windDy (m, east/north)}]
   */
  function setData(flames, puffs) {
    if (!gl) return;
    const first = flames[0] ?? puffs[0];
    if (first) { const c = maplibregl.MercatorCoordinate.fromLngLat(first.lngLat, 0); ref = [c.x, c.y, 0]; }
    const merc = s => {
      const c = maplibregl.MercatorCoordinate.fromLngLat(s.lngLat, s.alt);
      return [c.x - ref[0], c.y - ref[1], c.z, c.meterInMercatorCoordinateUnits()];
    };
    upload(flame, flames.map(s => [merc(s), s]), FLAME_CORNERS, (d, o, [[x, y, z, k], s], [cx, cy]) => {
      d.set([x, y, z, cx, cy, s.height * k, s.halfWidth * k, s.seed, s.ig, s.dur, s.windDx * k, -s.windDy * k], o);
      return o + 12;
    });
    // mercator y grows southward, so north drift is negative y
    upload(smoke, puffs.map(s => [merc(s), s]), SMOKE_CORNERS, (d, o, [[x, y, z, k], s], [cx, cy]) => {
      d.set([x, y, z, cx, cy, s.rise * k, s.radius * k, s.seed, s.out, s.windDx * k, -s.windDy * k, s.ig, s.heat], o);
      return o + 13;
    });
    map.triggerRepaint();
  }

  function setClock(playbackMinute, seconds) {
    if (minute !== playbackMinute || time !== seconds) clockDirty = true;
    minute = playbackMinute; time = seconds;
    const now = performance.now();
    // Aim for a steady 30 fps without asking the whole terrain map to redraw at 120 Hz.
    if (clockDirty && now - lastRepaint >= 32) { lastRepaint = now; map?.triggerRepaint(); }
  }

  /** Display proxies, not fluid dynamics. Inputs are the actual run's model values (wind in km/h, FROM). */
  function profile(values, size) {
    const toward = (values.wind_dir + 180) * Math.PI / 180, ms = values.wind_spd / 3.6;
    const east = Math.sin(toward), north = Math.cos(toward);
    // Same relative areal heat output as FireModel.record; warmer air affects ignition, not flame temperature.
    const heat = [0, 0.35, 0.85, 1.4][values.bldg_mat] * (1 - 0.6 * values.humidity / 100) * values.oxygen_v;
    const strength = Math.max(0.35, Math.min(1.8, Math.sqrt(heat / (0.85 * 0.58))));
    const height = (5 + size * 1.1) * strength;
    const lean = height * 1.4 * ms / (ms + 5);
    return {height, halfWidth: Math.max(2, size * 0.6) * Math.sqrt(strength),
      windDx: lean * east, windDy: lean * north,
      smokeDx: ms / 0.09 * east, smokeDy: ms / 0.09 * north,
      rise: (16 + size * 0.4) * strength, heat: Math.min(1.4, strength)};
  }

  return {layer, setData, setClock, profile};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = fireGL;
