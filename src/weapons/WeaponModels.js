import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Modelos 3D estilizados ("low-poly premium") das armas, gerados por código.
 *
 * São representações visuais da SILHUETA EXTERNA, para videogame: não têm
 * mecanismos internos, dimensões de fabricação nem peças funcionais. Cada
 * peça é um perfil lateral extrudado com chanfro (ExtrudeGeometry com
 * bevel), o que dá silhuetas reconhecíveis e arestas definidas sem depender
 * de caixas e cilindros soltos.
 *
 * Sistema local do modelo: +Z para a frente (cano), +Y para cima, origem
 * livre; `anchors.grip` marca o centro da empunhadura (palma da mão).
 * Peças animadas ficam em grupos próprios: slide/ferrolho, carregador, bomba.
 */

// ------------------------------------------------------------ materiais
let MATS = null;
export function weaponMaterials() {
  if (MATS) return MATS;
  const std = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  MATS = {
    blued: std(0x3d4452, 0.65, 0.34),
    black: std(0x33353b, 0.5, 0.42),
    parkerized: std(0x55565a, 0.4, 0.58),
    stainless: std(0xc3c8cf, 0.85, 0.27),
    satin: std(0x9298a1, 0.8, 0.42),
    polymer: std(0x2a2b30, 0.05, 0.7),
    rubber: std(0x1d1d21, 0.0, 0.9),
    walnut: std(0x74401f, 0.05, 0.55),
    walnutDark: std(0x4e2a14, 0.05, 0.6),
    furniture: std(0x3a3c40, 0.1, 0.62),
    brass: std(0xc9a24a, 0.9, 0.32),
    dot: std(0xfff3e0, 0.0, 0.4, { emissive: 0xfff0d8, emissiveIntensity: 0.6 }),
    neon: std(0xff4fb8, 0.0, 0.5, { emissive: 0xff4fb8, emissiveIntensity: 0.35 }),
  };
  return MATS;
}

// ------------------------------------------------------------- utilidades
const TAU = Math.PI * 2;

/** Pontos de um arco (centro z,y; raio; ângulos em rad). */
export function arc(cz, cy, r, a0, a1, n = 5) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

function shapeFrom(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/**
 * Construtor de modelos: acumula geometrias por (peça, material) e funde
 * tudo no final (poucas draw calls por arma).
 */
class GunBuilder {
  constructor() {
    this.parts = new Map(); // part -> Map(material -> [geo])
    this.current = 'body';
  }

  part(name) {
    this.current = name;
    return this;
  }

  _add(geo, mat) {
    let p = this.parts.get(this.current);
    if (!p) this.parts.set(this.current, (p = new Map()));
    let l = p.get(mat);
    if (!l) p.set(mat, (l = []));
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    l.push(g);
    return g;
  }

  /**
   * Perfil lateral (pontos [z, y]) extrudado na largura `w`, centrado em x.
   * bevel: chanfro das arestas (m).
   */
  side(mat, pts, w, { x = 0, bevel = 0.0016, holes = null } = {}) {
    const shape = shapeFrom(pts);
    if (holes) for (const h of holes) shape.holes.push(new THREE.Path(h.map(([a, b]) => new THREE.Vector2(a, b))));
    const depth = Math.max(0.0005, w - bevel * 2);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 1, curveSegments: 4,
    });
    // Forma no plano XY (x = z do modelo); extrusão em Z → largura em X.
    geo.rotateY(-Math.PI / 2);
    geo.translate(depth / 2 + x, 0, 0);
    geo.computeVertexNormals();
    return this._add(geo, mat);
  }

  /** Cilindro ao longo de Z (de z0 a z1). */
  tube(mat, r0, r1, z0, z1, { y = 0, x = 0, seg = 12, open = false } = {}) {
    const geo = new THREE.CylinderGeometry(r1, r0, z1 - z0, seg, 1, open);
    geo.rotateX(Math.PI / 2);
    geo.translate(x, y, (z0 + z1) / 2);
    return this._add(geo, mat);
  }

  /** Sólido de revolução ao longo de Z: perfil [[z, raio], ...]. */
  lathe(mat, prof, { y = 0, x = 0, seg = 12 } = {}) {
    const pts = prof.map(([z, r]) => new THREE.Vector2(r, z));
    const geo = new THREE.LatheGeometry(pts, seg);
    geo.rotateX(Math.PI / 2);
    geo.translate(x, y, 0);
    return this._add(geo, mat);
  }

  /** Bloco com chanfro (perfil retangular extrudado). */
  block(mat, z0, z1, y0, y1, w, opts = {}) {
    return this.side(mat, [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], w, opts);
  }

  build(name) {
    const root = new THREE.Group();
    root.name = name;
    const parts = {};
    let triangles = 0;
    for (const [part, byMat] of this.parts) {
      const group = part === 'body' ? root : new THREE.Group();
      if (part !== 'body') { group.name = part; root.add(group); parts[part] = group; }
      for (const [mat, geos] of byMat) {
        const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
        if (geos.length > 1) geos.forEach((g) => g.dispose());
        triangles += merged.attributes.position.count / 3;
        const m = new THREE.Mesh(merged, mat);
        m.castShadow = true;
        m.receiveShadow = false;
        group.add(m);
      }
    }
    return { root, parts, triangles };
  }
}

