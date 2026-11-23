const clamp = value => Math.max(0, Math.min(1, value));
const polar = (x, y, radius, angle) => { const a = angle * Math.PI / 180; return [x + Math.cos(a) * radius, y + Math.sin(a) * radius]; };
const arc = (x, y, radius, start, end) => { const a = polar(x,y,radius,start), b = polar(x,y,radius,end); return `M ${a[0]} ${a[1]} A ${radius} ${radius} 0 ${end-start > 180 ? 1 : 0} 1 ${b[0]} ${b[1]}`; };

export function vehicleGaugeReadout(vehicle) {
  const ph = vehicle.physics, frame = ph.powertrainActive ? ph.powertrainFrame : null;
  const profile = ph.powertrain?.profile;
  const redline = profile?.engine.redlineRpm || vehicle.spec.handling.redline || 8000;
  const maxRpm = Math.max(10000, Math.ceil(redline / 1000) * 1000);
  const turbo = !!profile?.turbo;
  return { speedKmh: Math.abs(ph.vLong || 0) * 3.6, rpm: Math.max(0, ph.rpm || 0), maxRpm, redline,
    gear: ph.gear === 0 || ph.gear === undefined ? 'N' : String(ph.gear), mode: frame?.mode === 'manual' ? 'MAN' : 'AUT',
    aux: clamp(turbo ? frame?.boost || 0 : Math.abs(vehicle.controls.throttle || 0)), auxLabel: turbo ? 'TURBO %' : 'ACEL. %', turbo,
    integrity: Math.round(Math.max(0, Math.min(100, vehicle.damage?.integrity ?? 100))),
    nitro: clamp(frame?.nitrousFraction || 0), nitroActive: !!frame?.nitrousActive,
    upshift: !!frame && typeof frame.gear === 'number' && Number.isFinite(frame.upshiftRpm) && ph.rpm >= frame.upshiftRpm - 250,
    staged: !!frame?.staged, launchReady: !!frame?.staged && ph.rpm >= profile.launch.minimumGoodRpm && ph.rpm <= profile.launch.maximumGoodRpm,
  };
}

const FEEDBACK = {
  perfect: ['TROCA PERFEITA','good'], early: ['TROCA CEDO','warn'], late: ['TROCA TARDE','warn'],
  launch_good: ['LARGADA PERFEITA','good'], launch_bog_risk: ['LARGADA FRACA','warn'], launch_wheelspin_risk: ['GIRO ALTO DEMAIS','warn'],
  overheat: ['MOTOR SUPERAQUECIDO','bad'], cooled: ['MOTOR NORMALIZADO','good'], nitro_empty: ['NITRO VAZIO','warn'],
  rejected_overrev: ['REDUÇÃO RECUSADA','warn'], rejected_stop: ['PARE PARA ENGATAR RÉ','warn'],
};

