import * as THREE from 'three';
import {
  mat, glow, table, chair, stool, booth, sofa, counter, register, lampPendant, ceilingPanel, shelfUnit,
  productInstances, fridge, crtTV, jukebox, plant, rack, textTexture,
} from './InteriorKit.js';
import { TRACKS } from './InteriorAudio.js';

/**
 * Estabelecimentos (marcas fictícias originais). Cada definição tem:
 * id, tipo, nome, prédio associado (buildingId), tamanho do interior (limitado
 * pela planta real), paleta, iluminação, áudio, horário, layout (móveis,
 * colisões, assentos, interações), NPCs, diálogos e itens à venda.
 *
 * Para criar um novo estabelecimento (delegacia, farmácia, cinema...), basta
 * acrescentar uma definição com um layout usando o kit — sem alterar o
 * InteriorManager.
 */

// ------------------------------------------------------------ utilidades
// Espelho estilizado: brilho frio próprio (não reflete o céu externo do mapa de ambiente).
const MIRROR = () => mat(0x7f8aa6, 0.08, 0.15, { emissive: 0x2a3350, emissiveIntensity: 0.5 });
const P = (floor, wall, ceiling, trim) => ({ floor: mat(floor, 0.7), wall: mat(wall, 0.85), ceiling: mat(ceiling, 0.9), trim: mat(trim, 0.5, 0.2) });

function extra(ctx, mesh) { ctx.extras.push(mesh); return mesh; }

function wallSign(ctx, tex, x, y, z, w, h, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return extra(ctx, m);
}

/** Página de compra genérica (comprar várias vezes; feedback no painel). */
function shopPage(api, who, intro, items, back = null) {
  const page = (msg) => ({
    who, text: msg,
    options: [
      ...items.map((it) => ({ label: `${it.label} — $${it.price}${it.note ? ` (${it.note})` : ''}`, run: () => page(api.buy(it).msg) })),
      back ? { label: 'Voltar', run: back } : { label: 'Sair', run: () => null },
    ],
  });
  return page(intro);
}

function infoPage(who, text, back) {
  return { who, text, options: [back ? { label: 'Voltar', run: back } : { label: 'Fechar', run: () => null }] };
}

// Uniforme: sobrescreve o visual aleatório (inclusive remove a saia de um sorteio "vestido").
const SKIN_STAFF = (top, pants = 0x24242a, extraLook = {}) => ({ top, sleeve: top, pants, thigh: pants, shin: pants, shoes: 0x1f1f22, skirt: undefined, ...extraLook });

function softTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Tela de TV de tubo animada (canvas compartilhado por todas as TVs do interior). */
export function tvScreen(ctx, kind = 'show') {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 96;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  let acc = 0, frame = 0;
  ctx.updaters.push((dt) => {
    acc += dt;
    if (acc < 0.12) return;
    acc = 0;
    frame++;
    if (kind === 'bars' && frame % 40 < 20) {
      ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f'].forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 18.3, 0, 19, 96); });
    } else {
      // Programa fictício: céu ao pôr do sol, palmeira e letreiro.
      const grd = g.createLinearGradient(0, 0, 0, 96);
      grd.addColorStop(0, '#2a1b5c'); grd.addColorStop(0.6, '#ff6f91'); grd.addColorStop(1, '#ffb36b');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 96);
      g.fillStyle = '#ffe06b'; g.beginPath(); g.arc(64 + Math.sin(frame * 0.05) * 30, 60, 14, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1b0f2a'; g.fillRect(20, 40, 4, 56);
      g.fillStyle = '#fff'; g.font = 'bold 12px monospace'; g.fillText(frame % 30 < 15 ? 'CANAL 86' : 'NEON NEWS', 6, 14);
    }
    // Linhas de varredura e chiado.
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < 96; y += 3) g.fillRect(0, y, 128, 1);
    tex.needsUpdate = true;
  });
  ctx.disposers = ctx.disposers || [];
  ctx.disposers.push(() => { tex.dispose(); material.dispose(); });
  return material;
}

/** Piso de dança com células iluminadas (uma draw call; cores animadas no ritmo). */
function danceFloor(ctx, cx, cz, nx, nz, size, palette, mode = 'wave') {
  const geo = new THREE.BoxGeometry(size * 0.94, 0.05, size * 0.94);
  const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), nx * nz);
  const mm = new THREE.Matrix4();
  const col = new THREE.Color();
  let i = 0;
  for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
    mm.makeTranslation(cx + (a - (nx - 1) / 2) * size, 0.025, cz + (b - (nz - 1) / 2) * size);
    m.setMatrixAt(i, mm);
    m.setColorAt(i, col.setHex(palette[i % palette.length]));
    i++;
  }
  extra(ctx, m);
  ctx.updaters.push((dt, t, mgr) => {
    const bpm = mgr.npcs.bpm || 120;
    const beat = (t * bpm) / 60;
    let k = 0;
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const v = mode === 'wave' ? Math.sin(beat * Math.PI + a * 0.7 + b * 0.5) : ((a + b + Math.floor(beat)) % 3 === 0 ? 1 : -0.6);
      const base = palette[(a * 3 + b * 5 + Math.floor(beat / 2)) % palette.length];
      col.setHex(base).multiplyScalar(0.25 + Math.max(0, v) * 1.1);
      m.setColorAt(k++, col);
    }
    m.instanceColor.needsUpdate = true;
  });
  return m;
}

/** Porta interna genérica (giratória, de correr ou de enrolar) com colisor próprio. */
export function innerDoor(b, ctx, { id, x, z, y = 0, w = 0.95, ry = 0, type = 'swing', label = 'PORTA', locked = false, lockedText = null, color = 0x6b3b22, glass = false }) {
  const pivot = new THREE.Group();
  const s = Math.sin(ry), c = Math.cos(ry);
  const hingeX = type === 'swing' ? x - (w / 2) * c : x;
  const hingeZ = type === 'swing' ? z + (w / 2) * s : z;
  pivot.position.set(hingeX, y, hingeZ);
  pivot.rotation.y = ry;
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, type === 'roll' ? 2.6 : 2.15, 0.05), glass ? mat(color, 0.05, 0.1, { transparent: true, opacity: 0.35 }) : mat(color, 0.55, type === 'roll' ? 0.5 : 0));
  leaf.position.set(type === 'swing' ? w / 2 : 0, type === 'roll' ? 1.3 : 1.075, 0);
  pivot.add(leaf);
  if (type === 'swing') {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat(0xd9c58a, 0.3, 0.8));
    knob.position.set(w - 0.1, 1.0, 0.05);
    pivot.add(knob);
  }
  extra(ctx, pivot);
  b.collider(x, z, w, 0.12, y, y + 2.2, { ry });
  const d = { id, x, y, z, w, type, obj: type === 'slide' ? leaf : pivot, base: type === 'swing' ? ry : type === 'slide' ? 0 : y, open: false, k: 0, label, locked, lockedText, collider: b.colliders[b.colliders.length - 1], dir: 1 };
  ctx.doors.push(d);
  return d;
}

/** Pequeno cômodo (banheiro, provador, escritório) com porta. */
function room(b, ctx, { x, z, y = 0, w, d, h, door, wallMat, label, fixtures }) {
  const t = 0.12;
  // Paredes: fundo usa a parede do prédio; frente tem a porta.
  b.box(wallMat, x - w / 2, y, z, t, h, d, { r: 0, collide: true });
  b.box(wallMat, x + w / 2, y, z, t, h, d, { r: 0, collide: true });
  const fz = z + d / 2;
  const dx = door ?? x;
  const left = dx - 0.5 - (x - w / 2), right = x + w / 2 - (dx + 0.5);
  if (left > 0.05) b.box(wallMat, x - w / 2 + left / 2, y, fz, left, h, t, { r: 0, collide: true });
  if (right > 0.05) b.box(wallMat, x + w / 2 - right / 2, y, fz, right, h, t, { r: 0, collide: true });
  b.box(wallMat, dx, y + 2.2, fz, 1.0, h - 2.2, t, { r: 0 });
  fixtures?.(b);
  return innerDoor(b, ctx, { id: label, x: dx, y, z: fz, w: 0.95, label });
}

// ======================================================================
// 01 — PIZZARIA SUNSET SLICE
// ======================================================================
const PIZZA_MENU = [
  { id: 'fatia', label: 'Fatia de pizza', price: 4, effect: { pickup: true, pickupHeal: 10 }, done: 'Saindo! Sua fatia está no balcão.' },
  { id: 'pizza_inteira', label: 'Pizza inteira "Sunset"', price: 14, effect: { pickup: true, pickupHeal: 30 }, done: 'Pizza no balcão, quentinha!' },
  { id: 'refri', label: 'Refrigerante de laranja', price: 2, effect: { heal: 3 } },
];

const pizzeria = {
  id: 'sunset_slice', type: 'pizzaria', name: 'SUNSET SLICE PIZZA', buildingId: 'bld_e_back_5',
  sign: { text: 'Sunset Slice', color: '#ff7a3d', style: 'script', sub: 'PIZZA', w: 2.4, h: 0.62 }, // abaixo do neon "Pizza" original
  size: { w: 13, d: 14, h: 3.6 }, hours: [11, 2], bell: true, doorColor: 0x2f7a5a,
  palette: P(0x8a3b2c, 0xf2e3c8, 0xf5efe6, 0x2f7a5a),
  windows: [{ x: -0.3, w: 3.0 }, { x: 0.3, w: 3.0 }],
  light: { sky: 0xffd2a0, ground: 0x6a3a2a, hemi: 0.95, exposure: 1.0, windowColor: 0xffb36b, poolStrength: 0.45, points: [{ x: 0, y: 3.0, z: 0.15, color: 0xffb36b, intensity: 10, distance: 12 }, { x: 0.15, y: 3.0, z: -0.3, color: 0xffd08a, intensity: 7, distance: 9 }] },
  audio: { track: null, ambience: 'pizza', radio: 'tropical' }, // rádio da casa (NEON RADIO NETWORK)
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    const counterZ = -D / 2 + 3.2;
    const len = W - 3.8, cx = -W / 2 + 1.2 + len / 2;
    counter(b, cx, counterZ, len, 0, { front: mat(0x2f7a5a, 0.55), top: mat(0x2a2b30, 0.3, 0.2), accent: glow(0xffb36b, 1.2) });
    const regX = cx - len / 2 + 1.0;
    register(b, regX, 1.05, counterZ - 0.05);
    for (let k = 0; k < 3; k++) {
      const px = cx + 0.6 + k * 0.9;
      b.cyl(mat(0xe2a13a, 0.6), px, 1.05, counterZ, 0.24, 0.24, 0.03, 16);
      b.cyl(mat(0xc8352a, 0.6), px, 1.075, counterZ, 0.21, 0.21, 0.01, 16);
      b.box(mat(0xf5f0e6, 0.4), px, 1.087, counterZ + 0.05, 0.05, 0.004, 0.18, { r: 0 });
    }
    // Cozinha: forno de lenha estilizado, bancada de preparo, geladeira.
    const ovenX = W / 2 - 2.0, ovenZ = -D / 2 + 0.9;
    b.box(mat(0xa3432c, 0.85), ovenX, 0, ovenZ, 2.0, 1.0, 1.4, { r: 0.05, collide: true });
    b.cyl(mat(0xb5523a, 0.85), ovenX, 1.0, ovenZ, 0.5, 0.95, 0.9, 16);
    b.cyl(mat(0x6b2c1e, 0.8), ovenX, 1.9, ovenZ, 0.15, 0.2, 1.4, 10);
    b.box(glow(0xff6a1f, 2.4), ovenX, 1.05, ovenZ + 0.7, 0.7, 0.42, 0.04, { r: 0.08 });
    b.pool(ovenX, ovenZ + 1.3, 1.6, 0xff7a2a);
    counter(b, -W / 2 + 2.6, -D / 2 + 0.45, 4.2, 0, { front: mat(0xd9d4cc, 0.4, 0.4), top: mat(0xeceae6, 0.3, 0.5) });
    for (let k = 0; k < 3; k++) b.cyl(mat(0xf0d9a8, 0.7), -W / 2 + 1.4 + k * 1.1, 1.05, -D / 2 + 0.45, 0.2, 0.2, 0.02, 14);
    fridge(b, -W / 2 + 0.55, counterZ - 1.2, Math.PI / 2, { w: 0.9 });
    // Geladeira de bebidas para clientes (lateral direita).
    fridge(b, W / 2 - 0.45, counterZ + 1.6, -Math.PI / 2);
    // Cardápio na parede do fundo.
    const menu = textTexture([['Fatia', '$4'], ['Pizza inteira "Sunset"', '$14'], ['Calzone da casa', '$9'], ['Refrigerante', '$2'], ['Sorvete', '$3']], { title: 'SUNSET SLICE', w: 512, h: 384, bg: '#2a1410', fg: '#ffe9c2', accent: '#ff7a3d' });
    wallSign(ctx, menu, cx, 2.55, -D / 2 + 0.03, 3.0, 2.25 * 0.75);
    const neon = textTexture([], { title: 'SLICE OF HEAVEN', w: 512, h: 128, bg: '#120a14', accent: '#ff4fb8' });
    wallSign(ctx, neon, -W / 2 + 0.03, 2.5, 0.5, 2.6, 0.65, Math.PI / 2);
    // Salão: cabines na parede esquerda; mesas redondas no restante.
    const front0 = counterZ + 2.0, front1 = D / 2 - 1.6;
    for (let z = front0 + 0.5; z < front1; z += 2.4) booth(b, -W / 2 + 1.0, z, Math.PI / 2, { uph: mat(0xc8344a, 0.55) });
    const tablesX = [];
    for (let x = -W / 2 + 4.2; x < W / 2 - 1.4; x += 2.6) if (Math.abs(x - ctx.doorX) > 1.9) tablesX.push(x);
    for (const x of tablesX) for (let z = front0 + 0.6; z < front1 - 0.2; z += 2.5) {
      table(b, x, z, { round: true, w: 0.85, top: mat(0xf4ede0, 0.35) });
      chair(b, x - 0.75, z, Math.PI / 2, { seat: mat(0x2f7a5a, 0.55) });
      chair(b, x + 0.75, z, -Math.PI / 2, { seat: mat(0x2f7a5a, 0.55) });
      lampPendant(b, x, H, z, 0xffcf8a, { shade: mat(0xc8344a, 0.5) });
    }
    ceilingPanel(b, cx, H, counterZ - 0.2, 2.2, 0.5, 0xfff1d8, 1.4);
    plant(b, W / 2 - 0.6, D / 2 - 0.7);
    ctx.spots = { regX, counterZ, ovenX, ovenZ, prepX: -W / 2 + 2.6, front0, front1 };
    ctx.pickupSpot = { x: regX + 0.7, y: 1.08, z: counterZ + 0.05 };
    b.interact({ id: 'atendente', x: regX, y: 1.1, z: counterZ + 0.85, label: 'FALAR COM A ATENDENTE', action: (api) => pizzaTalk(api) });
    b.interact({ id: 'cardapio', x: cx + 1.2, y: 1.2, z: counterZ + 0.85, label: 'CONSULTAR CARDÁPIO', action: () => infoPage('Cardápio', 'Fatia $4 · Pizza inteira "Sunset" $14 · Calzone $9 · Refrigerante $2 · Sorvete $3. Peça no caixa.') });
    b.interact({ id: 'geladeira', x: W / 2 - 1.2, y: 1.1, z: counterZ + 1.6, label: 'ABRIR GELADEIRA', action: (api) => { api.sfx('fridge'); return shopPage(api, 'Geladeira', 'Refrigerantes gelados. Pague direto no caixa automático da porta.', [PIZZA_MENU[2], { id: 'agua', label: 'Água mineral', price: 1, effect: { heal: 2 } }]); } });
  },
  npcs(inst) {
    const s = inst.ctx.spots;
    return [
      { role: 'attendant', name: 'Gina', behavior: 'stand', x: s.regX, z: s.counterZ - 0.8, yaw: 0, uniform: SKIN_STAFF(0xc8352a, 0x222228) },
      { role: 'cook', name: 'Tony', behavior: 'patrol', points: [[s.prepX, -inst.D / 2 + 1.25], [s.ovenX - 0.6, s.ovenZ + 1.2]], speed: 0.8, uniform: SKIN_STAFF(0xf2f2ee, 0x3a3a40) },
      { role: 'customer', behavior: 'talk', seat: 0 }, { role: 'customer', behavior: 'talk', seat: 1 },
      { role: 'customer', behavior: 'sit', seat: 5 }, { role: 'customer', behavior: 'talk', seat: 6 },
      { role: 'customer', behavior: 'patrol', points: [[inst.ext.doorX, inst.D / 2 - 1.6], [s.regX + 0.3, s.counterZ + 1.1], [inst.ext.doorX + 0.4, s.counterZ + 2.2]] },
    ];
  },
};

