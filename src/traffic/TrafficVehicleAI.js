import * as THREE from 'three';
import { CitizenBrain } from '../city/CitizenBrain.js';

/**
 * Motorista de IA. Produz os MESMOS comandos abstratos do jogador
 * (throttle, brake, steer, handbrake) para a VehiclePhysics existente quando
 * o carro está perto; longe, anda sobre a faixa em modo cinemático (mesmo
 * controle de velocidade, sem física), sem saltos na troca de nível.
 *
 * Velocidade: Intelligent Driver Model (IDM) contra todos os "obstáculos"
 * à frente na rota (carros, jogador, pedestres na faixa, linhas de parada).
 * Direção: perseguição pura (pure pursuit) num ponto à frente da rota.
 */
export const PERSONALITIES = {
  cautious: { label: 'cauteloso', speed: 0.88, T: 1.8, s0: 3.2, a: 1.4, b: 2.2, yellowRun: 0.0, redRun: 0, honk: 0.15, wander: 0, weight: 0.25 },
  normal: { label: 'comum', speed: 1.0, T: 1.4, s0: 2.6, a: 1.9, b: 2.6, yellowRun: 0.25, redRun: 0, honk: 0.35, wander: 0.05, weight: 0.45 },
  hurried: { label: 'apressado', speed: 1.12, T: 1.05, s0: 2.1, a: 2.6, b: 3.2, yellowRun: 0.7, redRun: 0, honk: 0.8, wander: 0.05, weight: 0.2 },
  careless: { label: 'descuidado', speed: 1.06, T: 0.95, s0: 1.9, a: 2.3, b: 3.0, yellowRun: 0.85, redRun: 0.12, honk: 0.5, wander: 0.3, weight: 0.1 },
};

export const STATES = {
  CRUISING: 'CRUISING', FOLLOWING: 'FOLLOWING', BRAKING: 'BRAKING', STOPPED: 'STOPPED',
  WAITING_SIGNAL: 'WAITING_SIGNAL', TURNING: 'TURNING', YIELDING: 'YIELDING', AVOIDING: 'AVOIDING',
  PARKING: 'PARKING', PARKED: 'PARKED', PULLING_OUT: 'PULLING_OUT', RECOVERING: 'RECOVERING',
};

const SAMPLE = 2; // espaçamento dos pontos da rota à frente (m)
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

export class TrafficVehicleAI {
  constructor(manager, vehicle, personalityKey) {
    this.m = manager;
    this.v = vehicle;
    this.pk = personalityKey;
    this.P = { ...PERSONALITIES[personalityKey] };
    this.brain = new CitizenBrain({ id: vehicle.id, style: personalityKey === 'hurried' ? 'suit' : 'casual', profile: personalityKey === 'cautious' ? 'STAT_SENSIBLE_GUY' : personalityKey === 'hurried' ? 'STAT_TAXIDRIVER' : personalityKey === 'careless' ? 'STAT_CRIMINAL' : 'STAT_STREET_GUY' });
    this.P.T *= 0.8 + this.brain.profile.lawfulness / 250;
    this.P.yellowRun *= 1 - this.brain.profile.lawfulness / 170;
    this.P.honk = Math.min(1, this.P.honk * 0.5 + this.brain.profile.temper / 160);
    this.destination = null;
    this.plannedRoute = [];
    this.el = null;          // elemento atual (segmento, conector ou trajeto de vaga)
    this.s = 0;              // distância ao longo do elemento
    this.next = null;        // próximo elemento escolhido
    this.speed = 0;          // velocidade (m/s), cinemática ou lida da física
    this.mode = 'kin';       // 'kin' | 'phys'
    this.state = STATES.CRUISING;
    this.reason = '';
    this.stopWait = 0;
    this.clearedNode = null;
    this.hornCd = 2 + Math.random() * 4;
    this.blockedT = 0;
    this.stuckT = 0;
    this.panicT = 0;
    this.reverseT = 0;
    this.recoverCount = 0;
    this.wanderPhase = Math.random() * 10;
    this.parkSpot = null;
    this.parkT = 0;
    this.decideT = Math.random() * 0.1;
    this.acc = 0;
    this.ahead = [];
    for (let i = 0; i < 30; i++) this.ahead.push(new THREE.Vector3());
    this.aheadN = 0;
    this.halfLen = vehicle.spec.length / 2;
    this.halfWid = vehicle.spec.width / 2;
    this.lastLateral = 0;
  }

