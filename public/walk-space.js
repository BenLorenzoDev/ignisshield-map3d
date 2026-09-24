/* Local-preview walking geometry. Uses mapped footprints; it cannot verify doors, fences or passage rights. */
(function (root) {
  const K = [111320 * Math.cos(10.51 * Math.PI / 180), 110540];
  const xy = p => [p[0] * K[0], p[1] * K[1]], ll = p => [p[0] / K[0], p[1] / K[1]];
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a, b, p) => Math.abs(cross(a, b, p)) < 1e-7 && p[0] >= Math.min(a[0], b[0]) - 1e-7 && p[0] <= Math.max(a[0], b[0]) + 1e-7 && p[1] >= Math.min(a[1], b[1]) - 1e-7 && p[1] <= Math.max(a[1], b[1]) + 1e-7;
  function intersects(a, b, c, d) {
    const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b);
    return (x * y < 0 && z * w < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
  }
  function inside(p, r) {
    let yes = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if (on(a, b, p)) return true;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
    }
    return yes;
  }
  class Heap {
    constructor() { this.a = []; }
    push(v) { const a = this.a; a.push(v); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p].f <= v.f) break; a[i] = a[p]; i = p; } a[i] = v; }
    pop() { const a = this.a, v = a[0], end = a.pop(); if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let j = i * 2 + 1; if (j + 1 < a.length && a[j + 1].f < a[j].f) j++; if (a[j].f >= end.f) break; a[i] = a[j]; i = j; } a[i] = end; } return v; }
  }
  function create(features, water = []) {
    const shapes = [], cells = new Map(), size = 24;
    const add = (rings, owner, wet) => {
      rings = rings.map(r => r.map(xy));
      const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]);
      const s = {rings, owner, wet, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]}, id = shapes.push(s) - 1;
      for (let x = Math.floor(s.box[0] / size); x <= Math.floor(s.box[2] / size); x++) for (let y = Math.floor(s.box[1] / size); y <= Math.floor(s.box[3] / size); y++) {
        const key = `${x},${y}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(id);
      }
    };
    features.forEach((f, i) => { for (const poly of f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]) add(poly, i, false); });
    water.forEach(poly => add(poly, -2, true));
    function clearM(a, b, ignore = -1, checkWater = true) {
      const box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], seen = new Set();
      for (let x = Math.floor(box[0] / size); x <= Math.floor(box[2] / size); x++) for (let y = Math.floor(box[1] / size); y <= Math.floor(box[3] / size); y++) for (const id of cells.get(`${x},${y}`) || []) {
        if (seen.has(id)) continue; seen.add(id);
        const s = shapes[id];
        if (s.owner === ignore || (!checkWater && s.wet) || box[2] < s.box[0] || box[0] > s.box[2] || box[3] < s.box[1] || box[1] > s.box[3]) continue;
        const contains = p => inside(p, s.rings[0]) && !s.rings.slice(1).some(r => inside(p, r));
        if (contains(a) || contains(b)) return false;
        for (const r of s.rings) for (let j = 1; j < r.length; j++) if (intersects(a, b, r[j - 1], r[j])) return false;
      }
      return true;
    }
    const clear = (a, b, ignore = -1, checkWater = true) => clearM(xy(a), xy(b), ignore, checkWater);
    function snap(p, radius = 6) {
      const a = xy(p); if (clearM(a, a)) return p;
      for (let r = 0.75; r <= radius; r += 0.75) for (let j = 0; j < 24; j++) {
        const t = j * Math.PI / 12, b = [a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)];
        if (clearM(b, b)) return ll(b);
      }
      return null;
    }
    // Reuse a visibility graph around footprint corners across all households. Exact segment
    // checks reject corner cutting; a bounded failed search never falls back to a straight line.
    const vertices = [], vertexCells = new Map(), adjacency = new Map(), startCache = new Map();
    for (const shape of shapes) for (const ring of shape.rings) {
      let area = 0;
      for (let i = 1; i < ring.length; i++) area += (ring[i - 1][0] - ring[0][0]) * (ring[i][1] - ring[0][1]) - (ring[i][0] - ring[0][0]) * (ring[i - 1][1] - ring[0][1]);
      const sign = area >= 0 ? 1 : -1, n = ring.length - 1;
      for (let i = 0; i < n; i++) {
        const prev = ring[(i + n - 1) % n], p = ring[i], next = ring[(i + 1) % n];
        const l = distance(prev, p) || 1, r = distance(p, next) || 1;
        let dx = sign * ((p[1] - prev[1]) / l + (next[1] - p[1]) / r), dy = -sign * ((p[0] - prev[0]) / l + (next[0] - p[0]) / r);
        const d = Math.hypot(dx, dy); if (d < 0.001) continue; dx /= d; dy /= d;
        for (const offset of [0.3, 0.1]) {
          const q = [p[0] + dx * offset, p[1] + dy * offset];
          if (!clearM(q, q)) continue;
          const id = vertices.push(q) - 1, key = `${Math.floor(q[0] / size)},${Math.floor(q[1] / size)}`;
          if (!vertexCells.has(key)) vertexCells.set(key, []); vertexCells.get(key).push(id); break;
        }
      }
    }
    function nearby(p, radius) {
      const ids = [], n = Math.ceil(radius / size), x = Math.floor(p[0] / size), y = Math.floor(p[1] / size);
      for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) for (const id of vertexCells.get(`${x + dx},${y + dy}`) || []) if (distance(p, vertices[id]) <= radius) ids.push(id);
      return ids;
    }
    const links = (p, radius, ignore) => nearby(p, radius).filter(id => clearM(p, vertices[id], ignore)).map(id => [id, distance(p, vertices[id])]);
    const neighbours = id => {
      if (!adjacency.has(id)) adjacency.set(id, links(vertices[id], 40, -1).filter(([j]) => j !== id));
      return adjacency.get(id);
    };
    function route(start, end, {ignore = -1, maxLength = 80} = {}) {
      const a = xy(start), b = xy(end);
      if (distance(a, b) > maxLength || !clearM(b, b, ignore)) return null;
      if (clearM(a, b, ignore)) return [start, end];
      if (!clearM(a, a, ignore)) return null;
      const heap = new Heap(), best = new Map(), parents = new Map();
      const cacheKey = `${a[0]},${a[1]},${ignore},${maxLength}`;
      if (!startCache.has(cacheKey)) startCache.set(cacheKey, links(a, maxLength, ignore));
      for (const [id, g] of startCache.get(cacheKey)) { const f = g + distance(vertices[id], b); if (f <= maxLength) { best.set(id, g); heap.push({id, g, f}); } }
      let last = null, cost = maxLength + 1e-7;
      while (heap.a.length) {
        const v = heap.pop(); if (v.g !== best.get(v.id) || v.f >= cost) continue;
        const p = vertices[v.id], h = distance(p, b);
        if (v.g + h < cost && clearM(p, b, ignore)) { cost = v.g + h; last = v.id; }
        for (const [id, length] of neighbours(v.id)) {
          const g = v.g + length, f = g + distance(vertices[id], b);
          if (f >= cost || f > maxLength || g >= (best.get(id) ?? Infinity)) continue;
          best.set(id, g); parents.set(id, v.id); heap.push({id, g, f});
        }
      }
      if (last === null) return null;
      const raw = [b]; for (let k = last; k !== undefined; k = parents.get(k)) raw.push(vertices[k]); raw.push(a); raw.reverse();
      const out = [raw[0]];
      for (let i = 0; i < raw.length - 1;) { let j = raw.length - 1; while (j > i + 1 && !clearM(raw[i], raw[j], ignore)) j--; out.push(raw[j]); i = j; }
      return out.map(ll);
    }
    return {clear, route, snap};
  }
  const api = {create};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IgnisWalkSpace = api;
})(globalThis);
