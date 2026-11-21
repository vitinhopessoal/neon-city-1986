/**
 * Tela de abertura: título, subtítulo, seleção de qualidade gráfica e botão
 * INICIAR JOGO. O cenário 3D é renderizado ao fundo em plano cinematográfico.
 */
export class StartScreen {
  constructor(root, { presets, current, onStart, onQuality, onContinue = null, onLoadSlot = null, listSlots = null }) {
    this.onLoadSlot = onLoadSlot;
    this.listSlots = listSlots;
    this.el = document.createElement('div');
    this.el.className = 'start-screen';
    const buttons = Object.entries(presets)
      .map(([key, p]) => `<button class="q-btn${key === current ? ' active' : ''}" data-q="${key}">${p.label}</button>`)
      .join('');
    this.el.innerHTML = `
      <div class="start-sun"></div>
      <div class="start-grid"></div>
      <div class="start-content">
        <h1 class="start-title"><span class="t-neon">NEON CITY</span><span class="t-year">1986</span></h1>
        <div class="start-subtitle">WELCOME TO SUNSET BEACH</div>
        <button class="start-button" data-ref="start" disabled>CARREGANDO…</button>
        <div class="start-menu-row">
          <button class="start-sub" data-ref="continue" disabled>CONTINUAR</button>
          <button class="start-sub" data-ref="load" disabled>CARREGAR JOGO</button>
        </div>
        <div class="start-slots hidden" data-ref="slots"></div>
        <div class="start-msg" data-ref="msg"></div>
        <div class="start-quality">
          <span>CONFIGURAÇÕES · QUALIDADE GRÁFICA</span>
          <div class="q-group">${buttons}</div>
        </div>
        <div class="start-hint">WASD mover · SHIFT correr · ESPAÇO pular · MOUSE câmera · V alterna 1ª/3ª pessoa · ESC libera o mouse</div>
      </div>
    `;
    root.appendChild(this.el);
    this.startBtn = this.el.querySelector('[data-ref="start"]');
    this.contBtn = this.el.querySelector('[data-ref="continue"]');
    this.loadBtn = this.el.querySelector('[data-ref="load"]');
    this.slotsEl = this.el.querySelector('[data-ref="slots"]');
    this.msgEl = this.el.querySelector('[data-ref="msg"]');
    this.contBtn.addEventListener('click', () => { if (!this.contBtn.disabled) onContinue?.(); });
    this.loadBtn.addEventListener('click', () => this.toggleSlots());
    this.slotsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-slot]'); if (b && !b.disabled) this.onLoadSlot?.(b.dataset.slot); });
    this.startBtn.addEventListener('click', () => {
      if (this.startBtn.disabled) return;
      this.startBtn.disabled = true;
      onStart();
    });
    for (const b of this.el.querySelectorAll('.q-btn')) {
      b.addEventListener('click', () => {
        for (const o of this.el.querySelectorAll('.q-btn')) o.classList.toggle('active', o === b);
        onQuality(b.dataset.q);
      });
    }
  }

  /** Seletor de mapa (apenas em desenvolvimento). */
  setMapOptions(maps, activeId, onSelect) {
    const row = document.createElement('div');
    row.className = 'start-quality start-maps';
    row.innerHTML = `<span>MAPA (DEV) · F8 ALTERNA</span><div class="q-group">${maps
      .map((m) => `<button class="q-btn${m.id === activeId ? ' active' : ''}" data-map="${m.id}">${m.label}</button>`)
      .join('')}</div>`;
    this.el.querySelector('.start-quality').after(row);
    this.mapRow = row;
    for (const b of row.querySelectorAll('[data-map]')) {
      b.addEventListener('click', () => {
        if (this.busy || b.classList.contains('active')) return;
        onSelect(b.dataset.map);
      });
    }
  }

  markMap(id) {
    if (!this.mapRow) return;
    for (const b of this.mapRow.querySelectorAll('[data-map]')) b.classList.toggle('active', b.dataset.map === id);
  }

  setBusy(busy) {
    this.busy = busy;
    this.startBtn.disabled = busy;
    this.startBtn.textContent = busy ? 'CARREGANDO…' : 'NOVO JOGO';
    if (busy) { this.contBtn.disabled = true; this.loadBtn.disabled = true; } else this.setSaveInfo(this.saveInfo ?? null);
  }

  /** Último salvamento válido: habilita Continuar (indisponível sem save). */
  setSaveInfo(latest) {
    this.saveInfo = latest;
    if (this.busy) return;
    this.contBtn.disabled = !latest;
    this.loadBtn.disabled = !this.listSlots;
    this.contBtn.title = latest ? `${latest.slot === 'auto' ? 'Autosave' : latest.slot.replace('slot', 'Slot ')} · ${new Date(latest.meta.savedAt).toLocaleString('pt-BR')}` : 'Nenhum salvamento';
  }

  async toggleSlots() {
    if (!this.slotsEl.classList.contains('hidden')) { this.slotsEl.classList.add('hidden'); return; }
    this.slotsEl.classList.remove('hidden');
    this.slotsEl.textContent = 'Lendo salvamentos…';
    const list = await this.listSlots();
    const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => '&#' + ch.charCodeAt(0) + ';');
    this.slotsEl.innerHTML = Object.entries(list).map(([k, v]) => `<button class="start-slot" data-slot="${k}" ${v.ok ? '' : 'disabled'}><b>${k === 'auto' ? 'AUTOSAVE' : k.replace('slot', 'SLOT ')}</b> ${v.ok ? `${new Date(v.meta.savedAt).toLocaleString('pt-BR')} · $${v.meta.money.toLocaleString('pt-BR')} ·${esc(v.meta.location)}` : (v.empty ? 'vazio' : 'inválido')}</button>`).join('');
  }

  showMessage(msg) {
    this.msgEl.textContent = msg || '';
  }

  setReady() {
    this.startBtn.disabled = false;
    this.startBtn.textContent = 'NOVO JOGO';
    this.setSaveInfo(this.saveInfo ?? null);
    this.startBtn.focus({ preventScroll: true });
  }

  setError(msg) {
    this.startBtn.textContent = msg;
  }

  hide() {
    this.el.classList.add('fade-out');
    setTimeout(() => this.el.remove(), 900);
  }
}
