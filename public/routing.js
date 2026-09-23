/* IgnisShield routing, ported line for line from IgnisShield-Web: Network and optimize_visit_order in
 * backend/model.py, build_graph and run_route in backend/engine.py. Dijkstra on modelled travel minutes;
 * checkpoint (Hamiltonian) order is exact Held-Karp up to 12 checkpoints, greedy + 2-opt above.
 * Static travel costs: no crowd capacity, live traffic or changing hazards during a trip.
 * Checked against the Python version by tests/parity.mjs. */
(function (root) {
  const F = typeof module !== 'undefined' && module.exports ? require('./fire.js') : root.IgnisFire;

  // Min-heap ordered like Python tuples (cost, node)
  class Heap {
    constructor() { this.items = []; }
    get size() { return this.items.length; }
    less(a, b) { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }
    push(item) {
      const h = this.items;
      h.push(item);
      let i = h.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!this.less(h[i], h[p])) break;
        [h[i], h[p]] = [h[p], h[i]];
        i = p;
      }
    }
    pop() {
      const h = this.items, top = h[0], last = h.pop();
      if (h.length) {
        h[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < h.length && this.less(h[l], h[m])) m = l;
          if (r < h.length && this.less(h[r], h[m])) m = r;
          if (m === i) break;
          [h[i], h[m]] = [h[m], h[i]];
          i = m;
        }
      }
      return top;
    }
  }

  class Network {
    constructor() { this.adj = new Map(); }

    addEdge(a, b, minutes, length, edgeId, bidirectional = true) {
      if (!Number.isFinite(minutes) || minutes <= 0 || length <= 0) throw new Error('Network edge weights must be positive');
      if (!this.adj.has(a)) this.adj.set(a, []);
      this.adj.get(a).push([b, minutes, length, edgeId]);
      if (!this.adj.has(b)) this.adj.set(b, []);
      if (bidirectional) this.adj.get(b).push([a, minutes, length, edgeId]);
    }

    shortest(source, target) {
      if (!this.adj.has(source) || !this.adj.has(target)) throw new Error('Start or destination is outside the traversable network');
      const queue = new Heap();
      queue.push([0.0, source]);
      const best = new Map([[source, 0.0]]);
      const previous = new Map();
      while (queue.size) {
        const [cost, start] = queue.pop();
        let node = start;
        if (cost !== best.get(node)) continue;
        if (node === target) {
          const nodes = [target], edges = [];
          let length = 0.0;
          while (node !== source) {
            const [parent, edge, edgeLength] = previous.get(node);
            nodes.push(parent);
            edges.push(edge);
            length += edgeLength;
            node = parent;
          }
          return {minutes: cost, length, nodes: nodes.reverse(), edges: edges.reverse()};
        }
        for (const [neighbor, weight, edgeLength, edge] of this.adj.get(node)) {
          const candidate = cost + weight;
          if (candidate < (best.has(neighbor) ? best.get(neighbor) : Infinity)) {
            best.set(neighbor, candidate);
            previous.set(neighbor, [node, edge, edgeLength]);
            queue.push([candidate, neighbor]);
          }
        }
      }
      throw new Error(`No traversable path from ${source} to ${target}; change endpoints or access constraints`);
    }
  }

  /** Hamiltonian checkpoint order on shortest-path closure, path or return cycle. */
  function optimizeVisitOrder(network, start, stops, end) {
    if (start === end && !stops.length) throw new Error('A return cycle needs at least one checkpoint');
    if (new Set(stops).size !== stops.length || stops.includes(start) || stops.includes(end)) {
      throw new Error('Checkpoints must be unique and distinct from endpoints');
    }
    if (stops.length > 20) throw new Error('Use at most 20 checkpoints for an interactive run');
    const points = [start, ...stops, end];
    if (points.some(n => !network.adj.has(n))) throw new Error('Start, checkpoint or destination is outside the traversable network');
    const cache = new Map();
    const key = (a, b) => `${a}\u0000${b}`;
    for (const a of points.slice(0, -1)) {
      for (const b of points.slice(1)) {
        if (a === b) continue;
        // A directed network need not allow every permutation. Invalid candidate legs have infinite cost.
        try { cache.set(key(a, b), network.shortest(a, b)); } catch { cache.set(key(a, b), null); }
      }
    }
    const leg = (a, b) => cache.get(key(a, b));
    const total = order => {
      let sum = 0;
      for (let i = 0; i < order.length - 1; i++) { const l = leg(order[i], order[i + 1]); sum += l ? l.minutes : Infinity; }
      return sum;
    };

    const baseline = points.slice();
    if (!Number.isFinite(total(baseline))) {
      throw new Error('Baseline checkpoint order is not traversable; reorder checkpoints or choose connected example endpoints');
    }
    let exactOrder = null;
    if (stops.length && stops.length <= 12) {
      const dp = new Map(), parents = new Map(), k2 = (m, j) => m * 32 + j;
      stops.forEach((node, j) => {
        const l = leg(start, node);
        if (l) { dp.set(k2(1 << j, j), l.minutes); parents.set(k2(1 << j, j), null); }
      });
      for (let mask = 1; mask < (1 << stops.length); mask++) {
        for (let j = 0; j < stops.length; j++) {
          if (!dp.has(k2(mask, j))) continue;
          for (let k = 0; k < stops.length; k++) {
            const l = mask & (1 << k) ? null : leg(stops[j], stops[k]);
            if (l) {
              const kk = k2(mask | (1 << k), k);
              const cost = dp.get(k2(mask, j)) + l.minutes;
              if (cost < (dp.has(kk) ? dp.get(kk) : Infinity)) { dp.set(kk, cost); parents.set(kk, j); }
            }
          }
        }
      }
      const full = (1 << stops.length) - 1;
      const choices = [];
      stops.forEach((node, j) => { if (dp.has(k2(full, j)) && leg(node, end)) choices.push([dp.get(k2(full, j)) + leg(node, end).minutes, j]); });
      if (!choices.length) throw new Error('No checkpoint order reaches the destination');
      let [, j] = choices.reduce((m, c) => (c[0] < m[0] || (c[0] === m[0] && c[1] < m[1]) ? c : m));
      const reverse = [];
      let mask = full;
      while (j !== null) {
        reverse.push(stops[j]);
        const prev = parents.get(k2(mask, j));
        mask ^= 1 << j;
        j = prev;
      }
      exactOrder = [start, ...reverse.reverse(), end];
    }
    const remaining = new Set(stops);
    const greedy = [start];
    while (remaining.size) {
      let nxt = null, nk = null;
      for (const n of remaining) {
        const l = leg(greedy[greedy.length - 1], n);
        const c = [l ? l.minutes : Infinity, n];
        if (nk === null || c[0] < nk[0] || (c[0] === nk[0] && c[1] < nk[1])) { nk = c; nxt = n; }
      }
      greedy.push(nxt);
      remaining.delete(nxt);
    }
    greedy.push(end);
    let best = (total(greedy) < total(baseline) ? greedy : baseline).slice();
    if (exactOrder !== null) best = exactOrder;
    let improved = true;
    while (improved) {
      improved = false;
      let bestCost = total(best);
      for (let i = 1; i < best.length - 2; i++) {
        for (let j = i + 1; j < best.length - 1; j++) {
          const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
          const cost = total(candidate);
          if (cost < bestCost - 1e-9) { best = candidate; bestCost = cost; improved = true; }
        }
      }
    }
    const assemble = order => {
      const legs = order.slice(0, -1).map((a, i) => leg(a, order[i + 1]));
      let length = 0;
      for (const l of legs) length += l.length;
      return {order, minutes: total(order), length, edges: legs.flatMap(l => l.edges),
        nodes: [...legs[0].nodes, ...legs.slice(1).flatMap(l => l.nodes.slice(1))]};
    };
    return [assemble(baseline), assemble(best)];
  }

  // ---------- geometry (projected metres) ----------
  const lineOf = g => (g.type === 'MultiLineString' ? g.coordinates[0] : g.coordinates);
  const bbox = pts => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0, y0, x1, y1];
  };
  const apart = (A, B, d) => B[0] - A[2] > d || A[0] - B[2] > d || B[1] - A[3] > d || A[1] - B[3] > d;
  /** Shapely-style distance from a line to a polygon: 0 when the line touches or enters it. */
  function lineToPolygon(line, ring) {
    if (line.some(p => F.inside(p, ring))) return 0;
    let best = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
      for (let j = 0; j < ring.length - 1; j++) {
        best = Math.min(best, F.segDist(line[i], line[i + 1], ring[j], ring[j + 1]));
        if (best === 0) return 0;
      }
    }
    return best;
  }
  const lineLength = line => { let s = 0; for (let i = 0; i < line.length - 1; i++) s += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]); return s; };

  /**
   * engine.build_graph: roads are GeoJSON features with id, alley_wd, walk_ok, access_ok, oneway, from_node, to_node.
   * buildings: [{feature, bldg_dens}]; hazards: building features to keep `clearance` metres away from.
   */
  function buildGraph(roads, buildings, hazards, {mode = 'Walking', speed, width, clearance = 8} = {}) {
    if (!['Walking', 'Fire engine'].includes(mode)) throw new Error('Choose walking or fire engine.');
    speed = speed ?? (mode === 'Walking' ? 4.5 : 15);
    width = width ?? (mode === 'Walking' ? 0.8 : 2.5);
    const number = (v, lo, hi, label) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${label} must be a number between ${lo} and ${hi}.`);
      return v;
    };
    number(speed, 0.1, 120, 'Travel speed'); number(width, 0.1, 20, 'Minimum road width'); number(clearance, 0, 100, 'Fire clearance');
    const project = ring => ring.map(F.UTM);
    const B = buildings.map(b => { const r = project(b.feature.geometry.coordinates[0]); return {r, box: bbox(r), dens: b.bldg_dens}; });
    const H = hazards.map(f => { const r = project(f.geometry.coordinates[0]); return {r, box: bbox(r)}; });
    const graph = new Network(), coords = new Map(), edges = new Map(), excluded = {width: 0, access: 0, fire: 0};
    for (const f of roads) {
      const p = f.properties, ident = p.id;
      const w = number(p.alley_wd, 0.1, 50, `Road ${ident} width`);
      if (w < width) { excluded.width++; continue; }
      const access = p[mode === 'Walking' ? 'walk_ok' : 'access_ok'];
      if (access !== 0 && access !== 1) throw new Error(`Road ${ident} needs an access value of 0 or 1.`);
      if (!access) { excluded.access++; continue; }
      const raw = lineOf(f.geometry), g = project(raw), gb = bbox(g);
      if (H.some(h => !apart(gb, h.box, clearance) && lineToPolygon(g, h.r) <= clearance)) { excluded.fire++; continue; }
      let a = String(p.from_node || ''), b = String(p.to_node || '');
      const length = lineLength(g);
      if (!a || !b || a === b || length <= 0) throw new Error(`Road ${ident} needs two different connected junction IDs.`);
      for (const [node, point, ll] of [[a, g[0], raw[0]], [b, g[g.length - 1], raw[raw.length - 1]]]) {
        if (coords.has(node) && Math.hypot(coords.get(node).xy[0] - point[0], coords.get(node).xy[1] - point[1]) > 2) {
          throw new Error(`Junction ${node} has conflicting positions. Connect road endpoints within 2 metres.`);
        }
        coords.set(node, {xy: point, lonlat: ll});
      }
      const densities = [];
      for (const x of B) if (!apart(gb, x.box, 20) && lineToPolygon(g, x.r) <= 20) densities.push(number(x.dens, 0, 1, 'Building density'));
      let dsum = 0;
      for (const d of densities) dsum += d;
      const density = densities.length ? dsum / densities.length : 0;
      const minutes = length / (speed * 1000 / 60) * (1 + 0.6 / w) * (1 + 0.5 * density);
      const oneway = mode === 'Fire engine' ? (p.oneway ?? 0) : 0;
      if (![-1, 0, 1].includes(oneway)) throw new Error('One-way value must be -1, 0 or 1.');
      if (oneway === -1) [a, b] = [b, a];
      graph.addEdge(a, b, minutes, length, ident, oneway === 0);
      edges.set(ident, f);
    }
    if (graph.adj.size < 2) throw new Error('No usable connected roads remain. Check mapped roads, width, access and fire exclusions.');
    return {graph, coords, edges, excluded};
  }

  /** engine.run_route: 'Evacuation' compares shortest distance with fastest; 'Checkpoints' compares entered order with optimised. */
  function route({graph, edges, excluded}, {purpose = 'Evacuation', start, end, checkpoints = []}) {
    start = String(start ?? ''); end = String(end ?? '');
    let baseline, optimized, method;
    if (purpose === 'Evacuation') {
      if (start === end) throw new Error('Evacuation needs different start and destination junctions.');
      const distance = new Network();
      for (const [a, links] of graph.adj) for (const [b, , length, e] of links) distance.addEdge(a, b, length, length, e, false);
      baseline = distance.shortest(start, end);
      let m = 0;
      baseline.nodes.slice(0, -1).forEach((a, i) => {
        const b = baseline.nodes[i + 1], e = baseline.edges[i];
        m += graph.adj.get(a).find(v => v[0] === b && v[3] === e)[1];
      });
      baseline.minutes = m;
      optimized = graph.shortest(start, end);
      method = 'Shortest distance baseline vs minimum modelled time';
    } else if (purpose === 'Checkpoints') {
      [baseline, optimized] = optimizeVisitOrder(graph, start, checkpoints.map(String), end);
      method = checkpoints.length <= 12 ? 'Exact checkpoint order (Held–Karp)' : 'Heuristic checkpoint order (nearest neighbour + 2-opt)';
    } else throw new Error('Choose evacuation or checkpoint routing.');
    for (const r of [baseline, optimized]) r.geometry = {type: 'FeatureCollection', features: r.edges.map(e => edges.get(e))};
    return {baseline, optimized, saved_minutes: Math.max(0, baseline.minutes - optimized.minutes), method, excluded};
  }

  const api = {Network, optimizeVisitOrder, buildGraph, route};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IgnisRouting = api;
})(globalThis);
