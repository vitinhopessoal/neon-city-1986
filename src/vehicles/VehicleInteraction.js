import * as THREE from 'three';
import { clamp, smoothstep, angleDelta } from '../utils/math.js';
import { bindingLabel } from '../core/InputManager.js';
import { BikeCrash } from './BikeCrash.js';

/**
 * Máquina de estados do jogador em relação aos veículos:
 *   ON_FOOT → ENTERING_VEHICLE → DRIVING → EXITING_VEHICLE → ON_FOOT
 * Durante as transições, comandos conflitantes (andar, pular, entrar de novo)
 * ficam bloqueados; pressionar E repetidamente não duplica animações.
 *
 * Entrada: exige proximidade real da porta (≤ 1,5 m). Sequência procedural:
 * aproximar/alinhar → abrir a porta → sentar (pela soleira) → fechar a porta
 * → ligar o motor. Pela porta do passageiro, o personagem desliza ao volante.
 * Saída: só parado ou devagar (< 7 km/h); testa o lado do motorista e, se
 * bloqueado, alternativas seguras (sem parede, sem outro carro, sem água,
 * com chão). Sem saída válida, permanece no carro e avisa discretamente.
 * Queda (CRASHED): batida forte de moto arremessa o piloto (BikeCrash); ele
 * rola, fica caído e se levanta, e então volta a ON_FOOT.
 */
export const PLAYER_STATES = {
  ON_FOOT: 'ON_FOOT',
  ENTERING_VEHICLE: 'ENTERING_VEHICLE',
  DRIVING: 'DRIVING',
  EXITING_VEHICLE: 'EXITING_VEHICLE',
  CRASHED: 'CRASHED',
};