function pizzaTalk(api) {
  const who = 'Gina (atendente)';
  const root = () => ({
    who, text: 'Bem-vindo ao Sunset Slice! Massa fina, forno a lenha e o melhor pôr do sol da Coral Street. O que vai querer?',
    options: [
      { label: 'Ver o cardápio e pedir', run: () => shopPage(api, who, 'Escolha à vontade — a gente entrega no balcão.', PIZZA_MENU, root) },
      { label: 'Qual é a especialidade?', run: () => infoPage(who, 'A "Sunset": tomate assado, manjericão e um toque de pimenta. Sai do forno em dois minutos.', root) },
      { label: 'Até mais', run: () => null },
    ],
  });
  return root();
}

// ======================================================================
// 02 — MERCADO PALM MART
// ======================================================================
const MART_ITEMS = {
  lanches: [{ id: 'chips', label: 'Batata frita "Coco Crunch"', price: 2, heal: 4 }, { id: 'barra', label: 'Barra de cereal Sol', price: 1, heal: 3 }, { id: 'biscoito', label: 'Biscoito Maré Alta', price: 2, heal: 4 }],
  bebidas: [{ id: 'cola', label: 'Refrigerante Palm Cola', price: 1, heal: 2 }, { id: 'suco', label: 'Suco de laranja Flórida', price: 2, heal: 4 }, { id: 'leite', label: 'Leite gelado', price: 2, heal: 3 }],
  casa: [{ id: 'fita', label: 'Fita cassete virgem C-60', price: 3, durable: true }, { id: 'pilhas', label: 'Pilhas Volt (4 un.)', price: 4, durable: true }, { id: 'protetor', label: 'Protetor solar FPS 15', price: 5, durable: true }],
};

function martShelf(api, who, cat) {
  const items = MART_ITEMS[cat];
  const page = (msg) => ({
    who, text: msg,
    options: [
      ...items.map((it) => ({ label: `Pegar ${it.label} — $${it.price}`, run: () => { api.basket.push(it); return page(`${it.label} na cesta. Itens na cesta: ${api.basket.length}. Pague no caixa.`); } })),
      { label: 'Sair', run: () => null },
    ],
  });
  return page('Produtos fictícios da casa. Os itens vão para a cesta; o pagamento é no caixa.');
}

function martCheckout(api) {
  const who = 'Rosa (caixa)';
  const total = api.basket.reduce((s, i) => s + i.price, 0);
  if (!api.basket.length) return infoPage(who, 'Oi! A cesta está vazia. Pegue o que precisar nas prateleiras e geladeiras e volte aqui.');
  return {
    who, text: `Sua cesta: ${api.basket.map((i) => i.label).join(', ')}. Total: $${total}.`,
    options: [
      {
        label: `Pagar $${total}`,
        run: () => {
          const heal = api.basket.reduce((s, i) => s + (i.heal || 0), 0);
          const r = api.buy({ id: 'palm_mart_compra', label: 'Compras', price: total, effect: { heal } });
          if (r.ok) { for (const i of api.basket) if (i.durable) api.save.recordPurchase(api.def.id, i.id, 0, true); api.basket.length = 0; return infoPage(who, `Obrigada! ${heal ? `Você comeu um lanche (+${heal} de vida). ` : ''}Volte sempre ao Palm Mart.`); }
          return infoPage(who, r.msg);
        },
      },
      { label: 'Esvaziar a cesta', run: () => { api.basket.length = 0; return infoPage(who, 'Tudo bem, devolvo para a prateleira.'); } },
      { label: 'Sair', run: () => null },
    ],
  };
}

const market = {
  id: 'palm_mart', type: 'mercado', name: 'PALM MART', buildingId: 'bld_e_back_8',
  sign: { text: 'Palm Mart', color: '#5dff9c', style: 'block', sub: 'MERCADO 7–23H', w: 3.6, h: 0.95 },
  size: { w: 20, d: 14.5, h: 3.8 }, hours: [7, 23], bell: true, doorColor: 0x2a6f4a, doorWidth: 1.6,
  palette: P(0xe8e4da, 0xf4f6ee, 0xf2f3f0, 0x2f9a6a),
  windows: [{ x: -0.3, w: 3.4 }, { x: 0.32, w: 3.4 }],
  light: { sky: 0xeef6ff, ground: 0x8a8a90, hemi: 1.25, exposure: 1.0, windowColor: 0xe8f4ff, poolStrength: 0.25, points: [{ x: 0, y: 3.3, z: 0, color: 0xf4fbff, intensity: 9, distance: 16 }] },
  audio: { track: null, ambience: 'market', radio: 'ocean_breeze' },
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    // Caixas registradoras perto da entrada (lado oposto ao vão da porta).
    const side = ctx.doorX > 0 ? -1 : 1;
    const checkoutX = ctx.doorX + side * 3.2;
    const cz = D / 2 - 2.6;
    for (let k = 0; k < 2; k++) {
      const x = checkoutX + side * k * 2.6;
      counter(b, x, cz, 1.8, Math.PI / 2, { front: mat(0x2f9a6a, 0.5), top: mat(0x3a3a3e, 0.3), h: 0.95 });
      register(b, x + 0.0, 0.95, cz + 0.4, Math.PI / 2);
    }
    // Corredores com prateleiras duplas (ao longo de Z).
    const shelfZ = -0.8, shelfLen = Math.min(7, D - 7.5);
    const rows = [];
    for (let x = -W / 2 + 2.6; x < W / 2 - 2.4; x += 3.0) if (Math.abs(x - ctx.doorX) > 1.6) rows.push(x);
    const palette = [0xff4f6a, 0xffd23f, 0x3fd0ff, 0x6aff7a, 0xff9a3f, 0xb07aff, 0xffffff];
    const slots = [];
    rows.forEach((x, i) => {
      for (const sd of [-1, 1]) {
        shelfUnit(b, x + sd * 0.26, shelfZ, shelfLen, sd > 0 ? Math.PI / 2 : -Math.PI / 2, { color: mat(0xdfe4e8, 0.4, 0.3), h: 1.8, depth: 0.48 });
        for (let lv = 0; lv < 4; lv++) slots.push({ x: x + sd * 0.3, y: lv === 0 ? 0.1 : (1.8 / 4.4) * lv + 0.03, z: shelfZ, yaw: sd > 0 ? Math.PI / 2 : -Math.PI / 2 });
      }
      const cat = ['lanches', 'bebidas', 'casa'][i % 3];
      const lbl = { lanches: 'LANCHES', bebidas: 'BEBIDAS', casa: 'CASA E PRAIA' }[cat];
      const tex = textTexture([], { title: lbl, w: 256, h: 64, bg: '#ffe95a', accent: '#2f9a6a', fg: '#222' });
      wallSign(ctx, tex, x, 2.35, shelfZ + shelfLen / 2 + 0.02, 1.2, 0.3);
      b.interact({ id: `prat_${i}`, x: x + 0.85, y: 1.1, z: shelfZ + shelfLen / 2 - 1.0, label: `VER PRODUTOS · ${lbl}`, radius: 1.6, action: (api) => martShelf(api, 'Prateleira', cat) });
    });
    extra(ctx, productInstances(slots.filter((_, k) => k % 2 === 0), palette, { kind: 'box', perSlot: Math.max(4, Math.floor(shelfLen / 0.35)), len: shelfLen }));
    extra(ctx, productInstances(slots.filter((_, k) => k % 2 === 1), palette, { kind: 'can', perSlot: Math.max(4, Math.floor(shelfLen / 0.25)), len: shelfLen }));
    // Geladeiras no fundo; porta do depósito (trancada) no canto.
    const nFr = Math.floor((W - 5) / 0.85);
    for (let k = 0; k < nFr; k++) fridge(b, -W / 2 + 0.6 + k * 0.85, -D / 2 + 0.4, 0, { w: 0.8, light: 0xdff4ff });
    const frSlots = [];
    const frCx = -W / 2 + 0.6 + (nFr - 1) * 0.425;
    for (let lv = 0; lv < 4; lv++) {
      frSlots.push({ x: frCx, y: 0.32 + lv * 0.42, z: -D / 2 + 0.83, yaw: 0 });
      b.box(mat(0xcfe8f4, 0.1, 0.3), frCx, 0.3 + lv * 0.42, -D / 2 + 0.83, nFr * 0.85 - 0.1, 0.02, 0.16, { r: 0 });
    }
    extra(ctx, productInstances(frSlots, palette, { kind: 'bottle', perSlot: nFr * 3, len: nFr * 0.85 - 0.1 }));
    b.interact({ id: 'geladeiras', x: -W / 2 + 2.5, y: 1.1, z: -D / 2 + 1.3, label: 'ABRIR GELADEIRA', radius: 2.0, action: (api) => { api.sfx('fridge'); return martShelf(api, 'Geladeiras', 'bebidas'); } });
    innerDoor(b, ctx, { id: 'deposito', x: W / 2 - 1.6, z: -D / 2 + 0.1, w: 1.0, label: 'DEPÓSITO', locked: true, lockedText: 'SOMENTE FUNCIONÁRIOS', color: 0x7a8088 });
    // Freezer horizontal, carrinhos e cestas.
    b.box(mat(0xf0f2f4, 0.4, 0.3), -side * 3 + ctx.doorX, 0, cz - 0.3, 2.2, 0.85, 0.9, { r: 0.05, collide: true });
    b.box(glow(0xcfefff, 0.8), -side * 3 + ctx.doorX, 0.86, cz - 0.3, 2.0, 0.02, 0.7, { r: 0 });
    for (let k = 0; k < 3; k++) {
      const x = ctx.doorX - side * (1.3 + k * 0.55), z = D / 2 - 0.9;
      b.box(mat(0xc9cdd3, 0.3, 0.8), x, 0.35, z, 0.5, 0.45, 0.8, { r: 0.02 });
      b.box(mat(0x2f9a6a, 0.5), x, 0.1, z, 0.48, 0.05, 0.75, { r: 0 });
    }
    b.collider(ctx.doorX - side * 1.85, D / 2 - 0.9, 1.7, 0.85, 0, 1);
    for (let x = -W / 2 + 2; x < W / 2 - 1; x += 4) for (let z = -D / 2 + 2; z < D / 2 - 1; z += 3.5) ceilingPanel(b, x, H, z, 1.6, 0.3, 0xf4fbff, 1.6);
    ctx.spots = { checkoutX, cz, side, rows, shelfZ, shelfLen };
    b.interact({ id: 'caixa', x: checkoutX - side * 0.0, y: 1.1, z: cz + 1.05, label: 'PAGAR NO CAIXA', radius: 1.6, action: (api) => martCheckout(api) });
  },
  npcs(inst) {
    const s = inst.ctx.spots;
    const D = inst.D;
    const aisle = (i) => s.rows[i] !== undefined ? s.rows[i] + 1.5 : 0;
    return [
      { role: 'cashier', name: 'Rosa', behavior: 'stand', x: s.checkoutX + s.side * 0.75, z: s.cz, yaw: -s.side * Math.PI / 2, uniform: SKIN_STAFF(0x2f9a6a, 0x2a2a2e) },
      { role: 'stocker', name: 'Beto', behavior: 'patrol', points: [[aisle(0), s.shelfZ - s.shelfLen / 2 + 0.5], [aisle(0), s.shelfZ + s.shelfLen / 2 - 0.5]], speed: 0.7, uniform: SKIN_STAFF(0x2f9a6a, 0x3a4a6a) },
      { role: 'customer', behavior: 'patrol', points: [[aisle(1), s.shelfZ - 2.5], [aisle(1), s.shelfZ + 2.6], [inst.ext.doorX, D / 2 - 3.6]] },
      { role: 'customer', behavior: 'patrol', points: [[aisle(2), s.shelfZ + 2.5], [aisle(2), s.shelfZ - 2.5], [-inst.W / 2 + 2.5, -D / 2 + 1.6]] },
      { role: 'customer', behavior: 'stand', x: s.checkoutX - s.side * 0.4, z: s.cz + 0.95, yaw: Math.PI },
    ];
  },
};

