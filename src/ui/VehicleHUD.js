/**
 * Painel automotivo compacto (anos 80): velocímetro analógico em arco com
 * ponteiro neon, velocidade digital em km/h, marcha/estado da transmissão,
 * integridade e nome do veículo. Aparece só durante a direção.
 */
import { bindingLabel as K } from '../core/InputManager.js';

export class VehicleHUD {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'veh-hud';
    const ticks = [];
    for (let i = 0; i <= 12; i++) {
      const a = (-210 + i * 20) * Math.PI / 180;
      const r0 = i % 2 === 0 ? 62 : 67, r1 = 74;
      ticks.push(`<line x1="${(100 + Math.cos(a) * r0).toFixed(1)}" y1="${(92 + Math.sin(a) * r0).toFixed(1)}" x2="${(100 + Math.cos(a) * r1).toFixed(1)}" y2="${(92 + Math.sin(a) * r1).toFixed(1)}" class="${i >= 10 ? 'red' : ''}"/>`);
    }
    this.el.innerHTML = `
      <div class="veh-head"><span class="veh-name" data-ref="name">VEÍCULO</span><span class="veh-cat" data-ref="cat"></span></div>
      <svg class="veh-dial" viewBox="0 0 200 118">
        <path d="M ${100 + Math.cos(-210 * Math.PI / 180) * 78} ${92 + Math.sin(-210 * Math.PI / 180) * 78} A 78 78 0 1 1 ${100 + Math.cos(30 * Math.PI / 180) * 78} ${92 + Math.sin(30 * Math.PI / 180) * 78}" class="arc"/>
        <g class="ticks">${ticks.join('')}</g>
        <g data-ref="labels"></g>
        <line x1="100" y1="92" x2="100" y2="30" class="needle" data-ref="needle"/>
        <circle cx="100" cy="92" r="6" class="hub"/>
      </svg>
      <div class="veh-readout">
        <div class="veh-speed"><span data-ref="speed">0</span><small>KM/H</small></div>
        <div class="veh-gear"><small>MARCHA</small><span data-ref="gear">P</span></div>
      </div>
      <div class="veh-integrity"><small>INTEGRIDADE</small><div class="veh-bar"><div class="veh-fill" data-ref="fill"></div></div><span data-ref="integrity">100%</span></div>
      <div class="veh-keys"><kbd>${K('handbrake')}</kbd> freio de mão · <kbd>${K('horn')}</kbd> buzina · <kbd>${K('recover')}</kbd> recuperar · <kbd>${K('interact')}</kbd> sair</div>
    `;
    root.appendChild(this.el);
    this.refs = {};
    for (const n of this.el.querySelectorAll('[data-ref]')) this.refs[n.dataset.ref] = n;
    this.visible = false;
    this._timer = 0;
    this._max = 240;
    this.speedKmh = 0;
  }

  show(vehicle) {
    this.vehicle = vehicle;
    this.refs.name.textContent = vehicle.spec.model.toUpperCase();
    this.refs.cat.textContent = vehicle.spec.category || '';
    // Escala do mostrador conforme a velocidade máxima do modelo.
    this._max = Math.ceil((vehicle.spec.handling.maxSpeed * 3.6) / 40) * 40;
    const labels = [];
    for (let i = 0; i <= 6; i++) {
      const a = (-210 + i * 40) * Math.PI / 180;
      labels.push(`<text x="${(100 + Math.cos(a) * 50).toFixed(1)}" y="${(95 + Math.sin(a) * 50).toFixed(1)}">${Math.round((this._max / 6) * i)}</text>`);
    }
    this.refs.labels.innerHTML = labels.join('');
    this.el.classList.add('visible');
    this.visible = true;
  }

  hide() {
    this.el.classList.remove('visible');
    this.visible = false;
    this.vehicle = null;
  }

  update(dt) {
    if (!this.visible || !this.vehicle) return;
    this._timer -= dt;
    if (this._timer > 0) return;
    this._timer = 1 / 15;
    const v = this.vehicle, ph = v.physics;
    const kmh = Math.abs(ph.vLong) * 3.6;
    this.speedKmh = kmh;
    this.refs.speed.textContent = String(Math.round(kmh)).padStart(3, '0');
    const frac = Math.min(1, kmh / this._max);
    const ang = -210 + frac * 240;
    this.refs.needle.setAttribute('transform', `rotate(${(ang + 90).toFixed(1)} 100 92)`);
    const g = ph.gear;
    this.refs.gear.textContent = typeof g === 'number' ? `D${g}` : g;
    const integ = Math.round(v.damage.integrity);
    this.refs.integrity.textContent = `${integ}%`;
    this.refs.fill.style.width = `${integ}%`;
    this.refs.fill.classList.toggle('low', integ < 30);
  }
}