const ENTER_RANGE = 1.5;
const EXIT_SPEED = 2.0; // m/s
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class VehicleInteraction {
  constructor(manager) {
    this.mgr = manager;
    this.game = manager.game;
    this.state = PLAYER_STATES.ON_FOOT;
    this.vehicle = null;
    this.door = null;
    this.seat = null;
    this.candidate = null;
    this.seq = null;
    this._scanTimer = 0;
    this._entries = [];
    this._from = new THREE.Vector3();
    this._fromLocal = new THREE.Vector3();
    this._exitWorld = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._sillW = new THREE.Vector3();
    this.onStateChange = null;
  }

  get onFoot() {
    return this.state === PLAYER_STATES.ON_FOOT;
  }

  get driving() {
    return this.state === PLAYER_STATES.DRIVING;
  }

  _setState(s) {
    this.state = s;
    // Breve intervalo após cada transição: toques repetidos em E não reentram/saem sem querer.
    this.cooldown = 0.6;
    this.onStateChange?.(s);
  }

  /** Porta utilizável mais próxima (somente a pé, no chão). */
  _scan() {
    const p = this.game.player;
    const c = p.controller;
    this.candidate = null;
    if (!c.grounded || this.game.state !== 'playing') return;
    let best = ENTER_RANGE;
    for (const v of this.mgr.list) {
      if (v.driver || !v.physics || v.physics.speed > 1) continue;
      const dx = v.root.position.x - c.position.x, dz = v.root.position.z - c.position.z;
      if (dx * dx + dz * dz > 64) continue;
      v.root.updateMatrixWorld();
      for (const e of v.getEntryPoints(this._entries)) {
        if (v.npcSeats?.has(e.seat)) continue;
        const d = Math.hypot(e.position.x - c.position.x, e.position.z - c.position.z);
        const dy = Math.abs(e.position.y - c.position.y);
        if (d < best && dy < 1.2) { best = d; this.candidate = { vehicle: v, doorId: e.id, dist: d }; }
      }
    }
  }

  update(dt, input) {
    const S = PLAYER_STATES;
    this._dt = dt;
    if (this.cooldown > 0) this.cooldown -= dt;
    const pressed = input.wasPressed('interact') && this.game.state === 'playing' && !this.game.mapLoading && !(this.cooldown > 0);
    if (this.state === S.ON_FOOT) {
      this._scanTimer -= dt;
      if (this._scanTimer <= 0) { this._scanTimer = 0.1; this._scan(); }
      // Interiores (portas de prédios, balcões) têm prioridade quando mais próximos: suppressed é
      // definido a cada quadro pelo InteriorManager; a varredura continua para a comparação de distância.
      if (!this.suppressed) {
        this.game.hud.setPrompt(this.candidate ? `PRESSIONE <kbd>${bindingLabel('interact')}</kbd> PARA ${this.candidate.vehicle.bike ? 'MONTAR' : 'ENTRAR'}` : null);
        if (pressed && this.candidate) this.beginEnter(this.candidate.vehicle, this.candidate.doorId);
      }
    } else if (this.state === S.ENTERING_VEHICLE) {
      this._advanceEnter(dt);
    } else if (this.state === S.DRIVING) {
      // suppressed: outro sistema usa o E neste quadro (ex.: vaga da NEON CUSTOMS).
      if (!this.suppressed) this.game.hud.setPrompt(null);
      if (pressed && !this.suppressed) this.tryExit();
      else this._seatPlayer(dt);
    } else if (this.state === S.EXITING_VEHICLE) {
      this._advanceExit(dt);
    } else if (this.state === S.CRASHED) {
      this._advanceCrash(dt);
    }
  }

  // ------------------------------------------------------------- entrada

  beginEnter(vehicle, doorId) {
    if (this.state !== PLAYER_STATES.ON_FOOT || vehicle.driver) return false;
    const door = vehicle.door(doorId);
    if (!door) return false;
    if (vehicle.npcSeats?.has(door.seat)) return false;
    const player = this.game.player;
    this.vehicle = vehicle;
    this.door = door;
    vehicle.driver = 'player';
    vehicle.physics.wake();
    this.mgr.onEnterStart(vehicle);
    const driverSeat = vehicle.seats.find((s) => s.driver);
    const viaSeat = vehicle.seat(door.seat) || driverSeat;
    this.seat = driverSeat;
    // Moto (PROMPT 15): pose de pilotagem pelos pontos de apoio do modelo (pedaleiras, manoplas).
    const anim = this.game.player.animator;
    anim.seatRide = vehicle.bike && driverSeat.ride ? driverSeat.ride : null;
    anim.rideSwing = 0;
    anim.rideState.footDown = vehicle.bike ? 1 : 0;
    // Moto caída de uma batida: volta a ficar em pé ao ser montada.
    vehicle.fallen = 0;
    // Centro do volante em relação ao quadril do motorista (IK dos braços).
    const wheel = vehicle.spec?.wheel;
    this.game.player.animator.seatGrip = wheel ? { y: wheel.y - driverSeat.hipY, z: wheel.z - driverSeat.z } : null;
    // Pés apoiados no assoalho (antes atravessavam o fundo dos carros baixos).
    const floorY = vehicle.spec?.floorY;
    this.game.player.animator.seatFloor = floorY !== undefined ? floorY + 0.09 - driverSeat.hipY : null;
    const roof = vehicle.spec?.roof;
    // headroomY (opcional): altura do forro interno nos modelos GLB de teto espesso; sem ele vale o teto.
    this.game.player.animator.seatHeadroom = roof ? (vehicle.spec.headroomY ?? roof.y) - driverSeat.hipY : null;
    vehicle.root.updateMatrixWorld();
    const entryW = vehicle.localToWorld(door.entry, new THREE.Vector3());
    entryW.y = player.controller.position.y;
    this._from.copy(player.controller.position);
    const dist = Math.hypot(entryW.x - this._from.x, entryW.z - this._from.z);
    const approach = 0.15 + dist / 2.6;
    // Moto: sem porta para abrir; segura o guidão e passa a perna por cima do banco.
    const bike = !!vehicle.bike;
    const open = approach + (bike ? 0.15 : 0.42);
    this.seq = {
      t: 0,
      entryW,
      viaSeat,
      approach,
      open,
      sit: open + (bike ? 0.8 : 0.72),
      slide: viaSeat !== driverSeat ? 0.45 : 0,
      yaw0: player.controller.yaw,
      bike,
    };
    this.seq.close = this.seq.sit + this.seq.slide + (bike ? 0.25 : 0.4);
    player.setExternalPose(this._from, player.controller.yaw, 0, 0);
    this.game.hud.setPrompt(null);
    this._setState(PLAYER_STATES.ENTERING_VEHICLE);
    return true;
  }

  /** Curva de Bézier quadrática (a → controle → b) no parâmetro t. */
  _bezier(a, c, b, t, out) {
    const u = 1 - t;
    out.set(
      u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      u * u * a.y + 2 * u * t * c.y + t * t * b.y,
      u * u * a.z + 2 * u * t * c.z + t * t * b.z,
    );
    return out;
  }

  /** Posição/rumo de um assento no mundo (raiz do personagem). */
  _seatWorld(seat, out) {
    _v.set(seat.x, seat.hipY - 0.95, seat.z);
    // updateWorldMatrix(true, …) recalcula também a raiz: a matriz da raiz
    // só é atualizada no render, e usá-la aqui atrasava o motorista um quadro.
    this.vehicle.body.updateWorldMatrix(true, false);
    return out.copy(_v).applyMatrix4(this.vehicle.body.matrixWorld);
  }

  _advanceEnter(dt) {
    const q = this.seq, v = this.vehicle, player = this.game.player;
    q.t += dt;
    const t = q.t;
    const heading = v.root.rotation.y;
    // Rumo voltado para o carro (da porta para a soleira).
    const faceCar = heading + (this.door.side > 0 ? -Math.PI / 2 : Math.PI / 2);
    if (t < q.approach) {
      const k = smoothstep(0, 1, t / q.approach);
      this._pos.lerpVectors(this._from, q.entryW, k);
      const yaw = q.yaw0 + angleDelta(q.yaw0, faceCar) * k;
      player.setExternalPose(this._pos, yaw, q.entryW.distanceTo(this._from) / q.approach, 0);
    } else if (t < q.open) {
      this.door.target = 1;
      player.setExternalPose(q.entryW, faceCar, 0, 0);
    } else if (t < q.sit) {
      // Do ponto de entrada até o assento (passando pela soleira), sentando.
      const k = (t - q.open) / (q.sit - q.open);
      const seatW = this._seatWorld(q.viaSeat, _w);
      // Curva pela soleira da porta (não atravessa a coluna nem a porta aberta).
      this._bezier(q.entryW, this.vehicle.localToWorld(this.door.sill, this._sillW), seatW, smoothstep(0, 1, k), this._pos);
      this._pos.y += Math.sin(k * Math.PI) * (q.bike ? 0.16 : 0.1);
      const yaw = faceCar + angleDelta(faceCar, heading) * smoothstep(0.25, 0.9, k);
      if (q.bike) player.animator.rideSwing = Math.sin(clamp((k - 0.15) / 0.7, 0, 1) * Math.PI);
      player.setExternalPose(this._pos, yaw, 0, smoothstep(0.15, 0.85, k), q.viaSeat.recline, 0, q.bike ? 0 : Math.sin(Math.min(1, k * 1.4) * Math.PI));
    } else if (t < q.sit + q.slide) {
      // Entrou pelo lado do passageiro: desliza para o volante.
      const k = smoothstep(0, 1, (t - q.sit) / q.slide);
      const a = this._seatWorld(q.viaSeat, _w);
      const b = this._seatWorld(this.seat, this._exitWorld);
      this._pos.lerpVectors(a, b, k);
      player.setExternalPose(this._pos, heading, 0, 1, this.seat.recline);
    } else {
      this.door.target = 0;
      player.animator.rideSwing = 0;
      this._seatPlayer(dt);
      if (!q.engineStarted && t >= q.sit + q.slide + 0.05) {
        q.engineStarted = true;
        this.mgr.startEngine(v);
      }
      if (t >= q.close) {
        this.seq = null;
        this._setState(PLAYER_STATES.DRIVING);
      }
    }
    this.mgr.setCameraBlend(clamp((t - q.approach * 0.5) / (q.close - q.approach * 0.5), 0, 1));
  }

  /** Chamado depois da física: alinha o personagem à pose final do carro. */
  postPhysics() {
    if (this.state !== PLAYER_STATES.DRIVING || !this.vehicle) return;
    this._seatPlayer();
    this.game.player.applyExternalPosition();
  }

  /** Mantém o personagem no banco do motorista (segue a carroceria). */
  _seatPlayer() {
    const v = this.vehicle;
    if (!v) return;
    const pos = this._seatWorld(this.seat, this._pos);
    if (v.bike) {
      const ph = v.physics, rs = this.game.player.animator.rideState;
      const speed = ph ? Math.abs(ph.vLong) : 0;
      rs.steer = v.animation?.steerVis ?? 0;
      rs.lean = v.root.rotation.z;
      rs.speed = speed;
      // Pé esquerdo no chão quando parada (e ao montar/desmontar); recolhe ao arrancar.
      const want = speed < 0.9 && !(v.controls.throttle > 0.1) ? 1 : 0;
      rs.footDown += (want - rs.footDown) * Math.min(1, (this._dt || 0.016) * 8);
      // Bancos altos: parado, o piloto desliza o quadril para o lado do pé de apoio (e desce um pouco).
      const ride = this.seat.ride;
      rs.hipDrop = ride ? Math.min(0.08, Math.max(0, ride.hipY - 0.84)) * rs.footDown : 0;
      if (rs.hipDrop > 0) {
        _w.set(this.seat.x + rs.hipDrop * 0.8, this.seat.hipY - 0.95 - rs.hipDrop, this.seat.z);
        v.body.updateWorldMatrix(true, false);
        pos.copy(_w).applyMatrix4(v.body.matrixWorld);
      }
      this.game.player.setExternalPose(pos, v.root.rotation.y, 0, 1, this.seat.recline, v.controls.steer, 0, v.root.rotation.z, v.root.rotation.x + v.body.rotation.x);
      return;
    }
    this.game.player.setExternalPose(pos, v.root.rotation.y, 0, 1, this.seat.recline, v.controls.steer);
  }

  // --------------------------------------------------------------- saída

  /** Testa se um ponto de saída é seguro para o personagem. */
  _exitFree(x, z, refY) {
    const env = this.mgr.env;
    const col = env.collision;
    const g = col.getGroundHeight(x, z, refY + 0.4, 0.45);
    // Veículo dentro d'água: o personagem sai nadando (o nado assume a altura).
    if (this.vehicle?.physics?.inWater && env.waterDepth && env.waterDepth(x, z, g) > 0.45) return g;
    if (Math.abs(g - refY) > 0.7) return null;
    if (env.waterDepth && env.waterDepth(x, z, g) > 0.45) return null;
    if (env.boundaryHint && env.boundaryHint(x, z, 0.4) === 'closed') return null;
    if (col.isVolumeFree) return col.isVolumeFree(x, g, z, 0.42, 1.85) ? g : null;
    const list = col.queryCircle(x, z, 0.42, this._tmpList || (this._tmpList = []));
    for (const c of list) {
      if (!c.solid || c.type === 'ramp') continue;
      if (c.maxY > g + 0.36 && c.minY < g + 1.85) return null;
    }
    return g;
  }

  _findExit() {
    const v = this.vehicle;
    const hw = v.spec.width / 2;
    const rank = (d) => (d.seat === 'driver' ? 0 : d.seat === 'passenger' ? 1 : 2);
    const order = [...v.doors].sort((a, b) => rank(a) - rank(b));
    v.root.updateMatrixWorld();
    const refY = v.root.position.y;
    for (const extra of [0, 0.45]) {
      for (const d of order) {
        _v.copy(d.entry);
        _v.x = d.side * (hw + 0.62 + extra);
        const p = v.localToWorld(_v, new THREE.Vector3());
        const g = this._exitFree(p.x, p.z, refY);
        if (g !== null) { p.y = g; return { door: d, point: p, local: _v.clone() }; }
      }
    }
    return null;
  }

  tryExit() {
    const v = this.vehicle;
    if (!v || this.state !== PLAYER_STATES.DRIVING) return false;
    if (v.physics.speed > EXIT_SPEED) {
      this.game.hud.toast(v.bike ? 'Reduza a velocidade para descer da moto' : 'Reduza a velocidade para sair do carro', 1.8);
      return false;
    }
    const exit = this._findExit();
    if (!exit) {
      this.game.hud.toast(v.bike ? 'Sem espaço para descer — afaste a moto do obstáculo' : 'Saída bloqueada — afaste o carro do obstáculo', 2.2);
      return false;
    }
    this.door = exit.door;
    this.mgr.stopEngine(v);
    // A câmera a pé assume a direção da câmera do carro (sem salto ao final da transição).
    this.game.cameras.yaw = v.root.rotation.y + Math.PI;
    const viaSeat = v.seat(exit.door.seat) || this.seat;
    this.seq = {
      t: 0,
      exit,
      viaSeat,
      slide: viaSeat !== this.seat ? 0.45 : 0,
      open: v.bike ? 0.15 : 0.38,
      bike: !!v.bike,
    };
    this.seq.out = this.seq.open + this.seq.slide + 0.65;
    this.seq.close = this.seq.out + 0.35;
    this._setState(PLAYER_STATES.EXITING_VEHICLE);
    return true;
  }

  _advanceExit(dt) {
    const q = this.seq, v = this.vehicle, player = this.game.player;
    q.t += dt;
    const t = q.t;
    const heading = v.root.rotation.y;
    const faceOut = heading + (q.exit.door.side > 0 ? Math.PI / 2 : -Math.PI / 2);
    if (t < q.open) {
      q.exit.door.target = 1;
      this._seatPlayer(dt);
    } else if (t < q.open + q.slide) {
      const k = smoothstep(0, 1, (t - q.open) / q.slide);
      const a = this._seatWorld(this.seat, _w);
      const b = this._seatWorld(q.viaSeat, this._exitWorld);
      this._pos.lerpVectors(a, b, k);
      player.setExternalPose(this._pos, heading, 0, 1, this.seat.recline);
    } else if (t < q.out) {
      const k = (t - q.open - q.slide) / (q.out - q.open - q.slide);
      const seatW = this._seatWorld(q.viaSeat, _w);
      this._bezier(seatW, this.vehicle.localToWorld(q.exit.door.sill, this._sillW), q.exit.point, smoothstep(0, 1, k), this._pos);
      this._pos.y += Math.sin(k * Math.PI) * (q.bike ? 0.16 : 0.1);
      const yaw = heading + angleDelta(heading, faceOut) * smoothstep(0.1, 0.7, k);
      if (q.bike) player.animator.rideSwing = Math.sin(clamp(k / 0.7, 0, 1) * Math.PI);
      player.setExternalPose(this._pos, yaw, 0, 1 - smoothstep(0.2, 0.9, k), q.viaSeat.recline, 0, q.bike ? 0 : Math.sin(Math.max(0, k * 1.4 - 0.4) * Math.PI));
    } else {
      if (!q.released) {
        // Controle a pé restaurado assim que o personagem está no chão.
        q.released = true;
        player.releaseExternalPose(q.exit.point, faceOut);
        player.animator.seatRide = null;
        player.animator.rideSwing = 0;
        this.mgr.setCameraBlend(0);
        this.mgr.onExitDone(v);
        this._setState(PLAYER_STATES.ON_FOOT);
        q.exit.door.target = 0;
        this.vehicle = null;
        this.seq = null;
        this.door = null;
      }
    }
    if (this.seq) this.mgr.setCameraBlend(1 - clamp((t - q.open) / (q.out - q.open), 0, 1));
  }

  // --------------------------------------------------------- queda

  /**
   * Batida forte de moto: o piloto é arremessado. velocity: velocidade da moto
   * antes da batida; normal: direção da batida (do obstáculo para a moto) ou null.
   */
  crash(velocity, normal = null) {
    const v = this.vehicle;
    if (!v?.bike || this.state !== PLAYER_STATES.DRIVING) return false;
    const player = this.game.player;
    const root = this._seatWorld(this.seat, this._pos);
    const hipHeight = player.animator.hipsBaseY || 0.95;
    const hip = root.clone();
    hip.y += hipHeight;
    // A moto continua sozinha: motor desligado, cai de lado e desliza até parar.
    this.mgr.stopEngine(v);
    this.mgr.onExitDone(v);
    v.controls.brake = 0.4;
    v.fallen = (v.root.rotation.z || 0) >= 0 ? 1 : -1;
    this.mgr.setCameraBlend(0);
    this.game.cameras.yaw = Math.atan2(velocity.x, velocity.z) + Math.PI;
    const anim = player.animator;
    anim.seatRide = null;
    anim.rideSwing = 0;
    anim.seatGrip = null;
    this.vehicle = null;
    this.seq = null;
    this.door = null;
    this.crashState = new BikeCrash(this.mgr.env.collision, { hip, velocity, normal, yaw: v.root.rotation.y, hipHeight, ignore: v.collider });
    this._setState(PLAYER_STATES.CRASHED);
    this._crashPose();
    return true;
  }

  _crashPose() {
    const c = this.crashState, player = this.game.player;
    // Levantar de bruços com o clipe "Getting Up" (ele começa deitado de bruços, cabeça à frente).
    const clips = player.clips;
    if (c.phase === 'getup' && c.lieFrom > 0 && clips.ready && clips.has('getup')) {
      if (player.clipMode !== 'getup') { player.clipMode = 'getup'; clips.snap(); }
      player.animator.crash = null;
      player.setExternalPose(c.standPoint(this._pos), c.yaw, 0, 0);
      return;
    }
    player.animator.crash = c.weights;
    // Corpo inteiro girado em torno do quadril (pitch = rolar para a frente).
    player.setExternalPose(c.rootPosition(this._pos), c.yaw, 0, 0, 0, 0, 0, c.roll, c.pitch);
  }

  _advanceCrash(dt) {
    const c = this.crashState;
    if (!c) { this._setState(PLAYER_STATES.ON_FOOT); return; }
    const done = c.update(dt);
    this._crashPose();
    if (done) this._endCrash();
  }

  /** Fim da queda (ou interrupção por troca de mapa/carregamento): controle a pé de volta. */
  _endCrash(point = null) {
    const c = this.crashState;
    const player = this.game.player;
    player.animator.crash = null;
    player.clipMode = null;
    if (c) player.releaseExternalPose(point || c.standPoint(), c.yaw);
    this.crashState = null;
    this._setState(PLAYER_STATES.ON_FOOT);
  }

  /** Troca de mapa / recuperação de emergência: sai sem animação. */
  forceExit(point = null) {
    if (this.state === PLAYER_STATES.CRASHED) { this._endCrash(point); return; }
    const v = this.vehicle;
    if (!v) return;
    const player = this.game.player;
    this.mgr.stopEngine(v);
    for (const d of v.doors) d.target = 0;
    const p = point || this._findExit()?.point || v.root.position.clone().add(new THREE.Vector3(2.5, 0, 0));
    player.releaseExternalPose(p, v.root.rotation.y);
    player.animator.seatRide = null;
    player.animator.rideSwing = 0;
    this.mgr.onExitDone(v);
    this.mgr.setCameraBlend(0);
    this.vehicle = null;
    this.seq = null;
    this.door = null;
    this._setState(PLAYER_STATES.ON_FOOT);
  }
}

