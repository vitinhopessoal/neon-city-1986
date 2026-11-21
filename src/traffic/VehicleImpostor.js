import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * LOD de distância para carros do trânsito: funde as malhas externas do
 * veículo (carroceria, vidros, rodas, luzes) numa única malha com cor por
 * vértice. Longe do jogador, o carro passa de ~20–28 draw calls (mais as de
 * sombra) para 1 (+1 de sombra), sem mudar silhueta, cores nem posição.
 * Detalhes pequenos (maçanetas, placa, retrovisores) e o interior ficam de fora.
 */
let MAT = null;
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

export function buildImpostor(v) {
  if (!MAT) MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.25 });
  const root = v.root;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const skip = new Set();
  for (const d of v.detail || []) d.traverse((o) => skip.add(o));
  const geos = [];
  root.traverse((o) => {
    if (!o.isMesh || skip.has(o) || !o.visible) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mat || mat.visible === false || mat === v.mats?.contactShadow) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    if (o.geometry.boundingSphere.radius < 0.12) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld));
    _c.copy(mat.color || _c.set(0xffffff));
    if (mat.emissive && (mat.emissiveIntensity ?? 0) > 0.4) _c.lerp(mat.emissive, 0.6);
    if (mat.transparent) _c.multiplyScalar(0.4);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  });
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, MAT);
  mesh.name = 'impostor';
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.visible = false;
  root.add(mesh);
  return mesh;
}

/** Liga/desliga o impostor (esconde/mostra os demais filhos da raiz). */
export function setImpostor(v, on) {
  if (!v.impostor || v._impOn === on) return;
  v._impOn = on;
  for (const c of v.root.children) {
    if (c === v.impostor) c.visible = on;
    else if (on) { c.userData._wasVisible = c.visible; c.visible = false; }
    else c.visible = c.userData._wasVisible ?? true;
  }
}