// ======================================================================
// 03 — OFICINA SUNSET AUTO WORKS
// ======================================================================
function workshopTalk(api) {
  const who = 'Ray (mecânico)';
  const root = () => {
    const v = api.vehicleNear();
    const opts = [];
    if (v) {
      const integ = Math.round(v.damage.integrity);
      const price = integ >= 99 ? 0 : Math.max(40, Math.round((100 - integ) * 3));
      opts.push({ label: `Ver integridade do ${v.spec.model || 'carro'}`, run: () => infoPage(who, `${v.spec.model || 'Seu carro'}: integridade ${integ}%. ${integ > 85 ? 'Está inteiro.' : integ > 50 ? 'Amassados e um farol desalinhado.' : 'Chassi torto, suspensão sofrendo. Precisa de reparo.'}`, root) });
      if (price > 0) {
        opts.push({
          label: `Reparo completo — $${price}`,
          run: () => {
            const r = api.buy({ id: 'reparo', label: 'Reparo completo', price });
            if (r.ok) { v.damage.repair(); api.sfx('tool'); return infoPage(who, 'Pronto! Lataria, faróis e suspensão no lugar. Integridade 100%.', root); }
            return infoPage(who, r.msg, root);
          },
        });
      }
    }
    opts.push({ label: 'Serviços e preços', run: () => infoPage(who, 'Reparo de lataria e suspensão: $3 por ponto de integridade (mínimo $40). Estacione na vaga em frente ao portão.', root) });
    opts.push({ label: 'Até logo', run: () => null });
    return { who, text: v ? 'Seu carro precisa de uma revisão? Ele está na vaga aí fora — já dei uma olhada.' : 'Seu carro precisa de uma revisão? Traga e estacione na vaga em frente ao portão.', options: opts };
  };
  return root();
}

const workshop = {
  id: 'sunset_auto', type: 'oficina', name: 'SUNSET AUTO WORKS', buildingId: 'bld_e_back_10',
  sign: { text: 'Sunset Auto Works', color: '#ffe95a', style: 'block', sub: 'SERVIÇO 8–20H', w: 4.2, h: 0.95 },
  size: { w: 17, d: 14.5, h: 5.0 }, hours: [8, 20], doorColor: 0x3a4a5a,
  palette: P(0x8d9096, 0x9fb0c0, 0x7d8590, 0xffd23f),
  windows: [],
  light: { sky: 0xdfe8ff, ground: 0x5a5a5a, hemi: 1.1, exposure: 1.0, windowColor: 0xdfe8ff, poolStrength: 0.3, points: [{ x: -0.15, y: 4.3, z: -0.1, color: 0xeaf2ff, intensity: 12, distance: 16 }] },
  audio: { track: null, ambience: 'workshop', radio: 'thunder_rock' },
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    // Faixas amarelas no piso e portão de garagem (lado interno da fachada).
    for (const x of [-W / 2 + 1.6, -W / 2 + 7.4]) b.box(mat(0xffd23f, 0.6), x, 0.002, -0.5, 0.12, 0.004, D - 4, { r: 0 });
    const gateX = ctx.doorX > 0 ? -W / 2 + 4.5 : W / 2 - 4.5;
    b.box(mat(0x8a96a4, 0.5, 0.5), gateX, 0, D / 2 - 0.02, 5.0, 3.6, 0.06, { r: 0 });
    for (let k = 0; k < 12; k++) b.box(mat(0x6c7886, 0.5, 0.5), gateX, 0.15 + k * 0.29, D / 2 - 0.06, 5.0, 0.04, 0.04, { r: 0 });
    // Elevador automotivo com carro de cliente em manutenção.
    const liftX = gateX, liftZ = -0.6;
    for (const sx of [-1.4, 1.4]) b.box(mat(0xd8283a, 0.4, 0.4), liftX + sx, 0, liftZ, 0.3, 3.0, 0.4, { r: 0.03, collide: true });
    b.box(mat(0x444a52, 0.4, 0.6), liftX, 1.32, liftZ, 2.4, 0.12, 4.0, { r: 0.02 });
    b.collider(liftX, liftZ, 2.4, 4.4, 1.25, 2.8);
    if (ctx.factory) {
      const car = ctx.factory.create('sports', { id: 'oficina_elevador', color: 0x3fd8d0, plate: 'FIX 001' });
      car.root.position.set(liftX, 1.45, liftZ);
      extra(ctx, car.root);
      const car2 = ctx.factory.create('sedan', { id: 'oficina_espera', color: 0xd6c29a, plate: 'OK 2024' });
      car2.root.position.set(-gateX * 0.15, 0, -D / 2 + 3.3);
      car2.root.rotation.y = Math.PI / 2;
      extra(ctx, car2.root);
      b.collider(-gateX * 0.15, -D / 2 + 3.3, 4.8, 2.0, 0, 1.5);
      ctx.disposers = [...(ctx.disposers || []), () => { ctx.factory.dispose(car); ctx.factory.dispose(car2); }];
    }
    // Bancada, armários, pneus, rodas na parede, compressor.
    const wallX = -Math.sign(gateX || 1) * (W / 2 - 0.4);
    b.box(mat(0x3a4048, 0.5, 0.5), wallX, 0, -D / 2 + 3.5, 0.7, 0.95, 3.4, { r: 0.02, collide: true });
    b.box(mat(0xc9a24a, 0.5, 0.3), wallX, 0.95, -D / 2 + 3.5, 0.75, 0.05, 3.5, { r: 0.01 });
    const toWall = Math.sign(wallX);
    b.box(mat(0x2a2e34, 0.5), wallX + toWall * 0.33, 1.05, -D / 2 + 3.5, 0.04, 1.2, 3.2, { r: 0 });
    for (let k = 0; k < 9; k++) b.box(mat(0xd0d4da, 0.3, 0.9), wallX + toWall * 0.29, 1.3 + (k % 3) * 0.3, -D / 2 + 2.4 + Math.floor(k / 3) * 1.1, 0.03, 0.22, 0.06, { r: 0 });
    for (let k = 0; k < 4; k++) b.box(mat([0xd84a3a, 0x3a6ad8, 0xd84a3a, 0x3a6ad8][k], 0.5, 0.4), wallX + Math.sign(-wallX) * (0.4 + k * 0.62), 0, -D / 2 + 0.35, 0.58, 1.9, 0.5, { r: 0.02, collide: true });
    for (let k = 0; k < 4; k++) b.cyl(mat(0x1d1d20, 0.9), -wallX * 0.6, k * 0.24, D / 2 - 2.2, 0.34, 0.34, 0.23, 16, { collide: k === 0 });
    for (let k = 0; k < 3; k++) b.cyl(mat(0xbfc5cc, 0.3, 0.9), -wallX * 0.98, 2.2, -1.5 + k * 1.1, 0.3, 0.3, 0.12, 14, { rz: Math.PI / 2 });
    b.cyl(mat(0xd84a3a, 0.4, 0.4), wallX + Math.sign(-wallX) * 0.6, 0, D / 2 - 1.2, 0.32, 0.32, 1.0, 14, { collide: true });
    b.box(mat(0x3a3a3e, 0.6), wallX + Math.sign(-wallX) * 0.6, 1.0, D / 2 - 1.2, 0.5, 0.25, 0.4, { r: 0.03 });
    // Escritório/recepção envidraçado perto da porta.
    // Recepção ao lado da porta, do lado oposto ao portão (ou do outro lado se não couber).
    const dir = gateX > 0 ? -1 : 1;
    let offX = ctx.doorX + dir * 2.4;
    if (Math.abs(offX) > W / 2 - 1.8) offX = ctx.doorX - dir * 2.4;
    const cdir = Math.abs(offX + dir * 1.6) < W / 2 - 0.6 ? dir : -dir;
    counter(b, offX, D / 2 - 3.0, 2.6, 0, { front: mat(0x2a3a4a, 0.5), top: mat(0xc9a24a, 0.4, 0.3) });
    register(b, offX - 0.7, 1.05, D / 2 - 3.05);
    for (let k = 0; k < 2; k++) chair(b, offX + cdir * 1.6, D / 2 - 1.2 - k * 0.7, cdir > 0 ? -Math.PI / 2 : Math.PI / 2, { seat: mat(0x3a6ad8, 0.6) });
    const svc = textTexture([['Reparo de lataria', '$3/pt'], ['Suspensão', 'incluso'], ['Faróis', 'incluso'], ['Lavagem', '$5']], { title: 'SERVIÇOS', w: 512, h: 320, bg: '#1d2430', accent: '#ffd23f' });
    wallSign(ctx, svc, offX, 2.3, D / 2 - 0.12, 2.2, 1.4, Math.PI);
    for (let x = -W / 2 + 2.5; x < W / 2 - 1; x += 4.2) ceilingPanel(b, x, H, -0.5, 2.6, 0.25, 0xeaf2ff, 1.8);
    ctx.spots = { liftX, liftZ, offX, wallX };
    b.interact({ id: 'mecanico', x: liftX + 2.0, y: 1.1, z: liftZ + 1.6, label: 'FALAR COM O MECÂNICO', radius: 1.8, action: (api) => workshopTalk(api) });
    b.interact({ id: 'recepcao', x: offX, y: 1.1, z: D / 2 - 2.2, label: 'FALAR COM A RECEPÇÃO', action: (api) => ({ who: 'Lia (recepção)', text: 'Sunset Auto Works, boa tarde! Abrimos das 8h às 20h. O Ray atende no elevador. Quer café enquanto espera?', options: [{ label: 'Aceitar café (grátis)', run: () => { api.status.setHealth(api.status.health + 2); return infoPage('Lia (recepção)', 'Cafezinho passado agora. Fique à vontade nas cadeiras.'); } }, { label: 'Obrigado', run: () => null }] }) });
    b.interact({ id: 'bancada', x: wallX + Math.sign(-wallX) * 0.9, y: 1.1, z: -D / 2 + 3.5, label: 'EXAMINAR BANCADA', action: () => infoPage('Bancada', 'Chaves combinadas, um torquímetro, catálogos de peças de 1984 e uma caneca "Melhor Mecânico da Costa".') });
  },
  npcs(inst) {
    const s = inst.ctx.spots;
    return [
      { role: 'mechanic', name: 'Ray', behavior: 'work', x: s.liftX + 1.9, z: s.liftZ + 0.6, yaw: -Math.PI / 2, uniform: SKIN_STAFF(0x3a6ad8, 0x2a3a5a) },
      { role: 'attendant', name: 'Lia', behavior: 'stand', x: s.offX, z: inst.D / 2 - 3.8, yaw: 0, uniform: SKIN_STAFF(0xffd23f, 0x2a2a2e) },
      { role: 'customer', behavior: 'sit', seat: 0 },
      { role: 'mechanic2', behavior: 'patrol', points: [[s.liftX - 2.2, s.liftZ - 1], [s.wallX * 0.7, -inst.D / 2 + 3.5]], speed: 0.8, uniform: SKIN_STAFF(0x3a6ad8, 0x2a3a5a) },
    ];
  },
};

// ======================================================================
// 04 — BOATE NEON PARADISE
// ======================================================================
function drinkMenu(api, who, items, back) {
  return shopPage(api, who, 'Sem álcool nesta casa de demonstração — mas com muito estilo.', items, back);
}
const CLUB_DRINKS = [
  { id: 'neon_fizz', label: 'Neon Fizz (sem álcool)', price: 6, effect: { heal: 4 } },
  { id: 'agua_coco', label: 'Água de coco gelada', price: 3, effect: { heal: 3 } },
  { id: 'soda_limao', label: 'Soda de limão', price: 2, effect: { heal: 2 } },
];

