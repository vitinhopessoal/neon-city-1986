import * as THREE from 'three';
import { InteriorNPCs } from '../interiors/InteriorNPCs.js';
import { MARINAS } from './MaritimeLocations.js';

/**
 * Frequentadores das marinas. NÃO cria um sistema novo de NPC: reaproveita o
 * InteriorNPCs (mesmo PedestrianRenderer instanciado, mesmos visuais e
 * comportamentos stand/work/patrol/guard, rotas A* na grade de navegação),
 * aplicado a um "interior" aberto cujo piso é o píer.
 * Só é simulado com o jogador por perto (economia de CPU).
 */
const NEAR = 95;

function site(id, cx, cz, W, D, y, colliders, specs) {
  const root = new THREE.Group();
  root.position.set(cx, 0, cz);
  root.updateMatrixWorld(true);
  // Interior "aberto": mesmas chaves que o InteriorNPCs lê de um interior real.
  const interior = { def: { id }, root, W, D, colliders, seats: [] };
  return { id, root, interior, specs, center: new THREE.Vector3(cx, y, cz), npcs: null };
}

export class MarinaNPCs {
  constructor(scene) {
    this.scene = scene;
    this.sites = [];
    this.stats = { active: 0, total: 0 };
  }

  build() {
    const S = MARINAS.sunset, A = MARINAS.azure;
    const deck = S.deckY;
    // Píer da Sunset Marina: eixo x local ao longo do píer, z local = transversal.
    const sx = (S.x0 + S.x1) / 2, sz = S.pierZ;
    // Água dos dois lados do píer vira "parede" da grade (NPCs só andam no deque).
    const pierBand = (x0, x1) => [-1, 1].map((sd) => ({ x: 0, z: sd * (1.6 + 6.5), w: x1 - x0 + 4, d: 13, y0: -1, y1: 3 }));
    this.sites.push(site('sunset_marina', sx, sz, S.x1 - S.x0 + 4, 30, deck, pierBand(S.x0, S.x1), [
      { role: 'dockhand', behavior: 'patrol', y: deck, speed: 0.9, points: [[-36, 0.4], [-5, -0.5], [36, 0.4]] },
      { role: 'fisher', behavior: 'work', y: deck, x: 39, z: 1.0, yaw: Math.PI / 2 },
      { role: 'tourist', behavior: 'stand', y: deck, x: 10, z: -1.0, yaw: Math.PI },
      { role: 'clerk', behavior: 'stand', y: 0.1, x: (S.office.x + 4.6 + 0.9) - sx, z: S.office.z - sz, yaw: -Math.PI / 2 },
    ]));
    const ax = (A.x0 + A.x1) / 2, az = A.pierZ;
    this.sites.push(site('azure_docks', ax, az, A.x1 - A.x0 + 4, 30, deck, pierBand(A.x0, A.x1), [
      { role: 'docker', behavior: 'patrol', y: deck, speed: 0.8, points: [[-28, -0.4], [28, 0.4]] },
      { role: 'fisher', behavior: 'work', y: deck, x: 30, z: -1.0, yaw: Math.PI / 2 },
      { role: 'guard', behavior: 'guard', y: 0.1, x: (A.warehouse.x + 6.2) - ax, z: (A.warehouse.z + 2) - az, yaw: Math.PI / 2 },
    ]));
    for (const s of this.sites) { this.stats.total += s.specs.length; s.npcs = new InteriorNPCs(this.scene, 6); s.spawned = false; }
  }

  update(dt, playerPos, enabled = true) {
    let active = 0;
    for (const s of this.sites) {
      const near = enabled && playerPos.distanceTo(s.center) < NEAR;
      if (near && !s.spawned) { s.npcs.spawn(s.interior, s.specs); s.spawned = true; }
      else if (!near && s.spawned) { s.npcs.clear(); s.spawned = false; }
      if (s.spawned) { s.npcs.update(dt, playerPos); active += s.npcs.npcs.length; }
    }
    this.stats.active = active;
  }

  react(kind) { for (const s of this.sites) s.npcs?.react(kind); }
}
