/**
 * Máscara de água a partir do radar convertido (radar/atlas.png): no radar
 * original a água é azul-claro, a terra é verde/cinza/branco/areia e as ruas
 * são traços pretos. Um traço preto (ponte ou rua) assume a classe do pixel
 * colorido mais próximo, assim o entorno de uma ponte continua sendo mar.
 * Devolve isWater(x, z) ou null quando o radar não pode ser lido (Node, erro).
 */
export async function loadRadarWater(url, bounds, fetcher = fetch) {
  if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined' || !bounds) return null;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`radar: HTTP ${res.status}`);
  const image = await createImageBitmap(await res.blob());
  const w = image.width, h = image.height;
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  image.close?.();
  const rgba = ctx.getImageData(0, 0, w, h).data;
  // 0 terra, 1 água, 2 traço escuro (resolvido pelo vizinho colorido).
  const cls = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < cls.length; p++, i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    cls[p] = b > 220 && b > r + 60 && g > 170 ? 1 : r < 60 && g < 60 && b < 60 ? 2 : 0;
  }
  const resolve = (u, v) => {
    for (let radius = 1; radius <= 10; radius++) {
      let water = 0, land = 0;
      for (let dv = -radius; dv <= radius; dv++) {
        for (let du = -radius; du <= radius; du++) {
          if (Math.max(Math.abs(du), Math.abs(dv)) !== radius) continue;
          const uu = u + du, vv = v + dv;
          if (uu < 0 || vv < 0 || uu >= w || vv >= h) { water++; continue; }
          const c = cls[vv * w + uu];
          if (c === 1) water++; else if (c === 0) land++;
        }
      }
      if (water || land) return water > land;
    }
    return false;
  };
  const sx = w / (bounds.maxX - bounds.minX), sz = h / (bounds.maxZ - bounds.minZ);
  return (x, z) => {
    const u = Math.floor((x - bounds.minX) * sx), v = Math.floor((z - bounds.minZ) * sz);
    if (u < 0 || v < 0 || u >= w || v >= h) return true; // além do radar: oceano
    const c = cls[v * w + u];
    return c === 2 ? resolve(u, v) : c === 1;
  };
}