// ----------------------------------------------------------- peças comuns

/** Guarda-mato (anel com furo). */
function triggerGuard(B, mat, z0, z1, y0, y1, w, t = 0.0055, squared = true) {
  const outer = squared
    ? [[z0, y1], [z1, y1], [z1 + 0.004, y0 + 0.012], [z1 - 0.006, y0], [z0 + 0.008, y0], [z0, y0 + 0.01]]
    : [[z0, y1], [z1, y1], ...arc(z1 - 0.014, y0 + 0.014, 0.014, 0, -Math.PI / 2, 3), [z0 + 0.01, y0], [z0, y0 + 0.01]];
  const inner = [[z0 + t, y1 - 0.0005], [z0 + t, y0 + t + 0.006], [z0 + t + 0.004, y0 + t], [z1 - t - 0.004, y0 + t], [z1 - t, y0 + t + 0.008], [z1 - t, y1 - 0.0005]];
  B.side(mat, outer, w, { holes: [inner.reverse()] });
}

/** Gatilho curvo. */
function trigger(B, mat, z, y, h = 0.018) {
  B.side(mat, [[z, y], [z + 0.004, y], [z + 0.007, y - h * 0.55], [z + 0.004, y - h], [z + 0.001, y - h], [z + 0.002, y - h * 0.5]], 0.005, { bevel: 0.0008 });
}

/** Ranhuras decorativas (serrilhado) como filetes salientes finos. */
function serrations(B, mat, z0, z1, y0, y1, w, n) {
  const step = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const z = z0 + i * step;
    B.block(mat, z, z + step * 0.45, y0, y1, w, { bevel: 0.0004 });
  }
}

// ------------------------------------------------------------- pistolas

