/** Indicador de carregamento de mapas (progresso por fase e mensagens de erro). */
const PHASES = {
  manifest: 'Lendo manifesto',
  download: 'Baixando modelo',
  parse: 'Interpretando glTF e texturas',
  process: 'Gerando colisões e otimizando',
  procedural: 'Gerando cenário procedural',
  done: 'Concluído',
};

export class LoadingOverlay {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'map-loading';
    this.el.innerHTML = `
      <div class="map-loading-box">
        <div class="map-loading-title" data-ref="title"></div>
        <div class="map-loading-phase" data-ref="phase"></div>
        <div class="map-loading-bar"><div class="map-loading-fill" data-ref="fill"></div></div>
        <div class="map-loading-detail" data-ref="detail"></div>
      </div>`;
    root.appendChild(this.el);
    this.refs = {};
    for (const n of this.el.querySelectorAll('[data-ref]')) this.refs[n.dataset.ref] = n;
  }

  show(title, phase = 'manifest') {
    this.el.classList.remove('error');
    this.el.classList.add('visible');
    this.refs.title.textContent = title;
    this.progress(phase, 0);
    this.refs.detail.textContent = '';
  }

  progress(phase, fraction) {
    const order = ['manifest', 'download', 'parse', 'process', 'done'];
    const i = Math.max(0, order.indexOf(phase));
    // Progresso global ponderado: download 55%, parse 15%, processamento 25%.
    const weights = { manifest: [0, 0.05], download: [0.05, 0.55], parse: [0.6, 0.15], process: [0.75, 0.25], done: [1, 0], procedural: [0, 1] };
    const [start, span] = weights[phase] || [i / order.length, 0];
    const pct = Math.round((start + span * fraction) * 100);
    this.refs.phase.textContent = `${PHASES[phase] || phase}… ${pct}%`;
    this.refs.fill.style.width = `${pct}%`;
  }

  error(title, message) {
    this.el.classList.add('visible', 'error');
    this.refs.title.textContent = `Falha ao carregar: ${title}`;
    this.refs.phase.textContent = 'Não foi possível concluir o carregamento do cenário.';
    this.refs.detail.textContent = message;
  }

  hide() {
    this.el.classList.remove('visible');
  }
}
