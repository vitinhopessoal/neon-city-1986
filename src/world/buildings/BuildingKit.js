import * as THREE from 'three';
import { UNIT, cylinderSector, composeMatrix } from '../../render/StaticBatcher.js';

/**
 * Kit de construção procedural.
 * Trabalha no espaço local do edifício (frente voltada para +Z, chão em y=0)
 * e envia a geometria transformada ao StaticBatcher. Também converte
 * colisores locais para o espaço do mundo.
 */
const _local = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _v = new THREE.Vector3();
const DETAIL_OPTS = Object.freeze({ detail: true });

/** Executa fn com o kit em modo "detalhe" (LOD: sem sombra, oculto a distância). */
export function asDetail(kit, fn) {
  const prev = kit.detail;
  kit.detail = true;
  try { return fn(); } finally { kit.detail = prev; }
}

export class BuildingKit {
  constructor({ batcher, lib, collision, dynamicParent, signs }) {
    this.batcher = batcher;
    this.lib = lib;
    this.collision = collision;
    this.dynamicParent = dynamicParent;
    this.signs = signs;
    this.base = new THREE.Matrix4();
    this.ox = 0;
    this.oy = 0;
    this.oz = 0;
    this.rotY = 0;
    this.id = 'building';
    this.colliderIds = [];
    this.attachments = [];
  }

  begin({ id, x, y = 0, z, rotY = 0 }) {
    this.id = id;
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.rotY = rotY;
    this.cos = Math.cos(rotY);
    this.sin = Math.sin(rotY);
    composeMatrix(x, y, z, 0, rotY, 0, 1, 1, 1, this.base);
    this.colliderIds = [];
    this.attachments = [];
    return this;
  }

  end() {
    return { id: this.id, colliderIds: [...this.colliderIds], attachments: [...this.attachments] };
  }

  // ------------------------------------------------------------ primitivas

  _add(geom, mat, color, local, opts) {
    if (this.detail) opts = opts ? { ...opts, detail: true } : DETAIL_OPTS;
    _world.multiplyMatrices(this.base, local);
    this.batcher.add(geom, mat, _world, color, opts);
  }

  box(mat, color, cx, cy, cz, sx, sy, sz, ry = 0, opts = undefined, rx = 0, rz = 0) {
    composeMatrix(cx, cy, cz, rx, ry, rz, sx, sy, sz, _local);
    this._add(UNIT.box, mat, color, _local, opts);
  }

  /** Cilindro vertical (eixo Y). */
  cyl(mat, color, cx, cy, cz, r, h, { seg = 16, rx = 0, ry = 0, rz = 0, opts } = {}) {
    const g = seg <= 8 ? UNIT.cyl8 : seg >= 24 ? UNIT.cyl24 : UNIT.cyl;
    composeMatrix(cx, cy, cz, rx, ry, rz, r, h, r, _local);
    this._add(g, mat, color, _local, opts);
  }

  sphere(mat, color, cx, cy, cz, rx, ry, rz, opts) {
    composeMatrix(cx, cy, cz, 0, 0, 0, rx, ry, rz, _local);
    this._add(UNIT.sphere, mat, color, _local, opts);
  }

  /** Setor de cilindro com raio r, altura h. Ângulos no padrão do CylinderGeometry. */
  sector(mat, color, cx, cy, cz, r, h, thetaStart, thetaLength, seg = 10, opts) {
    composeMatrix(cx, cy, cz, 0, 0, 0, r, h, r, _local);
    this._add(cylinderSector(thetaStart, thetaLength, seg), mat, color, _local, opts);
  }

  geom(geometry, mat, color, cx, cy, cz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, opts) {
    composeMatrix(cx, cy, cz, rx, ry, rz, sx, sy, sz, _local);
    this._add(geometry, mat, color, _local, opts);
  }

  // ----------------------------------------------------------------- faces

  /**
   * Descreve uma face vertical de um volume centrado em (cx, cz) com meias
   * dimensões (hw, hd). side: 'front' | 'back' | 'left' | 'right'.
   */
  face(side, cx, cz, hw, hd) {
    switch (side) {
      case 'front': return { ox: cx, oz: cz + hd, ux: 1, uz: 0, nx: 0, nz: 1, ry: 0, half: hw };
      case 'back': return { ox: cx, oz: cz - hd, ux: -1, uz: 0, nx: 0, nz: -1, ry: Math.PI, half: hw };
      case 'right': return { ox: cx + hw, oz: cz, ux: 0, uz: -1, nx: 1, nz: 0, ry: Math.PI / 2, half: hd };
      case 'left': return { ox: cx - hw, oz: cz, ux: 0, uz: 1, nx: -1, nz: 0, ry: -Math.PI / 2, half: hd };
      default: throw new Error(side);
    }
  }