function pistol(def, style) {
  const M = weaponMaterials();
  const B = new GunBuilder();
  const S = style;
  const slideMat = M[S.slide], frameMat = M[S.frame], gripMat = M[S.grip];
  const yb = S.bore; // altura do eixo do cano
  const zr = S.rear, zf = S.front;

  // Armação: guarda-pó até a frente, cauda e empunhadura inclinada.
  B.part('body');
  B.side(frameMat, [
    [zr + 0.008, yb - 0.018], [zf - 0.004, yb - 0.018], [zf, yb - 0.022], [zf, yb - 0.034], [zf - 0.03, yb - 0.036],
    [0.062, yb - 0.036], [0.058, yb - 0.04], [-0.004, yb - 0.04],
    [-0.012, yb - 0.05], [-0.022 - S.gripRake * 0.6, yb - 0.1], [-0.028 - S.gripRake, yb - S.gripLen],
    [-0.072 - S.gripRake, yb - S.gripLen], [-0.07 - S.gripRake * 0.7, yb - 0.1], [-0.062, yb - 0.052],
    [zr + 0.01, yb - 0.03], [zr - 0.008, yb - 0.026], [zr - 0.004, yb - 0.018],
  ], S.frameW);
  // Painéis da empunhadura (material contrastante, levemente mais largos).
  B.side(gripMat, [
    [-0.016, yb - 0.054], [-0.025 - S.gripRake * 0.6, yb - 0.098], [-0.03 - S.gripRake * 0.9, yb - S.gripLen + 0.008],
    [-0.066 - S.gripRake * 0.9, yb - S.gripLen + 0.008], [-0.064 - S.gripRake * 0.65, yb - 0.098], [-0.058, yb - 0.054],
  ], S.frameW + 0.006, { bevel: 0.0022 });
  if (S.wrap) {
    // Empunhadura envolvente (peça única, frente arredondada).
    B.side(gripMat, [
      [-0.012, yb - 0.05], [-0.02 - S.gripRake * 0.6, yb - 0.1], [-0.026 - S.gripRake, yb - S.gripLen + 0.004],
      [-0.034 - S.gripRake, yb - S.gripLen + 0.004], [-0.03 - S.gripRake * 0.6, yb - 0.1], [-0.02, yb - 0.05],
    ], S.frameW + 0.004, { bevel: 0.002 });
  }
  triggerGuard(B, frameMat, -0.004, 0.06, yb - 0.072, yb - 0.04, S.frameW * 0.62, 0.0055, S.squareGuard);
  trigger(B, M.black, 0.018, yb - 0.042);
  // Cão (martelo) e retém.
  B.side(M.black, [[zr - 0.002, yb - 0.006], [zr + 0.006, yb - 0.006], [zr + 0.004, yb + 0.012], [zr - 0.006, yb + 0.016], [zr - 0.01, yb + 0.012]], 0.007, { bevel: 0.0008 });
  B.block(M.black, 0.02, 0.034, yb - 0.022, yb - 0.016, S.frameW + 0.004, { bevel: 0.0006 });

  // Ferrolho (slide): peça animada no recuo.
  B.part('slide');
  const top = yb + S.slideTop;
  B.side(slideMat, [
    [zr, yb - 0.017], [zf - S.nose, yb - 0.017], [zf, yb - 0.012], [zf, top - S.noseTop], [zf - S.nose * 1.4, top],
    [zr + 0.006, top], [zr, top - 0.006],
  ], S.slideW, { bevel: 0.002 });
  if (S.rib) B.block(slideMat, zr + 0.03, zf - 0.02, top - 0.0005, top + 0.003, 0.009, { bevel: 0.0008 });
  serrations(B, slideMat, zr + 0.006, zr + 0.034, yb - 0.012, top - 0.004, S.slideW + 0.0025, 6);
  // Miras: alça traseira e massa de mira (com ponto claro).
  B.side(M.black, [[zr + 0.006, top], [zr + 0.02, top], [zr + 0.019, top + 0.007], [zr + 0.008, top + 0.008]], S.slideW * 0.8, { bevel: 0.0006 });
  B.side(M.black, [[zf - 0.016, top], [zf - 0.006, top], [zf - 0.008, top + 0.0065], [zf - 0.014, top + 0.0065]], 0.004, { bevel: 0.0004 });
  B.block(M.dot, zf - 0.0125, zf - 0.009, top + 0.0045, top + 0.0062, 0.0042, { bevel: 0 });
  // Janela de ejeção (moldura escura).
  B.block(M.black, 0.004, 0.034, yb + 0.002, top - 0.006, S.slideW + 0.0015, { bevel: 0.0004 });
  // Boca do cano.
  B.tube(M.black, 0.0062, 0.0062, zf - 0.01, zf + 0.002, { y: yb, seg: 10 });

  // Carregador (base visível; sai pela empunhadura na recarga).
  B.part('mag');
  B.side(M.black, [
    [-0.03 - S.gripRake * 0.9, yb - S.gripLen - 0.006], [-0.07 - S.gripRake * 0.9, yb - S.gripLen - 0.006],
    [-0.068 - S.gripRake * 0.9, yb - S.gripLen + 0.012], [-0.032 - S.gripRake * 0.9, yb - S.gripLen + 0.012],
  ], S.frameW + 0.002, { bevel: 0.0015 });
  B.side(M.blued, [
    [-0.022 - S.gripRake * 0.6, yb - 0.06], [-0.03 - S.gripRake * 0.9, yb - S.gripLen + 0.012],
    [-0.062 - S.gripRake * 0.9, yb - S.gripLen + 0.012], [-0.054 - S.gripRake * 0.6, yb - 0.06],
  ], S.frameW - 0.008, { bevel: 0.0008 });

  const model = B.build(def.id);
  model.anchors = {
    grip: new THREE.Vector3(0, yb - 0.085, -0.042 - S.gripRake * 0.6),
    muzzle: new THREE.Vector3(0, yb, zf + 0.004),
    eject: new THREE.Vector3(-S.slideW / 2, yb + 0.006, 0.018),
    support: new THREE.Vector3(-0.012, yb - 0.095, -0.02 - S.gripRake * 0.6),
    sight: new THREE.Vector3(0, top + 0.007, zr + 0.012),
  };
  model.recoilTravel = 0.028;
  return model;
}

