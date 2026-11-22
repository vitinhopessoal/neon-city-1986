import * as THREE from 'three';
import { AMMO_TYPES } from './WeaponDefinitions.js';
import { buildWeaponModel } from './WeaponModels.js';

/**
 * Roleta de armas (segurar TAB). Substitui a lista de cartões da seleção rápida.
 *  - abre no centro da tela com uma fatia para "Desarmado" e uma para cada arma possuída;
 *  - o movimento do mouse aponta a fatia (a câmera não gira enquanto ela está aberta);
 *    a roda do mouse e as teclas 1–8 também escolhem; clique ou soltar o TAB confirma;
 *  - o tempo do jogo desacelera enquanto a roleta está aberta;
 *  - ícones: silhuetas geradas dos PRÓPRIOS modelos 3D das armas do jogo (arte original),
 *    pintadas com o degradê neon da interface.
 */
const SLOW = 0.3;           // escala de tempo com a roleta aberta
const DEADZONE = 22;        // px de movimento acumulado para apontar uma fatia
const R_IN = 0.36, R_OUT = 1.0; // raios relativos do anel

export class WeaponWheel {
  constructor(root, inventory, renderer) {
    this.inv = inventory;
    this.open = false;
    this.hover = -1;          // índice da fatia apontada
    this._vec = new THREE.Vector2();
    this._icons = renderIcons(renderer, inventory.defs);
    this.el = document.createElement('div');
    this.el.className = 'wpn-wheel hidden';
    this.el.innerHTML = `<svg class="wpn-wheel-ring" viewBox="-1.05 -1.05 2.1 2.1"></svg>
      <div class="wpn-wheel-center"><span class="wpn-wheel-name"></span><span class="wpn-wheel-ammo"></span><span class="wpn-wheel-cat"></span></div>
      <div class="wpn-wheel-hint">mova o mouse · solte <kbd>TAB</kbd> para equipar</div>`;
    root.appendChild(this.el);
    this.svg = this.el.querySelector('svg');
    this.cName = this.el.querySelector('.wpn-wheel-name');
    this.cAmmo = this.el.querySelector('.wpn-wheel-ammo');
    this.cCat = this.el.querySelector('.wpn-wheel-cat');
    this._sig = '';
    this.stats = { opened: 0, chosen: 0 };
  }

  /** Fatias: [Desarmado, ...armas em ordem de slot]. */
  get items() {
    return [{ id: null, name: 'DESARMADO', slot: 0 }, ...this.inv.list().map((e) => ({ id: e.def.id, name: e.def.name, slot: e.def.slot, def: e.def }))];
  }

  _build() {
    const items = this.items;
    const sig = items.map((i) => i.id).join(',');
    if (sig === this._sig) return;
    this._sig = sig;
    const n = items.length;
    const seg = (Math.PI * 2) / n;
    let html = '';
    items.forEach((it, i) => {
      // Fatia i centrada no ângulo i*seg (0 = topo, sentido horário).
      const a0 = i * seg - seg / 2 + 0.012, a1 = i * seg + seg / 2 - 0.012;
      const p = (a, r) => `${(Math.sin(a) * r).toFixed(4)} ${(-Math.cos(a) * r).toFixed(4)}`;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M ${p(a0, R_IN)} L ${p(a0, R_OUT)} A ${R_OUT} ${R_OUT} 0 ${large} 1 ${p(a1, R_OUT)} L ${p(a1, R_IN)} A ${R_IN} ${R_IN} 0 ${large} 0 ${p(a0, R_IN)} Z`;
      const am = i * seg, rm = (R_IN + R_OUT) / 2;
      const cx = Math.sin(am) * rm, cy = -Math.cos(am) * rm;
      const icon = it.id ? this._icons[it.id] : this._icons.__fist;
      const w = 0.42, h = 0.21;
      html += `<g class="wpn-seg" data-i="${i}"><path d="${d}"/>`
        + (icon ? `<image href="${icon}" x="${(cx - w / 2).toFixed(4)}" y="${(cy - h / 2 - 0.02).toFixed(4)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>` : '')
        + `<text x="${cx.toFixed(4)}" y="${(cy + 0.15).toFixed(4)}">${it.slot ? it.slot : '–'}</text></g>`;
    });
    this.svg.innerHTML = html;
    this.segs = [...this.svg.querySelectorAll('.wpn-seg')];
  }

  /** Abre (chamado pelo WeaponManager ao pressionar TAB). */
  show(currentId) {
    if (this.open) return;
    this._build();
    this.open = true;
    this.stats.opened++;
    this._vec.set(0, 0);
    this.hover = Math.max(0, this.items.findIndex((i) => i.id === currentId));
    this.el.classList.remove('hidden');
    this._refresh();
  }