  // ----------------------------------------------------------- rota
  place(el, s, speed) {
    this.el = el;
    this.s = s;
    this.next = null;
    this.speed = speed;
    this.clearedNode = null;
    this.stopWait = 0;
  }

  isConnector(el = this.el) {
    return !!el && el.turn !== undefined;
  }

  /** Escolhe o conector seguinte de um segmento (pesos por tipo de curva). */
  _chooseNext(seg) {
    if (seg.next) return seg.next; // trajeto especial (vaga)
    const planned = this.plannedRoute.find(connector => connector.from === seg);
    if (planned) return planned;
    const opts = seg.out;
    if (!opts || !opts.length) return null;
    const W = { straight: 1.0, right: 0.55, left: 0.45, u: 0.15 };
    let total = 0;
    for (const c of opts) total += W[c.turn] ?? 0.3;
    let r = Math.random() * total;
    for (const c of opts) { r -= W[c.turn] ?? 0.3; if (r <= 0) return c; }
    return opts[opts.length - 1];
  }

  /** Elemento depois de `el` (escolhe o conector se preciso). */
  _after(el) {
    if (el === this.el) {
      if (this.isConnector(el)) return el.to;
      if (el.kind === 'park') return el.to || null;
      if (!this.next) this.next = this._chooseNext(el);
      return this.next;
    }
    if (this.isConnector(el)) return el.to;
    if (el.kind === 'park') return el.to || null;
    return null; // além de dois elementos não planejamos
  }

  /**
   * Avança `ds` metros pela rota. Retorna 'ok', 'sink' (chegou ao fim de uma
   * rua que sai do mapa) ou 'end' (sem continuação: estacionar/parar).
   */
  advance(ds) {
    this.s += ds;
    let guard = 0;
    while (this.el && this.s >= this.el.path.length && guard++ < 4) {
      const over = this.s - this.el.path.length;
      const prev = this.el;
      const nxt = this._after(prev);
      if (!nxt) {
        if (prev.sink) return 'sink';
        this.s = prev.path.length;
        return 'end';
      }
      this.m._onLeave(this, prev);
      this.el = nxt;
      this.s = over + (prev.kind === 'park' && prev.joinS !== undefined ? prev.joinS : 0);
      this.next = null;
      if (this.isConnector(nxt)) this.m._onEnterNode(this, nxt);
      else this.clearedNode = null;
    }
    return 'ok';
  }

  /** Ponto (e direção) a `d` metros à frente da posição atual na rota. */
  pointAhead(d, outP, outDir) {
    let el = this.el, s = this.s + d;
    for (let k = 0; k < 3 && el && s > el.path.length; k++) {
      const n = this._after(el);
      if (!n) { s = el.path.length; break; }
      s -= el.path.length;
      el = n;
    }
    return el.path.sample(s, outP, outDir);
  }

  /** Amostra a rota à frente (para detectar obstáculos sobre ela). */
  _sampleAhead(dist) {
    const n = Math.min(this.ahead.length, Math.ceil(dist / SAMPLE) + 1);
    for (let i = 0; i < n; i++) this.pointAhead(i * SAMPLE, this.ahead[i]);
    this.aheadN = n;
  }

  // ----------------------------------------------------- velocidade (IDM)
  _idm(v, v0, gap, dv) {
    const P = this.P;
    const sStar = P.s0 + Math.max(0, v * P.T + (v * dv) / (2 * Math.sqrt(P.a * P.b)));
    const free = 1 - Math.pow(Math.max(0, v) / Math.max(0.5, v0), 4);
    return P.a * (free - (gap > 0.1 ? (sStar / gap) ** 2 : 25));
  }

