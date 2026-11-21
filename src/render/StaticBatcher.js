import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Agrupa geometria estática por (material, bloco espacial, sombra) e funde
 * tudo em poucos meshes. Isso reduz drasticamente as draw calls e mantém o
 * frustum culling eficiente (cada bloco tem sua própria bounding sphere).
 */
const _nm = new THREE.Matrix3();

/**
 * Após o primeiro envio à GPU, a cópia em CPU da geometria estática fundida
 * não é mais usada (colisões são separadas; esferas envolventes já calculadas).
 * Liberá-la reduz a memória do processo. Limitação: perda de contexto WebGL
 * exigiria recarregar a página (o mesmo vale para as texturas procedurais).
 */
function releaseArray() {
  this.array = null;
}
let _releasedBytes = 0;
export function staticCPUBytesReleased() {
  return _releasedBytes;
}
const _seqIndex = new Map();

/** Índice sequencial compartilhado (geometrias não indexadas com n vértices). */
function sequentialIndex(n) {
  let a = _seqIndex.get(n);
  if (!a) {
    const arr = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    a = new THREE.BufferAttribute(arr, 1);
    _seqIndex.set(n, a);
  }
  return a;
}

/** Array contíguo de um atributo (copia apenas se intercalado/normalizado). */
function plainArray(attr, itemSize) {
  if (!attr.isInterleavedBufferAttribute && attr.itemSize === itemSize && !attr.normalized) return attr.array;
  const out = new Float32Array(attr.count * itemSize);
  for (let i = 0; i < attr.count; i++) {
    out[i * itemSize] = attr.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
    if (itemSize > 3) out[i * itemSize + 3] = attr.getW(i);
  }
  return out;
}

export class StaticBatcher {
  constructor({ chunkSize = 140, detailDistance = 120, releaseCPUData = true } = {}) {
    this.chunkSize = chunkSize;
    this.releaseCPUData = releaseCPUData;
    // Detalhes finos (molduras, frisos, cobogós...): lotes próprios em blocos
    // menores, sem sombra, ocultados além de detailDistance (LOD de edifícios).
    this.detailDistance = detailDistance;
    this._groups = new Map();
    this._box = new THREE.Box3();
    this._center = new THREE.Vector3();
    this._color = new THREE.Color();
    this.itemCount = 0;
  }

