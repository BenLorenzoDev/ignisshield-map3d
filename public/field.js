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

  const api = {parsePoints, cleanWalk};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IgnisField = api;
})(globalThis);