  /** Fecha e devolve o item escolhido (ou undefined se não houver escolha). */
  hide() {
    if (!this.open) return undefined;
    this.open = false;
    this.el.classList.add('hidden');
    const it = this.items[this.hover];
    if (it) this.stats.chosen++;
    return it;
  }

  /** Movimento do mouse enquanto aberta: aponta a fatia na direção acumulada. */
  pointer(dx, dy) {
    if (!this.open) return;
    this._vec.x += dx; this._vec.y += dy;
    const len = this._vec.length();
    if (len > 140) this._vec.multiplyScalar(140 / len); // direção, não distância
    if (len < DEADZONE) return;
    this.pointAngle(Math.atan2(this._vec.x, -this._vec.y));
  }

  /** Aponta pelo ângulo (0 = topo, sentido horário). */
  pointAngle(a) {
    const n = this.items.length;
    const seg = (Math.PI * 2) / n;
    const i = ((Math.round(a / seg) % n) + n) % n;
    if (i !== this.hover) { this.hover = i; this._refresh(); }
  }

  /** Roda do mouse / atalhos. */
  step(dir) {
    const n = this.items.length;
    this.hover = (this.hover + dir + n) % n;
    this._vec.set(0, 0);
    this._refresh();
  }

  pick(id) {
    const i = this.items.findIndex((it) => it.id === id);
    if (i >= 0) { this.hover = i; this._vec.set(0, 0); this._refresh(); }
  }

  get timeScale() { return this.open ? SLOW : 1; }

  _refresh() {
    if (!this.segs) return;
    this.segs.forEach((s, i) => s.classList.toggle('active', i === this.hover));
    const it = this.items[this.hover];
    if (!it) return;
    this.cName.textContent = it.name;
    if (it.id) {
      const e = this.inv.get(it.id);
      this.cAmmo.textContent = `${e.loaded} / ${this.inv.reserve[e.def.category]}`;
      this.cCat.textContent = AMMO_TYPES[e.def.category]?.label || '';
    } else {
      this.cAmmo.textContent = '';
      this.cCat.textContent = 'armas guardadas';
    }
  }

  dispose() { this.el.remove(); }
}

// ------------------------------------------------------------------ ícones
/**
 * Renderiza a silhueta lateral de cada arma (modelo 3D do jogo) num alvo fora da tela,
 * pinta com o degradê neon e devolve data URLs. Ocorre uma vez, na inicialização.
 */
function renderIcons(renderer, defs) {
  const out = {};
  const W = 256, H = 128;
  out.__fist = fistIcon(W, H);
  if (!renderer?.setRenderTarget) return out;
  const rt = new THREE.WebGLRenderTarget(W, H);
  const scene = new THREE.Scene();
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const buf = new Uint8Array(W * H * 4);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  try {
    for (const def of defs) {
      let model;
      try { model = buildWeaponModel(def); } catch { continue; }
      const root = model.root;
      scene.add(root);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
      // Vista lateral (de +X para -X): comprimento da arma no eixo Z, altura em Y.
      const span = Math.max(size.z, size.y * (W / H)) * 1.08 / 2;
      cam.left = -span; cam.right = span; cam.top = span * H / W; cam.bottom = -span * H / W;
      cam.position.set(mid.x + 3, mid.y, mid.z);
      cam.lookAt(mid);
      cam.updateProjectionMatrix();
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      scene.remove(root);
      root.traverse((o) => { if (o.isMesh && !o.geometry.userData?.shared) o.geometry.dispose(); });
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      ctx.clearRect(0, 0, W, H);
      ctx.putImageData(img, 0, 0);
      out[def.id] = tint(c, W, H);
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    rt.dispose();
    scene.overrideMaterial.dispose();
  }
  return out;
}

/** Pinta a silhueta (alfa) com o degradê ciano → rosa e um brilho suave. */
function tint(src, W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#5ff4ff');
  g.addColorStop(0.55, '#b98bff');
  g.addColorStop(1, '#ff5fd2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const o = out.getContext('2d');
  o.shadowColor = 'rgba(255, 95, 210, 0.75)';
  o.shadowBlur = 10;
  o.drawImage(c, 0, 0);
  return out.toDataURL('image/png');
}

/** Ícone de "desarmado": punho fechado estilizado, desenhado com formas simples. */
function fistIcon(W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const x = W / 2, y = H / 2;
  ctx.fillStyle = '#fff';
  const rr = (px, py, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px, py, w, h, r) : ctx.rect(px, py, w, h); ctx.fill(); };
  for (let k = 0; k < 4; k++) rr(x - 34 + k * 17, y - 34, 16, 30, 7);  // dedos
  rr(x - 36, y - 12, 70, 44, 14);                                     // palma
  rr(x - 52, y - 8, 22, 34, 10);                                      // polegar
  rr(x - 22, y + 30, 44, 22, 6);                                      // punho
  return tint(c, W, H);
}
