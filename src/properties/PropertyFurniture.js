import * as THREE from 'three';
import { mat, glow } from '../interiors/InteriorKit.js';

/**
 * Móveis residenciais complementares ao kit de interiores (mesmo estilo
 * low-poly premium, materiais em cache compartilhados). Coordenadas locais
 * do interior: +Z = fachada, y = 0 no piso.
 */

/** Parede interna alinhada a um eixo, com vãos de porta [a, b] ao longo dela. */
export function partition(b, m, x0, z0, x1, z1, h, gaps = [], doorH = 2.2, t = 0.12) {
  const alongX = Math.abs(z1 - z0) < 1e-6;
  const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
  const a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
  const fixed = alongX ? z0 : x0;
  const seg = (a, c, y0, hh, collide) => {
    if (c - a < 0.02) return;
    const mid = (a + c) / 2, len = c - a;
    if (alongX) b.box(m, mid, y0, fixed, len, hh, t, { r: 0, collide });
    else b.box(m, fixed, y0, mid, t, hh, len, { r: 0, collide });
  };
  let cur = a0;
  for (const [ga, gb] of [...gaps].sort((p, q) => p[0] - q[0])) {
    seg(cur, ga, 0, h, true);
    seg(ga, gb, doorH, h - doorH, false);
    cur = gb;
  }
  seg(cur, a1, 0, h, true);
}

/** Cama com cabeceira em -Z local girada por ry. Retorna o ponto ao pé da cama (local). */
export function bed(b, x, z, ry = 0, { w = 1.4, l = 2.0, frame = mat(0x6b3b22, 0.6), sheet = mat(0xf4efe6, 0.75), blanket = mat(0x45c8b8, 0.8), pillows = 2 } = {}) {
  const s = Math.sin(ry), c = Math.cos(ry);
  const L = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  b.box(frame, x, 0, z, w + 0.08, 0.32, l + 0.06, { r: 0.03, ry, collide: true, block: false });
  b.box(sheet, x, 0.32, z, w, 0.2, l, { r: 0.06, ry });
  const [bx, bz] = L(0, l * 0.18);
  b.box(blanket, bx, 0.5, bz, w + 0.04, 0.06, l * 0.62, { r: 0.03, ry });
  const [hx, hz] = L(0, -l / 2 - 0.04);
  b.box(frame, hx, 0.3, hz, w + 0.14, 0.9, 0.08, { r: 0.03, ry });
  for (let k = 0; k < pillows; k++) {
    const [px, pz] = L((k - (pillows - 1) / 2) * (w / pillows), -l / 2 + 0.28);
    b.box(mat(0xffffff, 0.8), px, 0.52, pz, w / pillows - 0.12, 0.13, 0.36, { r: 0.06, ry });
  }
  return L(0, l / 2 + 0.55);
}

export function nightstand(b, x, z, ry = 0, lampColor = 0xffd8a0) {
  b.box(mat(0x6b3b22, 0.6), x, 0, z, 0.45, 0.52, 0.4, { r: 0.03, ry, collide: true });
  b.cyl(mat(0xe8dcc8, 0.6), x, 0.52, z, 0.05, 0.08, 0.28, 10);
  b.cyl(mat(0xf6efe0, 0.7), x, 0.8, z, 0.1, 0.16, 0.18, 12);
  b.sphere(glow(lampColor, 1.4), x, 0.86, z, 0.06, 8);
  b.pool(x, z, 0.9, lampColor);
}

/** Guarda-roupa de duas portas (frente para +Z local girada por ry). */
export function wardrobe(b, x, z, ry = 0, { w = 1.4, h = 2.0, d = 0.58, body = mat(0xc9a27a, 0.55), handles = mat(0xd9c58a, 0.3, 0.8) } = {}) {
  const s = Math.sin(ry), c = Math.cos(ry);
  b.box(body, x, 0, z, w, h, d, { r: 0.02, ry, collide: true });
  for (const k of [-1, 1]) {
    const lx = k * w / 4;
    b.box(mat(0xb08a62, 0.5), x + lx * c + (d / 2 + 0.005) * s, 0.08, z - lx * s + (d / 2 + 0.005) * c, w / 2 - 0.05, h - 0.16, 0.012, { r: 0, ry });
    const hx = k * 0.07;
    b.box(handles, x + hx * c + (d / 2 + 0.02) * s, 0.95, z - hx * s + (d / 2 + 0.02) * c, 0.02, 0.3, 0.02, { r: 0, ry });
  }
}

