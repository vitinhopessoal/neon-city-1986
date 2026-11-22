/**
 * Painel automotivo compacto (anos 80): velocímetro analógico em arco com
 * ponteiro neon, velocidade digital em km/h, marcha/estado da transmissão,
 * integridade e nome do veículo. Aparece só durante a direção.
 *
 * Com a mecânica veicular ativa (carros): conta-giros em segmentos com luz de
 * troca, marcha + modo do câmbio (AUT/MAN), reserva de nitro, pressão do turbo
 * (modelos turbo), temperatura do motor, luzes de assistência (TCS/ABS) e um
 * aviso curto para troca perfeita/cedo/tarde, largada e superaquecimento.
 */
import { bindingLabel as K } from '../core/InputManager.js';

const RPM_SEGMENTS = 24;
const FEEDBACK = {
  perfect: ['TROCA PERFEITA', 'good'], early: ['TROCA CEDO', 'warn'], late: ['TROCA TARDE', 'warn'],
  launch_good: ['LARGADA PERFEITA', 'good'], launch_bog_risk: ['LARGADA FRACA · GIRO BAIXO', 'warn'], launch_wheelspin_risk: ['LARGADA · GIRO ALTO DEMAIS', 'warn'],
  overheat: ['MOTOR SUPERAQUECIDO', 'bad'], cooled: ['MOTOR NORMALIZADO', 'good'], nitro_empty: ['NITRO VAZIO', 'warn'],
  rejected_overrev: ['REDUÇÃO RECUSADA · GIRO', 'warn'], rejected_stop: ['PARE PARA ENGATAR N/R', 'warn'],
};

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
    const segs = Array.from({ length: RPM_SEGMENTS }, (_, i) => `<i data-seg="${i}"></i>`).join('');
    this.el.innerHTML = `
      <div class="veh-head"><span class="veh-name" data-ref="name">VEÍCULO</span><span class="veh-cat" data-ref="cat"></span></div>
      <div class="veh-feedback" data-ref="feedback"></div>
      <svg class="veh-dial" viewBox="0 0 200 118">
        <path d="M ${100 + Math.cos(-210 * Math.PI / 180) * 78} ${92 + Math.sin(-210 * Math.PI / 180) * 78} A 78 78 0 1 1 ${100 + Math.cos(30 * Math.PI / 180) * 78} ${92 + Math.sin(30 * Math.PI / 180) * 78}" class="arc"/>
        <g class="ticks">${ticks.join('')}</g>
        <g data-ref="labels"></g>
        <line x1="100" y1="92" x2="100" y2="30" class="needle" data-ref="needle"/>
        <circle cx="100" cy="92" r="6" class="hub"/>
      </svg>
      <div class="veh-readout">
        <div class="veh-speed"><span data-ref="speed">0</span><small>KM/H</small></div>
        <div class="veh-gear"><small>MARCHA <b data-ref="mode"></b></small><span data-ref="gear">P</span></div>
      </div>
      <div class="veh-pt" data-ref="pt">
        <div class="veh-rpm"><div class="veh-rpm-bar" data-ref="rpmBar">${segs}</div><span class="veh-shift" data-ref="shift">TROCA</span></div>
        <div class="veh-rpm-label"><small data-ref="rpmText">0 RPM</small><span class="veh-assist"><b data-ref="tcs">TCS</b><b data-ref="abs">ABS</b><b data-ref="launch">LARGADA</b></span></div>
        <div class="veh-meter veh-nitro"><small>NITRO</small><div class="veh-bar"><div class="veh-fill" data-ref="nitro"></div></div><span data-ref="nitroPct">100%</span></div>
        <div class="veh-meter veh-turbo" data-ref="turboRow"><small>TURBO</small><div class="veh-bar"><div class="veh-fill" data-ref="turbo"></div></div><span data-ref="turboPct">0.0</span></div>
        <div class="veh-meter veh-temp"><small>MOTOR</small><div class="veh-bar"><div class="veh-fill" data-ref="temp"></div></div><span data-ref="tempPct">OK</span></div>
      </div>
      <div class="veh-integrity"><small>INTEGRIDADE</small><div class="veh-bar"><div class="veh-fill" data-ref="fill"></div></div><span data-ref="integrity">100%</span></div>
      <div class="veh-keys" data-ref="keys"></div>
    `;
    root.appendChild(this.el);
    this.refs = {};
    for (const n of this.el.querySelectorAll('[data-ref]')) this.refs[n.dataset.ref] = n;
    this.segs = [...this.el.querySelectorAll('[data-seg]')];
    this.visible = false;
    this._timer = 0;
    this._max = 240;
    this.speedKmh = 0;
    this.feedback = null;
    this._feedbackT = 0;
    this._blink = 0;
    this.lastEvents = [];
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
    const pt = !!vehicle.physics?.powertrain;
    this.el.classList.toggle('has-pt', pt);
    this.refs.keys.innerHTML = pt
      ? `<kbd>${K('nitrous')}</kbd> nitro · <kbd>${K('gearDown')}</kbd>/<kbd>${K('gearUp')}</kbd> marchas · <kbd>${K('transmissionMode')}</kbd> câmbio · <kbd>${K('handbrake')}</kbd>+<kbd>${K('forward')}</kbd> largada<br><kbd>${K('handbrake')}</kbd> freio de mão · <kbd>${K('horn')}</kbd> buzina · <kbd>${K('recover')}</kbd> recuperar · <kbd>${K('interact')}</kbd> sair`
      : `<kbd>${K('handbrake')}</kbd> freio de mão · <kbd>${K('horn')}</kbd> buzina · <kbd>${K('recover')}</kbd> recuperar · <kbd>${K('interact')}</kbd> sair`;
    this.refs.turboRow.hidden = !vehicle.physics?.powertrain?.profile?.turbo;
    this.feedback = null;
    this.refs.feedback.className = 'veh-feedback';
    this.el.classList.add('visible');
    this.visible = true;
    this._timer = 0;
  }

  hide() {
    this.el.classList.remove('visible');
    this.visible = false;
    this.vehicle = null;
  }

  /** Aviso curto no topo do painel (troca, largada, motor, nitro). */
  flash(key, seconds = 1.3) {
    const f = FEEDBACK[key];
    if (!f) return;
    this.feedback = key;
    this._feedbackT = seconds;
    this.refs.feedback.textContent = f[0];
    this.refs.feedback.className = `veh-feedback show ${f[1]}`;
  }

  /** Eventos do câmbio/motor vindos da física (fila esvaziada pelo VehicleManager). */
  powertrainEvent(e) {
    this.lastEvents.push(e);
    if (this.lastEvents.length > 20) this.lastEvents.shift();
    if (e.type === 'shift_quality') this.flash(e.quality, 1.1);
    else if (e.type === 'launch') this.flash(`launch_${e.quality}`, 1.8);
    else if (e.type === 'overheat') this.flash('overheat', 2.4);
    else if (e.type === 'cooled') this.flash('cooled', 1.4);
    else if (e.type === 'nitrous_stop' && (this.vehicle?.physics?.powertrainFrame?.nitrousFraction ?? 1) <= 0.001) this.flash('nitro_empty', 1.4);
    else if (e.type === 'shift_rejected') this.flash(e.reason === 'would_overrev' ? 'rejected_overrev' : 'rejected_stop', 1.2);
  }

  update(dt) {
    if (!this.visible || !this.vehicle) return;
    if (this._feedbackT > 0) {
      this._feedbackT -= dt;
      if (this._feedbackT <= 0) this.refs.feedback.className = 'veh-feedback';
    }
    this._blink += dt;
    this._timer -= dt;
    if (this._timer > 0) return;
    this._timer = 1 / 20;
    const v = this.vehicle, ph = v.physics;
    const kmh = Math.abs(ph.vLong) * 3.6;
    this.speedKmh = kmh;
    this.refs.speed.textContent = String(Math.round(kmh)).padStart(3, '0');
    const frac = Math.min(1, kmh / this._max);
    const ang = -210 + frac * 240;
    this.refs.needle.setAttribute('transform', `rotate(${(ang + 90).toFixed(1)} 100 92)`);
    const g = ph.gear;
    const fr = ph.powertrainActive ? ph.powertrainFrame : null;
    if (fr) {
      this.refs.gear.textContent = typeof g === 'number' ? String(g) : g;
      this.refs.mode.textContent = fr.mode === 'manual' ? 'MAN' : 'AUT';
      this._powertrain(ph, fr);
    } else {
      this.refs.gear.textContent = typeof g === 'number' ? `D${g}` : g;
      this.refs.mode.textContent = '';
    }
    const integ = Math.round(v.damage.integrity);
    this.refs.integrity.textContent = `${integ}%`;
    this.refs.fill.style.width = `${integ}%`;
    this.refs.fill.classList.toggle('low', integ < 30);
  }

  _powertrain(ph, fr) {
    const p = ph.powertrain.profile, idle = p.engine.idleRpm, red = p.engine.redlineRpm;
    const rpm = ph.rpm, k = Math.max(0, Math.min(1, (rpm - idle * 0.6) / (red - idle * 0.6)));
    const lit = Math.round(k * RPM_SEGMENTS);
    const redFrom = Math.floor(((p.transmission.upshiftRpm - idle * 0.6) / (red - idle * 0.6)) * RPM_SEGMENTS);
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      s.className = i < lit ? (i >= redFrom ? 'on red' : i >= redFrom - 4 ? 'on amber' : 'on') : (i >= redFrom ? 'red' : '');
    }
    this.refs.rpmText.textContent = `${Math.round(rpm / 10) * 10} RPM`;
    // Luz de troca: perto do ponto ideal de subida (o mesmo usado pelo automático e pela avaliação da troca).
    const shiftNow = typeof fr.gear === 'number' && Number.isFinite(fr.upshiftRpm) && rpm >= fr.upshiftRpm - (red - idle) * 0.05;
    this.refs.shift.classList.toggle('on', shiftNow && (rpm < red - 60 || Math.floor(this._blink * 8) % 2 === 0));
    const n = Math.max(0, Math.min(1, fr.nitrousFraction ?? 0));
    this.refs.nitro.style.width = `${(n * 100).toFixed(1)}%`;
    this.refs.nitroPct.textContent = `${Math.round(n * 100)}%`;
    this.refs.nitro.parentElement.parentElement.classList.toggle('active', !!fr.nitrousActive);
    if (!this.refs.turboRow.hidden) {
      const b = Math.max(0, Math.min(1, fr.boost ?? 0));
      this.refs.turbo.style.width = `${(b * 100).toFixed(1)}%`;
      this.refs.turboPct.textContent = `${(b * p.turbo.boostFraction * 2).toFixed(1)}`;
    }
    const t = Math.max(0, Math.min(1, fr.temperature ?? 0));
    this.refs.temp.style.width = `${(t * 100).toFixed(1)}%`;
    this.refs.temp.classList.toggle('low', !!fr.overheated || t > 0.8);
    this.refs.tempPct.textContent = fr.overheated ? 'QUENTE' : t > 0.8 ? 'ALTA' : 'OK';
    this.refs.tcs.classList.toggle('on', !!ph.tcsActive);
    this.refs.abs.classList.toggle('on', !!ph.absActive);
    // Largada: acesa ao preparar; verde quando o giro está na faixa boa (soltar o freio de mão agora).
    const band = p.launch;
    this.refs.launch.classList.toggle('on', !!fr.staged);
    this.refs.launch.classList.toggle('ready', !!fr.staged && rpm >= band.minimumGoodRpm && rpm <= band.maximumGoodRpm);
  }
}
