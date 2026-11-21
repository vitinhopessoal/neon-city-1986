// Shortest reachable route on the actual sidewalk graph; never jump components.
export function sidewalkPath(nodes, start, end) {
  if (!nodes[start] || !nodes[end]) return null;
  const queue = [start], previous = new Map([[start, null]]);
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if (at === end) {
      const path = [];
      for (let n = at; n !== null; n = previous.get(n)) path.push(n);
      return path.reverse();
    }
    for (const link of nodes[at].links) if (!previous.has(link.to)) { previous.set(link.to, at); queue.push(link.to); }
  }
  return null;
}

export function laneRoute(start, target) {
  const queue = [start], previous = new Map([[start, null]]);
  for (let i = 0; i < queue.length; i++) {
    const segment = queue[i];
    if (segment === target) {
      const route = [];
      for (let at = target; at !== start;) { const connector = previous.get(at); route.push(connector); at = connector.from; }
      return route.reverse();
    }
    for (const connector of segment.out || []) if (connector.to && !previous.has(connector.to)) { previous.set(connector.to, connector); queue.push(connector.to); }
  }
  return null;
}