/** Armário de armazenamento (aço pintado, cadeado). */
export function locker(b, x, z, ry = 0, color = 0x3a4a6a) {
  const s = Math.sin(ry), c = Math.cos(ry);
  b.box(mat(color, 0.45, 0.45), x, 0, z, 0.9, 1.9, 0.5, { r: 0.02, ry, collide: true });
  for (let k = 0; k < 3; k++) b.box(mat(0x222831, 0.5), x + (0.255 * s), 1.45 + k * 0.08, z + 0.255 * c, 0.5, 0.025, 0.01, { r: 0, ry });
  b.box(mat(0xd9c58a, 0.3, 0.8), x + 0.26 * s + 0.3 * c, 0.95, z + 0.26 * c - 0.3 * s, 0.05, 0.12, 0.04, { r: 0, ry });
}

/** Bancada de cozinha ao longo de X local: armários, tampo, pia e fogão opcionais. */
export function kitchenRun(b, x, z, len, ry = 0, { sinkAt = null, stoveAt = null, body = mat(0xf2ece2, 0.55), top = mat(0x2a2b30, 0.3, 0.2), upper = true } = {}) {
  const s = Math.sin(ry), c = Math.cos(ry);
  const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  b.box(body, x, 0, z, len, 0.88, 0.6, { r: 0.02, ry, collide: true });
  b.box(top, x, 0.88, z, len + 0.04, 0.05, 0.64, { r: 0.01, ry });
  const nDoors = Math.max(1, Math.round(len / 0.6));
  for (let k = 0; k < nDoors; k++) {
    const [dx, dz] = P(-len / 2 + (k + 0.5) * (len / nDoors), 0.305);
    b.box(mat(0xd9d2c4, 0.5), dx, 0.1, dz, len / nDoors - 0.05, 0.7, 0.01, { r: 0, ry });
  }
  if (sinkAt !== null) {
    const [sx, sz] = P(sinkAt, 0);
    b.box(mat(0xc9cdd3, 0.2, 0.9), sx, 0.9, sz, 0.55, 0.03, 0.4, { r: 0.01, ry });
    const [fx, fz] = P(sinkAt, -0.22);
    b.cyl(mat(0xc9cdd3, 0.2, 0.9), fx, 0.93, fz, 0.015, 0.015, 0.28, 8);
  }
  if (stoveAt !== null) {
    for (const [ox, oz] of [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.12], [0.14, 0.12]]) {
      const [bx, bz] = P(stoveAt + ox, oz);
      b.cyl(mat(0x111114, 0.5), bx, 0.93, bz, 0.08, 0.08, 0.01, 12);
    }
  }
  if (upper) {
    const [ux, uz] = P(0, -0.12);
    b.box(body, ux, 1.45, uz, len, 0.7, 0.35, { r: 0.02, ry });
  }
}

export function toilet(b, x, z, ry = 0) {
  const s = Math.sin(ry), c = Math.cos(ry);
  b.box(mat(0xf4f4f6, 0.25, 0.05), x, 0, z, 0.38, 0.42, 0.5, { r: 0.08, ry, collide: true });
  b.box(mat(0xf4f4f6, 0.25, 0.05), x - 0.24 * s, 0.4, z - 0.24 * c, 0.42, 0.38, 0.18, { r: 0.04, ry });
}

export function bathSink(b, x, z, ry = 0) {
  const s = Math.sin(ry), c = Math.cos(ry);
  b.box(mat(0xe8e2d6, 0.4), x, 0, z, 0.6, 0.8, 0.45, { r: 0.03, ry, collide: true });
  b.box(mat(0xf4f4f6, 0.2, 0.05), x, 0.8, z, 0.5, 0.06, 0.38, { r: 0.04, ry });
  b.box(mat(0x9fb0c8, 0.05, 0.3, { emissive: 0x2a3350, emissiveIntensity: 0.4 }), x - 0.215 * s, 1.15, z - 0.215 * c, 0.55, 0.7, 0.02, { r: 0, ry });
}

/** Box de chuveiro (vidro + base) num canto. */
export function shower(b, x, z, w = 0.9, d = 0.9) {
  b.box(mat(0xe8eef4, 0.3), x, 0, z, w, 0.06, d, { r: 0.01 });
  b.box(mat(0x9fc6d8, 0.05, 0.1, { transparent: true, opacity: 0.32 }), x, 0.06, z + d / 2, w, 1.95, 0.02, { r: 0 });
  b.cyl(mat(0xc9cdd3, 0.2, 0.9), x, 1.9, z - d / 2 + 0.1, 0.07, 0.07, 0.03, 10);
  b.collider(x, z, w, d, 0, 2.0);
}