const club = {
  id: 'neon_paradise', type: 'boate', name: 'NEON PARADISE', buildingId: 'bld_e_back_7',
  sign: { text: 'Neon Paradise', color: '#ff4fd8', style: 'script', sub: 'NIGHT CLUB', w: 4.2, h: 1.1 },
  size: { w: 22, d: 14.5, h: 4.6 }, hours: [18, 5], bpm: 112, doorColor: 0x1a1424, doorWidth: 1.6,
  palette: P(0x16121e, 0x22182e, 0x0e0b14, 0x8a5cff),
  windows: [],
  light: { sky: 0x6a3fb0, ground: 0x140a24, hemi: 0.75, exposure: 1.1, windowColor: 0xff4fd8, poolStrength: 0.65, points: [{ x: 0.1, y: 3.6, z: -0.2, color: 0xff4fd8, intensity: 14, distance: 14 }, { x: -0.25, y: 3.6, z: 0.1, color: 0x3ff0ff, intensity: 10, distance: 12 }] },
  audio: { track: 'club', ambience: 'club' },
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    const floorX = ctx.doorX > 0 ? -1.5 : 1.5;
    danceFloor(ctx, floorX, -1.2, 6, 5, 1.1, [0xff4fd8, 0x3ff0ff, 0x8a5cff, 0x2a6aff]);
    // Cabine do DJ ao fundo.
    b.box(mat(0x1d1a24, 0.4, 0.4), floorX, 0, -D / 2 + 1.0, 4.0, 0.5, 1.6, { r: 0.05, collide: true, walkable: true });
    b.box(mat(0x2a2632, 0.3, 0.5), floorX, 0.5, -D / 2 + 1.3, 2.4, 0.6, 0.7, { r: 0.04, collide: true });
    b.box(glow(0x3ff0ff, 2.0), floorX, 1.1, -D / 2 + 1.3, 2.3, 0.04, 0.6, { r: 0 });
    b.box(glow(0xff4fd8, 2.4), floorX, 0.52, -D / 2 + 1.67, 2.4, 0.08, 0.02, { r: 0 });
    for (const sx of [-2.6, 2.6]) { b.box(mat(0x111114, 0.6), floorX + sx, 0, -D / 2 + 0.7, 1.0, 2.2, 0.9, { r: 0.05, collide: true }); b.cyl(mat(0x333338, 0.4, 0.6), floorX + sx, 1.3, -D / 2 + 1.16, 0.3, 0.3, 0.04, 16, { rx: Math.PI / 2 }); }
    // Bar na parede lateral.
    const barX = floorX > 0 ? -W / 2 + 1.6 : W / 2 - 1.6;
    const barYaw = floorX > 0 ? Math.PI / 2 : -Math.PI / 2;
    counter(b, barX, -0.5, 6.0, barYaw, { front: mat(0x2a1a3a, 0.4, 0.3), top: mat(0x0e0b14, 0.15, 0.6), accent: glow(0xff4fd8, 2.0) });
    const shelfX = floorX > 0 ? -W / 2 + 0.3 : W / 2 - 0.3;
    for (let lv = 0; lv < 3; lv++) b.box(glow(0x8a5cff, 0.6), shelfX, 1.2 + lv * 0.45, -0.5, 0.35, 0.03, 5.5, { r: 0 });
    extra(ctx, productInstances([0, 1, 2].map((lv) => ({ x: shelfX, y: 1.23 + lv * 0.45, z: -0.5, yaw: Math.PI / 2 })), [0x3ff0ff, 0xff9a4a, 0xb07aff, 0x5dff9c, 0xffd23f], { kind: 'bottle', perSlot: 16, len: 5.3 }));
    const stoolX = barX + (floorX > 0 ? 0.95 : -0.95);
    for (let k = 0; k < 5; k++) stool(b, stoolX, -2.5 + k * 1.0, barYaw + Math.PI, { seat: mat(0xff4fd8, 0.4) });
    // Sofás (lounge) e área VIP com corda.
    const loungeX = floorX > 0 ? W / 2 - 2.0 : -W / 2 + 2.0;
    const lYaw = floorX > 0 ? -Math.PI / 2 : Math.PI / 2;
    for (const z of [-0.8, 3.0]) {
      sofa(b, loungeX, z, lYaw, { uph: mat(0x6a3fb0, 0.6) });
      table(b, loungeX - Math.sign(loungeX) * 1.1, z, { round: true, w: 0.7, h: 0.5, top: mat(0x0e0b14, 0.2, 0.5) });
    }
    const vipZ = -D / 2 + 2.2;
    b.box(mat(0x3a1f4a, 0.85), loungeX, 0.003, vipZ, 3.4, 0.006, 3.6, { r: 0 });
    sofa(b, loungeX, vipZ - 0.6, 0, { uph: mat(0xd4a83a, 0.4, 0.4), w: 2.4 });
    for (let k = 0; k < 4; k++) b.cyl(mat(0xd4a83a, 0.3, 0.9), loungeX - 1.5 + k * 1.0, 0, vipZ + 1.9, 0.04, 0.05, 1.0, 8);
    b.box(mat(0xb0203a, 0.6), loungeX, 0.85, vipZ + 1.9, 3.0, 0.05, 0.05, { r: 0 });
    b.collider(loungeX, vipZ + 1.9, 3.4, 0.3, 0, 1.2);
    // Espelhos estilizados e faixas de neon.
    for (let k = -2; k <= 2; k++) b.box(MIRROR(), floorX + k * 1.9, 1.2, -D / 2 + 0.04, 1.6, 2.6, 0.02, { r: 0 });
    for (const [x, z, ry, c] of [[-W / 2 + 0.03, 0, Math.PI / 2, 0xff4fd8], [W / 2 - 0.03, 0, -Math.PI / 2, 0x3ff0ff]]) b.box(glow(c, 2.4), x, H - 0.5, z, 0.03, 0.06, D - 1, { r: 0 });
    b.box(glow(0x8a5cff, 2.0), 0, H - 0.08, -1.2, 8, 0.03, 0.06, { r: 0 });
    // Recepção e segurança junto à entrada.
    const recX = ctx.doorX + (floorX > 0 ? 2.2 : -2.2);
    counter(b, recX, D / 2 - 2.0, 1.8, 0, { front: mat(0x2a1a3a, 0.4), top: mat(0xd4a83a, 0.3, 0.6), h: 1.1 });
    // Banheiros (porta funcional) no canto do fundo.
    const wcX = floorX > 0 ? -W / 2 + 1.6 : W / 2 - 1.6; // canto do fundo, lado do bar (o VIP ocupa o outro)
    room(b, ctx, { x: wcX, z: -D / 2 + 0.0 + 1.2, w: 2.6, d: 2.4, h: 2.8, wallMat: mat(0x2a2236, 0.7), label: 'BANHEIRO', fixtures: (bb) => { bb.box(mat(0xe8e8ec, 0.3, 0.2), wcX, 0, -D / 2 + 0.35, 0.6, 0.85, 0.45, { r: 0.04, collide: true }); bb.box(MIRROR(), wcX, 1.2, -D / 2 + 0.02, 0.8, 0.9, 0.02, { r: 0 }); } });
    // Máquina de fumaça: planos suaves derivando sobre a pista.
    const smokeTex = softTex();
    const smoke = new THREE.Group();
    for (let k = 0; k < 8; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.0), new THREE.MeshBasicMaterial({ map: smokeTex, transparent: true, opacity: 0.12, depthWrite: false, color: 0xd8c8ff }));
      m.position.set(floorX + (Math.random() - 0.5) * 5, 0.35 + Math.random() * 0.3, -1.2 + (Math.random() - 0.5) * 4);
      m.rotation.y = Math.random() * Math.PI;
      smoke.add(m);
    }
    extra(ctx, smoke);
    ctx.updaters.push((dt, t) => { smoke.children.forEach((m, i) => { m.position.x = floorX + Math.sin(t * 0.15 + i) * 2.6; m.rotation.y += dt * 0.05; }); });
    // Luzes dinâmicas: as duas luzes reais alternam cor no ritmo.
    ctx.lightDriver = true;
    ctx.updaters.push((dt, t, mgr) => {
      const beat = (t * 112) / 60;
      const [l1, l2] = mgr.lights;
      l1.intensity = 8 + Math.max(0, Math.sin(beat * Math.PI)) * 10;
      l2.intensity = 6 + Math.max(0, Math.cos(beat * Math.PI)) * 8;
      l1.color.setHSL(0.83 + Math.sin(t * 0.2) * 0.05, 1, 0.6);
      l2.color.setHSL(0.52 + Math.cos(t * 0.17) * 0.05, 1, 0.6);
    });
    ctx.spots = { floorX, barX, stoolX, loungeX, recX, vipZ };
    b.interact({ id: 'bartender', x: stoolX, y: 1.1, z: -0.5, label: 'PEDIR NO BAR', radius: 1.7, action: (api) => drinkMenu(api, 'Kiko (bartender)', CLUB_DRINKS) });
    b.interact({ id: 'dj', x: floorX, y: 1.1, z: -D / 2 + 2.6, label: 'FALAR COM O DJ', radius: 1.8, action: (api) => ({ who: 'DJ Starlight', text: 'Tudo produção própria, sintetizador e bateria eletrônica! Quer outra faixa?', options: [{ label: 'Tocar "Neon Paradise"', run: () => { api.jukebox('club'); return null; } }, { label: 'Tocar "Turbo Coast"', run: () => { api.jukebox('turbo'); return null; } }, { label: 'Valeu!', run: () => null }] }) });
    b.interact({ id: 'seguranca', x: ctx.doorX + (floorX > 0 ? -1.2 : 1.2), y: 1.1, z: D / 2 - 2.0, label: 'FALAR COM O SEGURANÇA', action: () => infoPage('Marcus (segurança)', 'Bem-vindo ao Neon Paradise. Pista liberada, VIP só com convite. Nada de confusão, combinado?') });
    b.interact({ id: 'vip', x: loungeX, y: 1.0, z: vipZ + 2.5, label: 'ÁREA VIP', action: () => infoPage('Corda VIP', 'Reservado para convidados da casa esta noite.') });
  },
  npcs(inst) {
    const s = inst.ctx.spots;
    const D = inst.D;
    const dancers = [[-1.6, -2.0], [0.2, -0.6], [1.4, -2.2], [-0.6, 0.6], [1.8, 0.2], [-2.2, -0.4]].map(([x, z], i) => ({ role: 'dancer', behavior: 'dance', x: s.floorX + x, z: -1.2 + z, yaw: (i * 1.3) % (Math.PI * 2) }));
    return [
      { role: 'dj', name: 'DJ Starlight', behavior: 'dj', x: s.floorX, z: -D / 2 + 0.6, y: 0.5, yaw: 0, uniform: SKIN_STAFF(0x8a5cff, 0x111114, { glasses: true }) },
      { role: 'bartender', name: 'Kiko', behavior: 'work', x: s.barX - Math.sign(s.stoolX - s.barX) * 0.7, z: -0.5, yaw: s.stoolX > s.barX ? Math.PI / 2 : -Math.PI / 2, uniform: SKIN_STAFF(0x111114, 0x111114) },
      { role: 'guard', name: 'Marcus', behavior: 'guard', x: inst.ext.doorX + (s.floorX > 0 ? -1.2 : 1.2), z: D / 2 - 2.6, yaw: Math.PI, uniform: SKIN_STAFF(0x1a1a1e, 0x1a1a1e, { glasses: true }) },
      ...dancers,
      { role: 'guest', behavior: 'talk', seat: 0 }, { role: 'guest', behavior: 'talk', seat: 1 }, { role: 'guest', behavior: 'sit', seat: 5 },
      { role: 'guest', behavior: 'patrol', points: [[s.stoolX + Math.sign(s.stoolX - s.barX) * 1.0, -1.5], [s.floorX, 1.8], [s.loungeX - Math.sign(s.loungeX) * 2.2, 0]] },
    ];
  },
};

// ======================================================================
// 05 — DISCOTECA ELECTRIC FEVER
// ======================================================================
const disco = {
  id: 'electric_fever', type: 'discoteca', name: 'ELECTRIC FEVER', buildingId: 'bld_e_back_4',
  sign: { text: 'Electric Fever', color: '#ffe95a', style: 'script', sub: 'DISCOTHEQUE', w: 4.2, h: 1.1 },
  size: { w: 22, d: 14.5, h: 4.4 }, hours: [18.5, 4], bpm: 122, doorColor: 0xd84a8a, doorWidth: 1.6,
  palette: P(0x1c1018, 0x3a1830, 0x140a12, 0xffd23f),
  windows: [],
  light: { sky: 0xff9ad8, ground: 0x2a1020, hemi: 0.7, exposure: 1.1, windowColor: 0xffd23f, poolStrength: 0.7, points: [{ x: 0, y: 3.8, z: -0.1, color: 0xffd23f, intensity: 12, distance: 14 }, { x: 0.3, y: 3.4, z: 0.2, color: 0xff4f6a, intensity: 8, distance: 10 }] },
  audio: { track: 'disco', ambience: 'disco' },
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    const fz = -1.4;
    danceFloor(ctx, 0, fz, 8, 6, 1.0, [0xff3f6a, 0xffd23f, 0x3fd0ff, 0x6aff7a, 0xff9a3f, 0xb07aff], 'checker');
    // Globo espelhado com reflexos girando.
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), mat(0xe8eef8, 0.15, 0.5, { flatShading: true, emissive: 0x9aa4c0, emissiveIntensity: 0.9 }));
    ball.position.set(0, H - 1.0, fz);
    extra(ctx, ball);
    b.cyl(mat(0x888888, 0.4, 0.8), 0, H - 0.55, fz, 0.01, 0.01, 0.55, 4);
    const spots = new THREE.Group();
    spots.position.set(0, H - 1.0, fz);
    const spotMat = new THREE.MeshBasicMaterial({ map: softTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff6d8, opacity: 0.8 });
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2, e = -0.2 - Math.random() * 0.9;
      const r = 5.5;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), spotMat);
      m.position.set(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r * 0.55, Math.sin(a) * Math.cos(e) * r * 0.75);
      m.lookAt(0, 0, 0);
      spots.add(m);
    }
    extra(ctx, spots);
    ctx.updaters.push((dt) => { ball.rotation.y += dt * 0.6; spots.rotation.y += dt * 0.6; });
    // Painéis geométricos coloridos e luzes de piso.
    const tri = [0xff3f6a, 0xffd23f, 0x3fd0ff, 0xb07aff];
    for (let k = 0; k < 10; k++) {
      const x = -W / 2 + 1.2 + k * ((W - 2.4) / 9);
      b._add(new THREE.CircleGeometry(0.5, 3), glow(tri[k % 4], 1.6), x, 2.9, -D / 2 + 0.03, 0, 0, k % 2 ? Math.PI : 0);
      b._add(new THREE.CircleGeometry(0.4, 6), glow(tri[(k + 1) % 4], 1.2), x, 1.9, -D / 2 + 0.03, 0, 0, 0);
    }
    for (let k = 0; k < 8; k++) { const x = -4.4 + k * 1.25; for (const z of [fz - 3.4, fz + 3.4]) b.cyl(glow(tri[k % 4], 2.2), x, 0, z, 0.12, 0.14, 0.12, 10); }
    // Palco pequeno e cabine de som.
    const stageX = W / 2 - 3.0;
    b.box(mat(0x2a1020, 0.5), stageX, 0, -D / 2 + 1.8, 4.0, 0.45, 3.0, { r: 0.04, collide: true, walkable: true });
    b.box(glow(0xffd23f, 1.8), stageX, 0.45, -D / 2 + 3.32, 4.0, 0.04, 0.04, { r: 0 });
    b.box(mat(0x241820, 0.4, 0.4), -W / 2 + 2.4, 0, -D / 2 + 1.2, 2.6, 1.1, 1.0, { r: 0.05, collide: true });
    b.box(glow(0x3fd0ff, 1.6), -W / 2 + 2.4, 1.1, -D / 2 + 1.2, 2.4, 0.04, 0.8, { r: 0 });
    // Mesas, sofás e um pequeno bar de sucos.
    for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) {
      const x = sx * (W / 2 - 1.6), z = fz + 2.4 - k * 3.2 + 1.0;
      if (Math.abs(x - ctx.doorX) < 2.2 && z > D / 2 - 4) continue;
      sofa(b, x, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, { uph: mat(sx > 0 ? 0xff3f6a : 0x3fd0ff, 0.5), w: 1.8 });
      table(b, x - sx * 1.0, z, { round: true, w: 0.6, h: 0.5, top: mat(0xffd23f, 0.3, 0.4) });
    }
    counter(b, ctx.doorX + (ctx.doorX > 0 ? -3.5 : 3.5), D / 2 - 2.3, 2.6, 0, { front: mat(0xd84a8a, 0.4), top: mat(0x111111, 0.2, 0.5), accent: glow(0xffd23f, 1.6) });
    const tex = textTexture([], { title: 'ELECTRIC FEVER', w: 512, h: 128, bg: '#1a0a14', accent: '#ffd23f' });
    wallSign(ctx, tex, 0, H - 0.6, -D / 2 + 0.04, 4.4, 1.1);
    ctx.lightDriver = true;
    ctx.updaters.push((dt, t, mgr) => {
      const beat = (t * 122) / 60;
      const [l1, l2] = mgr.lights;
      l1.color.setHSL((beat / 16) % 1, 0.9, 0.6);
      l1.intensity = 9 + Math.max(0, Math.sin(beat * Math.PI)) * 8;
      l2.color.setHSL(((beat / 16) + 0.5) % 1, 0.9, 0.6);
      l2.intensity = 6 + Math.max(0, Math.cos(beat * Math.PI)) * 6;
    });
    ctx.spots = { fz, stageX };
    const juiceX = ctx.doorX + (ctx.doorX > 0 ? -3.5 : 3.5);
    b.interact({ id: 'bar', x: juiceX, y: 1.1, z: D / 2 - 1.4, label: 'PEDIR SUCO', action: (api) => drinkMenu(api, 'Dora (balcão)', [{ id: 'fever_punch', label: 'Fever Punch (sem álcool)', price: 5, effect: { heal: 4 } }, { id: 'limonada', label: 'Limonada rosa', price: 3, effect: { heal: 3 } }]) });
    b.interact({ id: 'cabine', x: -W / 2 + 2.4, y: 1.1, z: -D / 2 + 2.2, label: 'FALAR COM O DJ', action: (api) => ({ who: 'DJ Funky Ray', text: 'Discoteca de verdade é baixo oitavado e chimbal aberto! Escolha o clima.', options: [{ label: '"Electric Fever"', run: () => { api.jukebox('disco'); return null; } }, { label: '"Sunrise Boulevard"', run: () => { api.jukebox('sunrise'); return null; } }, { label: 'Continuar dançando', run: () => null }] }) });
  },
  npcs(inst) {
    const s = inst.ctx.spots;
    const ds = [];
    for (let k = 0; k < 9; k++) ds.push({ role: 'dancer', behavior: 'dance', x: -3 + (k % 3) * 3 + (Math.random() - 0.5), z: s.fz - 1.8 + Math.floor(k / 3) * 1.8, yaw: Math.random() * 6 });
    return [
      { role: 'dj', name: 'DJ Funky Ray', behavior: 'dj', x: -inst.W / 2 + 2.4, z: -inst.D / 2 + 0.45, yaw: 0, uniform: SKIN_STAFF(0xffd23f, 0x6a3fb0) },
      { role: 'performer', behavior: 'dance', x: s.stageX, z: -inst.D / 2 + 1.8, y: 0.45, yaw: 0, uniform: SKIN_STAFF(0xff3f6a, 0xffffff, { skirt: 0xff3f6a, skirtLen: 1.0 }) },
      ...ds,
      { role: 'staff', name: 'Dora', behavior: 'stand', x: inst.ext.doorX + (inst.ext.doorX > 0 ? -3.5 : 3.5), z: inst.D / 2 - 3.0, yaw: 0, uniform: SKIN_STAFF(0xd84a8a, 0x222222) },
      { role: 'guest', behavior: 'talk', seat: 0 }, { role: 'guest', behavior: 'talk', seat: 1 },
    ];
  },
};