  /** Caixa encostada numa face: u (horizontal na face), v (altura do centro). */
  fbox(face, mat, color, u, v, w, h, depth, outset = 0, { rx = 0, rz = 0, opts } = {}) {
    const off = outset + depth / 2;
    const cx = face.ox + face.ux * u + face.nx * off;
    const cz = face.oz + face.uz * u + face.nz * off;
    this.box(mat, color, cx, v, cz, w, h, depth, face.ry, opts, rx, rz);
  }

  /** Cilindro com eixo perpendicular à face (janelas redondas, discos). */
  fdisc(face, mat, color, u, v, r, depth, outset = 0, seg = 24) {
    const off = outset + depth / 2;
    const cx = face.ox + face.ux * u + face.nx * off;
    const cz = face.oz + face.uz * u + face.nz * off;
    this.cyl(mat, color, cx, v, cz, r, depth, { seg, rx: Math.PI / 2, ry: face.ry });
  }

  /** Ponto local sobre a face (útil para letreiros/luzes). */
  facePoint(face, u, v, outset) {
    return {
      x: face.ox + face.ux * u + face.nx * outset,
      y: v,
      z: face.oz + face.uz * u + face.nz * outset,
    };
  }

  // -------------------------------------------------------------- colisões

  /** Colisor de caixa em coordenadas locais (centro e meias-extensões). */
  solid(cx, cz, hx, hz, minY, maxY, opts = {}, localRot = 0) {
    const wx = this.ox + cx * this.cos + cz * this.sin;
    const wz = this.oz - cx * this.sin + cz * this.cos;
    const c = this.collision.addBox({
      id: opts.id || `${this.id}_col${this.colliderIds.length}`,
      ownerId: this.id,
      cx: wx,
      cz: wz,
      hx,
      hz,
      rotation: this.rotY + localRot,
      minY: this.oy + minY,
      maxY: this.oy + maxY,
      ...opts,
    });
    this.colliderIds.push(c.id);
    return c;
  }

  solidCyl(cx, cz, r, minY, maxY, opts = {}) {
    const wx = this.ox + cx * this.cos + cz * this.sin;
    const wz = this.oz - cx * this.sin + cz * this.cos;
    const c = this.collision.addCylinder({
      id: opts.id || `${this.id}_col${this.colliderIds.length}`,
      ownerId: this.id,
      x: wx,
      z: wz,
      radius: r,
      minY: this.oy + minY,
      maxY: this.oy + maxY,
      ...opts,
    });
    this.colliderIds.push(c.id);
    return c;
  }

  /** Rampa caminhável em coordenadas locais (sobe ao longo de +X local). */
  ramp(cx, cz, hx, hz, y0, y1, localRot = 0, opts = {}) {
    const wx = this.ox + cx * this.cos + cz * this.sin;
    const wz = this.oz - cx * this.sin + cz * this.cos;
    const c = this.collision.addRamp({
      id: opts.id || `${this.id}_ramp${this.colliderIds.length}`,
      ownerId: this.id,
      cx: wx,
      cz: wz,
      hx,
      hz,
      rotation: this.rotY + localRot,
      y0: this.oy + y0,
      y1: this.oy + y1,
    });
    this.colliderIds.push(c.id);
    return c;
  }

  // ------------------------------------------------------ objetos dinâmicos

  /** Posiciona um Object3D no espaço local do edifício e o adiciona à cena. */
  attach(object, cx, cy, cz, ry = 0) {
    _v.set(cx, cy, cz).applyMatrix4(this.base);
    object.position.copy(_v);
    object.rotation.set(0, this.rotY + ry, 0);
    this.dynamicParent.add(object);
    this.attachments.push(object);
    return object;
  }

  /** Converte um ponto local em mundo. */
  toWorld(cx, cy, cz, out = new THREE.Vector3()) {
    return out.set(cx, cy, cz).applyMatrix4(this.base);
  }
}
