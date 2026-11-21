import { PAINTS, FINISHES, PARTS, UPGRADES, SECONDARY_PRICE } from './CustomizationCatalog.js';

const money = (n) => `$${Number(n).toLocaleString('pt-BR')}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

const GROUPS = {
  paint: ['paint', 'paint2'], wheels: ['wheels', 'tires'], body: ['bumper', 'skirts', 'spoiler', 'hood', 'exhaust'],
  suspension: ['ride', 'susp'], lighting: ['lights', 'tint'], interior: ['interior'], performance: ['engine', 'brakes', 'trans', 'armor'], repair: ['repair'],
};
const STAT_LABELS = { speed: 'Velocidade', accel: 'Aceleração', brake: 'Frenagem', control: 'Controle', resist: 'Resistência' };

/**
 * Painel NEON CUSTOMS (identidade do jogo: preto, rosa neon, azul, violeta).
 * Clique numa opção = prévia instantânea; COMPRAR confirma; CANCELAR PRÉVIA volta
 * ao instalado. Arrastar no cenário gira a câmera; a roda do mouse aproxima.
 */
export class CustomizationUI {
  constructor(mgr, root) {
    this.mgr = mgr;
    this.el = document.createElement('div');
    this.el.className = 'customs-ui hidden';
    this.el.innerHTML = `
      <div class="cu-panel">
        <div class="cu-title"><span>Neon Customs</span><small data-ref="car"></small></div>
        <nav class="cu-tabs" data-ref="tabs"></nav>
        <section class="cu-body" data-ref="body"></section>
        <div class="cu-actions"><span data-ref="sel"></span><button data-act="buy">COMPRAR</button><button data-act="cancel">CANCELAR PRÉVIA</button></div>
        <div class="cu-msg" data-ref="msg"></div>
        <div class="cu-stats" data-ref="stats"></div>
        <div class="cu-foot"><span data-ref="money"></span><button data-act="leave">SAIR DA OFICINA</button></div>
      </div>
      <div class="cu-cams">
        <button data-cam="front">FRENTE</button><button data-cam="back">TRASEIRA</button><button data-cam="side">LATERAL</button>
        <button data-cam="wheels">RODAS</button><button data-cam="interior">INTERIOR</button><button data-cam="orbit">LIVRE</button>
        <span>arraste para girar · roda do mouse aproxima</span>
      </div>`;
    root.appendChild(this.el);
    this.r = {};
    this.el.querySelectorAll('[data-ref]').forEach((n) => { this.r[n.dataset.ref] = n; });
    this.selected = null;
    this.el.addEventListener('click', (e) => this._click(e));
    // Câmera: arrastar fora do painel e roda do mouse.
    this._drag = null;
    this._down = (e) => { if (!this.isOpen || e.target.closest('.cu-panel,.cu-cams')) return; this._drag = { x: e.clientX, y: e.clientY }; };
    this._move = (e) => { if (!this._drag) return; this.mgr.rotate(e.clientX - this._drag.x, e.clientY - this._drag.y); this._drag = { x: e.clientX, y: e.clientY }; };
    this._up = () => { this._drag = null; };
    this._wheel = (e) => { if (!this.isOpen || e.target.closest('.cu-panel')) return; this.mgr.zoom(e.deltaY); };
    this._key = (e) => { if (this.isOpen && e.code === 'Escape') { e.stopImmediatePropagation(); this.mgr.leave(); } };
    window.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('wheel', this._wheel, { passive: true });
    window.addEventListener('keydown', this._key, true);
    this.isOpen = false;
  }

  open(tabs) {
    this.tabs = tabs;
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.r.tabs.innerHTML = tabs.map((t) => `<button data-tab="${t.id}">${esc(t.label)}</button>`).join('');
    const v = this.mgr.session.v;
    this.r.car.textContent = `${v.spec.model} · ${v.appearance?.plate || ''}`;
    this.tab('paint');
  }

  close() {
    this.isOpen = false;
    this.el.classList.add('hidden');
  }

  _cats() { return GROUPS[this.current] || []; }

  tab(id) {
    this.current = id;
    this.selected = null;
    for (const b of this.r.tabs.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === id);
    this.render();
  }

  _optionRow(cat, value, name, price, desc, extra = '') {
    const m = this.mgr;
    const ok = m.compatible(cat, value);
    const inst = m.isInstalled(cat, value);
    const sel = this.selected && this.selected.cat === cat && JSON.stringify(this.selected.value) === JSON.stringify(value);
    const val = esc(JSON.stringify(value));
    return `<button class="cu-opt ${sel ? 'sel' : ''} ${inst ? 'inst' : ''}" data-cat="${cat}" data-val="${val}" ${ok ? '' : 'disabled'}>
      ${extra}<b>${esc(name)}</b><span>${inst ? 'INSTALADO' : price ? money(price) : 'GRÁTIS'}</span><small>${esc(ok ? desc : 'Incompatível com este veículo/configuração.')}</small></button>`;
  }

  render() {
    const m = this.mgr, S = m.session;
    if (!S) return;
    const P = S.preview;
    let html = '';
    for (const cat of this._cats()) {
      if (cat === 'paint') {
        html += `<h4>Cor e acabamento</h4><div class="cu-fin">${Object.entries(FINISHES).map(([k, f]) => `<button data-finish="${k}" class="${(this.finish || P.finish) === k ? 'active' : ''}">${esc(f.name)} · ${money(f.price)}</button>`).join('')}</div><div class="cu-grid">`;
        const fin = this.finish || P.finish;
        for (const c of PAINTS) html += this._optionRow('paint', { paint: c.id, finish: fin }, c.name, FINISHES[fin].price, `${FINISHES[fin].name}`, `<i style="background:${hex(c.hex)}"></i>`);
        html += '</div>';
      } else if (cat === 'paint2') {
        html += `<h4>Pintura secundária (faixas)</h4><div class="cu-grid">${this._optionRow('paint2', null, 'Sem faixas', 0, 'Remove as faixas.')}`;
        for (const c of PAINTS) html += this._optionRow('paint2', c.id, c.name, SECONDARY_PRICE, 'Faixas no capô, teto e tampa (laterais nos modelos que já as têm).', `<i style="background:${hex(c.hex)}"></i>`);
        html += '</div>';
      } else if (cat === 'repair') {
        const cost = m.repairCost();
        html += `<h4>Reparos</h4><p class="cu-note">Integridade atual: ${Math.round(S.v.damage?.integrity ?? 100)}%. Custo: ${cost ? money(cost) : '—'} ($3 por ponto). As peças personalizadas são preservadas.</p><button class="cu-repair" data-act="repair" ${cost ? '' : 'disabled'}>REPARAR ${cost ? money(cost) : ''}</button>`;
      } else if (UPGRADES[cat]) {
        html += `<h4>${esc(UPGRADES[cat].label)}</h4><div class="cu-list">${UPGRADES[cat].levels.map((l, i) => this._optionRow(cat, i, `Nível ${i} · ${l.name}`, l.price, l.perf ? Object.entries(l.perf).map(([k, x]) => `${k} ${typeof x === 'number' && x < 3 && k !== 'stability' ? `×${x}` : `+${x}`}`).join(', ') : 'Especificação de fábrica.')).join('')}</div>`;
      } else {
        html += `<h4>${esc(PARTS[cat].label)}</h4><div class="cu-list">${PARTS[cat].options.map((o) => this._optionRow(cat, o.id, o.name, o.price, o.desc)).join('')}</div>`;
      }
    }
    this.r.body.innerHTML = html;
    this._refreshFooter();
  }

  _refreshFooter() {
    const m = this.mgr, S = m.session;
    const s = this.selected;
    this.r.sel.textContent = s ? `${s.cat === 'paint' ? 'Pintura' : s.cat}: ${money(m.priceOf(s.cat, s.value))}` : 'Selecione uma opção para visualizar';
    this.el.querySelector('[data-act="buy"]').disabled = !s || m.isInstalled(s.cat, s.value) || !m.compatible(s.cat, s.value);
    this.el.querySelector('[data-act="cancel"]').disabled = !s;
    this.r.money.textContent = `Saldo ${money(this.mgr.game.economy.balance())}`;
    const st = m.barStats();
    if (st) this.r.stats.innerHTML = Object.keys(STAT_LABELS).map((k) => {
      const a = st.installed[k], b = st.preview[k];
      return `<div class="cu-bar"><span>${STAT_LABELS[k]}</span><div><i style="width:${a}%"></i>${b !== a ? `<em class="${b > a ? 'up' : 'down'}" style="width:${b}%"></em>` : ''}</div><b>${b}</b></div>`;
    }).join('');
  }

  _msg(text, ok = true) {
    this.r.msg.textContent = text || '';
    this.r.msg.className = `cu-msg ${ok ? 'ok' : 'err'}`;
  }

  _click(e) {
    const m = this.mgr;
    const t = e.target.closest('[data-tab]');
    if (t) { this.tab(t.dataset.tab); return; }
    const f = e.target.closest('[data-finish]');
    if (f) { this.finish = f.dataset.finish; if (this.selected?.cat === 'paint') { this.selected.value = { ...this.selected.value, finish: this.finish }; m.preview('paint', this.selected.value); } this.render(); return; }
    const c = e.target.closest('[data-cam]');
    if (c) { m.setPreset(c.dataset.cam); return; }
    const o = e.target.closest('.cu-opt');
    if (o && !o.disabled) {
      const value = JSON.parse(o.dataset.val);
      const r = m.preview(o.dataset.cat, value);
      if (r.ok) { this.selected = { cat: o.dataset.cat, value }; this._msg('Prévia aplicada (nada foi cobrado).'); }
      else this._msg(r.msg, false);
      this.render();
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a || a.disabled) return;
    if (a.dataset.act === 'buy' && this.selected) {
      a.disabled = true; // evita compra dupla por clique repetido
      const r = m.buy(this.selected.cat, this.selected.value);
      this._msg(r.msg, r.ok);
      if (r.ok) this.selected = null;
      this.render();
    } else if (a.dataset.act === 'cancel' && this.selected) {
      m.cancelPreview(this.selected.cat);
      this.selected = null; this.finish = null;
      this._msg('Prévia cancelada: estado instalado restaurado.');
      this.render();
    } else if (a.dataset.act === 'repair') {
      const r = m.repair();
      this._msg(r.msg, r.ok);
      this.render();
    } else if (a.dataset.act === 'leave') {
      m.leave();
    }
  }

  dispose() {
    window.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('wheel', this._wheel);
    window.removeEventListener('keydown', this._key, true);
    this.el.remove();
  }
}
