import * as THREE from 'three';

/**
 * Entidade de veículo (estado compartilhado entre os subsistemas).
 *  - root / body : transformação no mundo e pivô da carroceria (suspensão)
 *  - wheels      : pivôs individuais (suspensão, esterçamento, giro)
 *  - doors       : pivôs das portas, pontos de entrada e soleira
 *  - seats       : posições de motorista e passageiros (NPCs futuros)
 *  - controls    : comandos ABSTRATOS (acelerador, freio, direção, freio de mão)
 *                  preenchidos pelo jogador, por IA de trânsito ou por missões
 *  - physics / animation / damage : anexados pelo VehicleManager
 */
export class Vehicle {
  constructor({ id, type, root, body, wheels, spec, lights, doors = [], steering = null, popups = [], mats = {} }) {
    this.id = id;
    this.type = type;
    this.root = root;
    this.body = body;
    this.wheels = wheels;
    this.spec = spec;
    this.lights = lights;
    this.doors = doors;
    this.steeringWheel = steering;
    this.popups = popups;
    this.mats = mats;
    this.seats = spec.seats || [];
    this.state = 'parked'; // parked | driven | coasting
    this.driver = null;    // 'player' | 'ai' | null
    this.engineOn = false;
    this.headlightsOn = false;
    this.speed = 0;
    this.steer = 0;
    this.heading = 0;
    this.colliderId = null;
    this.collision = null;
    /** Comandos abstratos (mesma interface para jogador e IA). */
    // Estacionado: freio e freio de mão acionados (se for empurrado, desliza pouco).
    this.controls = { throttle: 0, brake: 1, steer: 0, handbrake: true };
    this.physics = null;
    this.animation = null;
    this.damage = null;
    this.root.userData.vehicle = this;
  }

  get name() {
    return this.spec.model;
  }

  /** Posiciona o veículo (estacionado) e atualiza seu colisor. */
  setPose(x, y, z, heading) {
    this.heading = heading;
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, heading, 0);
    this.root.updateMatrixWorld(true);
    if (this.collision && this.colliderId) this.collision.move(this.colliderId, x, z, heading);
    this.physics?.syncFromRoot();
  }

  attachCollider(collision) {
    this.collision = collision;
    const s = this.spec;
    const p = this.root.position;
    const c = collision.addBox({
      id: `${this.id}_col`,
      ownerId: this.id,
      cx: p.x,
      cz: p.z,
      hx: s.width / 2,
      hz: s.length / 2,
      rotation: this.heading,
      minY: p.y,
      maxY: p.y + s.height * 0.92,
      tags: ['vehicle'],
      walkable: true,
      cameraBlocker: true,
    });
    this.colliderId = c.id;
    this.collider = c;
  }

  /** Atualiza o colisor com a pose atual (veículos em movimento). */
  syncCollider(x, y, z, heading) {
    if (!this.collision || !this.colliderId) return;
    this.collision.move(this.colliderId, x, z, heading);
    this.collider.minY = y;
    this.collider.maxY = y + this.spec.height * 0.92;
  }

  /** Converte um ponto local (do veículo) para o mundo. */
  localToWorld(local, out = new THREE.Vector3()) {
    return out.copy(local).applyMatrix4(this.root.matrixWorld);
  }

  /** Pontos de entrada (portas) em coordenadas do mundo. */
  getEntryPoints(out = []) {
    out.length = 0;
    for (const d of this.doors) {
      out.push({ id: d.id, seat: d.seat, side: d.side, position: this.localToWorld(d.entry) });
    }
    return out;
  }

  seat(id) {
    return this.seats.find((s) => s.id === id) || null;
  }

  door(id) {
    return this.doors.find((d) => d.id === id) || null;
  }

  /** Gira as rodas (compatibilidade). */
  spinWheels(distance) {
    for (const w of this.wheels) w.spin.rotation.x += distance / w.radius;
  }

  setSteer(angle) {
    this.steer = angle;
    for (const w of this.wheels) if (w.steer) w.pivot.rotation.y = angle;
  }
}

/** Compatibilidade com o Prompt 01: portas em espaço local (motorista = +X). */
export const DOOR_OFFSETS = (spec) => [
  { id: 'driver', seat: 'driver', offset: new THREE.Vector3(spec.width / 2 + 0.55, 0, spec.seats?.[0]?.z ?? 0) },
  { id: 'passenger', seat: 'passenger', offset: new THREE.Vector3(-spec.width / 2 - 0.55, 0, spec.seats?.[1]?.z ?? 0) },
];