// ======================================================================
// 06 — LOJA DE ROUPAS OCEAN STYLE
// ======================================================================
const CLOTHES = [
  { id: 'jaqueta_pastel', label: 'Jaqueta pastel de linho', price: 120, durable: true, unique: true },
  { id: 'camisa_havaiana', label: 'Camisa estampada de palmeiras', price: 45, durable: true, unique: true },
  { id: 'oculos_aviador', label: 'Óculos de sol aviador', price: 35, durable: true, unique: true },
  { id: 'tenis_branco', label: 'Tênis branco de lona', price: 60, durable: true, unique: true },
];

const clothes = {
  id: 'ocean_style', type: 'roupas', name: 'OCEAN STYLE', buildingId: 'bld_e_back_6',
  sign: { text: 'Ocean Style', color: '#45f3ff', style: 'script', sub: 'MODA PRAIA & NOITE', w: 3.6, h: 0.95 },
  size: { w: 15, d: 13, h: 3.6 }, hours: [9, 22], bell: true, doorColor: 0xe8e2d6,
  palette: P(0xd9cfc0, 0xf6f0f4, 0xf6f4f2, 0x45c8b8),
  windows: [{ x: -0.3, w: 3.2 }, { x: 0.3, w: 3.2 }],
  light: { sky: 0xfff4f8, ground: 0x8a7a80, hemi: 1.15, exposure: 1.0, windowColor: 0xfff0e0, poolStrength: 0.35, points: [{ x: 0, y: 3.0, z: 0, color: 0xfff4ea, intensity: 9, distance: 12 }] },
  audio: { track: 'pastel', ambience: 'clothes' },
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    // Manequins na vitrine e em plataformas.
    const manq = (x, z, ry, color) => {
      b.cyl(mat(0x2a2a2e, 0.4, 0.6), x, 0, z, 0.22, 0.25, 0.04, 14);
      b.cyl(mat(0x2a2a2e, 0.4, 0.6), x, 0.04, z, 0.02, 0.02, 0.85, 6);
      b._add(new THREE.LatheGeometry([[0, 0], [0.14, 0], [0.16, 0.15], [0.19, 0.4], [0.2, 0.5], [0.15, 0.58], [0.06, 0.62], [0, 0.63]].map(([r, y]) => new THREE.Vector2(r, y)), 10), mat(color, 0.7), x, 0.9, z, 0, ry, 0);
      b.sphere(mat(0xf2ede6, 0.5), x, 1.68, z, 0.1, 10);
      b.collider(x, z, 0.5, 0.5, 0, 1.8);
    };
    for (const x of [-W * 0.3, W * 0.3]) if (Math.abs(x - ctx.doorX) > 2) { manq(x - 0.6, D / 2 - 0.7, Math.PI, 0x45c8b8); manq(x + 0.6, D / 2 - 0.7, Math.PI, 0xff8fcf); }
    // Araras de roupas.
    const colors = [0xff8fcf, 0x45c8b8, 0xffe95a, 0xffffff, 0x8a5cff, 0xff9a4a];
    const rx = [];
    for (let x = -W / 2 + 2.0; x < W / 2 - 1.5; x += 3.0) if (Math.abs(x - ctx.doorX) > 1.8) rx.push(x);
    rx.forEach((x, i) => { rack(b, x, -0.2, 2.0, Math.PI / 2, colors.slice(i % 3)); rack(b, x, 2.4, 2.0, Math.PI / 2, colors.slice((i + 2) % 3)); });
    // Prateleiras de parede com roupas dobradas (instanciadas).
    const sl = [];
    for (let lv = 0; lv < 4; lv++) sl.push({ x: -W / 2 + 0.3, y: 0.5 + lv * 0.45, z: -1.0, yaw: Math.PI / 2 });
    for (let lv = 0; lv < 4; lv++) b.box(mat(0xe8e2d6, 0.5), -W / 2 + 0.3, 0.45 + lv * 0.45, -1.0, 0.45, 0.04, 5.0, { r: 0 });
    b.collider(-W / 2 + 0.3, -1.0, 0.5, 5.0, 0, 2.2);
    extra(ctx, productInstances(sl, colors, { kind: 'box', perSlot: 14, len: 4.8 }));
    // Espelhos, balcão com caixa, provadores com cortinas (portas de correr).
    for (const z of [1.2, 3.2]) b.box(MIRROR(), W / 2 - 0.05, 0.3, z, 0.03, 1.9, 0.9, { r: 0 });
    const cX = W / 2 - 2.2;
    counter(b, cX, -D / 2 + 3.0, 2.4, 0, { front: mat(0xff8fcf, 0.5), top: mat(0xf2ede6, 0.3, 0.2) });
    register(b, cX - 0.5, 1.05, -D / 2 + 2.95);
    const nFit = 3;
    for (let k = 0; k < nFit; k++) {
      const x = -W / 2 + 2.2 + k * 1.6;
      b.box(mat(0xe8e2d6, 0.6), x - 0.78, 0, -D / 2 + 0.9, 0.06, 2.3, 1.8, { r: 0, collide: true });
      if (k === nFit - 1) b.box(mat(0xe8e2d6, 0.6), x + 0.78, 0, -D / 2 + 0.9, 0.06, 2.3, 1.8, { r: 0, collide: true });
      b.box(MIRROR(), x, 0.4, -D / 2 + 0.05, 0.6, 1.6, 0.02, { r: 0 });
      innerDoor(b, ctx, { id: `provador${k + 1}`, x, z: -D / 2 + 1.8, w: 1.4, type: 'slide', label: `PROVADOR ${k + 1}`, color: [0xff8fcf, 0x45c8b8, 0xffe95a][k] });
    }
    for (let x = -W / 2 + 2; x < W / 2 - 1; x += 3.5) for (const z of [-2, 2]) ceilingPanel(b, x, H, z, 1.2, 1.2, 0xfff6ee, 1.3);
    plant(b, W / 2 - 0.6, D / 2 - 0.6);
    ctx.spots = { cX, rx };
    b.interact({ id: 'vendedora', x: cX, y: 1.1, z: -D / 2 + 3.9, label: 'FALAR COM A VENDEDORA', action: (api) => clothesTalk(api) });
    rx.forEach((x, i) => b.interact({ id: `arara${i}`, x: x + 0.9, y: 1.1, z: 1.1, label: 'VER ROUPAS', radius: 1.5, action: (api) => clothesShop(api, null) }));
  },
  npcs(inst) {
    const s = inst.ctx.spots;
    return [
      { role: 'seller', name: 'Vicky', behavior: 'stand', x: s.cX, z: -inst.D / 2 + 2.2, yaw: 0, uniform: SKIN_STAFF(0xff8fcf, 0xffffff, { skirt: 0xffffff, skirtLen: 0.9 }) },
      { role: 'stylist', behavior: 'patrol', points: [[(s.rx[0] ?? 0) + 1.5, -1.5], [(s.rx[0] ?? 0) + 1.5, 3.2]], speed: 0.7, uniform: SKIN_STAFF(0x45c8b8, 0x222228) },
      { role: 'customer', behavior: 'patrol', points: [[(s.rx[1] ?? 1) + 1.5, 3.0], [(s.rx[1] ?? 1) + 1.5, -1.6]] },
      { role: 'customer', behavior: 'stand', x: inst.W / 2 - 0.9, z: 1.2, yaw: Math.PI / 2 },
    ];
  },
};

function clothesShop(api, back) {
  const who = 'Coleção Ocean Style';
  const page = (msg) => ({
    who, text: msg,
    options: [
      ...CLOTHES.map((c) => ({ label: `${c.label} — $${c.price}${api.save.owns(c.id) ? ' (você já tem)' : ''}`, disabled: !!api.save.owns(c.id), run: () => page(api.buy(c).msg + (api.save.owns(c.id) ? ' Guardado no seu guarda-roupa.' : '')) })),
      { label: 'Experimentar no provador', run: () => infoPage('Provador', 'O protagonista importado usa um modelo GLB com roupa única (uma textura, sem peças separadas). Trocar o visual exige novas variantes do modelo ou malhas de roupa com rig — a compra fica registrada no guarda-roupa para essa integração futura.', () => page(msg)) },
      back ? { label: 'Voltar', run: back } : { label: 'Sair', run: () => null },
    ],
  });
  return page('Nova coleção da estação: tons pastel, linho e muito neon.');
}

function clothesTalk(api) {
  const who = 'Vicky (vendedora)';
  const root = () => ({
    who, text: 'Temos novidades chegando esta semana! Pastel de dia, neon à noite. Posso ajudar?',
    options: [
      { label: 'Ver a coleção', run: () => clothesShop(api, root) },
      { label: 'O que está na moda?', run: () => infoPage(who, 'Paletó com mangas dobradas, camiseta clara e mocassim sem meia. Clássico de Sunset Beach.', root) },
      { label: 'Só olhando', run: () => null },
    ],
  });
  return root();
}

// ======================================================================
// 07 — BAR BLUE HORIZON
// ======================================================================
const BAR_DRINKS = [
  { id: 'blue_soda', label: 'Blue Horizon Soda', price: 4, effect: { heal: 3 } },
  { id: 'cafe_gelado', label: 'Café gelado', price: 3, effect: { heal: 3 } },
  { id: 'tonica', label: 'Água tônica com limão', price: 3, effect: { heal: 2 } },
  { id: 'petisco', label: 'Porção de batatas', price: 5, effect: { heal: 8 } },
];

function jukeboxPage(api, who) {
  return { who, text: 'Jukebox "Starliner" — músicas originais da casa. 25 centavos? Hoje é por conta.', options: ['sunrise', 'pastel', 'turbo'].map((k) => ({ label: `Tocar "${TRACKS[k].label}"`, run: () => { api.jukebox(k); api.toast(`Tocando: ${TRACKS[k].label}`); return null; } })).concat([{ label: 'Desligar', run: () => { api.jukebox(null); return null; } }]) };
}

