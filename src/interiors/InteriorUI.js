/**
 * Painel de diálogo e comércio dos estabelecimentos (identidade Neon City).
 * Opções numeradas (1–9); E ou Esc fecham. Enquanto aberto, as teclas
 * numéricas não trocam de arma (o evento é consumido antes do jogo).
 */
export class InteriorUI {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'int-panel hidden';
    this.el.innerHTML = `
      <div class="int-head"><span class="int-who" data-i="who"></span><span class="int-place" data-i="place"></span></div>
      <div class="int-text" data-i="text"></div>
      <ol class="int-opts" data-i="opts"></ol>
      <div class="int-foot"><span data-i="money"></span><span><kbd>1</kbd>–<kbd>9</kbd> escolher · <kbd>E</kbd>/<kbd>ESC</kbd> fechar</span></div>`;
    root.appendChild(this.el);
    this.r = {};
    this.el.querySelectorAll('[data-i]').forEach((n) => { this.r[n.dataset.i] = n; });
    this.open = false;
    this.options = [];
    this._onKey = (e) => {
      if (!this.open) return;
      if (e.code.startsWith('Digit')) {
        const i = Number(e.code.slice(5)) - 1;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat && this.options[i]) this._choose(i);
      } else if (e.code === 'Escape' || e.code === 'KeyE') {
        e.stopImmediatePropagation();
        if (!e.repeat) this.close();
      }
    };
    window.addEventListener('keydown', this._onKey, true);
  }

  /** page: { who, place, text, options: [{ label, run }] }, moneyFn para o saldo. */
  show(page, moneyFn) {
    this.page = page;
    this.moneyFn = moneyFn;
    this.r.who.textContent = page.who || '';
    this.r.place.textContent = page.place || '';
    this.r.text.textContent = page.text || '';
    this.options = page.options || [];
    this.r.opts.innerHTML = this.options.map((o, i) => `<li class="${o.disabled ? 'off' : ''}"><kbd>${i + 1}</kbd> ${o.label}</li>`).join('');
    this.r.money.textContent = moneyFn ? `Saldo: $${moneyFn()}` : '';
    this.el.classList.remove('hidden');
    this.open = true;
  }

  _choose(i) {
    const o = this.options[i];
    if (o.disabled) return;
    const next = o.run?.();
    if (next) this.show(next, this.moneyFn);
    else if (next === null) this.close();
    else this.r.money.textContent = this.moneyFn ? `Saldo: $${this.moneyFn()}` : '';
  }

  /** Mensagem de retorno dentro do painel (ex.: compra concluída). */
  feedback(text) {
    this.r.text.textContent = text;
  }

  close() {
    this.open = false;
    this.el.classList.add('hidden');
    this.onClose?.();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey, true);
    this.el.remove();
  }
}
