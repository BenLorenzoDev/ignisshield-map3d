// Presentation only: destination labels and spacing for representative group icons.
const IgnisEvacDisplay = (() => {
  function destinations(groups) {
    const points = new Map();
    for (const g of groups) {
      if (g.status !== 'safe' || !g.coords.length) continue;
      const at = g.coords.at(-1), key = at.join(',');
      if (!points.has(key)) points.set(key, {at, label: g.to === 'the main road' ? 'Main road exit' : (g.to || 'Route destination'), people: 0});
      points.get(key).people += g.people;
    }
    return [...points.values()];
  }
  function separate(points, spacing) {
    const cells = new Map(), kept = [];
    for (const p of points) {
      const x = Math.floor(p.x / spacing), y = Math.floor(p.y / spacing);
      let overlap = false;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const q of cells.get(`${x + dx},${y + dy}`) || []) {
          if (Math.abs(p.x - q.x) < spacing && Math.abs(p.y - q.y) < spacing) overlap = true;
        }
      }
      if (overlap) continue;
      const key = `${x},${y}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(p); kept.push(p.id);
    }
    return kept;
  }
  return {destinations, separate};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = IgnisEvacDisplay;
