import { bindingLabel as K } from '../core/InputManager.js';

/**
 * Painel náutico (anos 80): velocidade em nós e km/h, acelerador (frente/ré),
 * integridade do casco, profundidade, rumo e local. Só aparece pilotando.
 */
const DIRS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];

export class BoatHUD {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'veh-hud boat-hud';
    this.el.innerHTML = `
      <div class="veh-head"><span class="veh-name" data-ref="name">BARCO</span><span class="veh-cat" data-ref="cat"></span></div>
      <div class="boat-row">
        <div class="veh-speed"><span data-ref="kn">0</span><small>NÓS</small></div>
        <div class="boat-kmh"><span data-ref="kmh">0</span> km/h</div>
        <div class="boat-throttle"><small>ACELERADOR</small><div class="boat-tbar"><div class="boat-tfill" data-ref="tfill"></div><div class="boat-tmid"></div></div></div>
      </div>
      <div class="veh-integrity"><small>CASCO</small><div class="veh-bar"><div class="veh-fill" data-ref="fill"></div></div><span data-ref="hp">100%</span></div>
      <div class="boat-info"><span data-ref="head">RUMO N</span> · <span data-ref="depth">PROF. —</span> · <span data-ref="place"></span></div>
      <div class="veh-keys"><kbd>${K('forward')}</kbd>/<kbd>${K('back')}</kbd> acelerar/ré · <kbd>${K('left')}</kbd>/<kbd>${K('right')}</kbd> leme · <kbd>${K('run')}</kbd> potência · <kbd>${K('horn')}</kbd> buzina · <kbd>${K('toggleCamera')}</kbd> câmera · <kbd>${K('interact')}</kbd> sair</div>
    `;
    root.appendChild(this.el);
    this.refs = {};
    for (const n of this.el.querySelectorAll('[data-ref]')) this.refs[n.dataset.ref] = n;
    this.visible = false;
    this._t = 0;
  }

  show(boat) {
    this.boat = boat;
    this.refs.name.textContent = boat.name;
    this.refs.cat.textContent = boat.spec.kind.toUpperCase();
    this.el.classList.add('visible');
    this.visible = true;
  }

  hide() {
    this.el.classList.remove('visible');
    this.visible = false;
    this.boat = null;
  }

  update(dt, place) {
    if (!this.visible || !this.boat) return;
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.1;
    const b = this.boat, P = b.phys, r = this.refs;
    const v = Math.abs(P.forwardSpeed);
    r.kn.textContent = Math.round(v * 1.944);
    r.kmh.textContent = Math.round(v * 3.6);
    const t = P.throttle;
    r.tfill.style.left = t >= 0 ? '50%' : `${50 + t * 50}%`;
    r.tfill.style.width = `${Math.abs(t) * 50}%`;
    r.tfill.classList.toggle('rev', t < 0);
    const hp = Math.max(0, Math.round((b.hp / b.maxHp) * 100));
    r.hp.textContent = `${hp}%`;
    r.fill.style.width = `${hp}%`;
    r.fill.classList.toggle('low', hp < 30);
    const deg = ((-P.heading * 180) / Math.PI + 180 + 360) % 360; // 0° = norte (−Z)
    r.head.textContent = `RUMO ${DIRS[Math.round(deg / 45) % 8]} ${Math.round(deg)}°`;
    r.depth.textContent = P.grounded > 0.3 ? 'ENCALHADO' : `PROF. ${P.depth.toFixed(1)} m`;
    r.place.textContent = place || '';
  }
}