const bar = {
  id: 'blue_horizon', type: 'bar', name: 'BLUE HORIZON BAR', buildingId: 'bld_e_back_2',
  sign: { text: 'Blue Horizon', color: '#45a0ff', style: 'script', sub: 'BAR', w: 3.6, h: 0.95 },
  size: { w: 16, d: 13, h: 3.4 }, hours: [16, 4], doorColor: 0x2a3a5a,
  palette: P(0x6a4632, 0x4a5a80, 0x2a3044, 0xd4a83a),
  windows: [{ x: -0.32, w: 2.6 }],
  light: { sky: 0x5a78b8, ground: 0x2a1a24, hemi: 1.0, exposure: 1.1, windowColor: 0x45a0ff, poolStrength: 0.6, points: [{ x: 0, y: 2.9, z: -0.2, color: 0xffb36b, intensity: 11, distance: 12 }, { x: -0.3, y: 2.9, z: 0.2, color: 0x45a0ff, intensity: 7, distance: 10 }] },
  audio: { track: 'pastel', ambience: 'bar' },
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    const cz = -D / 2 + 2.6;
    const len = W - 4.0;
    counter(b, 0.6, cz, len, 0, { front: mat(0x4a2a1a, 0.5), top: mat(0x1a1612, 0.2, 0.4), accent: glow(0x45a0ff, 1.4) });
    for (let k = 0; k < Math.floor(len / 1.0); k++) stool(b, 0.6 - len / 2 + 0.5 + k * 1.0, cz + 0.85, Math.PI, { seat: mat(0x45a0ff, 0.45) });
    // Prateleiras de garrafas com espelho e luz indireta.
    b.box(MIRROR(), 0.6, 1.1, -D / 2 + 0.03, len, 1.4, 0.02, { r: 0 });
    for (let lv = 0; lv < 3; lv++) b.box(glow(0xffb36b, 0.6), 0.6, 1.15 + lv * 0.45, -D / 2 + 0.2, len, 0.03, 0.35, { r: 0 });
    extra(ctx, productInstances([0, 1, 2].map((lv) => ({ x: 0.6, y: 1.18 + lv * 0.45, z: -D / 2 + 0.2, yaw: 0 })), [0x7a4a1a, 0x2a6a3a, 0xbfd0e8, 0x8a2a2a, 0xd4a83a], { kind: 'bottle', perSlot: Math.floor(len / 0.18), len }));
    const neon = textTexture([], { title: 'BLUE HORIZON', w: 512, h: 128, bg: '#0a0e1a', accent: '#45a0ff' });
    wallSign(ctx, neon, 0.6, 2.75, -D / 2 + 0.05, 3.0, 0.75);
    // TV de época presa à parede e jukebox.
    const screen = tvScreen(ctx, 'show');
    crtTV(b, -W / 2 + 0.5, 2.0, cz - 0.3, Math.PI / 2, screen, 0.6);
    b.box(mat(0x2a2a2e, 0.5), -W / 2 + 0.3, 1.85, cz - 0.3, 0.4, 0.15, 0.5, { r: 0 });
    jukebox(b, W / 2 - 0.55, cz + 2.0, -Math.PI / 2);
    // Mesas.
    const zs = [cz + 3.0, cz + 5.4, cz + 7.8];
    for (const z of zs) for (let x = -W / 2 + 2.0; x < W / 2 - 2.0; x += 3.2) {
      if (Math.abs(x - ctx.doorX) < 1.8 && z > D / 2 - 3) continue;
      table(b, x, z, { round: true, w: 0.8, top: mat(0x4a2a1a, 0.4) });
      chair(b, x - 0.75, z, Math.PI / 2, { seat: mat(0x2a3346, 0.6) });
      chair(b, x + 0.75, z, -Math.PI / 2, { seat: mat(0x2a3346, 0.6) });
      lampPendant(b, x, H, z, 0xffb36b, { shade: mat(0x1a2a4a, 0.5) });
    }
    // Faixas de luz indireta sob o balcão e no teto.
    b.box(glow(0x45a0ff, 1.8), 0.6, 0.06, cz + 0.32, len, 0.03, 0.02, { r: 0 });
    b.box(glow(0xffb36b, 1.0), 0, H - 0.05, 0, W - 1, 0.02, 0.05, { r: 0 });
    room(b, ctx, { x: -W / 2 + 1.5, z: -D / 2 + 1.0, w: 2.4, d: 2.0, h: 2.6, wallMat: mat(0x2a3346, 0.8), label: 'BANHEIRO', fixtures: (bb) => bb.box(mat(0xe8e8ec, 0.3), -W / 2 + 1.5, 0, -D / 2 + 0.35, 0.55, 0.85, 0.4, { r: 0.04, collide: true }) });
    ctx.spots = { cz, len };
    b.interact({ id: 'bartender', x: 0.6, y: 1.1, z: cz + 1.2, label: 'FALAR COM O BARTENDER', radius: 1.6, action: (api) => barTalk(api) });
    b.interact({ id: 'jukebox', x: W / 2 - 1.2, y: 1.0, z: cz + 2.0, label: 'USAR A JUKEBOX', action: (api) => jukeboxPage(api, 'Jukebox Starliner') });
    b.interact({ id: 'tv', x: -W / 2 + 1.4, y: 1.2, z: cz - 0.3, label: 'ASSISTIR À TV', action: () => infoPage('TV', 'Canal 86: previsão de céu limpo, maré alta às 22h e o resultado da regata de Sunset Beach.') });
  },
  npcs(inst) {
    const s = inst.ctx.spots;
    return [
      { role: 'bartender', name: 'Sal', behavior: 'work', x: 0.6, z: s.cz - 0.75, yaw: 0, uniform: SKIN_STAFF(0xf2f2ee, 0x1a1a1e) },
      { role: 'waitress', name: 'Nina', behavior: 'patrol', points: [[0.6 - s.len / 3, s.cz + 1.8], [-inst.W / 2 + 3.6, s.cz + 4.2], [inst.W / 2 - 3.0, s.cz + 4.2]], speed: 0.9, uniform: SKIN_STAFF(0x45a0ff, 0x1a1a1e) },
      { role: 'customer', behavior: 'talk', seat: 1 }, { role: 'customer', behavior: 'talk', seat: 2 }, { role: 'customer', behavior: 'sit', seat: 5 },
      { role: 'customer', behavior: 'talk', seat: 12 }, { role: 'customer', behavior: 'talk', seat: 13 },
    ];
  },
};

function barTalk(api) {
  const who = 'Sal (bartender)';
  const root = () => ({
    who, text: 'Noite tranquila no Blue Horizon. Senta aí — o que vai ser?',
    options: [
      { label: 'Ver o cardápio', run: () => shopPage(api, who, 'Bebidas da casa e petiscos.', BAR_DRINKS, root) },
      { label: 'Alguma novidade na cidade?', run: () => infoPage(who, 'Dizem que vão abrir uma discoteca nova na Coral Street. E o pessoal da oficina está trabalhando até tarde.', root) },
      { label: 'Até a próxima', run: () => null },
    ],
  });
  return root();
}

// ======================================================================
// 08 — HOTEL AZURE PALMS
// ======================================================================
const hotel = {
  id: 'azure_palms', type: 'hotel', name: 'AZURE PALMS HOTEL', buildingId: 'bld_e_back_1',
  sign: { text: 'Azure Palms', color: '#45f3ff', style: 'script', sub: 'HOTEL', w: 3.8, h: 1.0 },
  size: { w: 20, d: 14, h: 4.4 }, hours: null, doorColor: 0xd4a83a, doorWidth: 1.6,
  palette: P(0xe8dcc8, 0xf2ece2, 0xf6f2ea, 0xd4a83a),
  windows: [{ x: -0.32, w: 3.0 }, { x: 0.32, w: 3.0 }],
  light: { sky: 0xfff1dc, ground: 0x8a7a6a, hemi: 1.05, exposure: 1.0, windowColor: 0xffe8c8, poolStrength: 0.4, points: [{ x: 0, y: 3.6, z: 0.1, color: 0xffe2b8, intensity: 10, distance: 14 }, { x: 0, y: 3.3, z: -0.35, color: 0xfff0d8, intensity: 6, distance: 10 }] },
  audio: { track: 'lounge', ambience: 'hotel' },
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    // Recepção em "mármore", painel de chaves, faixas Art Déco.
    const rz = -D / 2 + 3.0;
    counter(b, 0, rz, 5.0, 0, { front: mat(0xf0e8dc, 0.25, 0.1), top: mat(0x2a2a2e, 0.15, 0.4), accent: mat(0xd4a83a, 0.3, 0.8) });
    b.box(mat(0x6b3b22, 0.5), 0, 1.2, -D / 2 + 0.05, 2.4, 1.0, 0.06, { r: 0 });
    for (let k = 0; k < 12; k++) b.box(mat(0xd4a83a, 0.3, 0.9), -1.0 + (k % 6) * 0.4, 1.45 + Math.floor(k / 6) * 0.4, -D / 2 + 0.1, 0.05, 0.12, 0.02, { r: 0 });
    for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) for (const y of [1.2, 3.4]) b.box(mat(0xd4a83a, 0.3, 0.8), x, y, 0, 0.03, 0.08, D - 0.5, { r: 0 });
    // Colunas, lounge com sofás, tapete, plantas, lustre.
    for (const sx of [-1, 1]) b.cyl(mat(0xf0e8dc, 0.3, 0.1), sx * 4.0, 0, 0.8, 0.3, 0.3, H, 16, { collide: true });
    const lx = ctx.doorX > 0 ? -W / 2 + 3.5 : W / 2 - 3.5;
    b.box(mat(0x2a6a8a, 0.9), lx, 0.002, 1.5, 4.4, 0.006, 3.6, { r: 0 });
    sofa(b, lx, 0.2, 0, { uph: mat(0x45c8b8, 0.6), w: 2.4 });
    sofa(b, lx, 2.9, Math.PI, { uph: mat(0x45c8b8, 0.6), w: 2.4 });
    table(b, lx, 1.55, { w: 1.2, d: 0.6, h: 0.42, top: mat(0x2a2a2e, 0.2, 0.4) });
    plant(b, lx - 2.4, 0.0, 1.6);
    plant(b, lx + 2.4, 3.2, 1.6);
    b.sphere(glow(0xfff0d0, 2.0), 0, H - 0.6, 0.8, 0.35, 12);
    b.cyl(mat(0xd4a83a, 0.3, 0.9), 0, H - 0.45, 0.8, 0.5, 0.2, 0.25, 16);
    b.pool(0, 0.8, 3.5, 0xffe2b8);
    // Elevadores no fundo (lado oposto à recepção).
    const ex = W / 2 - 2.4;
    for (const k of [0, 1]) {
      b.box(mat(0xd4a83a, 0.3, 0.35), ex - 1.2 + k * 2.0, 0, -D / 2 + 0.06, 1.4, 2.5, 0.06, { r: 0 });
      b.box(mat(0xc9ced6, 0.25, 0.35), ex - 1.2 + k * 2.0, 0, -D / 2 + 0.1, 1.2, 2.3, 0.02, { r: 0 });
      b.box(glow(0xffe95a, 1.4), ex - 1.2 + k * 2.0, 2.65, -D / 2 + 0.08, 0.5, 0.15, 0.02, { r: 0 });
    }
    // ---- 3º andar (acima do saguão, mesma planta): corredor, quarto modelo, banheiro.
    const Y = H + 0.3, H2 = 3.0;
    b.box(mat(0x8a3b4a, 0.9), 0, Y - 0.12, 0, W, 0.12, D, { r: 0 });
    b.collider(0, 0, W, D, Y - 0.6, Y, { walkable: true });
    b.box(mat(0xf6f2ea, 0.9), 0, Y + H2, 0, W, 0.1, D, { r: 0 });
    for (const [x, z, w, d] of [[-W / 2, 0, 0.2, D], [W / 2, 0, 0.2, D], [0, -D / 2, W, 0.2], [0, D / 2, W, 0.2]]) b.box(mat(0xf2ece2, 0.85), x, Y, z, w, H2, d, { r: 0, collide: true });
    // Parede do corredor (z = 1.0) com portas: 304 (abre), 303 e 305 (ocupados).
    const cwz = 0.6;
    const doors = [-5, 0, 5];
    let cur = -W / 2;
    for (const dx of doors) { const a = dx - 0.55; b.box(mat(0xe8dcc8, 0.85), (cur + a) / 2, Y, cwz, a - cur, H2, 0.15, { r: 0, collide: true }); b.box(mat(0xe8dcc8, 0.85), dx, Y + 2.2, cwz, 1.1, H2 - 2.2, 0.15, { r: 0 }); cur = dx + 0.55; }
    b.box(mat(0xe8dcc8, 0.85), (cur + W / 2) / 2, Y, cwz, W / 2 - cur, H2, 0.15, { r: 0, collide: true });
    // Divisórias entre quartos.
    for (const x of [-2.5, 2.5]) b.box(mat(0xe8dcc8, 0.85), x, Y, -D / 2 + (D / 2 + cwz) / 2, 0.15, H2, D / 2 + cwz, { r: 0, collide: true });
    doors.forEach((dx, i) => innerDoor(b, ctx, { id: `quarto${303 + i}`, x: dx, y: Y, z: cwz, w: 0.95, label: `QUARTO ${303 + i}`, locked: i !== 1, lockedText: 'OCUPADO — NÃO PERTURBE', color: 0x6b3b22 }));
    // Quarto 304 (centro, x −2,5…2,5): cama, criados-mudos, TV, poltrona, janela e banheiro com porta.
    const bedX = -0.6;
    b.box(mat(0x6b3b22, 0.6), bedX, Y, -D / 2 + 1.3, 2.0, 0.45, 2.2, { r: 0.05, collide: true });
    b.box(mat(0xf6f2ea, 0.7), bedX, Y + 0.45, -D / 2 + 1.35, 1.9, 0.2, 2.1, { r: 0.08 });
    b.box(mat(0x45c8b8, 0.8), bedX, Y + 0.62, -D / 2 + 1.9, 1.9, 0.06, 1.1, { r: 0.03 });
    b.box(mat(0xffffff, 0.8), bedX, Y + 0.65, -D / 2 + 0.55, 1.4, 0.14, 0.4, { r: 0.06 });
    b.box(mat(0x6b3b22, 0.6), bedX, Y + 0.45, -D / 2 + 0.2, 2.1, 1.0, 0.12, { r: 0.03 });
    for (const sx of [bedX - 1.3, bedX + 1.3]) { b.box(mat(0x6b3b22, 0.6), sx, Y, -D / 2 + 0.5, 0.5, 0.55, 0.45, { r: 0.03, collide: true }); b.sphere(glow(0xffd8a0, 1.6), sx, Y + 0.8, -D / 2 + 0.5, 0.12, 8); }
    // Cômoda com TV junto à parede do corredor, virada para a cama.
    const screen = tvScreen(ctx, 'show');
    b.box(mat(0x6b3b22, 0.6), -1.5, Y, 0.2, 1.1, 0.6, 0.5, { r: 0.03, collide: true });
    crtTV(b, -1.5, Y + 0.6, 0.2, Math.PI, screen, 0.5);
    // Poltrona.
    b.box(mat(0x45c8b8, 0.6), 1.5, Y, -2.6, 0.75, 0.45, 0.75, { r: 0.08, ry: -0.75, collide: true, block: false });
    b.box(mat(0x45c8b8, 0.6), 1.5 + Math.sin(-0.75 + Math.PI) * 0.3, Y + 0.45, -2.6 + Math.cos(-0.75 + Math.PI) * 0.3, 0.75, 0.5, 0.16, { r: 0.06, ry: -0.75 });
    b.seat(1.5, Y + 0.45, -2.6, -0.75, 'chair');
    b.seats[b.seats.length - 1].floor = Y;
    // Janela com persianas iluminadas (a vista real não é renderizada no andar).
    b.panel(mat(0x222a33, 0.6, 0, { emissive: 0xffe8c8, emissiveIntensity: 0.6 }), bedX - 1.3, Y + 1.6, -D / 2 + 0.12, 0.9, 1.0);
    for (let k = 0; k < 6; k++) b.box(mat(0xe9e2d4, 0.6), bedX - 1.3, Y + 1.15 + k * 0.17, -D / 2 + 0.16, 0.86, 0.03, 0.04, { r: 0 });
    // Banheiro no canto (pia, espelho, vaso, box).
    room(b, ctx, {
      x: 1.8, y: Y, z: -D / 2 + 1.3, w: 1.3, d: 2.6, h: H2, wallMat: mat(0xe8e8ee, 0.5), label: 'BANHEIRO',
      fixtures: (bb) => {
        bb.box(mat(0xf4f4f6, 0.3, 0.1), 1.8, Y, -D / 2 + 0.35, 0.45, 0.42, 0.55, { r: 0.08, collide: true });
        bb.box(mat(0xf4f4f6, 0.3, 0.1), 2.25, Y + 0.75, -D / 2 + 1.5, 0.3, 0.12, 0.5, { r: 0.04 });
        bb.box(MIRROR(), 2.38, Y + 1.1, -D / 2 + 1.5, 0.02, 0.7, 0.5, { r: 0 });
        bb.box(mat(0x9fc6d8, 0.05, 0.1, { transparent: true, opacity: 0.35 }), 1.3, Y, -D / 2 + 0.6, 0.02, 2.0, 1.1, { r: 0 });
      },
    });
    ceilingPanel(b, 1.8, Y + H2, -D / 2 + 1.3, 0.6, 0.6, 0xffffff, 1.4);
    // Elevador do andar e sinalização.
    for (const k of [0, 1]) b.box(mat(0xc9ced6, 0.25, 0.35), ex - 1.2 + k * 2.0, Y, D / 2 - 0.12, 1.2, 2.3, 0.02, { r: 0 });
    const plate = textTexture([['303 · 304 · 305', '']], { title: '3º ANDAR', w: 256, h: 128, bg: '#f2ece2', fg: '#6b3b22', accent: '#d4a83a' });
    wallSign(ctx, plate, ex - 3.2, Y + 1.6, D / 2 - 0.12, 0.8, 0.4, Math.PI);
    ceilingPanel(b, 0, Y + H2, 2.5, 6, 0.3, 0xfff0d8, 1.2);
    ceilingPanel(b, bedX, Y + H2, -3.2, 1.2, 1.2, 0xfff0d8, 1.0);
    ctx.floors = {
      lobby: { x: ex - 0.2, y: 0, z: -D / 2 + 1.4, yaw: 0 },
      upper: { x: ex - 0.2, y: Y, z: D / 2 - 1.4, yaw: Math.PI },
    };
    ctx.spots = { rz, lx, ex, Y };
    const elevatorPage = (api) => ({ who: 'Elevador', text: 'Selecione o andar.', options: [{ label: 'Térreo — saguão', run: () => { api.elevator('lobby'); return null; } }, { label: '3º andar — quartos 303 a 305', run: () => { api.elevator('upper'); return null; } }, { label: 'Cancelar', run: () => null }] });
    b.interact({ id: 'elevador', x: ex - 0.2, y: 1.1, z: -D / 2 + 1.0, label: 'CHAMAR ELEVADOR', action: (api) => elevatorPage(api) });
    b.interact({ id: 'elevador_3', x: ex - 0.2, y: Y + 1.1, z: D / 2 - 1.0, label: 'CHAMAR ELEVADOR', action: (api) => elevatorPage(api) });
    b.interact({ id: 'recepcao', x: 0, y: 1.1, z: rz + 0.9, label: 'FALAR COM A RECEPCIONISTA', action: (api) => hotelTalk(api) });
    b.interact({ id: 'cama', x: bedX, y: Y + 0.8, z: -D / 2 + 2.8, label: 'DEITAR NA CAMA', action: (api) => { api.status.setHealth(api.status.health + 5); return infoPage('Quarto 304', 'Lençóis frescos, ar-condicionado silencioso e o som distante do mar. Você descansa um pouco (+5 de vida).'); } });
    b.interact({ id: 'abajur', x: 0.8, y: Y + 1.1, z: cwz - 0.25, label: 'INTERRUPTOR DO QUARTO', radius: 1.2, action: (api) => { const off = api.toggleLights(); api.toast(off ? 'Luzes apagadas' : 'Luzes acesas'); return null; } });
  },
  npcs(inst) {
    const s = inst.ctx.spots;
    return [
      { role: 'receptionist', name: 'Claire', behavior: 'stand', x: 0.6, z: s.rz - 0.8, yaw: 0, uniform: SKIN_STAFF(0x2a4a7a, 0x2a2a2e, { skirt: 0x2a2a2e, skirtLen: 0.9 }) },
      { role: 'bellboy', name: 'Teo', behavior: 'patrol', points: [[s.ex - 1.0, -inst.D / 2 + 1.6], [inst.ext.doorX, inst.D / 2 - 2.2], [s.lx + 1.6, 1.5]], speed: 0.8, uniform: SKIN_STAFF(0xb0203a, 0x1a1a1e) },
      { role: 'guest', behavior: 'talk', seat: 0 }, { role: 'guest', behavior: 'talk', seat: 2 },
      { role: 'housekeeper', behavior: 'patrol', y: s.Y, points: [[-6, 1.8], [6, 1.8]], speed: 0.6, uniform: SKIN_STAFF(0xe8e8ee, 0x45c8b8) },
    ];
  },
};