export function rug(b, x, z, w, d, color, border = 0xf2ece2) {
  b.box(mat(border, 0.95), x, 0.003, z, w, 0.006, d, { r: 0 });
  b.box(mat(color, 0.95), x, 0.008, z, w - 0.2, 0.004, d - 0.2, { r: 0 });
}

export function floorLamp(b, x, z, color = 0xffe2b8) {
  b.cyl(mat(0x2a2a2e, 0.4, 0.6), x, 0, z, 0.16, 0.18, 0.03, 12);
  b.cyl(mat(0x2a2a2e, 0.4, 0.6), x, 0.03, z, 0.015, 0.015, 1.45, 6);
  b.cyl(mat(0xf6efe0, 0.7), x, 1.4, z, 0.14, 0.22, 0.3, 12);
  b.sphere(glow(color, 1.6), x, 1.45, z, 0.08, 8);
  b.pool(x, z, 1.5, color);
  b.collider(x, z, 0.36, 0.36, 0, 1.7, { cameraBlocker: false });
}

/** Janela decorativa iluminada com persianas (parede interna/fundo). */
export function windowPanel(b, x, y, z, w, h, ry = 0, color = 0xffe8c8) {
  const s = Math.sin(ry), c = Math.cos(ry);
  b.panel(mat(0x222a33, 0.6, 0, { emissive: color, emissiveIntensity: 0.6 }), x, y, z, w, h, ry);
  for (let k = 0; k < Math.floor(h / 0.17); k++) b.box(mat(0xe9e2d4, 0.6), x + 0.03 * s, y - h / 2 + 0.08 + k * 0.17, z + 0.03 * c, w - 0.04, 0.025, 0.04, { r: 0, ry });
  b.box(mat(0xffffff, 0.5), x + 0.02 * s, y - h / 2 - 0.05, z + 0.02 * c, w + 0.12, 0.05, 0.12, { r: 0, ry });
}

/** Ventilador de teto com pás animadas (um grupo simples por ventilador). */
export function ceilingFan(ctx, x, h, z, speed = 3.2) {
  const g = new THREE.Group();
  g.position.set(x, h - 0.45, z);
  const metal = mat(0xd9c58a, 0.35, 0.7);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), metal);
  rod.position.y = 0.22;
  g.add(rod);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.12, 12), metal);
  g.add(hub);
  const blades = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.015, 0.13), mat(0x8a5a3c, 0.6));
    bl.position.set(Math.cos((k * Math.PI) / 2) * 0.4, -0.02, Math.sin((k * Math.PI) / 2) * 0.4);
    bl.rotation.y = -(k * Math.PI) / 2;
    blades.add(bl);
  }
  g.add(blades);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), glow(0xfff1d8, 1.8));
  bulb.position.y = -0.1;
  g.add(bulb);
  ctx.extras.push(g);
  ctx.updaters.push((dt) => { blades.rotation.y += dt * speed; });
  return g;
}