// ------------------------------------------------------------- escopeta

function ithaca(def) {
  const M = weaponMaterials();
  const B = new GunBuilder();
  const yb = 0.045;
  B.part('body');
  // Receptor: perfil arredondado embaixo, sem janela lateral (ejeção inferior).
  B.side(M.blued, [
    [-0.06, 0.004], [0.13, 0.004], [0.145, 0.016], [0.145, 0.068], [0.128, 0.074], [-0.04, 0.074], [-0.064, 0.06], [-0.07, 0.02],
  ], 0.04, { bevel: 0.0028 });
  B.block(M.black, -0.03, 0.12, 0.074, 0.078, 0.012, { bevel: 0.0008 }); // trilho/costela superior
  // Cano e tubo de munição.
  B.tube(M.blued, 0.0125, 0.0118, 0.14, 0.47, { y: yb, seg: 14 });
  B.tube(M.black, 0.0085, 0.0085, 0.462, 0.474, { y: yb, seg: 12 });
  B.tube(M.blued, 0.0105, 0.0105, 0.14, 0.43, { y: 0.017, seg: 12 });
  B.tube(M.blued, 0.012, 0.012, 0.42, 0.44, { y: 0.017, seg: 12 }); // tampa do tubo
  B.block(M.blued, 0.41, 0.44, 0.017, 0.045, 0.012, { bevel: 0.001 }); // braçadeira
  B.side(M.dot, [[0.455, yb + 0.012], [0.465, yb + 0.012], [0.463, yb + 0.018], [0.457, yb + 0.018]], 0.004, { bevel: 0.0005 });
  // Empunhadura de pistola em madeira (sem coronha: "Stakeout").
  B.side(M.walnut, [
    [-0.066, 0.02], [-0.02, 0.004], [-0.034, -0.03], [-0.07, -0.1], [-0.078, -0.118], [-0.118, -0.11],
    [-0.12, -0.096], [-0.094, -0.04], [-0.086, 0.01], [-0.075, 0.03],
  ], 0.036, { bevel: 0.004 });
  B.side(M.walnutDark, [[-0.07, -0.1], [-0.078, -0.118], [-0.118, -0.11], [-0.12, -0.096], [-0.1, -0.098]], 0.038, { bevel: 0.002 });
  triggerGuard(B, M.blued, 0.0, 0.072, -0.026, 0.004, 0.012, 0.006, false);
  trigger(B, M.black, 0.026, 0.003, 0.02);

  // Bomba (telha de madeira com sulcos), animada.
  B.part('pump');
  const ribs = [];
  for (let i = 0; i <= 10; i++) {
    const z = 0.19 + i * 0.016;
    ribs.push([z, i % 2 ? 0.026 : 0.0235]);
  }
  B.lathe(M.walnut, [[0.185, 0.011], [0.188, 0.022], ...ribs, [0.352, 0.022], [0.355, 0.011]], { y: 0.017, seg: 12 });
  B.part('body');

  const model = B.build(def.id);
  model.anchors = {
    grip: new THREE.Vector3(0, -0.05, -0.07),
    muzzle: new THREE.Vector3(0, yb, 0.476),
    eject: new THREE.Vector3(0, 0.0, 0.05),
    support: new THREE.Vector3(0, 0.012, 0.27),
    sight: new THREE.Vector3(0, 0.08, 0.0),
  };
  model.pumpTravel = 0.07;
  return model;
}

// ------------------------------------------------------ armas compactas

