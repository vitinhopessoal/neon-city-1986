export function validateWaypoint(point, bounds) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z) || !bounds) return null;
  if (point.x < bounds.minX || point.x > bounds.maxX || point.z < bounds.minZ || point.z > bounds.maxZ) return null;
  return { x: point.x, z: point.z };
}

export function waypointIndicator(point, origin, width, height, padding = 15) {
  const dx = point.x - origin.x, dy = point.y - origin.y;
  const inside = point.x >= padding && point.x <= width - padding && point.y >= padding && point.y <= height - padding;
  let t = 1;
  if (!inside) {
    const tx = dx > 0 ? (width - padding - origin.x) / dx : dx < 0 ? (padding - origin.x) / dx : Infinity;
    const ty = dy > 0 ? (height - padding - origin.y) / dy : dy < 0 ? (padding - origin.y) / dy : Infinity;
    t = Math.max(0, Math.min(tx, ty));
  }
  return { x: origin.x + dx * t, y: origin.y + dy * t, inside, angle: Math.atan2(dy, dx) + Math.PI / 2 };
}

export function formatMapDistance(metres) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2).replace('.', ',')} km` : `${Math.round(metres)} m`;
}

export function readWaypoint(mapId, bounds) {
  try { return validateWaypoint(JSON.parse(localStorage.getItem(`neoncity.waypoint.${mapId}`) || 'null'), bounds); } catch { return null; }
}

export function storeWaypoint(mapId, point) {
  try {
    const key = `neoncity.waypoint.${mapId}`;
    if (point) localStorage.setItem(key, JSON.stringify(point)); else localStorage.removeItem(key);
  } catch { /* A waypoint remains usable when browser storage is unavailable. */ }
}