  /**
   * @param {THREE.BufferGeometry} geometry  Geometria base (não é modificada).
   * @param {THREE.Material} material
   * @param {THREE.Matrix4} matrix  Transformação para o espaço do mundo.
   * @param {number|THREE.Color|null} color  Cor por vértice (para materiais vertexColors).
   * @param {{castShadow?:boolean, receiveShadow?:boolean, chunk?:string}} opts
   */
  add(geometry, material, matrix, color = null, opts = {}) {
    // Otimizado (Prompt 02): em vez de clone() + applyMatrix4(), transforma os
    // arrays diretamente e compartilha atributos somente-leitura (índice, UV e
    // cor originais) com a geometria de origem. O resultado fundido é idêntico.
    const src = geometry.attributes;
    const pa = src.position;
    const n = pa.count;
    const P = plainArray(pa, 3);
    const e = matrix.elements;
    const pos = new Float32Array(n * 3);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const x = P[j], y = P[j + 1], z = P[j + 2];
      const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      const tx = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
      const tz = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
      pos[j] = tx;
      pos[j + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
      pos[j + 2] = tz;
      if (tx < minX) minX = tx; if (tx > maxX) maxX = tx;
      if (tz < minZ) minZ = tz; if (tz > maxZ) maxZ = tz;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (src.normal) {
      const N = plainArray(src.normal, 3);
      const ne = _nm.getNormalMatrix(matrix).elements;
      const nrm = new Float32Array(n * 3);
      for (let j = 0; j < n * 3; j += 3) {
        const x = N[j], y = N[j + 1], z = N[j + 2];
        let nx = ne[0] * x + ne[3] * y + ne[6] * z;
        let ny = ne[1] * x + ne[4] * y + ne[7] * z;
        let nz = ne[2] * x + ne[5] * y + ne[8] * z;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nrm[j] = nx / len; nrm[j + 1] = ny / len; nrm[j + 2] = nz / len;
      }
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    }
    // UV: compartilhada quando não há recorte de atlas; uv' = uv * escala + deslocamento.
    if (src.uv && !opts.uvTile && !src.uv.isInterleavedBufferAttribute) {
      g.setAttribute('uv', src.uv);
    } else {
      const uv = new Float32Array(n * 2);
      if (src.uv) {
        const U = plainArray(src.uv, 2);
        const { su = 1, sv = 1, ou = 0, ov = 0 } = opts.uvTile || {};
        for (let j = 0; j < n * 2; j += 2) { uv[j] = U[j] * su + ou; uv[j + 1] = U[j + 1] * sv + ov; }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    // Cores por vértice já existentes são preservadas quando nenhuma cor é informada.
    const keepColor = material.vertexColors && (color === null || color === undefined) && !!src.color;
    if (keepColor) {
      g.setAttribute('color', src.color.isInterleavedBufferAttribute
        ? new THREE.BufferAttribute(plainArray(src.color, src.color.itemSize).slice(), src.color.itemSize)
        : src.color);
    } else if (material.vertexColors) {
      const c = this._color.set(color ?? 0xffffff);
      const arr = new Float32Array(n * 3);
      for (let j = 0; j < n * 3; j += 3) { arr[j] = c.r; arr[j + 1] = c.g; arr[j + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    g.setIndex(geometry.index ?? sequentialIndex(n));
    if (!src.normal) g.computeVertexNormals();

    let chunkKey = opts.chunk;
    const detail = !!opts.detail;
    if (!chunkKey) {
      const size = detail ? this.chunkSize / 2 : this.chunkSize;
      const cx = Math.floor((minX + maxX) / 2 / size);
      const cz = Math.floor((minZ + maxZ) / 2 / size);
      chunkKey = detail ? `d${cx},${cz}` : `${cx},${cz}`;
    }
    // Materiais rentes à fachada (vidros, pinturas no chão, emissivos) não projetam sombra.
    const cast = detail ? false : (opts.castShadow ?? !material.userData.noCastShadow);
    const receive = opts.receiveShadow ?? true;
    const key = `${material.uuid}|${chunkKey}|${cast ? 1 : 0}${receive ? 1 : 0}`;
    let group = this._groups.get(key);
    if (!group) {
      group = { material, cast, receive, geometries: [], chunkKey, detail };
      this._groups.set(key, group);
    }
    group.geometries.push(g);
    this.itemCount++;
  }

  /** Funde tudo e adiciona os meshes resultantes ao grupo informado. */
  build(parent, name = 'static') {
    const meshes = [];
    for (const group of this._groups.values()) {
      if (group.geometries.length === 0) continue;
      const merged = mergeGeometries(group.geometries, false);
      for (const g of group.geometries) g.dispose();
      group.geometries.length = 0;
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      if (this.releaseCPUData) {
        for (const a of Object.values(merged.attributes)) {
          a.onUpload(function () { _releasedBytes += this.array.byteLength; releaseArray.call(this); });
        }
        merged.index?.onUpload(function () { _releasedBytes += this.array.byteLength; releaseArray.call(this); });
      }
      const mesh = new THREE.Mesh(merged, group.material);
      mesh.name = `${name}:${group.chunkKey}`;
      mesh.castShadow = group.cast;
      mesh.receiveShadow = group.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (group.detail) mesh.userData.lodDistance = this.detailDistance;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this._groups.clear();
    return meshes;
  }
}

/** Recorte (coluna, linha) de um atlas com cols x rows células. */
export function atlasTile(col, row, cols, rows) {
  return { su: 1 / cols, sv: 1 / rows, ou: col / cols, ov: row / rows };
}

/** Geometrias unitárias reutilizadas (escaladas via matriz). */
export const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
  cyl24: new THREE.CylinderGeometry(1, 1, 1, 24, 1),
  sphere: new THREE.SphereGeometry(1, 16, 12),
  plane: new THREE.PlaneGeometry(1, 1),
};

const _cache = new Map();
/** Setor de cilindro (para cantos arredondados), cacheado por parâmetros. */
export function cylinderSector(thetaStart, thetaLength, segments = 10) {
  const key = `sector|${thetaStart.toFixed(4)}|${thetaLength.toFixed(4)}|${segments}`;
  let g = _cache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(1, 1, 1, segments, 1, false, thetaStart, thetaLength);
    _cache.set(key, g);
  }
  return g;
}

/** Plano horizontal (XZ) com UVs em escala de mundo (tile = metros por repetição). */
export function groundPlane(width, depth, tile = 4, segX = 1, segZ = 1) {
  const g = new THREE.PlaneGeometry(width, depth, segX, segZ);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * width) / tile, (uv.getY(i) * depth) / tile);
  }
  return g;
}

/** Caixa com UVs proporcionais ao tamanho de cada face (texturas repetidas). */
export function tiledBox(w, h, d, tileU, tileV) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // Ordem das faces: +x, -x, +y, -y, +z, -z (4 vértices cada).
  const dims = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = dims[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * fu) / tileU, (uv.getY(i) * fv) / tileV);
    }
  }
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Compõe uma matriz a partir de posição, rotação (Euler XYZ) e escala. */
export function composeMatrix(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, out = new THREE.Matrix4()) {
  _p.set(x, y, z);
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _s.set(sx, sy, sz);
  return out.compose(_p, _q, _s);
}

export { _m as tmpMatrix };