function hotelTalk(api) {
  const who = 'Claire (recepção)';
  const root = () => ({
    who, text: 'Boa noite. Bem-vindo ao Azure Palms. Em que posso ser útil?',
    options: [
      { label: 'Conhecer o quarto modelo (304)', run: () => infoPage(who, 'Fica no 3º andar — use o elevador ao fundo. A porta do 304 está destrancada para visitas.', root) },
      { label: 'Diária do hotel', run: () => infoPage(who, 'Quarto vista mar: $89 a diária, café da manhã incluso. As reservas abrem em breve.', root) },
      { label: 'Obrigado', run: () => null },
    ],
  });
  return root();
}

// ======================================================================
// 09 — LANCHONETE MOONLIGHT DINER
// ======================================================================
const DINER_MENU = [
  { id: 'burger', label: 'Hambúrguer Moonlight', price: 7, effect: { pickup: true, pickupHeal: 18 }, done: 'Hambúrguer saindo! Está no balcão.' },
  { id: 'milkshake', label: 'Milk-shake de morango', price: 4, effect: { heal: 6 } },
  { id: 'torta', label: 'Torta de limão', price: 3, effect: { heal: 5 } },
  { id: 'cafe', label: 'Café passado', price: 2, effect: { heal: 3 } },
];

const diner = {
  id: 'moonlight_diner', type: 'lanchonete', name: 'MOONLIGHT DINER', buildingId: 'bld_sw_4',
  sign: { text: 'Moonlight Diner', color: '#ff4fd8', style: 'script', sub: 'ABERTO 24H', w: 3.8, h: 1.0 },
  size: { w: 13, d: 16, h: 3.6 }, hours: null, bell: true, doorColor: 0xc9cdd3,
  palette: P(0xf2f2f2, 0xf4e8f0, 0xf6f4f2, 0xff4fb8),
  windows: [{ x: -0.3, w: 3.0 }, { x: 0.3, w: 3.0 }],
  light: { sky: 0xffeaf6, ground: 0x6a5060, hemi: 1.05, exposure: 1.0, windowColor: 0xffc8e8, poolStrength: 0.45, points: [{ x: 0, y: 3.0, z: 0, color: 0xfff0f6, intensity: 9, distance: 12 }, { x: -0.3, y: 2.8, z: -0.3, color: 0xff7ad0, intensity: 4, distance: 8 }] },
  audio: { track: 'sunrise', ambience: 'diner' },
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    // Piso quadriculado preto e branco (instanciado).
    const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.004, 0.5), mat(0x1a1a1e, 0.4), Math.ceil(W * D * 2));
    const mm = new THREE.Matrix4();
    let n = 0;
    for (let x = -W / 2 + 0.25; x < W / 2; x += 0.5) for (let z = -D / 2 + 0.25; z < D / 2; z += 0.5) {
      if ((Math.round((x + W) * 2) + Math.round((z + D) * 2)) % 2) continue;
      mm.makeTranslation(x, 0.002, z);
      tiles.setMatrixAt(n++, mm);
    }
    tiles.count = n;
    tiles.receiveShadow = true;
    extra(ctx, tiles);
    // Balcão comprido com banquetas; cozinha atrás com janela de passagem.
    const side = ctx.doorX > 0 ? -1 : 1;
    const cx = side * (W / 2 - 2.6);
    counter(b, cx, -0.6, D - 6.0, Math.PI / 2, { front: mat(0xc9cdd3, 0.25, 0.8), top: mat(0xff4fb8, 0.35), accent: glow(0x45f3ff, 1.4) });
    for (let k = 0; k < 7; k++) stool(b, cx - side * 0.95, -0.6 - (D - 6) / 2 + 0.6 + k * ((D - 7) / 6), -side * Math.PI / 2, { seat: mat(0xff4fb8, 0.45) });
    const kx = side * (W / 2 - 0.9);
    b.box(mat(0xd9dde2, 0.35, 0.5), kx, 0, -1.5, 1.0, 0.95, 4.0, { r: 0.02, collide: true });
    b.box(glow(0xff6a1f, 1.4), kx, 0.95, -2.2, 0.8, 0.02, 1.2, { r: 0 });
    b.box(mat(0xc9cdd3, 0.3, 0.8), cx, 1.15, -0.6 - (D - 6) / 2 + 1.0, 0.45, 0.4, 0.35, { r: 0.03 });
    b.box(mat(0x2a2a2e, 0.4), cx, 1.15, -0.6 + (D - 6) / 2 - 1.0, 0.3, 0.45, 0.3, { r: 0.03 });
    // Cardápio iluminado sobre a cozinha.
    const menu = textTexture([['Hambúrguer Moonlight', '$7'], ['Milk-shake', '$4'], ['Torta de limão', '$3'], ['Café', '$2']], { title: 'MOONLIGHT', w: 512, h: 320, bg: '#1a0f20', accent: '#ff4fd8' });
    wallSign(ctx, menu, side * (W / 2 - 0.05), 2.5, -1.2, 2.4, 1.5, -side * Math.PI / 2);
    // Cabines ao longo da parede oposta.
    for (let z = -D / 2 + 1.6; z < D / 2 - 2.6; z += 2.4) booth(b, -side * (W / 2 - 1.0), z, side * Math.PI / 2, { uph: mat(0x45c8b8, 0.55) });
    jukebox(b, -side * (W / 2 - 0.55), D / 2 - 1.6, side * Math.PI / 2);
    // Máquina de refrigerante e neon de lua.
    b.box(mat(0xd8283a, 0.4, 0.3), -side * 1.0, 0, -D / 2 + 0.5, 0.9, 1.9, 0.7, { r: 0.05, collide: true });
    b.box(glow(0xffffff, 1.0), -side * 1.0, 1.0, -D / 2 + 0.86, 0.7, 0.7, 0.01, { r: 0 });
    b._add(new THREE.TorusGeometry(0.5, 0.06, 8, 24, Math.PI * 1.4), glow(0xffe95a, 2.4), 0, 2.6, -D / 2 + 0.06, 0, 0, 0.6);
    for (let z = -D / 2 + 2; z < D / 2 - 1; z += 3) ceilingPanel(b, 0, H, z, 1.4, 0.5, 0xfff0f6, 1.3);
    ctx.spots = { cx, side, kx };
    ctx.pickupSpot = { x: cx, y: 1.08, z: -0.6 + 1.0 };
    b.interact({ id: 'atendente', x: cx - side * 1.1, y: 1.1, z: 0.4, label: 'FAZER PEDIDO', radius: 1.6, action: (api) => dinerTalk(api) });
    b.interact({ id: 'jukebox', x: -side * (W / 2 - 1.3), y: 1.0, z: D / 2 - 1.6, label: 'USAR A JUKEBOX', action: (api) => jukeboxPage(api, 'Jukebox do Moonlight') });
    b.interact({ id: 'refri', x: -side * 1.0, y: 1.0, z: -D / 2 + 1.4, label: 'MÁQUINA DE REFRIGERANTE', action: (api) => shopPage(api, 'Máquina', 'Escolha um refrigerante.', [{ id: 'cola_moon', label: 'Moon Cola', price: 2, effect: { heal: 3 } }, { id: 'uva', label: 'Refrigerante de uva', price: 2, effect: { heal: 3 } }]) });
  },
  npcs(inst) {
    const s = inst.ctx.spots;
    return [
      { role: 'waitress', name: 'Dolly', behavior: 'patrol', points: [[s.cx - s.side * 1.6, -2.5], [s.cx - s.side * 1.6, 2.5], [-s.side * 2.6, 0]], speed: 0.9, uniform: SKIN_STAFF(0xff8fcf, 0xffffff, { skirt: 0xff8fcf, skirtLen: 1.0 }) },
      { role: 'cook', name: 'Hank', behavior: 'work', x: s.kx - s.side * 0.9, z: -1.8, yaw: s.side * Math.PI / 2, uniform: SKIN_STAFF(0xffffff, 0x3a3a40) },
      { role: 'attendant', name: 'June', behavior: 'stand', x: s.cx + s.side * 0.7, z: 0.4, yaw: -s.side * Math.PI / 2, uniform: SKIN_STAFF(0x45c8b8, 0xffffff) },
      { role: 'customer', behavior: 'sit', seat: 0 }, { role: 'customer', behavior: 'talk', seat: 3 },
      { role: 'customer', behavior: 'talk', seat: 7 }, { role: 'customer', behavior: 'talk', seat: 8 },
    ];
  },
};

