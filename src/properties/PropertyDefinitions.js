import * as THREE from 'three';
import {
  mat, glow, table, chair, stool, sofa, counter, lampPendant, ceilingPanel, fridge, crtTV, plant, textTexture, jukebox,
} from '../interiors/InteriorKit.js';
import {
  partition, bed, nightstand, wardrobe, locker, kitchenRun, toilet, bathSink, shower, rug, floorLamp, windowPanel,
  ceilingFan, panorama, pool, lounger, diningSet,
} from './PropertyFurniture.js';
import { PRICES } from '../economy/PriceDefinitions.js';

/**
 * Residências (PROMPT 07). Cada definição é ao mesmo tempo:
 *  - um interior do sistema existente (mesma porta, transição, colisão, luz,
 *    áudio e interações do PROMPT 06), e
 *  - uma propriedade: tipo, preço, recursos, garagem, ponto de salvamento.
 * As ações dos móveis (dormir, salvar, guarda-roupa, armário, garagem) são
 * ligadas ao PropertyManager por createPropertyDefs(pm).
 *
 * Garagens: coordenadas no espaço do PRÉDIO (lx, lz; +Z = fachada) ou do
 * mundo (world: true, ex.: vaga de rua reservada). heading em radianos.
 */
const P = (floor, wall, ceiling, trim) => ({ floor: mat(floor, 0.7), wall: mat(wall, 0.85), ceiling: mat(ceiling, 0.9), trim: mat(trim, 0.5, 0.2) });
const tex = (ctx, t, x, y, z, w, h, ry = 0) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
  m.position.set(x, y, z); m.rotation.y = ry; ctx.extras.push(m); return m;
};
const poster = (ctx, title, lines, x, y, z, ry, bg, accent) => tex(ctx, textTexture(lines, { title, w: 256, h: 340, bg, accent }), x, y, z, 0.6, 0.8, ry);

function homeInteractions(b, pm, def, spots) {
  b.interact({ id: 'cama', x: spots.bed[0], y: 0.8, z: spots.bed[1], label: 'DORMIR', prompt: 'PRESSIONE <kbd>E</kbd> PARA DORMIR', radius: 1.5, action: (api) => pm.sleepPage(def) });
  b.interact({ id: 'guarda_roupa', x: spots.wardrobe[0], y: 1.1, z: spots.wardrobe[1], label: 'ABRIR GUARDA-ROUPA', action: () => pm.wardrobePage(def) });
  b.interact({ id: 'armario', x: spots.storage[0], y: 1.1, z: spots.storage[1], label: 'ABRIR ARMÁRIO (ARMAS E ITENS)', action: () => pm.storagePage(def) });
  b.interact({ id: 'salvar', x: spots.save[0], y: 1.0, z: spots.save[1], label: 'SALVAR PROGRESSO', prompt: 'SALVAR PROGRESSO · PRESSIONE <kbd>E</kbd>', action: () => pm.savePage(def) });
  if (spots.garage) b.interact({ id: 'garagem', x: spots.garage[0], y: 1.2, z: spots.garage[1], label: 'PAINEL DA GARAGEM', action: () => pm.garagePage(def, true) });
}

