import * as THREE from 'three';
import { InteriorBuilder, mat, glow } from '../interiors/InteriorKit.js';
import { BOATS } from './BoatDefinitions.js';

/**
 * Modelos procedurais originais das embarcações (casco em V gerado por seções,
 * convés, para-brisa, console, assentos, motor, luzes de navegação).
 * Geometria fundida por material (poucas chamadas de desenho por barco).
 * Frente = +Z local; bombordo (vermelho) = +X; boreste (verde) = −X.
 */

/** Casco em V: seções da popa (t=0) à proa (t=1). */
export function hullGeometry(L, W, top, draft, { sections = 14, deadrise = 0.55, bowStart = 0.55, sheer = 0.25, transom = 0.85 } = {}) {
  const P = [];
  const sec = [];
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const z = -L / 2 + t * L;
    const bt = Math.max(0, (t - bowStart) / (1 - bowStart));
    const hw = (W / 2) * (t < bowStart ? (transom + (1 - transom) * Math.min(1, t / 0.25)) : Math.sqrt(Math.max(0.002, 1 - bt * bt)));
    const keel = -draft + bt * bt * draft * 0.9;
    const chine = keel + (draft * deadrise) * (1 - bt * 0.4);
    const deck = top + bt * bt * sheer;
    sec.push([
      [hw, deck, z], [hw * 0.98, chine, z], [0, keel, z], [-hw * 0.98, chine, z], [-hw, deck, z],
    ]);
  }
  const quad = (a, b, c, d) => P.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < sections; i++) {
    const A = sec[i], B = sec[i + 1];
    for (let k = 0; k < 4; k++) quad(A[k], A[k + 1], B[k + 1], B[k]);
  }
  // Espelho de popa.
  const S = sec[0];
  for (let k = 1; k < 4; k++) P.push(...S[0], ...S[k + 1], ...S[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  // Garante normais para fora (o lado do casco pode ter sido gerado invertido).
  g.computeVertexNormals();
  return { geometry: g, sections: sec };
}

/** Convés plano acompanhando o contorno do casco. */
function deckGeometry(sec, inset = 0.06) {
  const P = [];
  for (let i = 0; i < sec.length - 1; i++) {
    const a = sec[i], b = sec[i + 1];
    const al = [a[0][0] - inset, a[0][1] - 0.02, a[0][2]], ar = [a[4][0] + inset, a[4][1] - 0.02, a[4][2]];
    const bl = [b[0][0] - inset, b[0][1] - 0.02, b[0][2]], br = [b[4][0] + inset, b[4][1] - 0.02, b[4][2]];
    P.push(...al, ...bl, ...br, ...al, ...br, ...ar);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  return g;
}

const C = {
  glass: () => mat(0x9fc6d8, 0.05, 0.2, { transparent: true, opacity: 0.45 }),
  chrome: () => mat(0xd6dde4, 0.18, 0.95),
  dark: () => mat(0x1f2329, 0.55, 0.2),
  cushion: (c = 0xf2ece2) => mat(c, 0.75),
  black: () => mat(0x111317, 0.6),
  teak: () => mat(0xa7794a, 0.8),
  canvas: (c = 0xe6e0d0) => mat(c, 0.9),
};

export class BoatFactory {
  constructor() {
    this.cache = new Map();
    this.stats = { built: 0 };
  }

  create(type, { id, color = null, name = null } = {}) {
    const spec = BOATS[type];
    if (!spec) throw new Error(`Barco desconhecido: ${type}`);
    const b = new InteriorBuilder();
    const L = spec.length, W = spec.width, F = spec.freeboard, D = spec.draft;
    const col = spec.colors;
    const hullMat = new THREE.MeshStandardMaterial({ color: color ?? col.hull, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide, flatShading: false });
    const { geometry, sections } = hullGeometry(L, W, F, D, type === 'jetski' ? { sections: 10, bowStart: 0.45, sheer: 0.1, transom: 0.75 } : type === 'yacht' ? { sheer: 0.45, bowStart: 0.6 } : {});
    const root = new THREE.Group();
    root.name = `boat_${id}`;
    root.rotation.order = 'YXZ';
    const hullMesh = new THREE.Mesh(geometry, hullMat);
    hullMesh.castShadow = true;
    root.add(hullMesh);
    // Faixa decorativa e linha d'água (antiincrustante escuro abaixo).
    const stripe = mat(col.stripe, 0.4);
    const bottom = mat(0x8a2a2a, 0.7);
    b.box(stripe, W / 2 + 0.005, F * 0.55, -L * 0.1, 0.02, 0.12, L * 0.6, { r: 0 });
    b.box(stripe, -W / 2 - 0.005, F * 0.55, -L * 0.1, 0.02, 0.12, L * 0.6, { r: 0 });
    void bottom;
    const deck = new THREE.Mesh(deckGeometry(sections), mat(col.deck, 0.8));
    root.add(deck);
    // Luzes de navegação (bombordo vermelho, boreste verde, branca de popa/mastro).
    const navY = F + 0.08;
    b.sphere(glow(0xff2a3a, 2.2), W * 0.42, navY, L * 0.28, 0.06, 8);
    b.sphere(glow(0x2aff7a, 2.2), -W * 0.42, navY, L * 0.28, 0.06, 8);
    b.sphere(glow(0xffffff, 2.0), 0, navY + 0.05, -L / 2 + 0.15, 0.06, 8);
    // Detalhes por modelo.
    const seat = { ...spec.seat };
    if (type === 'speedster') this._speedster(b, spec, col);
    else if (type === 'cruiser') this._cruiser(b, spec, col);
    else if (type === 'fisher') this._fisher(b, spec, col);
    else if (type === 'jetski') this._jetski(b, spec, col);
    else if (type === 'yacht') this._yacht(b, spec, col);
    else if (type === 'patrol') this._patrol(b, spec, col);
    if (type !== 'jetski') this._outboard(b, spec, type === 'yacht' || type === 'cruiser');
    const built = b.build();
    for (const m of built.group.children) m.castShadow = true;
    root.add(built.group);
    // Nome pintado na popa.
    if (typeof document !== 'undefined') {
      const tex = this._nameTexture(name || spec.name, col.stripe);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W * 0.8, 2.6), 0.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      plate.position.set(0, F * 0.55, -L / 2 - 0.02);
      plate.rotation.y = Math.PI;
      root.add(plate);
    }
    this.stats.built++;
    return { root, spec, type, seat, hullMat, triangles: built.triangles + geometry.attributes.position.count / 3 };
  }

  _nameTexture(text, color) {
    const key = `${text}|${color}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'italic bold 40px Trebuchet MS, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    g.fillText(text, 256, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, t);
    return t;
  }

  _outboard(b, s, inboard) {
    const z = -s.length / 2 - 0.25;
    if (inboard) {
      b.box(C.chrome(), 0, s.freeboard * 0.3, -s.length / 2 - 0.35, s.width * 0.7, 0.06, 0.7, { r: 0.02 }); // plataforma de banho
      b.cyl(C.dark(), 0.5, -s.draft - 0.05, -s.length / 2 + 0.3, 0.16, 0.16, 0.06, 8, { rx: Math.PI / 2 });
      b.cyl(C.dark(), -0.5, -s.draft - 0.05, -s.length / 2 + 0.3, 0.16, 0.16, 0.06, 8, { rx: Math.PI / 2 });
      return;
    }
    b.box(C.black(), 0, -0.55, z, 0.18, 0.7, 0.22, { r: 0.04 });
    b.box(C.black(), 0, 0.12, z - 0.05, 0.42, 0.55, 0.55, { r: 0.12 });
    b.box(mat(s.colors.stripe, 0.4), 0, 0.42, z - 0.05, 0.43, 0.06, 0.56, { r: 0.02 });
  }

  _windshield(b, s, z, w, h, y) {
    b._add(new THREE.BoxGeometry(w, h, 0.03), C.glass(), 0, y + h / 2, z, -0.55, 0, 0);
    b.box(C.chrome(), 0, y + h * 0.95, z - h * 0.3, w, 0.03, 0.03, { r: 0 });
  }

  _seat(b, x, y, z, w = 0.55, color = 0xf2ece2) {
    b.box(C.cushion(color), x, y, z, w, 0.16, 0.55, { r: 0.06 });
    b.box(C.cushion(color), x, y + 0.12, z - 0.27, w, 0.55, 0.14, { r: 0.06 });
  }

  _wheel(b, x, y, z) {
    b.cyl(C.black(), x, y, z, 0.17, 0.17, 0.03, 16, { rx: -1.0 });
    b.cyl(C.chrome(), x, y - 0.25, z + 0.1, 0.03, 0.03, 0.28, 6, { rx: -1.0 });
  }

  _speedster(b, s, col) {
    const F = s.freeboard;
    b.box(mat(col.deck, 0.8), 0, F - 0.35, -0.6, s.width - 0.5, 0.05, 3.4, { r: 0 }); // cockpit rebaixado
    this._seat(b, -0.45, F - 0.3, -0.6, 0.6, 0xa8d4ff);
    this._seat(b, 0.45, F - 0.3, -0.6, 0.6, 0xa8d4ff);
    b.box(C.cushion(0xa8d4ff), 0, F - 0.3, -2.3, s.width - 0.6, 0.35, 0.7, { r: 0.08 }); // banco de popa
    b.box(C.dark(), -0.45, F - 0.3, 0.25, 0.7, 0.55, 0.35, { r: 0.05 }); // painel
    this._wheel(b, -0.45, F + 0.38, 0.15);
    this._windshield(b, s, 0.55, s.width - 0.3, 0.45, F - 0.02);
    b.box(mat(col.stripe, 0.35), 0, F + 0.01, 1.8, 0.35, 0.02, 2.4, { r: 0 }); // faixa no convés de proa
    b.cyl(C.chrome(), 0, F, -1.6, 0.03, 0.03, 0.9, 6); // mastro curto (luz branca)
  }

  _cruiser(b, s, col) {
    const F = s.freeboard;
    // Cabine (proa) com vigias e para-brisa envolvente.
    b.box(mat(0xf6f8fa, 0.4), 0, F, 1.4, s.width - 0.7, 0.75, 3.2, { r: 0.18 });
    for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) b.box(C.glass(), sd * (s.width / 2 - 0.34), F + 0.38, 0.6 + k * 0.8, 0.02, 0.18, 0.4, { r: 0 });
    this._windshield(b, s, -0.3, s.width - 0.6, 0.55, F + 0.3);
    // Hardtop e cockpit.
    for (const sd of [-1, 1]) b.cyl(C.chrome(), sd * (s.width / 2 - 0.4), F, -1.2, 0.035, 0.035, 1.75, 6);
    b.box(mat(0xf6f8fa, 0.4), 0, F + 1.75, -0.8, s.width - 0.5, 0.1, 2.4, { r: 0.05 });
    b.box(mat(col.stripe, 0.4), 0, F + 1.72, -0.8, s.width - 0.48, 0.05, 2.42, { r: 0 });
    this._seat(b, -0.6, F, 0.4 - 0.9, 0.7, 0xd8eef4);
    b.box(C.dark(), -0.6, F, -0.2, 0.8, 0.85, 0.3, { r: 0.05 });
    this._wheel(b, -0.6, F + 0.95, -0.35);
    b.box(C.cushion(0xd8eef4), 0, F, -3.6, s.width - 0.6, 0.4, 0.8, { r: 0.1 }); // banco em U
    b.box(C.cushion(0xd8eef4), 1.0, F, -2.6, 0.5, 0.4, 1.6, { r: 0.1 });
    b.cyl(C.chrome(), 0, F + 1.85, -0.8, 0.025, 0.025, 0.6, 6); // antena
  }

  _fisher(b, s, col) {
    const F = s.freeboard;
    // Console central com T-top de lona.
    b.box(mat(0xf6f0d8, 0.5), 0, F - 0.3, -0.2, 0.9, 1.1, 0.8, { r: 0.08 });
    this._windshield(b, s, 0.25, 0.85, 0.35, F + 0.8);
    this._wheel(b, 0, F + 0.65, -0.62);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(C.chrome(), sx * 0.55, F - 0.3, -0.3 + sz * 0.6, 0.03, 0.03, 2.1, 6);
    b.box(C.canvas(0x2f8f55), 0, F + 1.8, -0.3, 1.5, 0.08, 1.7, { r: 0.04 });
    b.box(C.cushion(0xe8e2d0), 0, F - 0.3, -0.95, 0.9, 0.55, 0.45, { r: 0.06 }); // banco do leaning post
    // Viveiro, caixa de iscas e varas.
    b.box(mat(0xdfe8ee, 0.4), 0, F - 0.3, -2.6, 1.0, 0.55, 0.8, { r: 0.06 });
    for (let k = 0; k < 4; k++) b.cyl(C.black(), -0.7 + k * 0.45, F + 1.85, -1.1, 0.012, 0.008, 2.0, 5, { rx: -0.5 });
    b.box(C.teak(), 0, F - 0.3, 2.4, 1.2, 0.35, 0.9, { r: 0.04 }); // paiol de proa
    b.cyl(C.chrome(), 0, F + 1.88, -0.3, 0.02, 0.02, 0.7, 6);
  }

  _jetski(b, s, col) {
    const F = s.freeboard;
    b.box(C.black(), 0, F - 0.05, -0.35, 0.42, 0.22, 1.25, { r: 0.1 }); // selim
    b.box(mat(col.stripe, 0.35), 0, F - 0.02, 0.5, 0.75, 0.25, 0.55, { r: 0.14 }); // capô
    b.box(mat(col.stripe, 0.35), 0, F - 0.25, -0.35, 1.05, 0.04, 1.6, { r: 0.02 }); // plataformas dos pés
    b.cyl(C.chrome(), 0, F + 0.15, 0.58, 0.035, 0.035, 0.35, 6, { rx: -0.4 });
    b.box(C.black(), 0, F + 0.47, 0.5, 0.75, 0.05, 0.06, { r: 0.02 }); // guidão
    b.box(glow(0x45f3ff, 1.4), 0, F + 0.2, 0.8, 0.4, 0.05, 0.04, { r: 0 }); // filete neon
    b.box(C.dark(), 0, -0.1, -1.55, 0.25, 0.18, 0.18, { r: 0.04 }); // bocal da turbina
  }

  _yacht(b, s, col) {
    const F = s.freeboard, W = s.width;
    const white = mat(0xf8f8fa, 0.35);
    // Superestrutura em dois níveis, janelas escuras contínuas e flybridge.
    b.box(white, 0, F, -1.0, W - 1.0, 1.35, 8.5, { r: 0.25 });
    for (const sd of [-1, 1]) b.box(mat(0x1a2a3a, 0.08, 0.4), sd * (W / 2 - 0.49), F + 0.55, -0.6, 0.02, 0.55, 7.0, { r: 0 });
    b._add(new THREE.BoxGeometry(W - 1.1, 0.8, 0.03), mat(0x1a2a3a, 0.08, 0.4), 0, F + 0.9, 3.3, -0.7, 0, 0);
    b.box(white, 0, F + 1.35, -1.8, W - 1.6, 1.05, 5.2, { r: 0.22 });
    for (const sd of [-1, 1]) b.box(mat(0x1a2a3a, 0.08, 0.4), sd * (W / 2 - 0.79), F + 1.75, -1.6, 0.02, 0.4, 4.2, { r: 0 });
    b.box(mat(col.stripe, 0.4), 0, F + 2.4, -1.8, W - 1.5, 0.08, 5.3, { r: 0.02 });
    // Flybridge: console, assentos, guarda-corpo e radar.
    b.box(C.dark(), -0.7, F + 2.48, 1.5, 0.9, 0.75, 0.4, { r: 0.05 });
    this._wheel(b, -0.7, F + 3.3, 1.35);
    this._seat(b, -0.7, F + 2.48, 0.9, 0.7, 0xeae4d8);
    this._seat(b, 0.4, F + 2.48, 0.9, 0.7, 0xeae4d8);
    for (const sd of [-1, 1]) b.box(C.chrome(), sd * (W / 2 - 0.8), F + 3.25, -1.6, 0.03, 0.03, 5.0, { r: 0 });
    b.box(white, 0, F + 2.48, -3.0, 1.2, 1.6, 0.25, { r: 0.05 }); // mastro do radar
    b.box(C.dark(), 0, F + 4.15, -3.0, 1.4, 0.08, 0.2, { r: 0.02 });
    // Convés de proa com solário e popa com plataforma.
    b.box(C.cushion(0xeae4d8), 0, F, 5.2, 2.2, 0.18, 1.8, { r: 0.08 });
    b.box(C.teak(), 0, F - 0.02, -6.6, W - 0.6, 0.04, 2.6, { r: 0 });
    for (const sd of [-1, 1]) b.box(C.chrome(), sd * (W / 2 - 0.12), F + 0.85, 1.0, 0.03, 0.03, s.length * 0.8, { r: 0 });
    b.sphere(glow(0xffe2b0, 1.4), 0, F + 1.3, -5.4, 0.08, 8);
  }

  _patrol(b, s, col) {
    const F = s.freeboard;
    b.box(mat(0xf2f4f8, 0.4), 0, F, 0.3, 1.5, 1.4, 1.8, { r: 0.1 });
    this._windshield(b, s, 1.25, 1.4, 0.5, F + 0.9);
    b.box(mat(col.stripe, 0.4), 0, F + 1.4, 0.3, 1.6, 0.1, 1.9, { r: 0.04 });
    b.box(glow(0x4d8dff, 2.2), -0.4, F + 1.52, 0.3, 0.3, 0.12, 0.2, { r: 0.03 });
    b.box(glow(0xff3048, 2.2), 0.4, F + 1.52, 0.3, 0.3, 0.12, 0.2, { r: 0.03 });
    for (const sd of [-1, 1]) b.box(mat(0xffc93a, 0.6), sd * (s.width / 2 + 0.06), F * 0.35, 0, 0.12, 0.35, s.length * 0.75, { r: 0.08 }); // defensa
  }
}