function dinerTalk(api) {
  const who = 'June (atendente)';
  const root = () => ({
    who, text: 'Oi, querido! Mesa, balcão ou para viagem? A torta de limão acabou de sair.',
    options: [
      { label: 'Pedir comida', run: () => shopPage(api, who, 'O que vai ser?', DINER_MENU, root) },
      { label: 'Conversar', run: () => infoPage(who, 'Trabalho no turno da madrugada há seis anos. Os motoristas de táxi juram que nosso café é o melhor da costa.', root) },
      { label: 'Tchau', run: () => null },
    ],
  });
  return root();
}

// ======================================================================
// 10 — LOJA DE ELETRÔNICOS VOLTAGE
// ======================================================================
const ELECTRO = [
  { id: 'walkman', label: 'Toca-fitas portátil "Volt Walk"', price: 80, durable: true, unique: true },
  { id: 'boombox', label: 'Rádio portátil "Coastline 2000"', price: 150, durable: true, unique: true },
  { id: 'vcr', label: 'Videocassete "Nova VX-4"', price: 260, durable: true, unique: true },
  { id: 'telefone', label: 'Telefone sem fio "Breeze"', price: 95, durable: true, unique: true },
  { id: 'vector64', label: 'Computador doméstico "Vector 64"', price: 400, durable: true, unique: true },
];

const electronics = {
  id: 'voltage', type: 'eletronicos', name: 'VOLTAGE ELECTRONICS', buildingId: 'bld_nw_3',
  sign: { text: 'Voltage', color: '#45f3ff', style: 'block', sub: 'ELECTRONICS', w: 3.6, h: 1.0 },
  size: { w: 16, d: 15, h: 3.6 }, hours: [9, 21], bell: true, doorColor: 0x2a2e34,
  palette: P(0x3a3e46, 0xe8ecf2, 0xf2f4f6, 0x45f3ff),
  windows: [{ x: -0.3, w: 3.0 }, { x: 0.32, w: 3.0 }],
  light: { sky: 0xeaf4ff, ground: 0x4a4a54, hemi: 1.0, exposure: 1.0, windowColor: 0xd8f0ff, poolStrength: 0.3, points: [{ x: 0, y: 3.0, z: 0, color: 0xeaf6ff, intensity: 9, distance: 13 }] },
  audio: { track: null, ambience: 'electronics', radio: 'street_beat' },
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    // Parede de TVs de tubo (todas com a mesma tela animada).
    const screen = tvScreen(ctx, 'bars');
    const screen2 = tvScreen(ctx, 'show');
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      const x = -2.6 + c * 1.3, y = 0.6 + r * 0.85;
      crtTV(b, x, y, -D / 2 + 0.45, 0, (r + c) % 2 ? screen : screen2, 0.55);
    }
    b.box(mat(0x2a2e34, 0.5), 0, 0, -D / 2 + 0.45, 6.8, 0.6, 0.6, { r: 0.02, collide: true });
    for (const r of [1, 2]) b.box(mat(0x2a2e34, 0.5), 0, 0.56 + r * 0.85, -D / 2 + 0.45, 6.8, 0.04, 0.6, { r: 0 });
    for (const sx of [-3.38, 3.38]) b.box(mat(0x2a2e34, 0.5), sx, 0, -D / 2 + 0.45, 0.05, 3.0, 0.6, { r: 0 });
    b.collider(0, -D / 2 + 0.45, 6.8, 0.7, 0, 3.2);
    // Prateleiras com rádios, aparelhos de som, videocassetes e telefones.
    const shelfX = ctx.doorX > 0 ? -W / 2 + 0.4 : W / 2 - 0.4;
    const yaw = ctx.doorX > 0 ? Math.PI / 2 : -Math.PI / 2;
    shelfUnit(b, shelfX, -0.5, 6.0, yaw, { color: mat(0x2a2e34, 0.4, 0.3), h: 2.0, levels: 3, depth: 0.5 });
    const dev = [0x2a2a2e, 0xc9cdd3, 0x3a3a40, 0xd8283a, 0x1a1a1e];
    const sl = [];
    for (let lv = 0; lv < 3; lv++) sl.push({ x: shelfX + Math.sign(-shelfX) * 0.05, y: lv === 0 ? 0.1 : lv * (2.0 / 3.4) + 0.03, z: -0.5, yaw });
    extra(ctx, productInstances(sl, dev, { kind: 'box', perSlot: 16, len: 5.6 }));
    // Mesas com computadores domésticos fictícios (telas verdes).
    const greenTex = textTexture(['READY.', '10 PRINT "VOLTAGE"', '20 GOTO 10', 'RUN'], { w: 256, h: 192, bg: '#04140a', fg: '#4dff7a', accent: '#0a3a1a' });
    const green = new THREE.MeshBasicMaterial({ map: greenTex, toneMapped: false });
    const tx = -Math.sign(shelfX) * (W / 2 - 3.0);
    for (let k = 0; k < 3; k++) {
      const z = -2.0 + k * 2.2;
      table(b, tx, z, { w: 1.6, d: 0.8, h: 0.78, top: mat(0xe8ecf2, 0.4), leg: mat(0x2a2e34, 0.4, 0.5) });
      b.box(mat(0xd9d4c8, 0.6), tx, 0.78, z + 0.1, 0.9, 0.08, 0.35, { r: 0.02 });
      crtTV(b, tx, 0.86, z - 0.15, 0, green, 0.42);
    }
    // Balcão e caixa perto da entrada; pôsteres de marcas fictícias.
    const cX = ctx.doorX + (ctx.doorX > 0 ? -3.0 : 3.0);
    counter(b, cX, D / 2 - 3.0, 2.6, 0, { front: mat(0x2a2e34, 0.4), top: mat(0x45f3ff, 0.3, 0.2) });
    register(b, cX + 0.6, 1.05, D / 2 - 3.05);
    const poster = textTexture(['ALTA FIDELIDADE', 'GARANTIA 1 ANO'], { title: 'NOVA VX-4', w: 256, h: 320, bg: '#120a24', accent: '#45f3ff' });
    wallSign(ctx, poster, -Math.sign(shelfX) * (W / 2 - 0.04), 1.9, 2.8, 0.9, 1.1, Math.sign(shelfX) * Math.PI / 2);
    // Ilha central de exposição: rádios portáteis e toca-fitas (modelos fictícios).
    const isX = -Math.sign(shelfX) * 1.2;
    b.box(mat(0x2a2e34, 0.4, 0.3), isX, 0, -0.6, 2.6, 0.85, 1.1, { r: 0.03, collide: true });
    b.box(glow(0x45f3ff, 1.4), isX, 0.86, -0.6, 2.62, 0.02, 1.12, { r: 0 });
    for (let k = 0; k < 4; k++) {
      const x = isX - 0.95 + k * 0.63;
      b.box(mat(dev[k % dev.length], 0.4, 0.4), x, 0.88, -0.6, 0.5, 0.26, 0.16, { r: 0.03 });
      for (const sx of [-0.13, 0.13]) b.cyl(mat(0x111114, 0.6), x + sx, 0.92, -0.51, 0.07, 0.07, 0.01, 12, { rx: Math.PI / 2 });
      b.box(glow(0xff4fd8, 1.2), x, 1.1, -0.6, 0.18, 0.02, 0.02, { r: 0 });
    }
    for (let x = -W / 2 + 2; x < W / 2 - 1; x += 3.6) for (const z of [-2.5, 2.0]) ceilingPanel(b, x, H, z, 1.5, 0.3, 0xeaf6ff, 1.5);
    ctx.spots = { cX, tx, shelfX };
    b.interact({ id: 'vendedor', x: cX, y: 1.1, z: D / 2 - 2.2, label: 'FALAR COM O VENDEDOR', action: (api) => electroTalk(api) });
    b.interact({ id: 'tvs', x: 0, y: 1.2, z: -D / 2 + 1.6, label: 'EXAMINAR TELEVISORES', radius: 1.8, action: () => infoPage('Parede de TVs', 'Televisores "Prisma" de 14 a 26 polegadas, controle remoto com fio e som estéreo. Exibindo o Canal 86 e a tela de teste.') });
    b.interact({ id: 'computador', x: tx + Math.sign(shelfX) * 1.0, y: 1.1, z: 0.2, label: 'TESTAR O VECTOR 64', action: () => infoPage('Vector 64', '64 KB de memória, gravador de fita e oito cores. Na tela: 10 PRINT "VOLTAGE" / 20 GOTO 10. O vendedor diz que roda até jogo de corrida.') });
    b.interact({ id: 'prateleira', x: shelfX + Math.sign(-shelfX) * 1.0, y: 1.1, z: -0.5, label: 'VER APARELHOS', radius: 1.6, action: (api) => electroShop(api, null) });
  },
  npcs(inst) {
    const s = inst.ctx.spots;
    return [
      { role: 'seller', name: 'Max', behavior: 'stand', x: s.cX, z: inst.D / 2 - 3.8, yaw: 0, uniform: SKIN_STAFF(0x2a4a8a, 0x2a2a2e) },
      { role: 'clerk', behavior: 'patrol', points: [[s.shelfX + Math.sign(-s.shelfX) * 1.2, -2.5], [s.shelfX + Math.sign(-s.shelfX) * 1.2, 2.0]], speed: 0.7, uniform: SKIN_STAFF(0x45f3ff, 0x2a2a2e) },
      { role: 'customer', behavior: 'stand', x: 0.4, z: -inst.D / 2 + 2.2, yaw: Math.PI },
      { role: 'customer', behavior: 'stand', x: s.tx + Math.sign(s.shelfX) * 0.9, z: -2.0, yaw: -Math.sign(s.shelfX) * Math.PI / 2 },
    ];
  },
};

function electroShop(api, back) {
  const who = 'Voltage Electronics';
  const page = (msg) => ({
    who, text: msg,
    options: [
      ...ELECTRO.map((e) => ({ label: `${e.label} — $${e.price}${api.save.owns(e.id) ? ' (você já tem)' : ''}`, disabled: !!api.save.owns(e.id), run: () => page(api.buy(e).msg) })),
      back ? { label: 'Voltar', run: back } : { label: 'Sair', run: () => null },
    ],
  });
  return page('Preços com garantia. Itens comprados ficam registrados (o inventário completo virá em outra etapa).');
}

function electroTalk(api) {
  const who = 'Max (vendedor)';
  const root = () => ({
    who, text: 'Temos novidades chegando esta semana: o videocassete Nova VX-4 com controle remoto!',
    options: [
      { label: 'Consultar preços', run: () => electroShop(api, root) },
      { label: 'O que você recomenda?', run: () => infoPage(who, 'Para a praia, o Coastline 2000: duas fitas, rádio FM e graves que fazem tremer o calçadão.', root) },
      { label: 'Volto depois', run: () => null },
    ],
  });
  return root();
}

// ======================================================================
// TEST CITY — prédio de teste próprio
// ======================================================================
export const TEST_INTERIOR = {
  id: 'test_room', type: 'teste', name: 'SALA DE TESTE', buildingId: null,
  building: { w: 10, d: 9 },
  // Áreas livres e planas da praça/calçadas do GLB (varredura de colisores sólidos num raio de 6 m);
  // o primeiro ponto livre é usado. O GLB não é alterado: o prédio é geometria própria.
  testSpots: [{ x: -6, z: -30, rotY: Math.PI / 2 }, { x: 18, z: -36, rotY: -Math.PI / 2 }, { x: -64, z: 16, rotY: Math.PI / 2 }],
  sign: { text: 'Test Room', color: '#45f3ff', style: 'block', sub: 'INTERIOR DE TESTE', w: 3.0, h: 0.8 },
  size: { w: 9, d: 8, h: 3.4 }, hours: null, bell: true, doorColor: 0x2a6f6a,
  palette: P(0xcfc6b8, 0xf2ece2, 0xf6f4f2, 0x45c8b8),
  windows: [],
  light: { sky: 0xfff4e8, ground: 0x7a6a5a, hemi: 1.1, exposure: 1.0, windowColor: 0xffe8c8, poolStrength: 0.4, points: [{ x: 0, y: 2.8, z: 0, color: 0xffe2b8, intensity: 8, distance: 10 }] },
  audio: { track: null, ambience: 'test' },
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    counter(b, 0, -D / 2 + 1.6, 3.0, 0, { front: mat(0x45c8b8, 0.5) });
    register(b, -0.8, 1.05, -D / 2 + 1.55);
    table(b, W / 2 - 1.8, 1.2, { round: true, w: 0.8 });
    chair(b, W / 2 - 2.55, 1.2, Math.PI / 2);
    chair(b, W / 2 - 1.05, 1.2, -Math.PI / 2);
    lampPendant(b, W / 2 - 1.8, H, 1.2);
    ctx.spots = {};
    ctx.pickupSpot = { x: 0.2, y: 1.08, z: -D / 2 + 1.6 };
    b.interact({ id: 'atendente', x: -0.8, y: 1.1, z: -D / 2 + 2.4, label: 'FALAR COM O ATENDENTE', action: (api) => ({ who: 'Atendente de teste', text: 'Sala de teste do sistema de interiores: porta, colisão, luz, NPC, interação e saída.', options: [{ label: 'Comprar café de teste — $1', run: () => infoPage('Atendente de teste', api.buy({ id: 'cafe_teste', label: 'Café de teste', price: 1, effect: { heal: 2 } }).msg) }, { label: 'Fechar', run: () => null }] }) });
  },
  npcs(inst) {
    return [{ role: 'attendant', behavior: 'stand', x: -0.8, z: -inst.D / 2 + 0.8, yaw: 0, uniform: SKIN_STAFF(0x45c8b8, 0x2a2a2e) }];
  },
};

export const INTERIORS = [pizzeria, market, workshop, club, disco, clothes, bar, hotel, diner, electronics];
