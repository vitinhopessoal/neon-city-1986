import { formatClock } from '../player/PlayerStatus.js';

const money = (n) => `$${Number(n).toLocaleString('pt-BR')}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Menu do jogo (tecla P): Voltar ao jogo, Salvar, Carregar, Propriedades,
 * Inventário e Configurações. A simulação fica pausada enquanto está aberto.
 * Identidade Neon City: preto, azul, rosa neon, violeta, molduras Art Déco.
 */
export class GameMenu {
  constructor(game, root) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'game-menu hidden';
    this.el.innerHTML = `
      <div class="gm-frame">
        <div class="gm-title"><span>NEON CITY</span><small>MENU</small></div>
        <nav class="gm-tabs">
          <button data-tab="resume">VOLTAR AO JOGO</button>
          <button data-tab="save">SALVAR</button>
          <button data-tab="load">CARREGAR</button>
          <button data-tab="props">PROPRIEDADES</button>
          <button data-tab="inv">INVENTÁRIO</button>
          <button data-tab="settings">CONFIGURAÇÕES</button>
        </nav>
        <section class="gm-body" data-ref="body"></section>
        <div class="gm-foot"><span data-ref="status"></span><span><kbd>P</kbd>/<kbd>ESC</kbd> fechar</span></div>
      </div>`;
    root.appendChild(this.el);
    this.body = this.el.querySelector('[data-ref="body"]');
    this.status = this.el.querySelector('[data-ref="status"]');
    this.open = false;
    // Volumes por canal (Configurações): aplicados na hora e lembrados entre sessões.
    this.el.addEventListener('input', (e) => {
      const r = e.target.closest('[data-vol]');
      if (!r) return;
      game.audio.setLevel(r.dataset.vol, r.value / 100);
      if (r.nextElementSibling) r.nextElementSibling.textContent = r.value;
      game.radio?.playback.refreshLevels();
    });
    this.el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { this.tab(t.dataset.tab); return; }
      const a = e.target.closest('[data-act]');
      if (a && !a.disabled) this._act(a.dataset.act, a.dataset.arg);
    });
    this._onKey = (e) => {
      if (!this.open) return;
      if (e.code === 'Escape' || e.code === 'KeyP') { e.stopImmediatePropagation(); e.preventDefault(); if (!e.repeat) this.close(); }
    };
    window.addEventListener('keydown', this._onKey, true);
  }

  toggle(tab = 'save') { if (this.open) this.close(); else this.show(tab); }

  show(tab = 'save') {
    const g = this.game;
    if (g.state !== 'playing') return;
    this.open = true;
    g.menuOpen = true;
    g.input.exitPointerLock?.();
    try { document.exitPointerLock?.(); } catch { /* ignorado */ }
    this.el.classList.remove('hidden');
    this.tab(tab);
  }

  close() {
    this.open = false;
    this.game.menuOpen = false;
    this.game.time.reset?.();
    this.el.classList.add('hidden');
  }

  _setActive(tab) {
    for (const b of this.el.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === tab);
  }

  async tab(tab) {
    const g = this.game;
    this.current = tab;
    this._setActive(tab);
    this.status.textContent = `Saldo ${money(g.economy.balance())} · ${formatClock(g.player.status.minutes)}`;
    if (tab === 'resume') { this.close(); return; }
    if (tab === 'save' || tab === 'load') {
      this.body.innerHTML = '<p class="gm-note">Lendo slots…</p>';
      const list = await g.save.list();
      if (this.current !== tab) return;
      const row = (k, v) => {
        const name = k === 'auto' ? 'AUTOSAVE' : k.replace('slot', 'SLOT ');
        const info = v.ok
          ? `<b>${esc(name)}</b><span>${new Date(v.meta.savedAt).toLocaleString('pt-BR')} · ${formatClock(v.meta.minutes)} · ${money(v.meta.money)}</span><span>${esc(v.meta.location)} · ${Math.round(v.meta.playTime / 60)} min de jogo</span>`
          : `<b>${esc(name)}</b><span>${v.empty ? 'Vazio' : `Inválido: ${esc(v.msg)}`}</span>`;
        let btn = '';
        if (tab === 'save' && k !== 'auto') btn = `<button data-act="save" data-arg="${k}">${v.ok ? 'SOBRESCREVER' : 'SALVAR'}</button>`;
        if (tab === 'load') btn = `<button data-act="load" data-arg="${k}" ${v.ok ? '' : 'disabled'}>CARREGAR</button>`;
        return `<div class="gm-slot">${info}${btn}</div>`;
      };
      const keys = tab === 'save' ? ['slot1', 'slot2', 'slot3'] : ['auto', 'slot1', 'slot2', 'slot3'];
      const inside = g.interiors?.active?.def.property && g.properties.owns(g.interiors.active.def.id);
      this.body.innerHTML = `${tab === 'save' ? `<p class="gm-note">${inside ? 'Você está em casa: pode salvar em qualquer slot.' : 'Salvar manualmente é possível em qualquer lugar; residências também têm ponto de salvamento.'}</p>` : '<p class="gm-note">Carregar substitui o estado atual pelo salvamento escolhido.</p>'}${keys.map((k) => row(k, list[k])).join('')}<div data-ref="confirm"></div>`;
      this.slots = list;
      return;
    }
    if (tab === 'props') {
      const P = g.properties;
      this.body.innerHTML = `<div class="gm-props">${P.defs.map((d) => {
        const p = d.property, own = P.owns(d.id);
        return `<div class="gm-prop ${own ? 'own' : ''}"><b>${esc(d.name)}</b><span>${esc(p.typeLabel)} · ${esc(p.location)}</span><span>${own ? 'ADQUIRIDO' : `À VENDA · ${money(p.price)}`} · ${p.garage ? `garagem ${p.garage.capacity} vaga(s)` : 'sem garagem'}</span><small>${esc(p.features.join(' · '))}</small>${own ? '' : '<small class="gm-hint">Visite o imóvel (marcador $ no radar) e pressione E na porta para comprar.</small>'}</div>`;
      }).join('')}</div>`;
      return;
    }
    if (tab === 'inv') {
      const page = g.properties.inventoryPage();
      this.body.innerHTML = `<pre class="gm-pre">${esc(page.text)}</pre><p class="gm-note">Armas guardadas ficam no armário de cada residência.</p>`;
      return;
    }
    if (tab === 'settings') {
      const presets = Object.entries(g.qualityPresets || {});
      this.body.innerHTML = `<p class="gm-note">Qualidade gráfica</p><div class="gm-row">${presets.map(([k, p]) => `<button data-act="quality" data-arg="${k}" class="${k === g.qualityKey ? 'active' : ''}">${esc(p.label)}</button>`).join('')}</div>
        <p class="gm-note">Som</p><div class="gm-row"><button data-act="mute">${g.audio.muted ? 'ATIVAR SOM' : 'DESATIVAR SOM'}</button></div>
        <div class="gm-volumes">${[['master', 'Volume geral'], ['music', 'Música'], ['radio', 'Rádio'], ['voice', 'Vozes'], ['sfx', 'Efeitos'], ['ambient', 'Ambiente']].map(([k, label]) => `<label class="gm-vol"><span>${label}</span><input type="range" min="0" max="100" step="5" data-vol="${k}" value="${Math.round((g.audio.levels?.[k] ?? 1) * 100)}"><b>${Math.round((g.audio.levels?.[k] ?? 1) * 100)}</b></label>`).join('')}</div>
        <p class="gm-note">Salvamento: ${esc(g.save.backend?.kind || '—')} · autosave em compras, garagem, ao dormir e ao sair de casa.</p>`;
    }
  }

  async _act(act, arg) {
    const g = this.game;
    const box = this.body.querySelector('[data-ref="confirm"]');
    if (act === 'save') {
      const v = this.slots?.[arg];
      if (v?.ok && !this._confirm) {
        this._confirm = arg;
        box.innerHTML = `<div class="gm-confirm">Sobrescrever ${arg.replace('slot', 'Slot ')}? O anterior fica como cópia de segurança. <button data-act="save" data-arg="${arg}">CONFIRMAR</button> <button data-act="cancel">CANCELAR</button></div>`;
        return;
      }
      this._confirm = null;
      box.innerHTML = '<div class="gm-confirm">Gravando…</div>';
      const r = await g.save.save(arg, { label: 'Menu' });
      if (r.ok) g.interiors?.audio.sfx('save');
      await this.tab('save');
      const b2 = this.body.querySelector('[data-ref="confirm"]');
      if (b2) b2.innerHTML = `<div class="gm-confirm ${r.ok ? 'ok' : 'err'}">${r.ok ? `Salvo em ${arg.replace('slot', 'Slot ')} (confirmado após a gravação).` : esc(r.msg)}</div>`;
    } else if (act === 'cancel') {
      this._confirm = null;
      box.innerHTML = '';
    } else if (act === 'load') {
      box.innerHTML = '<div class="gm-confirm">Carregando…</div>';
      const r = await g.loadGame(arg);
      if (r.ok) { this.close(); g.hud.toast('Partida carregada', 2.5); }
      else box.innerHTML = `<div class="gm-confirm err">${esc(r.msg)} Os demais slots não foram alterados.</div>`;
    } else if (act === 'quality') {
      g.setQuality(arg);
      this.tab('settings');
    } else if (act === 'mute') {
      g.audio.toggleMute();
      this.tab('settings');
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey, true);
    this.el.remove();
  }
}