/** Vista pintada (horizonte urbano/marítimo) para janelas panorâmicas. */
export function viewTexture({ ocean = false, w = 1024, h = 384 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#2a1b5c'); sky.addColorStop(0.55, '#ff6f91'); sky.addColorStop(0.85, '#ffb36b'); sky.addColorStop(1, '#ffd08a');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(w * 0.72, h * (ocean ? 0.66 : 0.6), h * 0.12, 0, Math.PI * 2); g.fill();
  let rnd = 7;
  const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  if (ocean) {
    const sea = g.createLinearGradient(0, h * 0.68, 0, h);
    sea.addColorStop(0, '#3a6aa8'); sea.addColorStop(1, '#1b2f5c');
    g.fillStyle = sea; g.fillRect(0, h * 0.68, w, h * 0.32);
    g.fillStyle = 'rgba(255,220,170,0.6)';
    for (let k = 0; k < 40; k++) g.fillRect(w * 0.6 + r() * w * 0.25, h * 0.7 + r() * h * 0.25, 10 + r() * 30, 2);
    // Palmeiras em silhueta.
    g.fillStyle = '#1b0f2a';
    for (const px of [0.08, 0.18, 0.9]) {
      g.fillRect(w * px, h * 0.35, 6, h * 0.65);
      for (let a = 0; a < 6; a++) { g.save(); g.translate(w * px + 3, h * 0.35); g.rotate(-1.2 + a * 0.5); g.fillRect(0, -3, 70, 6); g.restore(); }
    }
  } else {
    for (let k = 0; k < 26; k++) {
      const bw = 30 + r() * 60, bh = h * (0.18 + r() * 0.5), bx = (k / 26) * w + r() * 20;
      g.fillStyle = k % 2 ? '#24183a' : '#2e1f48';
      g.fillRect(bx, h - bh, bw, bh);
      g.fillStyle = 'rgba(255,214,140,0.85)';
      for (let yy = h - bh + 8; yy < h - 6; yy += 12) for (let xx = bx + 5; xx < bx + bw - 6; xx += 10) if (r() < 0.35) g.fillRect(xx, yy, 5, 6);
      if (r() < 0.25) { g.fillStyle = r() < 0.5 ? '#ff4fd8' : '#45f3ff'; g.fillRect(bx + 4, h - bh + 4, bw - 8, 4); }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Janela panorâmica: vista + caixilhos. Plano voltado para +Z local girado por ry. */
export function panorama(ctx, b, x, y, z, w, h, ry = 0, opts = {}) {
  const tex = viewTexture(opts);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  ctx.extras.push(m);
  ctx.disposers = ctx.disposers || [];
  ctx.disposers.push(() => tex.dispose());
  const s = Math.sin(ry), c = Math.cos(ry);
  const frame = mat(0x2a2e34, 0.4, 0.6);
  const n = Math.max(2, Math.round(w / 1.6));
  for (let k = 0; k <= n; k++) {
    const lx = -w / 2 + (k / n) * w;
    b.box(frame, x + lx * c + 0.02 * s, y - h / 2, z - lx * s + 0.02 * c, 0.06, h, 0.06, { r: 0, ry });
  }
  b.box(frame, x + 0.02 * s, y - h / 2 - 0.04, z + 0.02 * c, w + 0.1, 0.08, 0.1, { r: 0, ry });
  b.box(frame, x + 0.02 * s, y + h / 2 - 0.04, z + 0.02 * c, w + 0.1, 0.08, 0.1, { r: 0, ry });
  return m;
}

/** Piscina decorativa: borda, água animada e colisor (não se entra nela). */
export function pool(ctx, b, x, z, w, d) {
  const coping = mat(0xf2ece2, 0.6);
  b.box(coping, x, 0, z - d / 2 - 0.15, w + 0.6, 0.14, 0.3, { r: 0.02 });
  b.box(coping, x, 0, z + d / 2 + 0.15, w + 0.6, 0.14, 0.3, { r: 0.02 });
  b.box(coping, x - w / 2 - 0.15, 0, z, 0.3, 0.14, d, { r: 0.02 });
  b.box(coping, x + w / 2 + 0.15, 0, z, 0.3, 0.14, d, { r: 0.02 });
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2fb7c9'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(220,255,255,0.55)'; g.lineWidth = 2;
  for (let k = 0; k < 14; k++) { g.beginPath(); const yy = (k * 128) / 14; g.moveTo(0, yy); for (let xx = 0; xx <= 128; xx += 16) g.lineTo(xx, yy + Math.sin(xx * 0.2 + k) * 4); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 2, d / 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, opacity: 0.92 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(x, 0.06, z);
  ctx.extras.push(water);
  ctx.updaters.push((dt, t) => { tex.offset.x = Math.sin(t * 0.3) * 0.1; tex.offset.y += dt * 0.03; });
  ctx.disposers = ctx.disposers || [];
  ctx.disposers.push(() => tex.dispose());
  b.collider(x, z, w + 0.6, d + 0.6, 0, 1.0);
  b.pool(x, z, Math.max(w, d) * 0.7, 0x7fe9ff);
}

export function lounger(b, x, z, ry = 0) {
  b.box(mat(0xffffff, 0.6), x, 0.25, z, 0.65, 0.1, 1.8, { r: 0.04, ry });
  b.box(mat(0x45c8b8, 0.7), x, 0.35, z, 0.6, 0.06, 1.75, { r: 0.03, ry });
  b.collider(x, z, 0.7, 1.9, 0, 0.5, { ry, cameraBlocker: false });
}

/** Mesa de jantar retangular com n cadeiras de cada lado (assentos registrados). */
export function diningSet(b, x, z, len, chairFn, { top = mat(0x6b3b22, 0.45), perSide = 2 } = {}) {
  b.box(top, x, 0.72, z, len, 0.05, 0.95, { r: 0.015 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(mat(0x3a2a22, 0.5), x + sx * (len / 2 - 0.08), 0, z + sz * 0.38, 0.06, 0.72, 0.06, { r: 0.01 });
  b.collider(x, z, len, 0.95, 0, 0.77);
  for (let k = 0; k < perSide; k++) {
    const cx = x - len / 2 + (k + 0.5) * (len / perSide);
    chairFn(cx, z - 0.75, 0);
    chairFn(cx, z + 0.75, Math.PI);
  }
}