function macFamily(def, s) {
  const M = weaponMaterials();
  const B = new GunBuilder();
  const k = s.scale;
  const L = (v) => v * k;
  const mat = M[s.finish];
  B.part('body');
  // Receptor superior (estampado) e inferior.
  B.side(mat, [[L(-0.06), L(0.0)], [L(0.2), L(0.0)], [L(0.2), L(0.052)], [L(0.19), L(0.058)], [L(-0.05), L(0.058)], [L(-0.06), L(0.05)]], L(0.05), { bevel: 0.0022 });
  B.block(M.black, L(-0.045), L(0.185), L(0.016), L(0.022), L(0.052), { bevel: 0.0005 }); // linha da junção
  // Fenda do manejo no topo + botão de manejo.
  B.block(M.black, L(0.02), L(0.17), L(0.056), L(0.06), L(0.012), { bevel: 0.0004 });
  B.part('bolt');
  B.tube(M.black, L(0.008), L(0.008), L(0.12), L(0.135), { y: L(0.068), seg: 10 });
  B.block(mat, L(0.122), L(0.133), L(0.058), L(0.064), L(0.01), { bevel: 0.0006 });
  B.part('body');
  // Cano com rosca aparente.
  B.tube(M.blued, L(0.011), L(0.011), L(0.2), L(0.245), { y: L(0.03), seg: 12 });
  for (let i = 0; i < 4; i++) B.tube(M.black, L(0.0122), L(0.0122), L(0.205) + i * L(0.01), L(0.209) + i * L(0.01), { y: L(0.03), seg: 12 });
  // Empunhadura vertical (o carregador entra por ela) e guarda-mato.
  B.side(mat, [[L(-0.03), L(0.0)], [L(0.035), L(0.0)], [L(0.03), L(-0.11)], [L(-0.028), L(-0.11)], [L(-0.034), L(-0.02)]], L(0.04), { bevel: 0.002 });
  B.side(M.polymer, [[L(-0.026), L(-0.018)], [L(0.028), L(-0.018)], [L(0.025), L(-0.104)], [L(-0.024), L(-0.104)]], L(0.044), { bevel: 0.0015 });
  triggerGuard(B, mat, L(0.034), L(0.1), L(-0.04), L(0.0), 0.011, 0.006, true);
  trigger(B, M.black, L(0.052), L(-0.002), 0.018);
  // Alça frontal (correia curta).
  B.side(M.rubber, [[L(0.13), L(0.0)], [L(0.185), L(0.0)], [L(0.185), L(-0.03)], [L(0.13), L(-0.03)]], 0.008, { bevel: 0.001, holes: [[[L(0.137), L(-0.006)], [L(0.137), L(-0.024)], [L(0.178), L(-0.024)], [L(0.178), L(-0.006)]]] });
  // Placa da coronha (rebatida, apenas o suporte traseiro).
  B.block(mat, L(-0.072), L(-0.06), L(0.0), L(0.05), L(0.044), { bevel: 0.001 });
  B.tube(mat, L(0.004), L(0.004), L(-0.075), L(-0.062), { y: L(0.044), x: L(0.018), seg: 6 });
  B.tube(mat, L(0.004), L(0.004), L(-0.075), L(-0.062), { y: L(0.044), x: L(-0.018), seg: 6 });

  // Carregador longo saindo pela base da empunhadura.
  B.part('mag');
  const magBottom = L(-0.11) - s.magLen;
  B.side(M.black, [[L(-0.022), L(-0.1)], [L(0.024), L(-0.1)], [L(0.022), magBottom], [L(-0.02), magBottom]], L(0.034), { bevel: 0.0014 });
  B.block(mat, L(-0.025), L(0.027), magBottom - 0.006, magBottom, L(0.038), { bevel: 0.001 });

  const model = B.build(def.id);
  model.anchors = {
    grip: new THREE.Vector3(0, L(-0.055), L(0.0)),
    muzzle: new THREE.Vector3(0, L(0.03), L(0.248)),
    eject: new THREE.Vector3(L(-0.026), L(0.04), L(0.06)),
    support: new THREE.Vector3(0, L(-0.016), L(0.158)),
    sight: new THREE.Vector3(0, L(0.064), L(-0.03)),
  };
  model.boltTravel = L(0.05);
  return model;
}

