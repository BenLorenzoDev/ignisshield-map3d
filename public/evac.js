/* Evacuation on foot during a simulated fire.
 * Residents of every building the fire comes within `warnM` metres of leave at that minute (or when their own
 * building ignites) and walk to the nearest safe place: a safe area set by the class, or the main road. Routes use the
 * walking network (inventory roads + field-surveyed paths, IgnisShield-Web travel times) and avoid every street
 * segment within `clearance` metres of a building that is burning or burned when they set off. Uses the fire run's
 * frames only; it does not change the fire. People per building = households (X6) × 5, the Baliwagan 2026 average. */
(function (root) {
  const R = typeof module !== 'undefined' && module.exports ? require('./routing.js') : root.IgnisRouting;
  const K = [111320 * Math.cos(10.51 * Math.PI / 180), 110540]; // metres per degree at Sitio Polo
  const toM = ([x, y]) => [x * K[0], y * K[1]];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const lineOf = g => (g.type === 'MultiLineString' ? g.coordinates[0] : g.coordinates);
  const MAIN = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
  const PEOPLE_PER_HOUSEHOLD = 5; // Baliwagan 2026 census: 6,141 people in 1,209 households

  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
      return top;
    }
  }

  /** Spatial index of points (metres) in cells of `size`. */
  function grid(points, size) {
    const cells = new Map(), key = (x, y) => `${Math.floor(x / size)},${Math.floor(y / size)}`;
    points.forEach((p, i) => { const k = key(p[0], p[1]); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i); });
    return (p, r) => {
      const out = [], gx = Math.floor(p[0] / size), gy = Math.floor(p[1] / size), n = Math.ceil(r / size);
      for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) for (const i of cells.get(`${gx + dx},${gy + dy}`) || []) out.push(i);
      return out;
    };
  }

  /**
   * One-time preparation for a set of buildings (all runs of a batch share it).
   * features, densities[i] (model coverage 0–1), households[i] (X6); roads, paths; safePoints [{lonlat, name}].
   */
  function prepare({features, densities, households, roads, paths = [], safePoints = [], water = [], warnM = 30, clearance = 8, speedKmh = 4.5, maxStartM = 80, walkingSpace = null}) {
    let network = R.prepareNetwork(roads, paths, walkingSpace ? {nodeM: 0.35, lineM: 0.5} : undefined);
    let excludedObstacles = 0;
    if (walkingSpace) network = network.filter(f => {
      const line = lineOf(f.geometry);
      // Existing mapped roads may include bridges. Footprints are always checked.
      const usable = String(f.properties.from_node) !== String(f.properties.to_node)
        && line.some((p, k) => k && dist(toM(line[k - 1]), toM(p)) > 0.01)
        && line.every((p, k) => !k || walkingSpace.clear(line[k - 1], p, -1, f.properties.source === 'field survey'));
      if (!usable) excludedObstacles++;
      return usable;
    });
    const base = R.buildGraph(network, features.map((f, i) => ({feature: f, bldg_dens: densities[i]})), [], {mode: 'Walking', speed: speedKmh});
    const speedMpm = speedKmh * 1000 / 60;

    // Buildings: centre (lon/lat and metres) and radius
    const B = features.map(f => {
      const ring = f.geometry.coordinates[0], n = ring.length - 1;
      let x = 0, y = 0;
      for (let k = 0; k < n; k++) { x += ring[k][0]; y += ring[k][1]; }
      const c = [x / n, y / n], cm = toM(c);
      let rad = 0;
      for (let k = 0; k < n; k++) rad = Math.max(rad, dist(cm, toM(ring[k])));
      return {c, cm, rad};
    });
    const near = grid(B.map(b => b.cm), 20);
    const within = (pm, d) => near(pm, d + 25).filter(i => dist(B[i].cm, pm) <= d + B[i].rad);

    // Which buildings block each street segment (sampled every 4 m) and each junction
    const edgeNear = new Map(), edgeNearAt = new Map(); // buildings beside each street, and where along it (0..1)
    for (const [id, f] of base.edges) {
      const line = lineOf(f.geometry).map(toM), at = new Map();
      let total = 0;
      for (let k = 0; k < line.length - 1; k++) total += dist(line[k], line[k + 1]);
      let run = 0;
      for (let k = 0; k < line.length - 1; k++) {
        const L = dist(line[k], line[k + 1]), steps = Math.max(1, Math.ceil(L / 4));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps, p = [line[k][0] + (line[k + 1][0] - line[k][0]) * t, line[k][1] + (line[k + 1][1] - line[k][1]) * t];
          const frac = total ? (run + t * L) / total : 0;
          for (const i of within(p, clearance)) { if (!at.has(i)) at.set(i, []); at.get(i).push(frac); }
        }
        run += L;
      }
      edgeNear.set(id, [...at.keys()]);
      edgeNearAt.set(id, [...at].map(([i, fr]) => [i, Math.min(...fr), Math.max(...fr)]));
    }
    const edgeWarm = new Map();
    for (const [id, f] of base.edges) {
      const line = lineOf(f.geometry).map(toM), set = new Set();
      for (let k = 0; k < line.length - 1; k++) {
        const L = dist(line[k], line[k + 1]), steps = Math.max(1, Math.ceil(L / 10));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          for (const i of within([line[k][0] + (line[k + 1][0] - line[k][0]) * t, line[k][1] + (line[k + 1][1] - line[k][1]) * t], warnM)) set.add(i);
        }
      }
      edgeWarm.set(id, [...set]);
    }
    const HEAT = 5; // streets within warnM of the fire count 5x longer when choosing a way out
    const nodeM = new Map([...base.coords].map(([id, c]) => [id, toM(c.lonlat)]));
    const nodeNear = new Map([...nodeM].map(([id, m]) => [id, within(m, clearance * 2)]));

    // Safe places: every junction on the main road, and the junction nearest each safe area
    const safe = new Map();
    for (const [id, f] of base.edges) {
      if (!MAIN.has(f.properties.highway)) continue;
      for (const n of [String(f.properties.from_node), String(f.properties.to_node)]) if (nodeM.has(n)) safe.set(n, 'the main road');
    }
    const nodeIds = [...nodeM.keys()], nodeGrid = grid(nodeIds.map(id => nodeM.get(id)), 25);
    const nearestNodes = (pm, r, k) => nodeGrid(pm, r).map(j => [nodeIds[j], dist(nodeM.get(nodeIds[j]), pm)])
      .filter(([, d]) => d <= r).sort((a, b) => a[1] - b[1]).slice(0, k);
    const areas = [];
    for (const s of safePoints) {
      const hit = nearestNodes(toM(s.lonlat), 60, 1)[0];
      if (hit) { safe.set(hit[0], s.name); areas.push({...s, node: hit[0]}); }
    }
    // Getting from home to the first mapped road or alley means squeezing between houses: counted at half speed
    const ACCESS_SLOWDOWN = 2;
    // Where each household steps out: the nearest point on every street or alley within maxStartM (not only junctions)
    const segGrid = new Map(), SEG = 40;
    for (const [e, f] of base.edges) {
      const line = lineOf(f.geometry), lm = line.map(toM);
      let total = 0;
      const cum = [0];
      for (let k = 1; k < lm.length; k++) cum.push(total += dist(lm[k - 1], lm[k]));
      const meta = {e, from: String(f.properties.from_node), to: String(f.properties.to_node), line, lm, cum, total};
      for (let k = 0; k < lm.length - 1; k++) {
        const [a, b] = [lm[k], lm[k + 1]];
        for (let gx = Math.floor(Math.min(a[0], b[0]) / SEG); gx <= Math.floor(Math.max(a[0], b[0]) / SEG); gx++)
          for (let gy = Math.floor(Math.min(a[1], b[1]) / SEG); gy <= Math.floor(Math.max(a[1], b[1]) / SEG); gy++) {
            const key = gx + "," + gy;
            if (!segGrid.has(key)) segGrid.set(key, []);
            segGrid.get(key).push([meta, k]);
          }
      }
    }
    // Water (sea, river, ponds) in metres, with bounding boxes. water = array of polygons (arrays of rings)
    const W = water.map(poly => {
      const rings = poly.map(ring => ring.map(toM)), xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]);
      return {rings, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]};
    });
    const inRing = (p, ring) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const inWater = p => W.some(w => p[0] >= w.box[0] && p[0] <= w.box[2] && p[1] >= w.box[1] && p[1] <= w.box[3]
      && inRing(p, w.rings[0]) && !w.rings.slice(1).some(h => inRing(p, h)));
    const crossesWater = (a, b) => {
      const n = Math.max(2, Math.ceil(dist(a, b) / 3));
      for (let s = 1; s < n; s++) { const t = s / n; if (inWater([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return true; }
      return false;
    };
    const starts = B.map((b, i) => {
      const best = new Map(), n = Math.ceil(maxStartM / SEG), gx = Math.floor(b.cm[0] / SEG), gy = Math.floor(b.cm[1] / SEG);
      for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) for (const [m, k] of segGrid.get((gx + dx) + "," + (gy + dy)) || []) {
        const a = m.lm[k], c = m.lm[k + 1], vx = c[0] - a[0], vy = c[1] - a[1], L = vx * vx + vy * vy;
        const t = L ? Math.max(0, Math.min(1, ((b.cm[0] - a[0]) * vx + (b.cm[1] - a[1]) * vy) / L)) : 0;
        const q = [a[0] + t * vx, a[1] + t * vy], d = dist(q, b.cm);
        if (d <= maxStartM && (!best.has(m.e) || d < best.get(m.e).d) && (walkingSpace || !crossesWater(b.cm, q))) best.set(m.e, {m, k, t, d, at: m.cum[k] + t * Math.sqrt(L)});
      }
      if (walkingSpace) for (const [edge, st] of best) {
        const a = st.m.line[st.k], z = st.m.line[st.k + 1], q = a.map((v, j) => v + (z[j] - v) * st.t);
        const access = walkingSpace.route(b.c, q, {ignore: i, maxLength: maxStartM});
        if (!access) { best.delete(edge); continue; }
        st.access = access; st.d = 0;
        for (let j = 1; j < access.length; j++) st.d += dist(toM(access[j - 1]), toM(access[j]));
      }
      return [...best.values()].sort((x, y) => x.d - y.d); // every street within reach: the nearest may be blocked by fire
    });

    // Direction of travel along an edge: coordinates from node `from`
    const edgeLine = (e, from) => {
      const f = base.edges.get(e), line = lineOf(f.geometry);
      return String(f.properties.from_node) === from ? line : line.slice().reverse();
    };
    const weightOf = (from, to, e) => base.graph.adj.get(from).find(v => v[0] === to && v[3] === e)[1];

    /** Evacuation for one fire run (its frames: one per minute, states 0 safe / 1 burning / 2 burned). */
    function evaluate(frames) {
      const n = features.length, ig = new Float64Array(n).fill(Infinity);
      for (const f of frames) for (let i = 0; i < n; i++) if (f.states[i] > 0 && ig[i] === Infinity) ig[i] = f.minute;
      // leave when the fire comes within warnM of home (includes the home itself)
      const depart = new Float64Array(n).fill(Infinity);
      for (let j = 0; j < n; j++) {
        if (ig[j] === Infinity) continue;
        for (const i of within(B[j].cm, warnM)) if (dist(B[i].cm, B[j].cm) <= warnM + B[i].rad && ig[j] < depart[i]) depart[i] = ig[j];
      }
      // What people know at minute m: where the fire is now. Streets beside burning buildings are impassable; streets
      // within warnM of the fire are avoided (HEAT x the cost) so people head away from it, not past it.
      const trees = new Map();
      const treeAt = m => {
        if (trees.has(m)) return trees.get(m);
        const burnt = i => ig[i] < m; // fires that started before this minute (people run out as their own house catches)
        const blocked = new Set([...edgeNear].filter(([, list]) => list.some(burnt)).map(([e]) => e));
        const hot = new Set([...edgeWarm].filter(([, list]) => list.some(burnt)).map(([e]) => e));
        const unsafe = id => nodeNear.get(id).some(burnt);
        const cost = e => (hot.has(e) ? HEAT : 1);
        const d = new Map(), next = new Map(), heap = new Heap();
        for (const [s] of safe) if (!unsafe(s)) { d.set(s, 0); heap.push([0, s]); }
        while (heap.size) {
          const [du, u] = heap.pop();
          if (du > d.get(u)) continue;
          for (const [v, w, , e] of base.graph.adj.get(u)) {
            if (blocked.has(e)) continue;
            const nd = du + w * cost(e);
            if (nd < (d.get(v) ?? Infinity)) { d.set(v, nd); next.set(v, [u, e]); heap.push([nd, v]); }
          }
        }
        const t = {d, next, unsafe, blocked, cost};
        trees.set(m, t);
        return t;
      };
      /** Follow the tree from `node` at time t: coordinates, times and the street steps taken. */
      const follow = (node, t, tree, coords, times, steps) => {
        while (tree.next.has(node)) {
          const [u, e] = tree.next.get(node), w = weightOf(node, u, e), line = edgeLine(e, node);
          let total = 0;
          for (let k = 1; k < line.length; k++) total += dist(toM(line[k - 1]), toM(line[k]));
          let acc = 0;
          for (let k = 1; k < line.length; k++) {
            acc += dist(toM(line[k - 1]), toM(line[k]));
            coords.push(line[k]); times.push(t + (total ? w * acc / total : w));
          }
          const fwd = String(base.edges.get(e).properties.from_node) === node;
          steps.push({e, from: node, to: u, t0: t, t1: t + w, f0: fwd ? 0 : 1, f1: fwd ? 1 : 0});
          t += w;
          node = u;
        }
        return {node, t};
      };
      /** Cut a route at minute k: keep everything walked so far and return the position. */
      const cutAt = (coords, times, k) => {
        let j = 1;
        while (j < times.length && times[j] <= k) j++;
        if (j >= times.length) return coords[coords.length - 1];
        const a = coords[j - 1], b = coords[j], span = times[j] - times[j - 1], f = span > 0 ? (k - times[j - 1]) / span : 1;
        const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        coords.length = j; times.length = j;
        coords.push(p); times.push(k);
        return p;
      };
      const groups = [];
      for (let i = 0; i < n; i++) {
        if (depart[i] === Infinity) continue;
        const people = Math.max(1, households[i]) * PEOPLE_PER_HOUSEHOLD, t0 = depart[i], home = B[i].c;
        if (!starts[i].length) { groups.push({i, people, depart: t0, status: 'nopath', coords: [home], times: [t0]}); continue; }
        let tree = treeAt(t0);
        // step out onto the nearest usable street or alley (never across water), then along it to one of its ends
        let pick = null;
        // the way from the door must keep clear of every other house already alight (including ones catching now)
        const legClear = st => {
          if (st.access) {
            for (let j = 1; j < st.access.length; j++) {
              const a = toM(st.access[j - 1]), b = toM(st.access[j]), n = Math.max(1, Math.ceil(dist(a, b) / 4));
              for (let s = 1; s <= n; s++) {
                const p = a.map((v, k) => v + (b[k] - v) * s / n);
                if (within(p, clearance).some(k => k !== i && ig[k] <= t0)) return false;
              }
            }
            return true;
          }
          const a = st.m.lm[st.k], b = st.m.lm[st.k + 1], q = [a[0] + (b[0] - a[0]) * st.t, a[1] + (b[1] - a[1]) * st.t];
          const n = Math.max(2, Math.ceil(st.d / 4));
          for (let s = 1; s <= n; s++) {
            const f = s / n, p = [B[i].cm[0] + (q[0] - B[i].cm[0]) * f, B[i].cm[1] + (q[1] - B[i].cm[1]) * f];
            if (within(p, clearance).some(j => j !== i && ig[j] <= t0)) return false;
          }
          return true;
        };
        for (const st of starts[i]) {
          if (tree.blocked.has(st.m.e) || !legClear(st)) continue;
          const w = weightOf(st.m.from, st.m.to, st.m.e), frac = st.m.total ? st.at / st.m.total : 0;
          for (const [end, part] of [[st.m.from, frac], [st.m.to, 1 - frac]]) {
            if (!tree.d.has(end) || tree.unsafe(end)) continue;
            const cost = st.d * ACCESS_SLOWDOWN / speedMpm + w * part * tree.cost(st.m.e) + tree.d.get(end);
            if (!pick || cost < pick.cost) pick = {cost, st, end, w: w * part};
          }
        }
        if (!pick) { groups.push({i, people, depart: t0, status: 'trapped', coords: [home], times: [t0]}); continue; }
        const {st, end} = pick, door = st.m.line[st.k].map((v, j) => v + (st.m.line[st.k + 1][j] - v) * st.t);
        let t = t0 + st.d * ACCESS_SLOWDOWN / speedMpm;
        const coords = st.access ? st.access.slice() : [home, door], times = [t0];
        let accessLength = 0;
        for (let j = 1; j < coords.length; j++) {
          accessLength += dist(toM(coords[j - 1]), toM(coords[j]));
          times.push(t0 + (st.d ? accessLength / st.d * (t - t0) : 0));
        }
        if (!st.access) times[1] = t; // retain the original mode's exact timestamp
        const accessEnd = coords.length - 1;
        const along = end === st.m.from ? st.m.line.slice(0, st.k + 1).reverse() : st.m.line.slice(st.k + 1);
        const partLen = end === st.m.from ? st.at : st.m.total - st.at;
        let prev = door, acc = 0;
        for (const c of along) {
          acc += dist(toM(prev), toM(c)); prev = c;
          coords.push(c); times.push(t + (partLen ? pick.w * Math.min(1, acc / partLen) : pick.w));
        }
        const doorFrac = st.m.total ? st.at / st.m.total : 0;
        const steps = [{e: st.m.e, from: end === st.m.from ? st.m.to : st.m.from, to: end, t0: t, t1: t + pick.w, door: true, f0: doorFrac, f1: end === st.m.from ? 0 : 1}];
        t += pick.w;
        let arrived = follow(end, t, tree, coords, times, steps), status = 'safe', replans = 0;
        let usesSurveyedAlley = steps.some(s => base.edges.get(s.e).properties.source === 'field survey');
        // Every minute on the way: if the fire now blocks a street still ahead, turn back or take another way
        const burntBy = k => i => ig[i] < k;
        // is there fire beside street e between positions a and b (0..1 along it)?
        const fireBetween = (e, a, b, k) => {
          const lo = Math.min(a, b) - 0.02, hi = Math.max(a, b) + 0.02, burnt = burntBy(k);
          return edgeNearAt.get(e).some(([i, f0, f1]) => burnt(i) && f1 >= lo && f0 <= hi);
        };
        for (let k = Math.floor(t0) + 1; k < arrived.t && replans < 8; k++) {
          const tk = treeAt(k), ahead = steps.filter(s => s.t1 > k);
          if (!ahead.length) break;
          const cur = ahead[0];
          // In the preview, wait until reaching the mapped network before road replanning.
          // Otherwise a replan could jump from the access path straight across a building.
          if (walkingSpace && k < cur.t0) continue;
          const p = Math.max(0, Math.min(1, (k - cur.t0) / ((cur.t1 - cur.t0) || 1)));
          const pos = cur.f0 + (cur.f1 - cur.f0) * p;
          const blockedAhead = fireBetween(cur.e, pos, cur.f1, k) || ahead.slice(1).some(s => tk.blocked.has(s.e));
          if (!blockedAhead) continue;
          replans++;
          const here = cutAt(coords, times, k), hm = toM(here);
          const options = [];
          if (!fireBetween(cur.e, pos, cur.f1, k)) options.push(cur.to);
          if (!cur.door && !fireBetween(cur.e, pos, cur.f0, k)) options.push(cur.from);
          let best = null;
          for (const node of options) {
            if (!tk.d.has(node) || tk.unsafe(node)) continue;
            let part = [here, base.coords.get(node).lonlat];
            if (walkingSpace) {
              const line = lineOf(base.edges.get(cur.e).geometry), cum = [0];
              for (let j = 1; j < line.length; j++) cum.push(cum[j - 1] + dist(toM(line[j - 1]), toM(line[j])));
              const at = pos * cum.at(-1), forward = node === String(base.edges.get(cur.e).properties.to_node);
              part = [here, ...(forward ? line.filter((_, j) => cum[j] > at + 1e-7) : line.filter((_, j) => cum[j] < at - 1e-7).reverse())];
            }
            let length = 0;
            for (let j = 1; j < part.length; j++) length += dist(toM(part[j - 1]), toM(part[j]));
            const walk = length / speedMpm, cost = walk + tk.d.get(node);
            if (!best || cost < best.cost) best = {node, walk, cost, part};
          }
          if (!best) { status = 'trapped'; arrived = {node: null, t: k}; break; }
          let elapsed = 0;
          for (let j = 1; j < best.part.length; j++) {
            elapsed += dist(toM(best.part[j - 1]), toM(best.part[j])) / speedMpm;
            coords.push(best.part[j]); times.push(k + elapsed);
          }
          steps.length = 0;
          if (walkingSpace) steps.push({e: cur.e, from: best.node === cur.to ? cur.from : cur.to, to: best.node,
            t0: k, t1: k + best.walk, f0: pos, f1: best.node === String(base.edges.get(cur.e).properties.to_node) ? 1 : 0});
          arrived = follow(best.node, k + best.walk, tk, coords, times, steps);
          usesSurveyedAlley ||= steps.some(s => base.edges.get(s.e).properties.source === 'field survey');
          tree = tk;
        }
        if (status === 'trapped') groups.push({i, people, depart: t0, status, coords, times, replans, accessEnd, usesSurveyedAlley});
        else groups.push({i, people, depart: t0, arrive: arrived.t, status, to: safe.get(arrived.node), coords, times, replans, accessEnd, usesSurveyedAlley});
      }
      const sum = (arr, f) => arr.reduce((s, g) => s + f(g), 0);
      const ok = groups.filter(g => g.status === 'safe'), okPeople = sum(ok, g => g.people);
      return {
        groups,
        summary: {
          buildings: groups.length, people: sum(groups, g => g.people), safe: okPeople,
          trapped: sum(groups.filter(g => g.status === 'trapped'), g => g.people),
          nopath: sum(groups.filter(g => g.status === 'nopath'), g => g.people),
          avgMin: okPeople ? sum(ok, g => (g.arrive - g.depart) * g.people) / okPeople : 0,
          maxMin: ok.length ? Math.max(...ok.map(g => g.arrive - g.depart)) : 0,
          toMainRoad: sum(ok.filter(g => g.to === 'the main road'), g => g.people)
        }
      };
    }
    const bridges = [...base.edges].filter(([, f]) => {
      const l = lineOf(f.geometry).map(toM);
      return l.some((p, k) => k && crossesWater(l[k - 1], p));
    }).map(([, f]) => lineOf(f.geometry));
    return {evaluate, excludedObstacles, bridges, safeNodes: [...safe].map(([id, label]) => ({lonlat: base.coords.get(id).lonlat, label})), areas};
  }

  /** Where an evacuee group is at `minute`: null before leaving, else [lon, lat] and state. */
  function positionAt(g, minute) {
    if (minute < g.depart) return null;
    if (g.status !== 'safe') {
      const end = g.times[g.times.length - 1];
      if (g.coords.length < 2 || minute >= end) return {at: g.coords[g.coords.length - 1], state: g.status};
      return {...positionAt({...g, status: 'safe', arrive: end}, minute), state: 'moving'};
    }
    if (minute >= g.arrive) return {at: g.coords[g.coords.length - 1], state: 'arrived'};
    const t = g.times;
    let k = 1;
    while (k < t.length - 1 && t[k] < minute) k++;
    const a = g.coords[k - 1], b = g.coords[k], span = t[k] - t[k - 1], f = span > 0 ? (minute - t[k - 1]) / span : 1;
    return {at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], state: 'moving', dir: b[0] >= a[0] ? 1 : -1,
      heading: Math.atan2((b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), b[1] - a[1])};
  }

  const api = {prepare, positionAt, PEOPLE_PER_HOUSEHOLD};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IgnisEvac = api;
})(globalThis);