  /** Decide aceleração e estado (chamado a ~10–20 Hz). */
  decide(dt, obstacles) {
    const m = this.m, P = this.P;
    const v = this.speed;
    const el = this.el;
    const panic = this.panicT > 0 ? 1.18 : 1;
    let v0 = el.speedLimit * P.speed * panic;
    let acc = Infinity;
    let reason = 'livre';
    let state = STATES.CRUISING;

    // Curvas à frente: reduz antes de entrar no conector.
    const remain = el.path.length - this.s;
    const nxt = this.isConnector(el) ? el.to : (this.next || (remain < 45 ? (this.next = this._chooseNext(el)) : null));
    if (nxt && !this.isConnector(el) && nxt.speedLimit < v0) {
      const vc = nxt.speedLimit * P.speed;
      const allowed = Math.sqrt(vc * vc + 2 * P.b * 0.8 * Math.max(0, remain - 2));
      if (allowed < v0) { v0 = allowed; if (remain < 25) state = STATES.TURNING; }
    }
    if (this.isConnector(el) && el.turn !== 'straight') state = STATES.TURNING;
    // Fim de trajeto sem continuação (vaga ou rua sem saída): para no fim.
    if (!this.isConnector(el) && !nxt && !el.sink && !el.to && (el.kind === 'park' || !el.out?.length)) {
      acc = Math.min(acc, this._idm(v, v0, Math.max(0.05, remain - 0.6 + P.s0 - 0.4), v));
      if (el.kind === 'park') state = STATES.PARKING;
    }
    if (el.kind === 'park' && el.to) state = STATES.PULLING_OUT;

    // Linha de parada do cruzamento (semáforo, PARE, conversão à esquerda).
    if (!this.isConnector(el) && el.to && el.kind !== 'park') {
      const stopGap = remain - 1.2;
      const ctl = m.graph.controlAt(el);
      let mustStop = false;
      if (ctl === 'red') {
        mustStop = !(this._runRed && stopGap < 6);
        if (mustStop) { reason = 'sinal vermelho'; state = STATES.WAITING_SIGNAL; }
      } else if (ctl === 'yellow') {
        const canStop = stopGap > (v * v) / (2 * P.b) + 1;
        if (canStop && Math.random() > P.yellowRun * 0.02) { mustStop = true; reason = 'sinal amarelo'; state = STATES.WAITING_SIGNAL; }
        // O descuidado às vezes passa no vermelho que acabou de abrir.
        this._runRed = !canStop || Math.random() < P.redRun;
      } else if (ctl === 'stop') {
        if (this.clearedNode !== el.to) {
          mustStop = true;
          reason = 'placa PARE';
          state = STATES.STOPPED;
          if (stopGap < 3.2 && v < 0.4) {
            this.stopWait += dt;
            if (this.stopWait > 0.8 && m.canEnter(el.to, this, nxt)) { this.clearedNode = el.to; mustStop = false; this.stopWait = 0; }
          }
        }
      } else {
        this._runRed = false;
      }
      // Conversão à esquerda no sinal verde: cede ao fluxo oposto.
      if (!mustStop && nxt && nxt.turn === 'left' && ctl === 'green' && m.oncoming(el, this)) {
        mustStop = stopGap > -0.5;
        if (mustStop) { reason = 'cedendo passagem'; state = STATES.YIELDING; }
      }
      // Linha virtual: soma s0 para o carro parar NA linha (não s0 metros antes).
      if (mustStop && stopGap < 60) acc = Math.min(acc, this._idm(v, v0, Math.max(0.05, stopGap + P.s0 - 0.4), v));
    }

    // Faixas de pedestres ocupadas à frente (segmento atual e o próximo).
    const cwStop = m.crosswalkStop(this);
    if (cwStop !== null) {
      acc = Math.min(acc, this._idm(v, v0, Math.max(0.05, cwStop + P.s0 - 0.4), v));
      if (cwStop < 20) { reason = 'pedestre atravessando'; state = STATES.YIELDING; }
    }

    // Obstáculos sobre a rota (carros, jogador, pedestres).
    const look = Math.min(56, 10 + v * 3.2);
    this._sampleAhead(look);
    let lead = null;
    for (const o of obstacles) {
      if (o.v === this.v) continue;
      const dx = o.x - this.ahead[0].x, dz = o.z - this.ahead[0].z;
      if (dx * dx + dz * dz > (look + 6) ** 2) continue;
      let best = 1e9, bi = -1;
      for (let i = 1; i < this.aheadN; i++) {
        const a = this.ahead[i];
        const dd = (a.x - o.x) ** 2 + (a.z - o.z) ** 2;
        if (dd < best) { best = dd; bi = i; }
      }
      const lateral = Math.sqrt(best);
      if (bi < 1 || lateral > this.halfWid + o.halfWid + 0.35) continue;
      const gap = bi * SAMPLE - this.halfLen - o.halfLen;
      if (gap > look) continue;
      const a = this._idm(v, v0, Math.max(0.05, gap), v - o.speed);
      if (a < acc) { acc = a; lead = o; }
    }
    if (lead) {
      if (lead.kind === 'player' || lead.kind === 'ped') { reason = lead.kind === 'player' ? 'jogador na pista' : 'pedestre na pista'; state = STATES.AVOIDING; }
      else if (state === STATES.CRUISING) { reason = 'seguindo veículo'; state = STATES.FOLLOWING; }
      this.leadKind = lead.kind;
      this.leadId = lead.v?.id || lead.kind;
    } else {
      this.leadKind = null;
      this.leadId = null;
    }
    if (acc === Infinity) acc = this._idm(v, v0, 1e6, 0);
    acc = Math.max(-P.b * 2.6, Math.min(P.a, acc));
    if (acc < -P.b * 0.8 && state === STATES.CRUISING) state = STATES.BRAKING;
    if (v < 0.2 && acc <= 0.05 && state !== STATES.WAITING_SIGNAL && state !== STATES.YIELDING) state = state === STATES.CRUISING ? STATES.STOPPED : state;
    this.acc = acc;
    this.v0 = v0;
    this.reason = reason;
    if (this.state !== STATES.RECOVERING || this.reverseT <= 0) this.state = state;
    // Bloqueado sem motivo legítimo (para a detecção de congestionamento).
    const legit = state === STATES.WAITING_SIGNAL || state === STATES.YIELDING || reason === 'placa PARE';
    this.blockedLegit = legit;
    return acc;
  }