function kg99(def) {
  const M = weaponMaterials();
  const B = new GunBuilder();
  const yb = 0.035;
  B.part('body');
  // Tubo do receptor e capa do cano ventilada (anéis alternados).
  B.lathe(M.black, [[-0.07, 0.0], [-0.07, 0.016], [-0.066, 0.02], [0.16, 0.02], [0.16, 0.0]], { y: yb, seg: 14 });
  const shroud = [];
  for (let i = 0; i <= 12; i++) shroud.push([0.16 + i * 0.0092, i % 2 ? 0.0225 : 0.0195]);
  B.lathe(M.parkerized, [[0.158, 0.0], [0.158, 0.021], ...shroud, [0.272, 0.019], [0.272, 0.0]], { y: yb, seg: 14 });
  B.tube(M.black, 0.0075, 0.0075, 0.272, 0.292, { y: yb, seg: 10 });
  // Armação inferior em polímero com empunhadura e encaixe do carregador à frente.
  B.side(M.polymer, [
    [-0.06, yb - 0.012], [0.135, yb - 0.012], [0.135, yb - 0.03], [0.108, yb - 0.04], [0.06, yb - 0.04], [0.06, yb - 0.048],
    [0.0, yb - 0.048], [-0.012, yb - 0.06], [-0.022, yb - 0.15], [-0.068, yb - 0.15], [-0.064, yb - 0.06], [-0.07, yb - 0.03],
  ], 0.036, { bevel: 0.0025 });
  B.side(M.rubber, [[-0.016, yb - 0.066], [-0.024, yb - 0.144], [-0.066, yb - 0.144], [-0.06, yb - 0.066]], 0.04, { bevel: 0.0018 });
  triggerGuard(B, M.polymer, -0.006, 0.058, yb - 0.08, yb - 0.046, 0.012, 0.006, false);
  trigger(B, M.black, 0.018, yb - 0.048);
  // Poço do carregador à frente do guarda-mato.
  B.block(M.polymer, 0.064, 0.106, yb - 0.075, yb - 0.035, 0.03, { bevel: 0.0018 });
  // Alavanca de manejo (lado esquerdo).
  B.part('bolt');
  B.tube(M.black, 0.005, 0.005, 0.0, 0.012, { y: yb + 0.006, x: 0.024, seg: 8 });
  B.block(M.black, -0.004, 0.016, yb + 0.002, yb + 0.01, 0.012, { x: 0.018, bevel: 0.0006 });
  B.part('mag');
  B.side(M.black, [[0.068, yb - 0.07], [0.102, yb - 0.07], [0.1, yb - 0.2], [0.07, yb - 0.2]], 0.024, { bevel: 0.0012 });
  B.block(M.black, 0.066, 0.104, yb - 0.206, yb - 0.198, 0.027, { bevel: 0.001 });
  B.part('body');
  // Miras simples.
  B.block(M.black, -0.04, -0.028, yb + 0.02, yb + 0.03, 0.014, { bevel: 0.0006 });
  B.block(M.black, 0.258, 0.264, yb + 0.022, yb + 0.031, 0.004, { bevel: 0.0004 });

  const model = B.build(def.id);
  model.anchors = {
    grip: new THREE.Vector3(0, yb - 0.1, -0.042),
    muzzle: new THREE.Vector3(0, yb, 0.294),
    eject: new THREE.Vector3(-0.022, yb + 0.006, 0.03),
    support: new THREE.Vector3(0, yb - 0.11, 0.085),
    sight: new THREE.Vector3(0, yb + 0.03, -0.034),
  };
  model.boltTravel = 0.04;
  return model;
}

// ------------------------------------------------------------- carabinas

