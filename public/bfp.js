/* Optional BFP fire-truck response (not part of the students' paper model).
 * The BFP receives the call `callMin` after ignition; the crew leaves the station `turnoutMin` later and drives on roads
 * a fire truck can use (fire-engine rules of IgnisShield-Web routing: width, access, one-way) at `speedKmh`,
 * avoiding streets beside burning buildings. It parks at the reachable road point closest to the fire but at least
 * `standoffM` from any flames, puts out up to `perMin` burning buildings a minute within `reachM` (nearest first) and
 * wets buildings within reach so they catch much less easily (`wetFactor`). When nothing burns within reach it drives
 * to the next part of the fire. It acts through FireModel's hook; the fire model itself is unchanged. */
(function (root) {
  const R = typeof module !== 'undefined' && module.exports ? require('./routing.js') : root.IgnisRouting;
  const K = [111320 * Math.cos(10.51 * Math.PI / 180), 110540];
  const toM = ([x, y]) => [x * K[0], y * K[1]];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const lineOf = g => (g.type === 'MultiLineString' ? g.coordinates[0] : g.coordinates);
  const DEFAULTS = {truckCount: 1, callMin: 3, turnoutMin: 1, speedKmh: 30, reachM: 60, perMin: 1, standoffM: 10, wetFactor: 0.25};
  const DEPARTURE_GAP_MIN = 0.1; // fleet assumption: six seconds between departures from the same station

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

  /** Road network and buildings for a batch of runs. station = [lon, lat]. */
  function prepare({features, densities, roads, paths = [], station, params = {}}) {
    const P = {...DEFAULTS, ...params};
    if (!Number.isInteger(P.truckCount) || P.truckCount < 1 || P.truckCount > 10) throw new Error('Number of fire trucks must be a whole number from 1 to 10.');
    const net = R.buildGraph(R.prepareNetwork(roads, paths), features.map((f, i) => ({feature: f, bldg_dens: densities[i]})), [],
      {mode: 'Fire engine', speed: P.speedKmh});
    const B = features.map(f => {
      const ring = f.geometry.coordinates[0], n = ring.length - 1;
      let x = 0, y = 0;
      for (let k = 0; k < n; k++) { x += ring[k][0]; y += ring[k][1]; }
      const c = [x / n, y / n], cm = toM(c);
      let rad = 0;
      for (let k = 0; k < n; k++) rad = Math.max(rad, dist(cm, toM(ring[k])));
      return {c, cm, rad};
    });
    const nodes = [...net.coords].map(([id, c]) => ({id, ll: c.lonlat, m: toM(c.lonlat)}));
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const sm = toM(station);
    const stationNode = nodes.reduce((b, n) => (!b || dist(n.m, sm) < dist(b.m, sm) ? n : b), null);
    // buildings beside each road (to close roads next to the fire)
    const edgeSamples = new Map();
    for (const [e, f] of net.edges) {
      const l = lineOf(f.geometry).map(toM), pts = [];
      for (let k = 0; k < l.length - 1; k++) {
        const n = Math.max(1, Math.ceil(dist(l[k], l[k + 1]) / 6));
        for (let s = 0; s <= n; s++) pts.push([l[k][0] + (l[k + 1][0] - l[k][0]) * s / n, l[k][1] + (l[k + 1][1] - l[k][1]) * s / n]);
      }
      edgeSamples.set(e, pts);
    }
    const edgeLine = (e, from) => { const f = net.edges.get(e), l = lineOf(f.geometry); return String(f.properties.from_node) === from ? l : l.slice().reverse(); };

    /** A fresh controller for one run (it keeps the truck's state and a timeline for the animation). */
    function createTruck(truckId, fleet) {
      const timeline = {truckId, station, stationNode: stationNode?.ll, drives: [], sprays: [], arrivals: [], extinguished: 0, notes: [], blocks: []};
      let at = null, freeAt = Infinity, dispatched = false, stuck = false;
      const burningNow = states => { const out = []; for (const [id, s] of states) if (s === 'burning') out.push(id); return out; };
      const edgeGap = (e, burning) => Math.min(...edgeSamples.get(e).map(p => Math.min(...burning.map(i => dist(p, B[i].cm) - B[i].rad))));
      function plan(from, minute, burning) {
        // roads closed within standoffM of flames; Dijkstra from the truck's position
        // All trucks see the same road closures for this model minute. Compute the expensive geometry once.
        const hazards = fleet.burning;
        const closed = fleet.closed ??= new Set([...net.edges.keys()].filter(e => hazards.length && edgeGap(e, hazards) < P.standoffM));
        const d = new Map([[from.id, 0]]), prev = new Map(), heap = new Heap();
        heap.push([0, from.id]);
        while (heap.size) {
          const [du, u] = heap.pop();
          if (du > d.get(u)) continue;
          for (const [v, w, , e] of net.graph.adj.get(u)) {
            if (closed.has(e)) continue;
            if (du + w < (d.get(v) ?? Infinity)) { d.set(v, du + w); prev.set(v, [u, e]); heap.push([du + w, v]); }
          }
        }
        // stand-by: reachable, at least standoffM from flames; closest to the fire, then quickest
        let best = null;
        for (const [id, t] of d) {
          const n = nodeById.get(id), gap = Math.min(...burning.map(i => dist(n.m, B[i].cm) - B[i].rad));
          if (gap < P.standoffM) continue;
          // Reserve separate road positions, including destinations of trucks still travelling.
          if (P.truckCount > 1 && [...fleet.parking].some(([other, point]) => other !== truckId && dist(n.m, point.m) < 8)) continue;
          const key = [Math.max(gap, P.standoffM), t];
          if (!best || key[0] < best.key[0] - 1 || (Math.abs(key[0] - best.key[0]) <= 1 && key[1] < best.key[1])) best = {id, key};
        }
        if (!best) return null;
        const coords = [nodeById.get(from.id).ll], times = [minute];
        const chain = [];
        for (let v = best.id; v !== from.id; v = prev.get(v)[0]) chain.unshift([prev.get(v)[0], v, prev.get(v)[1]]);
        let t = minute;
        for (const [u, v, e] of chain) {
          const w = net.graph.adj.get(u).find(x => x[0] === v && x[3] === e)[1], line = edgeLine(e, u);
          let total = 0;
          for (let k = 1; k < line.length; k++) total += dist(toM(line[k - 1]), toM(line[k]));
          let acc = 0;
          for (let k = 1; k < line.length; k++) { acc += dist(toM(line[k - 1]), toM(line[k])); coords.push(line[k]); times.push(t + (total ? w * acc / total : w)); }
          t += w;
        }
        // If already at the stand-by node, use an incident road tangent rather than an arbitrary north heading.
        const firstRoad = net.graph.adj.get(from.id)?.find(edge=>!closed.has(edge[3]));
        const tangent = firstRoad && edgeLine(firstRoad[3],from.id).find(p=>dist(toM(p),from.m)>0.01);
        return {to: nodeById.get(best.id), coords, times, arrive: t, gap: best.key[0], bearing:tangent?bearing(from.ll,tangent):0};
      }
      function drive(from, minute, burning) {
        const p = plan(from, minute, burning);
        if (!p) {
          stuck = P.truckCount === 1; // preserve the existing one-truck model; a fleet retries when a position opens
          freeAt = minute + 1;
          if (!timeline.blocks.length || timeline.blocks.at(-1).until !== undefined) {
            timeline.blocks.push({minute});
            timeline.notes.push(`Minute ${minute}: no open road or available stand-by position for truck ${truckId}.`);
          }
          return;
        }
        if (timeline.blocks.length && timeline.blocks.at(-1).until === undefined) timeline.blocks.at(-1).until = minute;
        if (at && p.to.id === at.id) { freeAt = minute + 2; return; } // already as close as the roads allow: wait, check again
        if (p.gap > P.reachM) timeline.notes.push(`Minute ${minute}: the nearest road the truck can use is ${Math.round(p.gap)} m from the flames, beyond hose reach.`);
        timeline.drives.push({truckId, coords: p.coords, times: p.times, bearing:p.bearing});
        timeline.arrivals.push({truckId, minute: p.arrive, at: p.to.ll, gap: p.gap});
        fleet.parking.set(truckId, p.to);
        at = p.to; freeAt = p.arrive;
      }
      function hook(minute, states) {
        if (!stationNode || stuck) return null;
        const burning = burningNow(states);
        if (!dispatched) {
          if (minute < P.callMin + P.turnoutMin) return null;
          dispatched = true;
          timeline.dispatch = minute + (truckId - 1) * DEPARTURE_GAP_MIN;
          if (!burning.length) return null;
          drive(stationNode, timeline.dispatch, burning);
          return null;
        }
        if (!at && P.truckCount > 1 && minute >= freeAt && burning.length) { drive(stationNode, minute, burning); return null; }
        if (!at || minute < freeAt) return null; // still driving
        const inReach = burning.filter(i => dist(at.m, B[i].cm) - B[i].rad <= P.reachM).sort((a, b) => dist(at.m, B[a].cm) - dist(at.m, B[b].cm));
        if (!inReach.length) {
          if (burning.length) drive(at, minute, burning); // move on to the next part of the fire
          return null;
        }
        const out = inReach.slice(0, P.perMin);
        for (const i of out) timeline.sprays.push({truckId, minute, at: at.ll, target: i});
        timeline.extinguished += out.length;
        const protect = new Map();
        for (let i = 0; i < B.length; i++) if (states.get(i) === 'safe' && dist(at.m, B[i].cm) - B[i].rad <= P.reachM) protect.set(i, P.wetFactor);
        return {extinguish: out, protect};
      }
      return {hook, timeline};
    }
    function create() {
      const fleet = {parking:new Map(), burning:[], closed:null};
      const trucks = Array.from({length:P.truckCount}, (_, i) => createTruck(i+1, fleet));
      const timeline = {station, stationNode:stationNode?.ll, truckCount:P.truckCount, params:{...P}, departureGapMin:DEPARTURE_GAP_MIN,
        trucks:trucks.map(t=>t.timeline), drives:[], sprays:[], arrivals:[], extinguished:0, notes:[]};
      function hook(minute, states) {
        fleet.burning = [...states].filter(([,s])=>s==='burning').map(([id])=>id); fleet.closed = null;
        const remaining = new Map(states), extinguish = [], protect = new Map();
        for (const truck of trucks) {
          const action = truck.hook(minute, remaining);
          for (const id of action?.extinguish ?? []) {
            // Reserve the target immediately: a second truck cannot claim the same building this minute.
            if (remaining.get(id) !== 'burning') continue;
            remaining.set(id, 'extinguished'); extinguish.push(id);
          }
          for (const [id, factor] of action?.protect ?? []) protect.set(id, Math.min(protect.get(id) ?? 1, factor));
        }
        timeline.drives = trucks.flatMap(t=>t.timeline.drives);
        timeline.sprays = trucks.flatMap(t=>t.timeline.sprays).sort((a,b)=>a.minute-b.minute||a.truckId-b.truckId);
        timeline.arrivals = trucks.flatMap(t=>t.timeline.arrivals).sort((a,b)=>a.minute-b.minute||a.truckId-b.truckId);
        timeline.extinguished = trucks.reduce((s,t)=>s+t.timeline.extinguished,0);
        timeline.notes = trucks.flatMap(t=>t.timeline.notes.map(note=>`Truck ${t.timeline.truckId}: ${note}`));
        const dispatches = trucks.map(t=>t.timeline.dispatch).filter(t=>t!==undefined);
        if (dispatches.length) timeline.dispatch = Math.min(...dispatches);
        return extinguish.length || protect.size ? {extinguish, protect} : null;
      }
      return {hook,timeline};
    }
    return {create, stationNode: stationNode?.ll, params: P};
  }

  /** Truck position at a (fractional) minute: [lon, lat] and whether it is driving, spraying or waiting. */
  const bearing = (a,b) => ((Math.atan2((b[0]-a[0])*K[0],(b[1]-a[1])*K[1])*180/Math.PI)%360+360)%360;
  function driveBearing(d, segment) {
    for (let k=Math.min(segment,d.coords.length-1);k>0;k--) if (dist(d.coords[k],d.coords[k-1])>1e-12) return bearing(d.coords[k-1],d.coords[k]);
    for (let k=1;k<d.coords.length;k++) if (dist(d.coords[k],d.coords[k-1])>1e-12) return bearing(d.coords[k-1],d.coords[k]);
    return d.bearing ?? 0;
  }
  function truckAt(tl, minute) {
    if (tl.trucks) tl = tl.trucks[0]; // legacy single-truck callers
    const blocked = tl.blocks?.some(b=>minute>=b.minute&&(b.until===undefined||minute<b.until));
    if (tl.dispatch === undefined || minute < tl.dispatch || !tl.drives.length) return {at: tl.stationNode ?? tl.station, state:blocked?'blocked':'station', bearing:0, deployed:false};
    for (const d of tl.drives) {
      const t = d.times;
      if (minute < t[0]) break;
      if (d.coords.length > 1 && minute < t[t.length - 1]) {
        let k = 1;
        while (k < t.length - 1 && t[k] < minute) k++;
        const a = d.coords[k - 1], b = d.coords[k], f = t[k] > t[k - 1] ? (minute - t[k - 1]) / (t[k] - t[k - 1]) : 1;
        return {at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], state: 'driving', dir: b[0] >= a[0] ? 1 : -1,
          bearing:driveBearing(d,k), deployed:true};
      }
    }
    const last = [...tl.drives].reverse().find(d => d.times[0] <= minute);
    if (!last) return {at:tl.stationNode??tl.station,state:blocked?'blocked':'station',bearing:0,deployed:false};
    const spraying = tl.sprays.some(s => s.minute <= minute && minute < s.minute + 1);
    return {at: last.coords[last.coords.length - 1], state: blocked?'blocked':spraying ? 'spraying' : 'standby', bearing:driveBearing(last,last.coords.length-1), deployed:true};
  }
  function trucksAt(timeline, minute) { return (timeline.trucks??[timeline]).map((tl,i)=>({truckId:tl.truckId??i+1,...truckAt(tl,minute)})); }

  const api = {prepare, truckAt, trucksAt, DEFAULTS, DEPARTURE_GAP_MIN};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IgnisBFP = api;
})(globalThis);