export function createPropertyDefs(pm) {
  // ====================================================================
  // 01 — SUNSET APARTMENT (inicial, gratuito)
  // ====================================================================
  const apartment = {
    id: 'sunset_apartment', type: 'residencia', name: 'SUNSET APARTMENT', buildingId: 'bld_nw_1',
    sign: { text: 'Sunset Apts', color: '#45f3ff', style: 'block', sub: 'APARTAMENTOS', w: 2.6, h: 0.62 },
    size: { w: 10, d: 8, h: 2.9 }, hours: null, doorColor: 0x6b3b22, doorWidth: 1.0,
    palette: P(0xb88a5a, 0xf2e3d0, 0xf6f1ea, 0x45a0a8),
    windows: [{ x: -0.32, w: 1.8 }, { x: 0.32, w: 1.8 }],
    light: { sky: 0xffe4c4, ground: 0x7a5a4a, hemi: 1.0, exposure: 1.0, windowColor: 0xffc890, poolStrength: 0.45, env: 0.1, points: [{ x: -0.25, y: 2.5, z: 0.25, color: 0xffd8a8, intensity: 7, distance: 9 }, { x: 0.35, y: 2.5, z: -0.3, color: 0xffe2b8, intensity: 5, distance: 7 }] },
    audio: { track: null, ambience: 'home' },
    property: {
      kind: 'apartment_simple', typeLabel: 'Apartamento simples', price: PRICES.properties.sunset_apartment, starter: true,
      description: 'Um apartamento pequeno e aconchegante no prédio de esquina da Coral Street. Sala com TV, quarto, cozinha compacta e banheiro.',
      features: ['Cama (dormir)', 'Guarda-roupa', 'Armário de armazenamento', 'Ponto de salvamento'],
      garage: null, location: 'Coral Street, Sunset Beach',
    },
    layout(b, ctx) {
      const { w: W, d: D, h: H } = ctx;
      const wall = mat(0xf2e3d0, 0.85);
      // Divisórias: banheiro (x −1,5…0,6) e quarto (x 0,6…5) atrás; cozinha aberta à esquerda.
      partition(b, wall, -1.5, -0.6, W / 2, -0.6, H, [[-1.0, -0.1], [1.3, 2.25]]);
      partition(b, wall, -1.5, -D / 2, -1.5, -0.6, H);
      partition(b, wall, 0.6, -D / 2, 0.6, -0.6, H);
      pm.door(b, ctx, { id: 'banheiro', x: -0.55, z: -0.6, w: 0.9, label: 'BANHEIRO' });
      pm.door(b, ctx, { id: 'quarto', x: 1.775, z: -0.6, w: 0.95, label: 'QUARTO' });
      // Entrada.
      rug(b, ctx.doorX, D / 2 - 0.9, 1.4, 0.9, 0x8a3b4a);
      b.box(mat(0x6b3b22, 0.6), ctx.doorX + 1.4, 0, D / 2 - 0.35, 0.9, 0.85, 0.32, { r: 0.02, collide: true });
      for (let k = 0; k < 3; k++) b.cyl(mat(0xd9c58a, 0.3, 0.8), ctx.doorX - 0.8 + k * 0.18, 1.7, D / 2 - 0.06, 0.015, 0.015, 0.1, 6, { rx: Math.PI / 2 });
      // Sala: TV de tubo, sofá, mesa de centro, luminária, ventilador.
      const tvMat = pm.tvScreen(ctx);
      b.box(mat(0x6b3b22, 0.6), -W / 2 + 0.3, 0, 1.8, 0.45, 0.55, 1.2, { r: 0.02, collide: true });
      crtTV(b, -W / 2 + 0.32, 0.55, 1.8, Math.PI / 2, tvMat, 0.55);
      sofa(b, -1.4, 1.8, -Math.PI / 2, { uph: mat(0x45a0a8, 0.65), w: 2.0 });
      table(b, -2.9, 1.8, { w: 0.9, d: 0.55, h: 0.42, top: mat(0x8a5a3c, 0.45) });
      rug(b, -2.6, 1.8, 2.6, 2.0, 0x2a6a8a);
      floorLamp(b, -W / 2 + 0.4, D / 2 - 0.5);
      ceilingFan(ctx, -2.6, H, 1.8);
      plant(b, -W / 2 + 0.45, 0.0, 1.1);
      poster(ctx, 'SUNSET BEACH', ['SURF · SOL · NEON'], -W / 2 + 0.02, 1.7, 3.3, Math.PI / 2, '#ff6f91', '#ffe95a');
      // Escrivaninha com telefone e agenda = ponto de salvamento.
      b.box(mat(0x8a5a3c, 0.5), 3.2, 0.72, D / 2 - 0.45, 1.3, 0.05, 0.6, { r: 0.015 });
      for (const sx of [-0.6, 0.6]) b.box(mat(0x3a2a22, 0.5), 3.2 + sx, 0, D / 2 - 0.45, 0.05, 0.72, 0.55, { r: 0 });
      b.collider(3.2, D / 2 - 0.45, 1.3, 0.6, 0, 0.77);
      b.box(mat(0xf2ece2, 0.4), 2.85, 0.77, D / 2 - 0.4, 0.26, 0.09, 0.2, { r: 0.03 });
      b.box(glow(0xff4f6a, 1.4), 2.92, 0.86, D / 2 - 0.36, 0.04, 0.02, 0.04, { r: 0 });
      b.box(mat(0x2a6a8a, 0.6), 3.45, 0.77, D / 2 - 0.45, 0.32, 0.03, 0.24, { r: 0.01 });
      chair(b, 3.2, D / 2 - 1.05, 0, { seat: mat(0x45a0a8, 0.6) });
      // Armário de armazenamento (armas e itens).
      locker(b, W / 2 - 0.3, 1.4, -Math.PI / 2);
      // Cozinha compacta.
      kitchenRun(b, -3.625, -D / 2 + 0.32, 2.55, 0, { sinkAt: 0.6, stoveAt: -0.8 });
      fridge(b, -1.95, -D / 2 + 0.38, 0, { w: 0.7 });
      table(b, -3.3, -1.6, { round: true, w: 0.7, top: mat(0xf4ede0, 0.4) });
      chair(b, -3.95, -1.6, Math.PI / 2, { seat: mat(0xd84a5a, 0.55) });
      chair(b, -2.65, -1.6, -Math.PI / 2, { seat: mat(0xd84a5a, 0.55) });
      lampPendant(b, -3.3, H, -1.6, 0xffd8a0, { shade: mat(0x45a0a8, 0.5) });
      // Banheiro.
      toilet(b, -1.1, -D / 2 + 0.4, 0);
      bathSink(b, 0.2, -D / 2 + 0.3, 0);
      shower(b, 0.15, -2.3, 0.8, 0.9);
      ceilingPanel(b, -0.45, H, -2.4, 0.6, 0.6, 0xffffff, 1.3);
      // Quarto.
      const foot = bed(b, 3.4, -3.0, 0, { blanket: mat(0xff8fb8, 0.8) });
      nightstand(b, 4.5, -3.7);
      nightstand(b, 2.25, -3.7);
      wardrobe(b, 0.95, -2.6, Math.PI / 2, { w: 1.4 });
      windowPanel(b, W / 2 - 0.02, 1.6, -2.1, 1.2, 1.1, -Math.PI / 2);
      poster(ctx, 'NEON CITY', ['1986'], 3.4, 1.85, -D / 2 + 0.02, 0, '#1a1424', '#45f3ff');
      ceilingPanel(b, 3.0, H, -2.2, 1.0, 1.0, 0xffe8c8, 1.2);
      ceilingPanel(b, 2.8, H, 2.4, 1.1, 1.1, 0xffe8c8, 1.2);
      ctx.spots = { bed: foot, wardrobe: [1.65, -2.6], storage: [W / 2 - 1.0, 1.4], save: [3.2, D / 2 - 1.3] };
      homeInteractions(b, pm, apartment, ctx.spots);
      b.interact({ id: 'geladeira', x: -1.95, y: 1.1, z: -D / 2 + 1.2, label: 'ABRIR GELADEIRA', action: () => pm.fridgePage(apartment) });
    },
    npcs: () => [],
  };

  // ====================================================================
  // 02 — PALM RESIDENCE (casa, garagem para 1 carro)
  // ====================================================================
  const palm = {
    id: 'palm_residence', type: 'residencia', name: 'PALM RESIDENCE', buildingId: 'house_coral_16', doorInset: 1.2,
    sign: false, size: { w: 12, d: 10, h: 3.0 }, hours: null, doorColor: 0xf2ece2, doorWidth: 1.0,
    palette: P(0xd9c8a8, 0xf6efe4, 0xfaf6f0, 0x2f8f83),
    windows: [{ x: 0.3, w: 2.2 }],
    light: { sky: 0xfff0d8, ground: 0x8a7a5a, hemi: 1.1, exposure: 1.0, windowColor: 0xffe2b0, poolStrength: 0.4, env: 0.1, points: [{ x: 0.15, y: 2.6, z: 0.2, color: 0xffe2b8, intensity: 8, distance: 11 }, { x: -0.3, y: 2.6, z: -0.25, color: 0xfff0d8, intensity: 6, distance: 9 }] },
    audio: { track: null, ambience: 'home' },
    property: {
      kind: 'house', typeLabel: 'Casa residencial', price: PRICES.properties.palm_residence,
      description: 'Bangalô tropical de um andar na Coral Street, com jardim murado, sala ampla, cozinha integrada e garagem anexa.',
      features: ['Sala', 'Quarto', 'Cozinha', 'Banheiro', 'Garagem para 1 carro', 'Ponto de salvamento', 'Armário', 'Guarda-roupa'],
      location: 'Coral Street 16, Sunset Beach',
      garage: { id: 'garage_palm', capacity: 1, label: 'Garagem da Palm Residence', door: { lx: 4.95, lz: 6.4 }, bays: [{ lx: 4.95, lz: 9.3, heading: Math.PI }] },
    },
    layout(b, ctx) {
      const { w: W, d: D, h: H } = ctx;
      const wall = mat(0xf6efe4, 0.85);
      partition(b, wall, -1.2, -1.0, W / 2, -1.0, H, [[-0.6, 0.3], [2.2, 3.15]]);
      partition(b, wall, -1.2, -D / 2, -1.2, -1.0, H);
      partition(b, wall, 1.6, -D / 2, 1.6, -1.0, H);
      pm.door(b, ctx, { id: 'banheiro', x: -0.15, z: -1.0, w: 0.9, label: 'BANHEIRO' });
      pm.door(b, ctx, { id: 'quarto', x: 2.675, z: -1.0, w: 0.95, label: 'QUARTO' });
      // Sala.
      rug(b, 3.0, 2.2, 4.4, 3.0, 0x2f8f83);
      sofa(b, 3.0, 3.9, Math.PI, { uph: mat(0xf29eb4, 0.65), w: 2.4 });
      sofa(b, 5.2, 2.0, -Math.PI / 2, { uph: mat(0xf29eb4, 0.65), w: 1.8 });
      table(b, 3.0, 2.2, { w: 1.2, d: 0.6, h: 0.42, top: mat(0x8a5a3c, 0.45) });
      const tvMat = pm.tvScreen(ctx);
      b.box(mat(0x8a5a3c, 0.55), 3.0, 0, 0.0, 1.6, 0.5, 0.45, { r: 0.02, collide: true });
      crtTV(b, 3.0, 0.5, 0.0, 0, tvMat, 0.6);
      floorLamp(b, W / 2 - 0.4, D / 2 - 0.4);
      plant(b, 1.2, D / 2 - 0.5, 1.4);
      ceilingFan(ctx, 3.0, H, 2.2, 2.6);
      poster(ctx, 'PALM COAST', ['BRISA DO MAR'], W / 2 - 0.02, 1.7, 0.6, -Math.PI / 2, '#2f8f83', '#fff1d8');
      // Cozinha integrada e jantar.
      kitchenRun(b, -W / 2 + 0.32, -2.6, 3.0, Math.PI / 2, { sinkAt: -0.5, stoveAt: 0.8, body: mat(0xffffff, 0.5), top: mat(0xd9c8a8, 0.35) });
      fridge(b, -W / 2 + 0.38, -0.55, Math.PI / 2, { w: 0.8 });
      b.box(mat(0x2f8f83, 0.5), -3.4, 0, -2.6, 0.8, 0.9, 1.8, { r: 0.03, collide: true });
      b.box(mat(0xd9c8a8, 0.35), -3.4, 0.9, -2.6, 0.9, 0.05, 1.9, { r: 0.01 });
      for (let k = 0; k < 3; k++) stool(b, -2.65, -3.2 + k * 0.6, -Math.PI / 2, { seat: mat(0xf29eb4, 0.5) });
      lampPendant(b, -3.4, H, -2.2, 0xffd8a0, { shade: mat(0x2f8f83, 0.5) });
      lampPendant(b, -3.4, H, -3.0, 0xffd8a0, { shade: mat(0x2f8f83, 0.5) });
      diningSet(b, -4.4, 2.4, 1.6, (x, z, yaw) => chair(b, x, z, yaw, { seat: mat(0x2f8f83, 0.55) }), { perSide: 2 });
      lampPendant(b, -4.4, H, 2.4, 0xffe2b8);
      // Banheiro.
      toilet(b, -0.8, -D / 2 + 0.4, 0);
      bathSink(b, 0.5, -D / 2 + 0.3, 0);
      shower(b, 0.95, -2.0, 1.0, 1.0);
      ceilingPanel(b, 0.2, H, -3.0, 0.7, 0.7, 0xffffff, 1.3);
      // Quarto.
      const foot = bed(b, 4.2, -3.6, 0, { w: 1.6, blanket: mat(0x2f8f83, 0.8) });
      nightstand(b, 5.4, -4.4);
      nightstand(b, 3.0, -4.4);
      wardrobe(b, 1.95, -3.0, Math.PI / 2, { w: 1.6 });
      windowPanel(b, W / 2 - 0.02, 1.6, -2.6, 1.4, 1.1, -Math.PI / 2);
      ceilingPanel(b, 3.8, H, -2.8, 1.1, 1.1, 0xffe8c8, 1.2);
      // Armário, escrivaninha (salvar), painel da garagem (lado direito = garagem).
      locker(b, W / 2 - 0.3, -0.2, -Math.PI / 2, 0x2f5f7a);
      b.box(mat(0x8a5a3c, 0.5), -0.3, 0.72, D / 2 - 0.4, 1.2, 0.05, 0.55, { r: 0.015 });
      b.collider(-0.3, D / 2 - 0.4, 1.2, 0.55, 0, 0.77);
      b.box(mat(0xf2ece2, 0.4), -0.55, 0.77, D / 2 - 0.35, 0.26, 0.09, 0.2, { r: 0.03 });
      b.box(mat(0x2a2e34, 0.4, 0.4), W / 2 - 0.05, 1.0, 3.2, 0.06, 0.6, 0.45, { r: 0.01 });
      b.box(glow(0x5dff9c, 1.2), W / 2 - 0.09, 1.25, 3.2, 0.02, 0.1, 0.3, { r: 0 });
      ctx.spots = { bed: foot, wardrobe: [2.6, -3.0], storage: [W / 2 - 1.0, -0.2], save: [-0.3, D / 2 - 1.1], garage: [W / 2 - 0.8, 3.4] };
      homeInteractions(b, pm, palm, ctx.spots);
      b.interact({ id: 'geladeira', x: -W / 2 + 1.2, y: 1.1, z: -0.55, label: 'ABRIR GELADEIRA', action: () => pm.fridgePage(palm) });
    },
    npcs: () => [],
  };

  // ====================================================================
  // 03 — AZURE CONDO (apartamento de luxo, vista, garagem para 2)
  // ====================================================================
  const condo = {
    id: 'azure_condo', type: 'residencia', name: 'AZURE CONDO', buildingId: 'lp_lantern_suites',
    sign: { text: 'Azure Condo', color: '#45f3ff', style: 'script', sub: 'RESIDENCES', w: 2.8, h: 0.7 },
    size: { w: 16, d: 12, h: 3.4 }, hours: null, doorColor: 0xd4a83a, doorWidth: 1.6,
    palette: P(0xe8e4dc, 0xf4f2ee, 0xfafafa, 0xd4a83a),
    windows: [{ x: -0.32, w: 2.6 }, { x: 0.32, w: 2.6 }],
    light: { sky: 0xfff4ec, ground: 0x8a8090, hemi: 1.15, exposure: 1.0, windowColor: 0xffe2c8, poolStrength: 0.4, env: 0.14, points: [{ x: -0.2, y: 3.0, z: 0.1, color: 0xffe8d0, intensity: 10, distance: 14 }, { x: 0.3, y: 3.0, z: -0.3, color: 0xfff0e0, intensity: 7, distance: 10 }] },
    audio: { track: 'lounge', ambience: 'home' },
    property: {
      kind: 'apartment_luxury', typeLabel: 'Apartamento de luxo', price: PRICES.properties.azure_condo,
      description: 'Andar alto na torre Lantern Suites: sala ampla com janela panorâmica para a cidade, cozinha aberta com ilha, suíte e garagem com duas vagas.',
      features: ['Sala ampla', 'Vista para a cidade', 'Quarto', 'Cozinha', 'Banheiro', 'Garagem para 2 carros', 'Ponto de salvamento', 'Armário', 'Guarda-roupa'],
      location: 'Lantern Suites, Lantern Point',
      garage: { id: 'garage_condo', capacity: 2, label: 'Garagem do Azure Condo', door: { world: true, x: 16.6, z: -268.8 }, bays: [{ world: true, x: 19.3, z: -265.0, heading: 0 }, { world: true, x: 19.3, z: -271.2, heading: 0 }] },
    },
    layout(b, ctx) {
      const { w: W, d: D, h: H } = ctx;
      const wall = mat(0xf4f2ee, 0.85);
      // Ala direita: suíte (z −6…−0,5) e banheiro (z −0,5…3).
      partition(b, wall, 3, -D / 2, 3, 3, H, [[-1.6, -0.6], [1.2, 2.15]]);
      partition(b, wall, 3, -0.5, W / 2, -0.5, H);
      partition(b, wall, 3, 3, W / 2, 3, H);
      pm.door(b, ctx, { id: 'suite', x: 3, z: -1.1, w: 0.95, ry: Math.PI / 2, label: 'SUÍTE' });
      pm.door(b, ctx, { id: 'banheiro', x: 3, z: 1.675, w: 0.9, ry: Math.PI / 2, label: 'BANHEIRO' });
      // Piso de "mármore" na sala e vista panorâmica no fundo.
      b.box(mat(0xf0ece6, 0.25, 0.05), -2.5, 0.002, 0, W / 2 + 3, 0.004, D - 0.2, { r: 0 });
      panorama(ctx, b, -2.5, 1.65, -D / 2 + 0.05, 10.5, 2.6, 0, { ocean: false });
      b.interact({ id: 'vista', x: -2.5, y: 1.4, z: -D / 2 + 1.2, label: 'APRECIAR A VISTA', radius: 1.8, action: () => ({ who: 'Janela panorâmica', text: 'Lantern Point se acende ao entardecer: neon nas fachadas, o farol girando e o trânsito da Ocean Avenue lá embaixo.', options: [{ label: 'Fechar', run: () => null }] }) });
      // Sala de estar: sofá em L, poltronas, mesa de vidro, bar.
      rug(b, -2.0, -2.4, 5.0, 3.2, 0x2a4a7a, 0xd4a83a);
      sofa(b, -2.4, -0.8, Math.PI, { uph: mat(0xf2ece2, 0.6), w: 3.0 });
      sofa(b, -5.0, -2.4, Math.PI / 2, { uph: mat(0xf2ece2, 0.6), w: 2.0 });
      sofa(b, 0.6, -2.6, -Math.PI / 2, { uph: mat(0x45c8b8, 0.6), w: 1.2 });
      b.box(mat(0x9fc6d8, 0.05, 0.2, { transparent: true, opacity: 0.5 }), -2.2, 0.38, -2.4, 1.4, 0.04, 0.8, { r: 0.01 });
      b.box(mat(0xd4a83a, 0.3, 0.8), -2.2, 0, -2.4, 1.2, 0.38, 0.6, { r: 0.02, collide: true });
      floorLamp(b, -6.2, -0.8);
      floorLamp(b, 1.4, -4.6);
      plant(b, -7.3, -5.3, 1.6);
      plant(b, 2.3, -5.3, 1.6);
      // Piano estilizado (vertical) e carrinho de bar.
      b.box(mat(0x111114, 0.2, 0.3), -7.3, 0, -2.2, 0.6, 1.25, 1.5, { r: 0.04, collide: true });
      b.box(mat(0xf4f4f6, 0.3), -7.0, 0.75, -2.2, 0.08, 0.04, 1.3, { r: 0 });
      jukebox(b, 1.9, 0.4, -Math.PI / 2);
      // Cozinha aberta com ilha e banquetas.
      kitchenRun(b, -4.2, D / 2 - 0.32, 4.0, Math.PI, { sinkAt: 0.6, stoveAt: -1.0, body: mat(0x2a2e34, 0.4, 0.3), top: mat(0xf0ece6, 0.2, 0.05), upper: false });
      fridge(b, -7.2, D / 2 - 0.38, Math.PI, { w: 0.9, light: 0xe8f4ff });
      b.box(mat(0x2a2e34, 0.4, 0.3), -4.2, 0, 3.7, 2.6, 0.9, 0.9, { r: 0.03, collide: true });
      b.box(mat(0xf0ece6, 0.2, 0.05), -4.2, 0.9, 3.7, 2.8, 0.05, 1.0, { r: 0.01 });
      for (let k = 0; k < 3; k++) stool(b, -5.1 + k * 0.9, 2.85, 0, { seat: mat(0xd4a83a, 0.4, 0.4) });
      for (const x of [-5.0, -3.4]) lampPendant(b, x, H, 3.7, 0xfff0d8, { shade: mat(0xd4a83a, 0.3, 0.8) });
      // Jantar para seis.
      diningSet(b, -1.7, 1.4, 2.2, (x, z, yaw) => chair(b, x, z, yaw, { seat: mat(0x2a4a7a, 0.55), frame: mat(0xd4a83a, 0.3, 0.8) }), { perSide: 3, top: mat(0x2a2e34, 0.25, 0.3) });
      ceilingPanel(b, -1.7, H, 1.4, 1.8, 0.3, 0xfff0d8, 1.4);
      // Suíte: cama king, criados, guarda-roupa embutido, vista.
      const foot = bed(b, 5.6, -4.6, 0, { w: 2.0, l: 2.1, frame: mat(0x2a2e34, 0.4), blanket: mat(0x2a4a7a, 0.8) });
      nightstand(b, 7.1, -5.4); nightstand(b, 4.1, -5.4);
      wardrobe(b, W / 2 - 0.35, -2.0, -Math.PI / 2, { w: 2.4, body: mat(0xf2ece2, 0.5) });
      panorama(ctx, b, 5.5, 1.7, -D / 2 + 0.05, 4.4, 1.8, 0, { ocean: true });
      ceilingPanel(b, 5.5, H, -3.0, 1.4, 1.4, 0xffe8d0, 1.2);
      // Banheiro com banheira.
      b.box(mat(0xf4f4f6, 0.2, 0.05), 6.2, 0, 1.2, 1.7, 0.55, 0.8, { r: 0.08, collide: true });
      b.box(mat(0x7fd6e0, 0.1, 0.1), 6.2, 0.5, 1.2, 1.5, 0.02, 0.6, { r: 0 });
      toilet(b, W / 2 - 0.4, 2.4, -Math.PI / 2);
      bathSink(b, 4.4, -0.2, 0);
      ceilingPanel(b, 5.5, H, 1.2, 0.8, 0.8, 0xffffff, 1.3);
      // Entrada: console (salvar), armário, painel da garagem.
      b.box(mat(0x2a2e34, 0.3, 0.3), 5.6, 0, D / 2 - 0.4, 1.6, 0.85, 0.42, { r: 0.02, collide: true });
      b.box(mat(0xd4a83a, 0.3, 0.8), 5.6, 0.85, D / 2 - 0.4, 1.65, 0.03, 0.45, { r: 0 });
      b.box(mat(0xf2ece2, 0.4), 5.2, 0.88, D / 2 - 0.35, 0.26, 0.09, 0.2, { r: 0.03 });
      locker(b, W / 2 - 0.3, 4.4, -Math.PI / 2, 0x2a2e34);
      b.box(mat(0x2a2e34, 0.4, 0.4), 3.06, 1.0, 4.4, 0.06, 0.6, 0.45, { r: 0.01 });
      b.box(glow(0x5dff9c, 1.2), 3.1, 1.25, 4.4, 0.02, 0.1, 0.3, { r: 0 });
      ctx.spots = { bed: foot, wardrobe: [W / 2 - 1.1, -2.0], storage: [W / 2 - 1.0, 4.4], save: [5.6, D / 2 - 1.1], garage: [3.8, 4.4] };
      homeInteractions(b, pm, condo, ctx.spots);
      b.interact({ id: 'geladeira', x: -7.2, y: 1.1, z: D / 2 - 1.3, label: 'ABRIR GELADEIRA', action: () => pm.fridgePage(condo) });
    },
    npcs: () => [],
  };

  // ====================================================================
  // 04 — OCEAN CREST VILLA (alto padrão, piscina, garagem para 3)
  // ====================================================================
  const villa = {
    id: 'ocean_crest_villa', type: 'residencia', name: 'OCEAN CREST VILLA', buildingId: 'lp_west_3', doorInset: 1.2,
    sign: false, size: { w: 22, d: 16, h: 3.6 }, hours: null, doorColor: 0xd4a83a, doorWidth: 1.6,
    palette: P(0xf0e8dc, 0xfaf6f0, 0xfdfbf8, 0xd4a83a),
    windows: [{ x: 0.3, w: 3.0 }],
    light: { sky: 0xfff4e8, ground: 0x9a8a7a, hemi: 1.2, exposure: 1.0, windowColor: 0xffe8c8, poolStrength: 0.4, env: 0.14, points: [{ x: 0.0, y: 3.1, z: 0.05, color: 0xffe8d0, intensity: 12, distance: 16 }, { x: 0.0, y: 3.0, z: -0.38, color: 0xbff4ff, intensity: 8, distance: 12 }] },
    audio: { track: 'lounge', ambience: 'villa' },
    property: {
      kind: 'villa', typeLabel: 'Residência de alto padrão', price: PRICES.properties.ocean_crest_villa,
      description: 'Mansão térrea em lote amplo de Lantern Point: salão, jantar, cozinha gourmet, suíte master, escritório, terraço com piscina e vista para o mar, e garagem para três carros.',
      features: ['Múltiplos ambientes', 'Área externa (terraço)', 'Piscina decorativa', 'Garagem para 3 carros', 'Armazenamento', 'Ponto de salvamento', 'Guarda-roupa'],
      location: 'Lantern Point (Coral Street norte)',
      garage: { id: 'garage_villa', capacity: 3, label: 'Garagem da Ocean Crest Villa', door: { lx: 4.95, lz: 8.4 }, bays: [{ lx: 4.95, lz: 11.3, heading: Math.PI }, { world: true, x: -75, z: -234, heading: 0 }] },
    },
    layout(b, ctx) {
      const { w: W, d: D, h: H } = ctx;
      const wall = mat(0xfaf6f0, 0.85);
      // Terraço com piscina (z −8…−3,2) separado por parede de vidro com porta de correr.
      const glass = mat(0x9fc6d8, 0.05, 0.1, { transparent: true, opacity: 0.3 });
      b.box(glass, -6, 0, -3.2, 10, H, 0.06, { r: 0, collide: true });
      b.box(glass, 6, 0, -3.2, 10, H, 0.06, { r: 0, collide: true });
      b.box(mat(0xfaf6f0, 0.85), 0, 2.4, -3.2, 2.0, H - 2.4, 0.1, { r: 0 });
      b.box(mat(0xd4a83a, 0.3, 0.6), 0, 2.38, -3.2, 2.1, 0.06, 0.14, { r: 0 });
      pm.door(b, ctx, { id: 'terraco', x: 0, z: -3.2, w: 2.0, type: 'slide', label: 'PORTA DO TERRAÇO', color: 0x9fc6d8, glass: true });
      b.box(mat(0xe8dcc8, 0.6), 0, 0.004, -5.6, W - 0.4, 0.008, 4.6, { r: 0 });
      pool(ctx, b, -2.0, -5.7, 8.0, 2.8);
      for (const x of [4.5, 6.2, 7.9]) lounger(b, x, -5.6, 0);
      for (const x of [-9.6, 9.6]) plant(b, x, -7.3, 2.0);
      panorama(ctx, b, 0, 1.8, -D / 2 + 0.05, W - 0.6, 3.0, 0, { ocean: true });
      // "Céu" sobre o terraço (o volume é fechado; o teto ali é pintado como céu).
      const skyTex = textTexture([], { w: 64, h: 64, bg: '#ffb08a', accent: '#ffb08a' });
      const sky = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, 4.7), new THREE.MeshBasicMaterial({ map: skyTex, toneMapped: false, color: 0xffd6c0 }));
      sky.rotation.x = Math.PI / 2; sky.position.set(0, H - 0.02, -5.65); ctx.extras.push(sky);
      b.interact({ id: 'piscina', x: -2.0, y: 0.8, z: -3.9, label: 'OLHAR A PISCINA', radius: 1.6, action: () => ({ who: 'Piscina', text: 'Água turquesa, espreguiçadeiras e o mar no horizonte. Decorativa por enquanto: nadar depende do sistema de natação.', options: [{ label: 'Fechar', run: () => null }] }) });
      // Ala esquerda: suíte master (z −3,2…2,5) e banheiro (z 2,5…8).
      partition(b, wall, -4.5, -3.2, -4.5, D / 2, H, [[0.4, 1.35], [4.4, 5.3]]);
      partition(b, wall, -W / 2, 2.5, -4.5, 2.5, H);
      pm.door(b, ctx, { id: 'suite', x: -4.5, z: 0.875, w: 0.95, ry: Math.PI / 2, label: 'SUÍTE MASTER' });
      pm.door(b, ctx, { id: 'banheiro', x: -4.5, z: 4.85, w: 0.9, ry: Math.PI / 2, label: 'BANHEIRO' });
      const foot = bed(b, -8.2, -1.6, Math.PI / 2, { w: 2.0, l: 2.2, frame: mat(0xd4a83a, 0.35, 0.6), blanket: mat(0xf2ece2, 0.8) });
      nightstand(b, -9.9, -0.2, Math.PI / 2); nightstand(b, -9.9, -3.0 + 0.1, Math.PI / 2);
      wardrobe(b, -7.4, 2.15, Math.PI, { w: 3.0, body: mat(0xf2ece2, 0.5) });
      rug(b, -7.6, -1.4, 3.2, 2.4, 0xd4a83a, 0xf2ece2);
      windowPanel(b, -W / 2 + 0.02, 1.6, 0.0, 1.6, 1.2, Math.PI / 2, 0xbff4ff);
      ceilingPanel(b, -7.6, H, -0.6, 1.6, 1.6, 0xffe8d0, 1.2);
      b.box(mat(0xf4f4f6, 0.2, 0.05), -8.6, 0, 5.4, 1.8, 0.55, 0.85, { r: 0.08, collide: true });
      b.box(mat(0x7fd6e0, 0.1, 0.1), -8.6, 0.5, 5.4, 1.6, 0.02, 0.65, { r: 0 });
      toilet(b, -W / 2 + 0.4, 7.2, Math.PI / 2);
      bathSink(b, -6.2, 2.85, Math.PI);
      shower(b, -5.2, 7.3, 1.0, 1.0);
      ceilingPanel(b, -7.6, H, 5.2, 1.0, 1.0, 0xffffff, 1.3);
      // Ala direita: escritório (z −3,2…2) e cozinha gourmet (z 2…8).
      partition(b, wall, 5, -3.2, 5, 2, H);
      partition(b, wall, 5, 2, W / 2, 2, H, [[6.0, 6.95]]);
      pm.door(b, ctx, { id: 'escritorio', x: 6.475, z: 2, w: 0.95, label: 'ESCRITÓRIO' });
      b.box(mat(0x6b3b22, 0.45), 8.3, 0.74, -1.0, 2.0, 0.06, 0.9, { r: 0.02 });
      b.box(mat(0x3a2a22, 0.5), 8.3, 0, -1.0, 1.8, 0.74, 0.7, { r: 0.02 });
      b.collider(8.3, -1.0, 2.0, 0.9, 0, 0.8);
      chair(b, 8.3, -0.2, Math.PI, { seat: mat(0x6b3b22, 0.5) });
      b.box(mat(0xf2ece2, 0.4), 7.8, 0.8, -1.1, 0.26, 0.09, 0.2, { r: 0.03 });
      for (let k = 0; k < 3; k++) b.box(mat(0x6b3b22, 0.5), 10.7, 0.4 + k * 0.6, -1.0, 0.4, 0.04, 2.4, { r: 0 });
      locker(b, 10.7, 1.2, -Math.PI / 2, 0x2a2e34);
      locker(b, 9.7, -2.85, 0, 0x2a2e34);
      ceilingPanel(b, 8.0, H, -0.6, 1.2, 1.2, 0xfff0d8, 1.2);
      kitchenRun(b, 8.2, D / 2 - 0.4, 5.0, Math.PI, { sinkAt: 1.0, stoveAt: -1.2, body: mat(0xffffff, 0.45), top: mat(0x2a2e34, 0.2, 0.3), upper: false });
      fridge(b, W / 2 - 0.4, 3.6, -Math.PI / 2, { w: 1.0 });
      b.box(mat(0xd4a83a, 0.35, 0.5), 8.0, 0, 4.9, 2.6, 0.9, 1.0, { r: 0.03, collide: true });
      b.box(mat(0x2a2e34, 0.2, 0.3), 8.0, 0.9, 4.9, 2.8, 0.05, 1.1, { r: 0.01 });
      for (let k = 0; k < 3; k++) stool(b, 7.1 + k * 0.9, 4.0, 0, { seat: mat(0x2a2e34, 0.4) });
      for (const x of [7.2, 8.8]) lampPendant(b, x, H, 4.9, 0xfff0d8, { shade: mat(0xd4a83a, 0.3, 0.8) });
      // Salão central e jantar.
      rug(b, 0.4, -0.4, 6.0, 4.0, 0x2a6a8a, 0xd4a83a);
      sofa(b, 0.4, 1.4, Math.PI, { uph: mat(0xf2ece2, 0.6), w: 3.2 });
      sofa(b, -2.6, -0.4, Math.PI / 2, { uph: mat(0x45c8b8, 0.6), w: 2.2 });
      table(b, 0.4, -0.4, { w: 1.6, d: 0.9, h: 0.42, top: mat(0x2a2e34, 0.2, 0.3) });
      const tvMat = pm.tvScreen(ctx);
      b.box(mat(0x6b3b22, 0.5), 4.6, 0, -0.6, 0.5, 0.55, 2.6, { r: 0.02, collide: true });
      crtTV(b, 4.6, 0.55, -0.6, -Math.PI / 2, tvMat, 0.75);
      floorLamp(b, 3.8, 1.4); floorLamp(b, -3.6, 2.0);
      diningSet(b, 1.8, 5.4, 2.6, (x, z, yaw) => chair(b, x, z, yaw, { seat: mat(0xd4a83a, 0.5), frame: mat(0x2a2e34, 0.4, 0.5) }), { perSide: 3 });
      lampPendant(b, 1.0, H, 5.4, 0xffe8d0, { shade: mat(0xd4a83a, 0.3, 0.8) });
      lampPendant(b, 2.6, H, 5.4, 0xffe8d0, { shade: mat(0xd4a83a, 0.3, 0.8) });
      // Saguão: aparador, plantas, painel da garagem.
      b.box(mat(0x2a2e34, 0.3, 0.3), -1.0, 0, 7.6, 1.4, 0.85, 0.38, { r: 0.02, collide: true });
      plant(b, -4.15, 6.5, 1.6);
      b.box(mat(0x2a2e34, 0.4, 0.4), 4.94, 1.0, 1.5, 0.06, 0.6, 0.45, { r: 0.01 });
      b.box(glow(0x5dff9c, 1.2), 4.9, 1.25, 1.5, 0.02, 0.1, 0.3, { r: 0 });
      ctx.spots = { bed: foot, wardrobe: [-7.4, 1.3], storage: [9.7, -2.0], save: [8.3, 0.4], garage: [4.2, 1.5] };
      homeInteractions(b, pm, villa, ctx.spots);
      b.interact({ id: 'geladeira', x: W / 2 - 1.3, y: 1.1, z: 3.6, label: 'ABRIR GELADEIRA', action: () => pm.fridgePage(villa) });
    },
    npcs: () => [],
  };

  return [apartment, palm, condo, villa];
}