function coltCarbine(def, s) {
  const M = weaponMaterials();
  const B = new GunBuilder();
  const yb = 0.025;
  const furn = M[s.furniture];
  B.part('body');
  // Receptor superior com alça de transporte (furo vazado).
  B.side(M.black, [[-0.1, yb - 0.022], [0.1, yb - 0.022], [0.104, yb + 0.012], [0.1, yb + 0.022], [-0.098, yb + 0.022], [-0.104, yb + 0.008]], 0.032, { bevel: 0.002 });
  B.side(M.black, [
    [-0.09, yb + 0.022], [0.056, yb + 0.022], [0.05, yb + 0.07], [-0.07, yb + 0.07], [-0.086, yb + 0.078], [-0.096, yb + 0.07],
  ], 0.022, { bevel: 0.002, holes: [[[-0.07, yb + 0.03], [-0.07, yb + 0.058], [0.04, yb + 0.058], [0.044, yb + 0.03]]] });
  // Receptor inferior, poço do carregador e guarda-mato.
  B.side(M.black, [[-0.1, yb - 0.022], [0.092, yb - 0.022], [0.092, yb - 0.05], [0.07, yb - 0.075], [0.004, yb - 0.075], [-0.002, yb - 0.05], [-0.1, yb - 0.05]], 0.03, { bevel: 0.002 });
  triggerGuard(B, M.black, -0.072, -0.004, yb - 0.08, yb - 0.05, 0.012, 0.005, true);
  trigger(B, M.black, -0.048, yb - 0.051, 0.02);
  // Empunhadura de pistola em polímero.
  B.side(furn, [[-0.078, yb - 0.05], [-0.06, yb - 0.05], [-0.07, yb - 0.09], [-0.088, yb - 0.15], [-0.122, yb - 0.148], [-0.108, yb - 0.09], [-0.104, yb - 0.05]], 0.03, { bevel: 0.003 });
  // Guarda-mão nervurado, anel e cano.
  const ribs = [];
  const hg1 = s.handguardEnd;
  const nR = Math.round((hg1 - 0.115) / 0.014);
  for (let i = 0; i <= nR; i++) ribs.push([0.115 + i * ((hg1 - 0.115) / nR), i % 2 ? 0.026 : 0.0235]);
  B.lathe(furn, [[0.104, 0.0], [0.104, 0.022], ...ribs, [hg1, 0.02], [hg1, 0.0]], { y: yb, seg: s.triangular ? 3 : 12 });
  B.tube(M.black, 0.03, 0.03, 0.1, 0.114, { y: yb, seg: 14 }); // anel delta
  B.tube(M.black, 0.0085, 0.0075, hg1, s.barrelEnd, { y: yb, seg: 10 });
  // Torre da massa de mira (triangular) e quebra-chamas.
  const fz = s.barrelEnd - 0.07;
  B.side(M.black, [[fz - 0.018, yb], [fz + 0.018, yb], [fz + 0.006, yb + 0.05], [fz - 0.006, yb + 0.05]], 0.012, { bevel: 0.0012, holes: [[[fz - 0.008, yb + 0.012], [fz - 0.003, yb + 0.034], [fz + 0.003, yb + 0.034], [fz + 0.008, yb + 0.012]]] });
  B.block(M.black, fz - 0.002, fz + 0.002, yb + 0.05, yb + 0.064, 0.003, { bevel: 0 });
  B.lathe(M.black, [[s.barrelEnd - 0.002, 0.0], [s.barrelEnd - 0.002, 0.011], [s.barrelEnd + 0.04, 0.011], [s.barrelEnd + 0.04, 0.006], [s.barrelEnd + 0.042, 0.0]], { y: yb, seg: 10 });
  // Coronha: retrátil (tubo + corpo curto) ou fixa (corpo longo).
  if (s.stock === 'collapsible') {
    B.tube(M.black, 0.0125, 0.0125, -0.27, -0.1, { y: yb - 0.004, seg: 10 });
    B.side(furn, [[-0.33, yb - 0.075], [-0.31, yb - 0.075], [-0.2, yb - 0.02], [-0.2, yb + 0.012], [-0.33, yb + 0.02]], 0.034, { bevel: 0.003 });
    B.block(M.rubber, -0.336, -0.33, yb - 0.078, yb + 0.022, 0.036, { bevel: 0.0015 });
  } else {
    B.side(furn, [[-0.42, yb - 0.09], [-0.36, yb - 0.08], [-0.12, yb - 0.035], [-0.1, yb - 0.035], [-0.1, yb + 0.014], [-0.42, yb + 0.022]], 0.036, { bevel: 0.0035 });
    B.block(M.rubber, -0.428, -0.42, yb - 0.092, yb + 0.024, 0.038, { bevel: 0.0015 });
  }
  // Alavanca de manejo (anima no fim da recarga).
  B.part('bolt');
  B.side(M.black, [[-0.11, yb + 0.012], [-0.094, yb + 0.012], [-0.094, yb + 0.02], [-0.11, yb + 0.022], [-0.116, yb + 0.018]], 0.03, { bevel: 0.001 });
  // Carregador (curvo ou reto).
  B.part('mag');
  const mb = yb - 0.075 - s.magLen;
  const curve = s.magCurve;
  B.side(M.black, [[0.012, yb - 0.06], [0.066, yb - 0.06], [0.066 + curve, mb + 0.004], [0.06 + curve, mb], [0.016 + curve * 0.8, mb], [0.012 + curve * 0.6, mb + 0.004]], 0.024, { bevel: 0.0014 });

  const model = B.build(def.id);
  model.anchors = {
    grip: new THREE.Vector3(0, yb - 0.1, -0.092),
    muzzle: new THREE.Vector3(0, yb, s.barrelEnd + 0.044),
    eject: new THREE.Vector3(-0.017, yb + 0.006, 0.02),
    support: new THREE.Vector3(0, yb - 0.012, (0.115 + hg1) / 2),
    sight: new THREE.Vector3(0, yb + 0.066, -0.06),
    stock: new THREE.Vector3(0, yb - 0.02, s.stock === 'collapsible' ? -0.33 : -0.42),
  };
  model.boltTravel = 0.03;
  return model;
}