/** Compact, translucent dual dial. Uses the same telemetry for cars and bikes. */
export class VehicleHUD {
  constructor(root) {
    this.el = document.createElement('div'); this.el.className = 'veh-hud compact-gauge';
    this.el.innerHTML = `<div class="veh-feedback" data-ref="feedback"></div>
      <svg class="gauge-cluster" viewBox="0 0 244 208" role="img" aria-label="Velocímetro, conta-giros e marcha">
        <circle class="gauge-face" cx="151" cy="88" r="78"/>
        <circle class="gauge-ring" cx="151" cy="88" r="76"/>
        <circle class="gauge-ring gauge-inner-ring" cx="151" cy="88" r="55"/>
        <path class="gauge-redline" data-ref="redline"/>
        <g data-ref="labels"></g>
        <line class="gauge-needle" data-ref="needle" x1="151" y1="100" x2="151" y2="24"/>
        <circle class="gauge-hub" cx="151" cy="88" r="5"/>
        <text class="gauge-rpm-unit" x="143" y="117">RPM × 1000</text>
        <text class="gauge-speed-number" data-ref="speed" x="189" y="146">0</text><text class="gauge-speed-unit" x="189" y="161">KM/H</text>
        <polygon class="gauge-shift-arrow" data-ref="shift" points="185,91 190,80 195,91"/>
        <text class="gauge-gear-number" data-ref="gear" x="209" y="93">N</text><text class="gauge-mode" data-ref="mode" x="208" y="108">AUT</text>
        <circle class="gauge-face" cx="47" cy="143" r="39"/><circle class="gauge-ring" cx="47" cy="143" r="37"/>
        <g data-ref="auxTicks"></g>
        <line class="gauge-needle gauge-aux-needle" data-ref="auxNeedle" x1="47" y1="149" x2="47" y2="113"/>
        <circle class="gauge-hub" cx="47" cy="143" r="3"/>
        <text class="gauge-aux-label" data-ref="auxLabel" x="47" y="163">ACEL. %</text>
      </svg>
      <div class="gauge-caption"><span data-ref="name"></span><span data-ref="launch" class="gauge-launch" title="Largada">L</span></div>
      <div class="gauge-integrity" aria-label="Integridade do veículo"><div><i data-ref="fill"></i></div><span data-ref="integrity">100%</span></div>
      <div class="gauge-nitro"><div><i data-ref="nitro"></i></div></div>
      <span data-ref="turboRow" hidden></span>`;
    root.appendChild(this.el);
    this.refs = {}; for (const node of this.el.querySelectorAll('[data-ref]')) this.refs[node.dataset.ref] = node;
    this.refs.auxTicks.innerHTML = this._ticks(47,143,35,5,100,8);
    this.visible = false; this._timer = 0; this._feedbackT = 0; this.lastEvents = []; this.speedKmh = 0;
  }
  _ticks(x, y, radius, count, maximum, fontSize) {
    const parts = [];
    for (let i = 0; i <= count * 2; i++) {
      const angle = 135 + i / (count * 2) * 270;
      const a = polar(x,y,radius - (i % 2 ? 4 : 7),angle), b = polar(x,y,radius,angle);
      parts.push(`<line class="gauge-tick" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`);
      if (!(i % 2)) { const p = polar(x,y,radius - 17,angle); parts.push(`<text class="gauge-tick-label" style="font-size:${fontSize}px" x="${p[0]}" y="${p[1]+4}">${Math.round(i / (count * 2) * maximum)}</text>`); }
    }
    return parts.join('');
  }
  show(vehicle) {
    this.vehicle = vehicle;
    const readout = vehicleGaugeReadout(vehicle);
    this.refs.labels.innerHTML = this._ticks(151,88,71,readout.maxRpm/1000,readout.maxRpm/1000,13);
    this.refs.redline.setAttribute('d', arc(151,88,74,135 + clamp(readout.redline/readout.maxRpm)*270,405));
    this.refs.name.textContent = vehicle.spec.model.toUpperCase();
    this.el.classList.toggle('has-pt', !!vehicle.physics.powertrain);
    this.refs.turboRow.hidden = !readout.turbo;
    this.el.classList.add('visible'); this.visible = true; this.feedback = null; this._feedbackT = 0;
    this.refs.feedback.className = 'veh-feedback'; this._timer = 0; this.update(0);
  }
  hide() { this.visible = false; this.vehicle = null; this.el.classList.remove('visible'); }
  flash(key, seconds = 1.3) {
    const feedback = FEEDBACK[key]; if (!feedback) return;
    this.feedback = key; this._feedbackT = seconds; this.refs.feedback.textContent = feedback[0]; this.refs.feedback.className = `veh-feedback show ${feedback[1]}`;
  }
  powertrainEvent(event) {
    this.lastEvents.push(event); if (this.lastEvents.length > 20) this.lastEvents.shift();
    if (event.type === 'shift_quality') this.flash(event.quality, 1.1);
    else if (event.type === 'launch') this.flash(`launch_${event.quality}`, 1.8);
    else if (event.type === 'overheat') this.flash('overheat',2.4);
    else if (event.type === 'cooled') this.flash('cooled',1.4);
    else if (event.type === 'nitrous_stop' && (this.vehicle?.physics.powertrainFrame?.nitrousFraction ?? 1) <= 0.001) this.flash('nitro_empty',1.4);
    else if (event.type === 'shift_rejected') this.flash(event.reason === 'would_overrev' ? 'rejected_overrev' : 'rejected_stop',1.2);
  }
  update(dt) {
    if (!this.visible || !this.vehicle) return;
    if (this._feedbackT > 0 && (this._feedbackT -= dt) <= 0) this.refs.feedback.className = 'veh-feedback';
    this._timer -= dt; if (this._timer > 0) return; this._timer = 0.05;
    const value = vehicleGaugeReadout(this.vehicle), refs = this.refs;
    this.speedKmh = value.speedKmh;
    refs.speed.textContent = String(Math.round(value.speedKmh)); refs.gear.textContent = value.gear; refs.mode.textContent = value.mode;
    refs.needle.setAttribute('transform', `rotate(${225 + clamp(value.rpm / value.maxRpm)*270} 151 88)`);
    refs.auxNeedle.setAttribute('transform', `rotate(${225 + value.aux*270} 47 143)`);
    refs.auxLabel.textContent = value.auxLabel; refs.shift.classList.toggle('on',value.upshift);
    refs.launch.classList.toggle('on',value.staged); refs.launch.classList.toggle('ready',value.launchReady);
    refs.integrity.textContent = `${value.integrity}%`; refs.fill.style.width = `${value.integrity}%`;
    refs.nitro.style.width = `${value.nitro*100}%`; refs.nitro.parentElement.parentElement.classList.toggle('active',value.nitroActive);
    this.el.setAttribute('aria-label', `${this.vehicle.spec.model}. ${Math.round(value.speedKmh)} quilômetros por hora. ${Math.round(value.rpm)} RPM. Marcha ${value.gear}.`);
  }
}
