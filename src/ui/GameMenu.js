import { formatClock } from '../player/PlayerStatus.js';
import { ACTION_INFO, bindingLabel } from '../core/InputManager.js';
import { INTERFACE_DEFAULTS, loadInterfacePreferences, sanitizePreferences, saveInterfacePreferences } from './InterfacePreferences.js';
import { WorldMapView } from './WorldMapView.js';

const money = (n) => `$${Number(n).toLocaleString('pt-BR')}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Menu do jogo (tecla P): Voltar ao jogo, Salvar, Carregar, Propriedades,
 * Inventário e Configurações. A simulação fica pausada enquanto está aberto.
 * Tela turquesa com navegação lateral, categorias e seleção rosa.
 */
export class GameMenu {
  constructor(game, root) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'game-menu hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Menu de pausa e opções');
    this.el.innerHTML = `<div class="gm-frame">
      <aside class="gm-sidebar">
        <div class="gm-brand"><span>neon</span><span>city</span><em>Vice City</em><small>1986 · LOCAL EDITION</small></div>
        <nav class="gm-tabs" aria-label="Menu principal">
          <button data-tab="resume">RETOMAR</button><button data-tab="map">MAPA</button>
          <button data-tab="save" data-section="game">JOGO</button><button data-tab="manuals">MANUAIS</button>
          <button data-tab="stats">ESTATÍSTICAS</button><button data-tab="settings">OPÇÕES</button>
        </nav>
      </aside>
      <main class="gm-main"><nav class="gm-categories" data-ref="categories" aria-label="Categorias"></nav>
        <section class="gm-body" data-ref="body"></section>
        <footer class="gm-foot"><span data-ref="status"></span><span><kbd>P</kbd> / <kbd>ESC</kbd> VOLTAR</span></footer>
      </main></div>`;
    root.appendChild(this.el);
    this.body = this.el.querySelector('[data-ref="body"]');
    this.status = this.el.querySelector('[data-ref="status"]');
    this.categories = this.el.querySelector('[data-ref="categories"]');
    this.preferences = loadInterfacePreferences();
    this.optionPage = 'controls'; this.manualPage = 'foot';
    this.open = false;
    this.applyPreferences();
    // Volumes por canal (Configurações): aplicados na hora e lembrados entre sessões.
    this.el.addEventListener('input', (e) => {
      if (e.target.matches('[data-pref]')) {
        const key = e.target.dataset.pref;
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? +e.target.value : e.target.value;
        this.preferences = sanitizePreferences({ ...this.preferences, [key]: value });
        this.applyPreferences(); saveInterfacePreferences(this.preferences);
        const output = e.target.closest('.gm-option-row')?.querySelector('output');
        if (output) output.textContent = key === 'zoom' ? `${Number(value).toFixed(1)}×` : value;
        return;
      }
      if (e.target.matches('[data-quality]')) { game.setQuality(e.target.value); this.tab('settings'); return; }
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
      if (e.code === 'F3') { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (this.current === 'map' && this.mapView?.handleKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.code === 'Tab') {
        const items = [...this.el.querySelectorAll('button:not([disabled]), input, select, [tabindex="0"]')].filter(node => node.getClientRects().length);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        e.stopImmediatePropagation(); return;
      }
      if (e.code === 'Escape' || e.code === 'KeyP') { e.stopImmediatePropagation(); e.preventDefault(); if (!e.repeat) this.close(); return; }
      // Menu navigation must not leave driving/weapon keys held when resuming.
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', this._onKey, true);
  }

  toggle(tab = 'settings') { if (this.open) this.close(); else this.show(tab); }

  show(tab = 'settings') {
    const g = this.game;
    if (!['playing', 'title'].includes(g.state) || g.mapLoading) return;
    this.previousFocus = document.activeElement;
    this.performanceSnapshot = { ...g.renderer.info.render, fps: g.time.fps };
    this.open = true;
    g.menuOpen = true;
    g.input.clearAll();
    g.input.exitPointerLock?.();
    try { document.exitPointerLock?.(); } catch { /* ignorado */ }
    this.el.classList.remove('hidden');
    this.tab(tab);
    this.el.querySelector('.gm-tabs button.active')?.focus();
  }

  close() {
    this.mapView?.dispose(); this.mapView = null;
    this.open = false;
    this.game.menuOpen = false;
    this.game.input.clearAll();
    this.game.time.reset?.();
    this.el.classList.add('hidden');
    if (this.previousFocus?.isConnected && !this.el.contains(this.previousFocus)) this.previousFocus.focus({ preventScroll: true });
  }

  _setActive(tab) {
    const section = ['save', 'load', 'props', 'inv'].includes(tab) ? 'game' : tab;
    for (const b of this.el.querySelectorAll('.gm-tabs [data-tab]')) b.classList.toggle('active', (b.dataset.section || b.dataset.tab) === section);
  }

  async tab(tab) {
    const g = this.game;
    this.mapView?.dispose(); this.mapView = null;
    this.el.classList.toggle('is-map', tab === 'map');
    this.current = tab;
    this._setActive(tab);
    this.categories.innerHTML = '';
    this.status.textContent = `Saldo ${money(g.economy.balance())} · ${formatClock(g.player.status.minutes)}`;
    if (tab === 'resume') { this.close(); return; }
    if (tab === 'settings') { this.renderOptions(); return; }
    if (tab === 'manuals') { this.renderManuals(); return; }
    if (tab === 'map') {
      this.categories.innerHTML = '<h2>Vice City</h2><span>MAPA</span><button data-tab="settings">← MENU</button>';
      this.body.innerHTML = '';
      this.mapView = new WorldMapView(g.minimap, this.body); return;
    }
    if (tab === 'stats') {
      this.categories.innerHTML = '<h2>ESTATÍSTICAS</h2>';
      const metrics = this.performanceSnapshot || {}, stats = g.mapEnv?.stats || {};
      this.body.innerHTML = this.rows([['Tempo de jogo', `${Math.floor(g.playTime / 60)} min`], ['Saúde', `${g.player.status.health}%`],
        ['Saldo', money(g.economy.balance())], ['Procurado', `${g.player.status.wanted} / 6`], ['Mapa', 'VICE CITY'],
        ['Setores carregados', stats.sectors ?? '—'], ['FPS antes da pausa', Math.round(metrics.fps || 0)],
        ['Chamadas de desenho', metrics.calls ?? '—'], ['Triângulos no quadro', Number(metrics.triangles || 0).toLocaleString('pt-BR')]]); return;
    }
    if (['save', 'load', 'props', 'inv'].includes(tab)) {
      this.categories.innerHTML = [['save', 'SALVAR'], ['load', 'CARREGAR'], ['props', 'PROPRIEDADES'], ['inv', 'INVENTÁRIO']]
        .map(([id, title]) => `<button data-tab="${id}" class="${id === tab ? 'active' : ''}">${title}</button>`).join('');
    }
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
  }

  rows(values) { return values.map(([label, value]) => `<div class="gm-option-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join(''); }

  applyPreferences() {
    const p = this.preferences, g = this.game;
    g.cameras.sensitivity = 0.0022 * p.sensitivity / 50; g.cameras.invertY = p.invertY;
    g.minimap.configure({ northUp: p.northUp, zoom: p.zoom, colorBlind: p.colorBlind });
    this.el.classList.toggle('gm-high-contrast', p.highContrast);
    this.el.dataset.textSize = p.helpSize;
    document.documentElement.classList.toggle('reduce-interface-motion', p.reduceMotion);
  }

  renderOptions() {
    const g = this.game, p = this.preferences;
    const pages = [['controls', 'CONTROLES'], ['gameplay', 'JOGABILIDADE'], ['graphics', 'GRÁFICOS'], ['audio', 'ÁUDIO'], ['accessibility', 'ACESSIBILIDADE']];
    this.categories.innerHTML = pages.map(([id, title]) => `<button data-act="options" data-arg="${id}" class="${id === this.optionPage ? 'active' : ''}">${title}</button>`).join('');
    const row = (label, control) => `<label class="gm-option-row"><span>${label}</span><span class="gm-option-control">${control}</span></label>`;
    const check = (key, label) => row(label, `<input aria-label="${label}" type="checkbox" data-pref="${key}" ${p[key] ? 'checked' : ''}><span class="gm-switch"></span>`);
    const range = (key, label, min, max, step) => row(label, `<input aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}" value="${p[key]}" data-pref="${key}"><output>${key === 'zoom' ? p[key].toFixed(1)+'×' : p[key]}</output>`);
    const select = (key, label, options) => row(label, `<select aria-label="${label}" data-pref="${key}">${options.map(([id, title]) => `<option value="${id}" ${p[key] === id ? 'selected' : ''}>${title}</option>`).join('')}</select>`);
    let html = '';
    if (this.optionPage === 'controls') html = range('sensitivity', 'Sensibilidade do mouse', 5, 100, 1) + check('invertY', 'Inverter câmera vertical')
      + this.rows(['forward','run','jump','interact','toggleCamera','gameMenu'].map(id => [ACTION_INFO[id].label, bindingLabel(id)]))
      + '<button class="gm-option-row gm-wide-action" data-tab="manuals">Ver todos os controles e manuais <span>›</span></button>';
    if (this.optionPage === 'gameplay') html = check('northUp', 'Manter norte no topo do minimapa') + range('zoom', 'Área visível do minimapa', 0.5, 2, 0.1)
      + this.rows([['Câmera', g.cameras.mode === 'first' ? 'Primeira pessoa' : 'Terceira pessoa'], ['Mapa ativo', 'Vice City completo']])
      + `<button class="gm-option-row gm-wide-action" data-act="camera" ${g.state !== 'playing' ? 'disabled' : ''}>Alternar câmera <span>${g.state === 'playing' ? '›' : 'Durante a partida'}</span></button>`;
    if (this.optionPage === 'graphics') html = row('Qualidade gráfica', `<select aria-label="Qualidade gráfica" data-quality>${Object.entries(g.qualityPresets).map(([id, q]) => `<option value="${id}" ${g.qualityKey === id ? 'selected' : ''}>${q.label}</option>`).join('')}</select>`)
      + this.rows([['Sombras', g.quality.shadows ? 'Ativadas' : 'Desativadas'], ['Distância de visão', g.quality.drawDistance+' m'], ['Resolução', 'Adaptativa'], ['Pixel ratio atual', g.pixelRatio.toFixed(2)+'×']]);
    if (this.optionPage === 'audio') html = [['master','Volume geral'],['music','Música'],['radio','Rádio'],['voice','Vozes'],['sfx','Efeitos'],['ambient','Ambiente']]
      .map(([id,label]) => row(label, `<input aria-label="${label}" type="range" min="0" max="100" step="5" data-vol="${id}" value="${Math.round(g.audio.levels[id]*100)}"><b>${Math.round(g.audio.levels[id]*100)}</b>`)).join('')
      + `<button class="gm-option-row gm-wide-action" data-act="mute">Som <span>${g.audio.muted ? 'Desativado' : 'Ativado'} ‹ ›</span></button>`;
    if (this.optionPage === 'accessibility') html = select('helpSize', 'Tamanho do texto de ajuda', [['small','Pequeno'],['normal','Normal'],['large','Grande']])
      + select('colorBlind', 'Modo daltônico no radar', [['off','Desligado'],['contrast','Alto contraste']])
      + check('highContrast', 'Alto contraste da interface') + check('reduceMotion', 'Reduzir animações da interface')
      + '<p class="gm-note">Os marcadores usam formas e símbolos; sua posição também pode ser destacada em amarelo.</p>';
    this.body.innerHTML = html + '<button class="gm-option-row gm-wide-action gm-restore" data-act="defaults">Restaurar padrões <span>↺</span></button>';
  }

  renderManuals() {
    const groups = { foot: ['A PÉ', ['forward','back','left','right','run','jump','toggleCamera','interact']],
      vehicle: ['VEÍCULOS', ['forward','back','left','right','handbrake','horn','nitrous','gearUp','gearDown','transmissionMode','recover','interact']],
      weapons: ['ARMAS', ['fire','aim','reload','holster','quickSelect','weaponNext','weaponPrev','weapon1','weapon2','weapon3','weapon4','weapon5','weapon6','weapon7','weapon8']],
      radio: ['RÁDIO', ['radioNext','radioPrev','toggleMute']],
      general: ['GERAL', ['gameMenu','inventory','toggleNavigation','toggleHelp','toggleStats','cycleQuality','cycleTime']] };
    this.categories.innerHTML = Object.entries(groups).map(([id,[title]]) => `<button data-act="manual" data-arg="${id}" class="${id === this.manualPage ? 'active' : ''}">${title}</button>`).join('');
    const [title, actions] = groups[this.manualPage];
    this.body.innerHTML = `<div class="gm-manual-heading">${title}</div>` + this.rows(actions.map(id => [ACTION_INFO[id].label, bindingLabel(id)]))
      + (this.manualPage === 'general' ? this.rows([['Mover a câmera', 'MOUSE'], ['Capturar o mouse', 'Clique na cena'], ['Liberar o mouse', 'ESC']]) : '')
      + (this.manualPage === 'vehicle' ? '<p class="gm-note">Câmbio manual: freie antes de engatar ré. Para preparar a largada, segure Espaço + W parado e solte o freio. Shift usa nitro quando disponível.</p>' : '')
      + (this.manualPage === 'radio' ? '<p class="gm-note">A roda do mouse seleciona a rádio em veículos. A pé, ela seleciona armas.</p>' : '');
  }

  async _act(act, arg) {
    const g = this.game;
    const box = this.body.querySelector('[data-ref="confirm"]');
    if (act === 'options') { this.optionPage = arg; this.tab('settings'); return; }
    if (act === 'manual') { this.manualPage = arg; this.tab('manuals'); return; }
    if (act === 'camera') { g.cameras.toggle(); this.tab('settings'); return; }
    if (act === 'defaults') {
      this.preferences = { ...INTERFACE_DEFAULTS }; this.applyPreferences(); saveInterfacePreferences(this.preferences);
      g.setQuality('medium');
      for (const [id, value] of Object.entries({ master:1, music:0.8, radio:0.8, voice:0.9, sfx:1, ambient:1 })) g.audio.setLevel(id, value);
      if (g.audio.muted) g.audio.toggleMute();
      g.radio?.playback.refreshLevels(); this.tab('settings'); return;
    }
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
    this.mapView?.dispose();
    window.removeEventListener('keydown', this._onKey, true);
    this.el.remove();
  }
}
