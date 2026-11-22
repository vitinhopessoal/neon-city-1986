import { DIAL, STATION_BY_ID, RADIO_OFF, stationLogo } from './RadioStations.js';

/**
 * Interface do rádio (identidade Neon City):
 *  - ROLETA: dentro de um veículo, o scroll do mouse abre um círculo com os logotipos das
 *    emissoras e RADIO OFF; cada passo do scroll destaca a próxima/anterior. Após 2 s sem
 *    interação a roleta some e a estação destacada passa a tocar (onSelect).
 *  - FAIXA DA ESTAÇÃO: ao sintonizar, mostra logotipo, frequência, nome, gênero e o que toca;
 *    desaparece suavemente depois de alguns segundos.
 */
const IDLE_CLOSE = 2.0;

export class RadioUI {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'radio-layer';
    this.el.innerHTML = `
      <div class="radio-wheel hidden">
        ${DIAL.map((id) => `<div class="radio-item" data-id="${id}">${stationLogo(id)}</div>`).join('')}
        <div class="radio-wheel-center"><span class="rw-freq"></span><span class="rw-name"></span><span class="rw-genre"></span></div>
      </div>
      <div class="radio-banner hidden"><div class="rb-logo"></div><div class="rb-text"><span class="rb-top"></span><span class="rb-name"></span><span class="rb-now"></span></div></div>`;
    root.appendChild(this.el);
    this.wheel = this.el.querySelector('.radio-wheel');
    this.items = [...this.el.querySelectorAll('.radio-item')];
    this.c = { freq: this.el.querySelector('.rw-freq'), name: this.el.querySelector('.rw-name'), genre: this.el.querySelector('.rw-genre') };
    this.banner = this.el.querySelector('.radio-banner');
    this.b = { logo: this.el.querySelector('.rb-logo'), top: this.el.querySelector('.rb-top'), name: this.el.querySelector('.rb-name'), now: this.el.querySelector('.rb-now') };
    this.open = false;
    this.hover = 0;
    this.idle = 0;
    this.bannerT = 0;
    this.onSelect = null;
    this._layout();
    this.stats = { opened: 0, selected: 0 };
  }

  _layout() {
    const n = this.items.length;
    this.items.forEach((it, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2; // primeira emissora no topo, sentido horário
      it.style.setProperty('--x', `${(Math.cos(a) * 42).toFixed(2)}%`);
      it.style.setProperty('--y', `${(Math.sin(a) * 42).toFixed(2)}%`);
    });
  }

  /** Um passo do scroll (dir = +1/-1). Abre a roleta se fechada. */
  scroll(dir, currentId) {
    if (!this.open) {
      this.open = true;
      this.stats.opened++;
      this.hover = Math.max(0, DIAL.indexOf(currentId));
      this.wheel.classList.remove('hidden');
      this.banner.classList.add('hidden');
    } else {
      this.hover = (this.hover + dir + DIAL.length) % DIAL.length;
    }
    this.idle = 0;
    this._refresh();
  }

  _refresh() {
    const id = DIAL[this.hover];
    this.items.forEach((it, i) => it.classList.toggle('active', i === this.hover));
    const s = id === 'off' ? RADIO_OFF : STATION_BY_ID.get(id);
    this.c.freq.textContent = s.freq ? `${s.freq} FM` : '';
    this.c.name.textContent = s.name;
    this.c.genre.textContent = s.genre;
    this.wheel.style.setProperty('--accent', s.colors[0]);
  }

  /** Fecha sem escolher (saiu do veículo, menu...). */
  cancel() {
    if (!this.open) return;
    this.open = false;
    this.wheel.classList.add('hidden');
  }

  /** Faixa com a estação sintonizada. */
  showStation(id, nowPlaying = '') {
    const s = id === 'off' ? RADIO_OFF : STATION_BY_ID.get(id);
    if (!s) return;
    this.b.logo.innerHTML = stationLogo(id);
    this.b.top.textContent = s.freq ? `${s.freq} FM · ${s.genre}` : 'RÁDIO DESLIGADO';
    this.b.name.textContent = s.name;
    this.b.now.textContent = nowPlaying;
    this.banner.style.setProperty('--accent', s.colors[0]);
    this.banner.classList.remove('hidden');
    this.bannerT = 4.0;
  }

  setNowPlaying(text) { if (this.bannerT > 0) this.b.now.textContent = text; }

  update() {
    // Tempo REAL (não o do jogo): 2 s de verdade mesmo com o quadro lento ou o tempo desacelerado.
    const now = performance.now();
    const dt = Math.min(0.25, (now - (this._t || now)) / 1000);
    this._t = now;
    if (this.open) {
      this.idle += dt;
      if (this.idle >= IDLE_CLOSE) {
        this.open = false;
        this.wheel.classList.add('hidden');
        this.stats.selected++;
        this.onSelect?.(DIAL[this.hover]);
      }
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.add('hidden');
    }
  }

  dispose() { this.el.remove(); }
}
