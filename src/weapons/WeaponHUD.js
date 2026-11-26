import { AMMO_TYPES } from './WeaponDefinitions.js';

/**
 * HUD de combate (canto inferior esquerdo, longe do velocímetro) + retículo
 * dinâmico + marcador de acerto (a seleção por TAB é a roleta, WeaponWheel). Identidade
 * Neon City: azul, rosa neon, violeta e preto. Oculto dentro de veículos.
 */
const MODE_LABEL = { semi: 'SEMI', auto: 'AUTO', pump: 'BOMBA' };

export class WeaponHUD {
  constructor(root, inventory) {
    this.inv = inventory;
    this.el = document.createElement('div');
    this.el.className = 'wpn-layer';
    this.el.innerHTML = `
      <div class="wpn-hud hidden" data-w="panel">
        <div class="wpn-head"><span class="wpn-name" data-w="name"></span><span class="wpn-mode" data-w="mode"></span></div>
        <div class="wpn-ammo"><span class="wpn-loaded" data-w="loaded">0</span><span class="wpn-sep">/</span><span class="wpn-reserve" data-w="reserve">0</span><span class="wpn-cat" data-w="cat"></span></div>
        <div class="wpn-reload" data-w="reloadBox"><div class="wpn-reload-bar" data-w="reloadBar"></div><span>RECARREGANDO</span></div>
      </div>
      <div class="wpn-reticle hidden" data-w="reticle"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="wpn-hit" data-w="hit"></div>
      <div class="wpn-quick hidden" data-w="quick"></div>
    `;
    root.appendChild(this.el);
    this.r = {};
    this.el.querySelectorAll('[data-w]').forEach((n) => { this.r[n.dataset.w] = n; });
    this._quickTimer = 0;
    this._hitTimer = 0;
    this._last = {};
    this._buildQuick();
  }

  _buildQuick() {
    const items = this.inv.list();
    this.r.quick.innerHTML = items.map((e) => `
      <div class="wpn-card" data-id="${e.def.id}">
        <span class="wpn-card-slot">${e.def.slot}</span>
        <span class="wpn-card-name">${e.def.name}</span>
        <span class="wpn-card-ammo" data-ammo="${e.def.id}"></span>
      </div>`).join('');
    this.cards = [...this.r.quick.querySelectorAll('.wpn-card')];
  }

  /** Compatibilidade: a lista de cartões foi substituída pela roleta (WeaponWheel); nada pisca na tela. */
  flashQuick() {}

  hitMarker(kill = false) {
    this._hitTimer = 0.18;
    this.r.hit.classList.toggle('kill', kill);
  }

  /**
   * @param {object} s estado do WeaponManager: visible, drawn, def, loaded,
   *   reserve, reloadK (0..1 ou -1), spreadPx, aim, quickOpen, selectedId
   */
  update(dt, s) {
    const r = this.r;
    const showPanel = s.visible && !!s.def;
    r.panel.classList.toggle('hidden', !showPanel);
    if (showPanel) {
      r.panel.classList.toggle('collapsed', !s.drawn);
      this._set('name', s.def.name);
      this._set('mode', MODE_LABEL[s.def.mode] || '');
      const melee = s.def.mode === 'melee';
      this._set('loaded', melee ? '—' : String(s.loaded));
      this._set('reserve', melee ? '' : String(s.reserve));
      this._set('cat', AMMO_TYPES[s.def.category]?.label || '');
      r.loaded.classList.toggle('low', !melee && s.loaded <= Math.ceil(s.def.mag * 0.25));
      const reloading = s.reloadK >= 0;
      r.reloadBox.classList.toggle('visible', reloading);
      if (reloading) r.reloadBar.style.transform = `scaleX(${s.reloadK.toFixed(3)})`;
    }
    // Retículo: aparece com a arma sacada; abre com a dispersão.
    const ret = s.visible && s.drawn;
    r.reticle.classList.toggle('hidden', !ret);
    if (ret) {
      const gap = Math.round(4 + s.spreadPx);
      if (gap !== this._last.gap) { r.reticle.style.setProperty('--gap', `${gap}px`); this._last.gap = gap; }
      r.reticle.classList.toggle('aim', s.aim > 0.5);
    }
    // Marcador de acerto.
    if (this._hitTimer > 0) { this._hitTimer -= dt; r.hit.classList.add('visible'); } else r.hit.classList.remove('visible');
    // A seleção rápida agora é a roleta de armas (WeaponWheel); a lista antiga fica oculta.
    r.quick.classList.add('hidden');
  }

  _set(key, value, html = false) {
    if (this._last[key] === value) return;
    this._last[key] = value;
    if (html) this.r[key].innerHTML = value; else this.r[key].textContent = value;
  }

  dispose() {
    this.el.remove();
  }
}
