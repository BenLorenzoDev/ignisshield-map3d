/* Field data: turn a recorded GPX walk (e.g. a Strava "Export Original") into clean walking lines.
 * Keeps only walking, splits where the phone lost GPS, thins standing-still scribbles, and drops every timestamp and
 * name, so what is stored shows where students walked but not when. */
(function (root) {
  const K = [111320 * Math.cos(10.51 * Math.PI / 180), 110540]; // metres per degree at Sitio Polo
  const dist = (a, b) => Math.hypot((a[0] - b[0]) * K[0], (a[1] - b[1]) * K[1]);

  function parsePoints(xml) {
    const pts = [];
    for (const m of xml.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
      const lat = /lat="([-\d.]+)"/.exec(m[1]), lon = /lon="([-\d.]+)"/.exec(m[1]), time = /<time>([^<]+)<\/time>/.exec(m[2]);
      if (lat && lon) pts.push({c: [+lon[1], +lat[1]], t: time ? Date.parse(time[1]) / 1000 : NaN});
    }
    return pts;
  }

  /**
   * @returns {{geometry, walkedOn, stats}} geometry = GeoJSON MultiLineString of walking lines.
   * Options: maxWalkKmh (faster = riding), gapS / jumpM (break the line), thinM (minimum spacing), minLineM.
   */
  function cleanWalk(xml, {maxWalkKmh = 9, gapS = 20, jumpM = 25, thinM = 3, minLineM = 15, windowS = 15} = {}) {
    const pts = parsePoints(xml);
    if (pts.length < 2) throw new Error('No track points found. Export the activity itself from Strava (Export Original or Export GPX).');
    if (pts.some(p => Number.isNaN(p.t))) throw new Error('This file has no times on its points: it is probably a Strava route, not the recorded walk. Export the activity instead.');
    // Speed over a sliding window, to tell walking from riding without being fooled by GPS jitter
    const speed = pts.map((p, i) => {
      let a = i, b = i;
      while (a > 0 && p.t - pts[a - 1].t <= windowS) a--;
      while (b < pts.length - 1 && pts[b + 1].t - p.t <= windowS) b++;
      let d = 0;
      for (let k = a + 1; k <= b; k++) d += dist(pts[k - 1].c, pts[k].c);
      const dt = pts[b].t - pts[a].t;
      return dt > 0 ? d / dt * 3.6 : 0;
    });
    const lines = [];
    let cur = [], riddenM = 0, gaps = 0, total = 0;
    const close = () => {
      let len = 0;
      for (let k = 1; k < cur.length; k++) len += dist(cur[k - 1], cur[k]);
      if (cur.length >= 2 && len >= minLineM) { lines.push(cur); total += len; }
      cur = [];
    };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], prev = pts[i - 1];
      if (speed[i] > maxWalkKmh) { if (prev) riddenM += dist(prev.c, p.c); close(); continue; }
      if (prev && (p.t - prev.t > gapS || dist(prev.c, p.c) > jumpM)) { gaps++; close(); }
      const last = cur[cur.length - 1];
      if (!last || dist(last, p.c) >= thinM) cur.push([+p.c[0].toFixed(6), +p.c[1].toFixed(6)]);
    }
    close();
    if (!lines.length) throw new Error('No walking found in this file.');
    const walkedOn = new Date((pts[0].t + 8 * 3600) * 1000).toISOString().slice(0, 10); // date in Philippine time
    return {
      geometry: {type: 'MultiLineString', coordinates: lines},
      walkedOn,
      stats: {points: pts.length, kept: lines.reduce((s, l) => s + l.length, 0), lines: lines.length,
        walkedKm: +(total / 1000).toFixed(2), riddenKm: +(riddenM / 1000).toFixed(2), gaps}
    };
  }

  // ---------- GPS walks -> escape paths ----------
  const toM = ([x, y]) => [x * K[0], y * K[1]];
  const toLL = ([x, y]) => [+(x / K[0]).toFixed(7), +(y / K[1]).toFixed(7)];
  function closest(p, segs) { // nearest point on any segment [[a, b], ...] (metres)
    let best = null;
    for (const [a, b] of segs) {
      if (Math.min(a[0], b[0]) - p[0] > 40 || p[0] - Math.max(a[0], b[0]) > 40 || Math.min(a[1], b[1]) - p[1] > 40 || p[1] - Math.max(a[1], b[1]) > 40) continue;
      const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
      const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L)) : 0;
      const q = [a[0] + t * vx, a[1] + t * vy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!best || d < best.d) best = {d, q};
    }
    return best ?? {d: Infinity};
  }
  function simplify(pts, tol) { // Douglas–Peucker
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    let far = 0, at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = closest(pts[i], [[a, b]]).d;
      if (d > far) { far = d; at = i; }
    }
    return far <= tol ? [a, b] : [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
  }
  /**
   * Turn walked GPS lines into paths for the network. Keeps only the parts more than `onM` metres from any road or
   * earlier path (so roads and alleys walked twice are not duplicated), smooths GPS wobble, and joins each end onto
   * the road or path it meets so routing can use it.
   * @param tracks  array of MultiLineString coordinates (lon/lat)
   * @param network array of existing lines (lon/lat coordinate arrays): roads and drawn paths
   * @returns array of LineString coordinate arrays (lon/lat)
   */
  function tracksToPaths(tracks, network, {onM = 6, joinM = 12, tol = 2.5, minLen = 12} = {}) {
    const segs = [];
    const addLine = line => { for (let i = 0; i < line.length - 1; i++) segs.push([line[i], line[i + 1]]); };
    for (const l of network) addLine(l.map(toM));
    const out = [];
    const finish = run => {
      if (run.length < 2) return;
      const s = simplify(run, tol);
      let len = 0;
      for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      if (len < minLen) return;
      out.push(s.map(toLL));
      addLine(s); // later walks along the same alley are treated as already mapped
    };
    for (const multi of tracks) for (const line of multi) {
      const pts = line.map(toM);
      let run = [];
      for (let i = 0; i < pts.length; i++) {
        const c = closest(pts[i], segs);
        if (c.d > onM) {
          if (!run.length && i > 0) { const s = closest(pts[i - 1], segs); if (s.d <= joinM) run.push(s.q); } // start on the road it left
          run.push(pts[i]);
        } else if (run.length) {
          if (c.d <= joinM) run.push(c.q); // end on the road it joins
          finish(run);
          run = [];
        }
      }
      finish(run);
    }
    return out;
  }

  const api = {parsePoints, cleanWalk, tracksToPaths};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IgnisField = api;
})(globalThis);
