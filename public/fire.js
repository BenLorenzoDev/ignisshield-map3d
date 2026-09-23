/* IgnisShield fire model, ported line for line from IgnisShield-Web/backend/model.py (MODEL_VERSION 0.4.0)
 * and the fire part of engine.py. Uncalibrated teaching model: a weighted cellular automaton, not a forecast.
 * Random numbers reproduce CPython's random.Random(seed).random(), so a seed gives the same run as the
 * Python model (checked by tests/parity.mjs). */
(function (root) {
  const MODEL_VERSION = '0.4.0-qgis-research';
  const VARIABLES = {
    bldg_dens: [0, 1], bldg_mat: [1, 3], humidity: [0, 100],
    temp_c: [-10, 60], house_cnt: [1, 1000], wind_dir: [0, 360],
    wind_spd: [0, 150], alley_wd: [0.1, 50], oxygen_v: [0.1, 2]
  };
  const INTEGER = new Set(['bldg_mat', 'house_cnt', 'wind_dir']);
  const MATERIAL = {1: 0.35, 2: 0.85, 3: 1.4};
  const NEIGHBOUR_M = 60;

  // ---------- CPython-compatible Mersenne Twister ----------
  class PyRandom {
    constructor(seed) {
      const N = 624, mt = new Uint32Array(N);
      mt[0] = 19650218;
      for (let i = 1; i < N; i++) mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) >>> 0;
      let n = Math.abs(seed);
      const key = [];
      do { key.push(n % 4294967296); n = Math.floor(n / 4294967296); } while (n > 0);
      let i = 1, j = 0;
      for (let k = Math.max(N, key.length); k; k--) {
        mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
        i++; j++;
        if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
        if (j >= key.length) j = 0;
      }
      for (let k = N - 1; k; k--) {
        mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
        i++;
        if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      }
      mt[0] = 0x80000000;
      this.mt = mt;
      this.index = N;
    }
    int32() {
      const mt = this.mt, N = 624, M = 397;
      if (this.index >= N) {
        for (let k = 0; k < N; k++) {
          const y = (mt[k] & 0x80000000) | (mt[(k + 1) % N] & 0x7fffffff);
          mt[k] = mt[(k + M) % N] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
        }
        this.index = 0;
      }
      let y = mt[this.index++];
      y ^= y >>> 11;
      y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
      y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
      return (y ^ (y >>> 18)) >>> 0;
    }
    random() {
      const a = this.int32() >>> 5, b = this.int32() >>> 6;
      return (a * 67108864 + b) / 9007199254740992;
    }
  }

  function validate(values) {
    for (const [key, [low, high]] of Object.entries(VARIABLES)) {
      const value = values[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
      if (value < low || value > high) throw new Error(`${key} must be between ${low} and ${high}`);
      if (INTEGER.has(key) && !Number.isInteger(value)) throw new Error(`${key} must be an integer`);
    }
  }

  /** Dimensionless weighted score. Constants are documented scenario assumptions. */
  function susceptibility(v) {
    const material = MATERIAL[v.bldg_mat];
    const moisture = 0.25 + 0.75 * (1 - v.humidity / 100);
    const temperature = Math.exp((v.temp_c - 25) / 45);
    const houses = 0.7 + 0.3 * Math.log1p(v.house_cnt);
    return (material * (0.6 + 1.2 * v.bldg_dens) * moisture * temperature
      * houses * v.oxygen_v * 2 / (v.alley_wd + 0.7));
  }

  /** Hazard per minute; wind_dir is meteorological FROM, degrees clockwise from N. */
  function ignitionRate(source, target, gap) {
    const v = target.values;
    const bearing = Math.atan2(target.x - source.x, target.y - source.y);
    const windToward = ((v.wind_dir + 180) % 360) * Math.PI / 180;
    const wind = Math.exp(Math.min(2.0, 0.9 * v.wind_spd / 30) * Math.cos(bearing - windToward));
    const decay = Math.exp(-gap / (6 + 0.4 * v.wind_spd));
    return 0.7 * susceptibility(v) * wind * decay;
  }

  class FireModel {
    /** hook (optional, not part of model.py): hook(minute, states) -> {extinguish: ids, protect: Map id -> factor}.
     *  Used only for the optional BFP response; without it the model is exactly model.py. */
    constructor(cells, adjacency, ignitionId, seed = 42, stepMinutes = 1.0, maxMinutes = 60, hook = null) {
      this.hook = hook;
      this.protect = null;
      this.cells = new Map(cells.map(c => [c.id, c]));
      this.ids = [...this.cells.keys()].sort((a, b) => a - b);
      if (!this.cells.size || !this.cells.has(ignitionId)) throw new Error('Choose an ignition building in the input layer');
      if (!(stepMinutes > 0 && stepMinutes <= 5) || !(stepMinutes <= maxMinutes && maxMinutes <= 240)) {
        throw new Error('Use a time step in (0, 5] and a horizon between that step and 240 minutes');
      }
      for (const c of this.cells.values()) {
        validate(c.values);
        if (c.area <= 0 || c.perimeter <= 0) throw new Error(`Building ${c.id} has invalid area or perimeter`);
      }
      this.adjacency = adjacency;
      this.ignitionId = ignitionId;
      this.rng = new PyRandom(seed);
      this.seed = seed;
      this.dt = stepMinutes;
      this.maxMinutes = maxMinutes;
      this.minute = 0.0;
      this.states = new Map(this.ids.map(id => [id, 'safe']));
      this.states.set(ignitionId, 'burning');
      this.ignitedAt = new Map([[ignitionId, 0.0]]);
      this.duration = new Map(cells.map(c => [c.id, (4 + 3 * c.values.bldg_mat + Math.log1p(c.values.house_cnt))
        * (0.8 + c.values.humidity / 200) / Math.sqrt(c.values.oxygen_v)]));
      this.peakHrr = 0.0;
      this.peakIntensity = 0.0;
      this.timeline = [];
      this.record();
    }

    get finished() {
      return this.minute >= this.maxMinutes || ![...this.states.values()].includes('burning');
    }

    record() {
      const burning = [];
      for (const [k, s] of this.states) if (s === 'burning') burning.push(this.cells.get(k));
      // Assumed areal heat output. These are illustrative proxies in explicit units.
      let kw = 0, perimeter = 0;
      for (const c of burning) {
        kw += c.area * 80 * MATERIAL[c.values.bldg_mat] * (1 - 0.6 * c.values.humidity / 100) * c.values.oxygen_v;
      }
      for (const c of burning) perimeter += c.perimeter;
      this.peakHrr = Math.max(this.peakHrr, kw / 1000);
      this.peakIntensity = Math.max(this.peakIntensity, perimeter ? kw / perimeter : 0);
      let burned = 0, affected = 0;
      let extinguished = 0;
      for (const s of this.states.values()) { if (s === 'burned') burned++; else if (s === 'extinguished') extinguished++; }
      for (const k of this.ignitedAt.keys()) affected += this.cells.get(k).area;
      const row = {Minute: this.minute, Burning: burning.length, Burned: burned, Affected_Area_M2: affected, HRR_MW: kw / 1000};
      if (this.hook) row.Extinguished = extinguished;
      this.timeline.push(row);
      return row;
    }

    step() {
      if (this.finished) return this.timeline[this.timeline.length - 1];
      const dt = Math.min(this.dt, this.maxMinutes - this.minute);
      if (this.hook) { // firefighting acts at the start of the minute
        const act = this.hook(this.minute, this.states) || {};
        for (const id of act.extinguish || []) if (this.states.get(id) === 'burning') this.states.set(id, 'extinguished');
        this.protect = act.protect || null;
      }
      const hazards = new Map();
      for (const sourceId of this.ids) {
        if (this.states.get(sourceId) !== 'burning') continue;
        for (const [targetId, gap] of this.adjacency.get(sourceId) || []) {
          if (this.states.get(targetId) === 'safe') {
            hazards.set(targetId, (hazards.get(targetId) || 0.0) + ignitionRate(this.cells.get(sourceId), this.cells.get(targetId), gap) * (this.protect?.get(targetId) ?? 1));
          }
        }
      }
      const nextMinute = this.minute + dt;
      for (const targetId of [...hazards.keys()].sort((a, b) => a - b)) {
        const probability = 1 - Math.exp(-hazards.get(targetId) * dt);
        if (this.rng.random() < probability) {
          this.states.set(targetId, 'burning');
          this.ignitedAt.set(targetId, nextMinute);
        }
      }
      for (const [k, at] of this.ignitedAt) {
        if (this.states.get(k) === 'burning' && nextMinute - at >= this.duration.get(k)) this.states.set(k, 'burned');
      }
      this.minute = nextMinute;
      return this.record();
    }

    metrics() {
      const origin = this.cells.get(this.ignitionId);
      const affected = [...this.ignitedAt.keys()].map(k => this.cells.get(k));
      let area = 0, totalArea = 0, dx = 0, dy = 0;
      for (const c of affected) area += c.area;
      for (const c of this.cells.values()) totalArea += c.area;
      for (const c of affected) dx += (c.x - origin.x) * c.area;
      for (const c of affected) dy += (c.y - origin.y) * c.area;
      const lastIgnition = Math.max(...this.ignitedAt.values());
      const maxDistance = Math.max(...affected.map(c => Math.hypot(c.x - origin.x, c.y - origin.y)));
      const fraction = area / totalArea;
      const severity = fraction >= 0.6 ? 'Extreme' : fraction >= 0.3 ? 'High' : fraction >= 0.1 ? 'Moderate' : 'Low';
      const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;
      return {
        Fire_Severity: severity,
        Fire_Spread_Rate: lastIgnition ? round(maxDistance / lastIgnition, 4) : 0.0,
        Fire_Intensity: round(this.peakIntensity, 4),
        Heat_Release_Rate: round(this.peakHrr, 4),
        Burned_Area_M2: round(area, 4),
        Spread_Direction_Deg: Math.hypot(dx, dy) > 0.001 ? round(((Math.atan2(dx, dy) * 180 / Math.PI) % 360 + 360) % 360, 2) : '',
        Burning_Duration_Min: round(this.minute, 4),
        // Not in model.py's output list; exposed for the paper's outputs (see paper.js)
        Fire_Severity_Index: round(fraction, 4),
        Mean_Building_Burn_Min: round(affected.reduce((s, c) => s + this.duration.get(c.id), 0) / affected.length, 4)
      };
    }
  }

  // ---------- geometry: WGS84 -> UTM zone 51N (EPSG:32651), as engine.py does with pyproj ----------
  const UTM = (() => {
    const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, lon0 = 123 * Math.PI / 180;
    const n = f / (2 - f), A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
    const alpha = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
    const c = 2 * Math.sqrt(n) / (1 + n);
    return ([lon, lat]) => {
      const phi = lat * Math.PI / 180, dl = lon * Math.PI / 180 - lon0, s = Math.sin(phi);
      const t = Math.sinh(Math.atanh(s) - c * Math.atanh(c * s));
      const xi = Math.atan(t / Math.cos(dl)), eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
      let E = eta, N = xi;
      alpha.forEach((al, j) => {
        E += al * Math.cos(2 * (j + 1) * xi) * Math.sinh(2 * (j + 1) * eta);
        N += al * Math.sin(2 * (j + 1) * xi) * Math.cosh(2 * (j + 1) * eta);
      });
      return [500000 + k0 * A * E, k0 * A * N];
    };
  })();

  function polygonStats(ring) { // ring closed, projected metres
    // Work relative to the first corner: UTM coordinates are ~10^6 m and lose precision in cross products
    const [ox, oy] = ring[0];
    let a2 = 0, cx = 0, cy = 0, perimeter = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const x0 = ring[i][0] - ox, y0 = ring[i][1] - oy, x1 = ring[i + 1][0] - ox, y1 = ring[i + 1][1] - oy;
      const cross = x0 * y1 - x1 * y0;
      a2 += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
      perimeter += Math.hypot(x1 - x0, y1 - y0);
    }
    return {area: Math.abs(a2) / 2, x: ox + cx / (3 * a2), y: oy + cy / (3 * a2), perimeter};
  }

  function segDist(p, q, r, s) {
    const d = (a, b, c) => { // point c to segment ab
      const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
      const t = L ? Math.max(0, Math.min(1, ((c[0] - a[0]) * vx + (c[1] - a[1]) * vy) / L)) : 0;
      return Math.hypot(a[0] + t * vx - c[0], a[1] + t * vy - c[1]);
    };
    const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0) return 0;
    return Math.min(d(p, q, r), d(p, q, s), d(r, s, p), d(r, s, q));
  }
  function inside(pt, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  /** Shapely-style polygon distance: 0 when they touch, overlap or one contains the other. */
  function gap(a, b) {
    if (inside(a[0], b) || inside(b[0], a)) return 0;
    let best = Infinity;
    for (let i = 0; i < a.length - 1; i++) {
      for (let j = 0; j < b.length - 1; j++) {
        best = Math.min(best, segDist(a[i], a[i + 1], b[j], b[j + 1]));
        if (best === 0) return 0;
      }
    }
    return best;
  }

  /** Projected centroid, area and perimeter of each building footprint. */
  function footprints(features) {
    return features.map(f => polygonStats(f.geometry.coordinates[0].map(UTM)));
  }

  /** Building features -> model cells and 60 m neighbour lists, the same way engine.run_fire builds them. */
  function buildCells(features, valuesFor) {
    const rings = features.map(f => f.geometry.coordinates[0].map(UTM));
    const cells = features.map((f, i) => {
      const s = polygonStats(rings[i]);
      return {id: i, x: s.x, y: s.y, area: s.area, perimeter: s.perimeter, values: valuesFor(f)};
    });
    const boxes = rings.map(r => {
      const xs = r.map(p => p[0]), ys = r.map(p => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    });
    const adjacency = new Map(cells.map(c => [c.id, []]));
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const A = boxes[i], B = boxes[j];
        if (B[0] - A[2] > NEIGHBOUR_M || A[0] - B[2] > NEIGHBOUR_M || B[1] - A[3] > NEIGHBOUR_M || A[1] - B[3] > NEIGHBOUR_M) continue;
        const g = gap(rings[i], rings[j]);
        if (g <= NEIGHBOUR_M) { adjacency.get(i).push([j, g]); adjacency.get(j).push([i, g]); }
      }
    }
    return {cells, adjacency};
  }

  /** Run to the horizon and keep every minute's states, as engine.run_fire does. */
  /** makeHook (optional): (cells) => hook for FireModel, used for the BFP response. */
  function simulate(features, valuesFor, ignitionIndex, seed, minutes, makeHook = null) {
    const started = performance.now();
    const {cells, adjacency} = buildCells(features, valuesFor);
    const model = new FireModel(cells, adjacency, ignitionIndex, seed, 1, minutes, makeHook ? makeHook(cells) : null);
    const code = {safe: 0, burning: 1, burned: 2, extinguished: 3};
    const frame = () => ({minute: model.minute, states: Uint8Array.from(model.ids, id => code[model.states.get(id)])});
    const frames = [frame()];
    while (!model.finished) { model.step(); frames.push(frame()); }
    return {
      model: MODEL_VERSION, frames, timeline: model.timeline,
      metrics: {...model.metrics(), Total_Simulation_Time_Sec: Math.round(performance.now() - started) / 1000},
      status: [...model.states.values()].includes('burning') ? 'Horizon reached' : 'Extinguished',
      neighbours: [...adjacency.values()].reduce((s, l) => s + l.length, 0) / 2
    };
  }

  const api = {MODEL_VERSION, VARIABLES, PyRandom, validate, susceptibility, ignitionRate, FireModel, UTM, gap, segDist, inside, footprints, buildCells, simulate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IgnisFire = api;
})(globalThis);