  // ------------------------------------------------------ física (perto)
  applyControls(dt) {
    const c = this.v.controls, ph = this.v.physics;
    const vLong = ph.vLong;
    this.speed = Math.max(0, vLong);
    if (this.reverseT > 0) {
      // Recuperação: ré curta para sair de um bloqueio.
      this.reverseT -= dt;
      c.throttle = -0.45; c.brake = 0; c.handbrake = false;
      c.steer = 0;
      return;
    }
    const target = Math.max(0, this.speed + this.acc * 0.7);
    const err = target - vLong;
    if (target < 0.15 && vLong < 0.6) { c.throttle = 0; c.brake = 1; }
    else if (err > 0) { c.throttle = Math.min(1, err * 0.55 + 0.08); c.brake = 0; }
    else { c.throttle = 0; c.brake = Math.min(1, -err * 0.45); }
    c.handbrake = false;
    // Direção: perseguição pura.
    const H = ph.H;
    const Ld = Math.max(4.5, Math.min(13, 4 + vLong * 0.55));
    this.pointAhead(Ld + this.halfLen * 0.4, _p);
    const sin = Math.sin(ph.heading), cos = Math.cos(ph.heading);
    const dx = _p.x - ph.x, dz = _p.z - ph.z;
    const fwd = dx * sin + dz * cos;
    let left = dx * cos - dz * sin;
    if (this.emergencyYield && !this.isConnector(this.el)) left -= 1.0;
    if (this.P.wander) left += Math.sin(this.wanderPhase += dt * 0.7) * this.P.wander * 0.25;
    const alpha = Math.atan2(left, Math.max(0.1, fwd));
    const delta = Math.atan2(2 * ph.L * Math.sin(alpha), Ld);
    const absV = Math.abs(vLong);
    c.steer = Math.max(-1, Math.min(1, (-delta * (1 + absV * H.steerSpeedFalloff)) / H.steerMax));
  }

  /** Depois da física: atualiza a posição ao longo da rota. */
  syncFromPhysics() {
    const ph = this.v.physics;
    _p.set(ph.x, 0, ph.z);
    const pr = this.el.path.project(_p);
    this.lastLateral = pr.dist;
    if (pr.s > this.s - 0.5 || pr.dist < 3) {
      const ds = pr.s - this.s;
      if (ds > 0) return this.advance(ds);
      this.s = pr.s;
    }
    return 'ok';
  }

  // --------------------------------------------------- cinemático (longe)
  kinStep(dt) {
    this.speed = Math.max(0, this.speed + this.acc * dt);
    const ds = this.speed * dt;
    const r = this.advance(ds);
    if (r !== 'ok' && r !== 'end') return r;
    if (r === 'end') this.speed = 0;
    this.pointAhead(0, _p);
    this.pointAhead(2.5, _d);
    const heading = Math.atan2(_d.x - _p.x, _d.z - _p.z);
    const y = this.m.groundY(_p.x, _p.z);
    const v = this.v;
    const prevH = v.root.rotation.y;
    v.root.position.set(_p.x, y, _p.z);
    v.root.rotation.set(0, heading, 0);
    v.heading = heading;
    v.syncCollider(_p.x, y, _p.z, heading);
    v.spinWheels(ds);
    const dh = Math.atan2(Math.sin(heading - prevH), Math.cos(heading - prevH));
    v.setSteer(Math.max(-0.5, Math.min(0.5, (dh / Math.max(1e-3, dt)) * 0.25)));
    return r;
  }
}