// --------------------------------------------------------------- fábrica

const BUILDERS = {
  brenten: (d) => pistol(d, { slide: 'black', frame: 'black', grip: 'rubber', bore: 0.052, rear: -0.075, front: 0.135, slideTop: 0.02, slideW: 0.024, frameW: 0.028, nose: 0.004, noseTop: 0.003, gripRake: 0.022, gripLen: 0.158, squareGuard: true, rib: false }),
  sw645: (d) => pistol(d, { slide: 'stainless', frame: 'stainless', grip: 'polymer', bore: 0.05, rear: -0.078, front: 0.14, slideTop: 0.019, slideW: 0.025, frameW: 0.029, nose: 0.012, noseTop: 0.008, gripRake: 0.016, gripLen: 0.152, squareGuard: true, rib: true }),
  sw4503: (d) => pistol(d, { slide: 'stainless', frame: 'satin', grip: 'polymer', bore: 0.049, rear: -0.074, front: 0.116, slideTop: 0.018, slideW: 0.024, frameW: 0.028, nose: 0.009, noseTop: 0.006, gripRake: 0.012, gripLen: 0.148, squareGuard: false, rib: false, wrap: true }),
  ithaca37: (d) => ithaca(d),
  mac10: (d) => macFamily(d, { scale: 1, finish: 'parkerized', magLen: 0.1 }),
  mac11: (d) => macFamily(d, { scale: 0.82, finish: 'black', magLen: 0.07 }),
  kg99: (d) => kg99(d),
  colt653: (d) => coltCarbine(d, { furniture: 'polymer', stock: 'collapsible', handguardEnd: 0.27, barrelEnd: 0.4, triangular: false, magLen: 0.15, magCurve: 0.035 }),
  coltsporter: (d) => coltCarbine(d, { furniture: 'furniture', stock: 'fixed', handguardEnd: 0.31, barrelEnd: 0.47, triangular: false, magLen: 0.1, magCurve: 0.012 }),
};

/** Cria o modelo 3D de uma arma (geometria nova; materiais compartilhados). */
export function buildWeaponModel(def) {
  const b = BUILDERS[def.id];
  if (!b) throw new Error(`Sem modelo para a arma ${def.id}`);
  const model = b(def);
  model.root.userData.weaponId = def.id;
  return model;
}

/** Cópia leve (mesmas geometrias e materiais) para a vista em 1ª pessoa. */
export function cloneWeaponModel(model) {
  const root = model.root.clone(true);
  const parts = {};
  for (const name of Object.keys(model.parts)) parts[name] = root.getObjectByName(name);
  return { root, parts, anchors: model.anchors, triangles: model.triangles, recoilTravel: model.recoilTravel, pumpTravel: model.pumpTravel, boltTravel: model.boltTravel };
}

export const _internal = { TAU };
