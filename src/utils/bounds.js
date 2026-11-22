/**
 * Limites jogáveis: retângulo simples {minX, maxX, minZ, maxZ} ou união de
 * retângulos (campo opcional `rects`), usada quando bairros não retangulares
 * se juntam (ex.: Sunset Beach + TEST CITY ligados por um corredor).
 *
 * `inset` > 0 encolhe cada retângulo (margem interna); < 0 aumenta.
 */
export function boundsContains(b, x, z, inset = 0) {
  if (!b) return true;
  const list = b.rects || [b];
  for (const r of list) {
    if (x > r.minX + inset && x < r.maxX - inset && z > r.minZ + inset && z < r.maxZ - inset) return true;
  }
  return false;
}

/** Retângulo envolvente de uma lista de retângulos, com a lista preservada em `rects`. */
export function unionBounds(rects) {
  const u = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const r of rects) {
    u.minX = Math.min(u.minX, r.minX); u.maxX = Math.max(u.maxX, r.maxX);
    u.minZ = Math.min(u.minZ, r.minZ); u.maxZ = Math.max(u.maxZ, r.maxZ);
  }
  u.rects = rects.map((r) => ({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ }));
  return u;
}
