/* Candidate alley network for local review. Never saves or replaces the captured GPS tracks. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const Field = node ? require('./field.js') : root.IgnisField;
  const Space = node ? require('./walk-space.js') : root.IgnisWalkSpace;
  const K = [111320 * Math.cos(10.51 * Math.PI / 180), 110540];
  const length = (a, b) => Math.hypot((a[0] - b[0]) * K[0], (a[1] - b[1]) * K[1]);
  function joinCrossings(paths, roads) {
    const lines = paths.map(f => f.geometry.coordinates), cuts = paths.map(() => []);
    const all = [...lines, ...roads.map(f => f.geometry.type === 'MultiLineString' ? f.geometry.coordinates[0] : f.geometry.coordinates)];
    const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
    for (let i = 0; i < lines.length; i++) for (let j = i; j < all.length; j++) {
      for (let a = 0; a < lines[i].length - 1; a++) for (let b = 0; b < all[j].length - 1; b++) {
        if (i === j && b <= a + 1) continue;
        const p = lines[i][a], q = all[j][b], r = p.map((v, k) => (lines[i][a + 1][k] - v) * K[k]), s = q.map((v, k) => (all[j][b + 1][k] - v) * K[k]);
        const den = cross(r, s); if (Math.abs(den) < 1e-8) continue;
        const d = q.map((v, k) => (v - p[k]) * K[k]), t = cross(d, s) / den, u = cross(d, r) / den;
        if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) continue;
        const point = p.map((v, k) => v + r[k] * Math.max(0, Math.min(1, t)) / K[k]);
        if (a + t > 1e-7 && a + t < lines[i].length - 1 - 1e-7) cuts[i].push({at: a + t, point});
        if (j < lines.length && b + u > 1e-7 && b + u < all[j].length - 1 - 1e-7) cuts[j].push({at: b + u, point});
      }
    }
    return paths.flatMap((f, i) => {
      const line = lines[i], sorted = cuts[i].sort((a, b) => a.at - b.at).filter((v, k, a) => !k || Math.abs(v.at - a[k - 1].at) > 1e-6);
      if (!sorted.length) return [f];
      const out = []; let start = 0, point = line[0];
      for (const cut of [...sorted, {at: line.length - 1, point: line.at(-1)}]) {
        const coords = [point];
        for (let k = Math.floor(start) + 1; k < cut.at; k++) coords.push(line[k]);
        coords.push(cut.point);
        if (coords.some((p, k) => k && length(coords[k - 1], p) > 0.01)) out.push({...f, properties: {...f.properties, id: `${f.properties.id}:junction-${out.length}`}, geometry: {type: 'LineString', coordinates: coords}});
        start = cut.at; point = cut.point;
      }
      return out;
    });
  }
  function prepare({features, obstacles = [], roads, paths, tracks, water}) {
    const ids = new Set(features.map(f => f.properties.id));
    const walkingSpace = Space.create([...features, ...obstacles.filter(f => !ids.has(f.properties.id))], water);
    const network = [...roads.map(f => f.geometry.type === 'MultiLineString' ? f.geometry.coordinates[0] : f.geometry.coordinates), ...paths.map(f => f.geometry.coordinates)];
    const candidates = Field.tracksToPaths(tracks.map(f => f.geometry.coordinates), network);
    const derived = [], stats = {walks: tracks.length, candidates: candidates.length, paths: 0, adjustedPoints: 0, detours: 0, unresolvedSegments: 0};
    for (const [index, line] of candidates.entries()) {
      let part = [], piece = 0;
      const finish = () => {
        if (part.length > 1) derived.push({type: 'Feature', geometry: {type: 'LineString', coordinates: part}, properties: {
          id: `survey-preview-${index}-${piece++}`, width_m: 1, access: 'walk', source: 'gps-preview', note: 'GPS-derived candidate; position and width need field review'
        }});
        part = [];
      };
      for (const original of line) {
        const p = walkingSpace.snap(original);
        if (!p) { stats.unresolvedSegments++; finish(); continue; }
        if (p !== original) stats.adjustedPoints++;
        if (!part.length) { part.push(p); continue; }
        const last = part.at(-1), distance = length(last, p);
        if (distance < 0.05) continue;
        const leg = walkingSpace.route(last, p, {maxLength: Math.min(200, distance + 30)});
        if (!leg) { stats.unresolvedSegments++; finish(); part.push(p); continue; }
        if (leg.length > 2) stats.detours++;
        part.push(...leg.slice(1));
      }
      finish();
    }
    const joined = joinCrossings([...paths, ...derived], roads), shown = joined.filter(f => f.properties.source === 'gps-preview');
    stats.paths = shown.length;
    return {walkingSpace, paths: joined, derived: shown, stats};
  }
  const api = {prepare, joinCrossings};
  if (node) module.exports = api; else root.IgnisSurveyPreview = api;
})(globalThis);
