/**
 * Leitor OBJ mínimo (somente dados: v / vt / vn / f). Não executa nada do
 * arquivo; apenas interpreta números. Produz uma malha indexada por "wedge"
 * (combinação única posição/uv) e um mapa wedge → posição soldada.
 */
import { readFileSync } from 'node:fs';

export function parseOBJ(path) {
  const text = readFileSync(path, 'utf8');
  const vRaw = [];
  const vtRaw = [];
  const faces = []; // [vi, ti, vi, ti, vi, ti]
  let start = 0;
  const n = text.length;
  while (start < n) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = n;
    const c0 = text.charCodeAt(start);
    const c1 = text.charCodeAt(start + 1);
    if (c0 === 118 /* v */) {
      const line = text.slice(start, end).trim();
      const parts = line.split(/\s+/);
      if (c1 === 32) vRaw.push(+parts[1], +parts[2], +parts[3]);
      else if (c1 === 116 /* t */) vtRaw.push(+parts[1], +parts[2]);
    } else if (c0 === 102 /* f */ && c1 === 32) {
      const parts = text.slice(start, end).trim().split(/\s+/).slice(1);
      const idx = parts.map((p) => {
        const [a, b] = p.split('/');
        return [parseInt(a, 10) - 1, b ? parseInt(b, 10) - 1 : -1];
      });
      for (let k = 1; k + 1 < idx.length; k++) faces.push(idx[0][0], idx[0][1], idx[k][0], idx[k][1], idx[k + 1][0], idx[k + 1][1]);
    }
    start = end + 1;
  }

  // Soldagem de posições idênticas (o conversor duplica vértices nas costuras de UV).
  const posKey = new Map();
  const vToP = new Int32Array(vRaw.length / 3);
  const P = [];
  for (let i = 0; i < vToP.length; i++) {
    const k = `${vRaw[i * 3].toFixed(6)},${vRaw[i * 3 + 1].toFixed(6)},${vRaw[i * 3 + 2].toFixed(6)}`;
    let id = posKey.get(k);
    if (id === undefined) {
      id = P.length / 3;
      posKey.set(k, id);
      P.push(vRaw[i * 3], vRaw[i * 3 + 1], vRaw[i * 3 + 2]);
    }
    vToP[i] = id;
  }

  // Wedges: (posição soldada, uv).
  const wKey = new Map();
  const wPos = [];
  const wUV = [];
  const tri = new Int32Array(faces.length / 2);
  for (let f = 0; f < faces.length; f += 2) {
    const p = vToP[faces[f]];
    const t = faces[f + 1];
    const u = t >= 0 ? vtRaw[t * 2] : 0;
    const v = t >= 0 ? vtRaw[t * 2 + 1] : 0;
    const k = `${p}|${u.toFixed(6)},${v.toFixed(6)}`;
    let id = wKey.get(k);
    if (id === undefined) {
      id = wPos.length;
      wKey.set(k, id);
      wPos.push(p);
      wUV.push(u, v);
    }
    tri[f / 2] = id;
  }

  return {
    positions: new Float64Array(P),
    wedgePos: Int32Array.from(wPos),
    wedgeUV: new Float64Array(wUV),
    tris: tri, // índices de wedge, 3 por triângulo
  };
}
