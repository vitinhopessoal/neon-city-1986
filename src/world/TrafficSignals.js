import * as THREE from 'three';

/**
 * Semáforos funcionais (apenas visual nesta etapa) com ciclo de fases.
 * O estado é exposto por getState(group) para a futura IA de trânsito.
 */
const PHASES = [
  { ns: 'green', ew: 'red', duration: 14 },
  { ns: 'yellow', ew: 'red', duration: 3 },
  { ns: 'red', ew: 'red', duration: 1.5 },
  { ns: 'red', ew: 'green', duration: 9 },
  { ns: 'red', ew: 'yellow', duration: 3 },
  { ns: 'red', ew: 'red', duration: 1.5 },
];

const ON = { red: new THREE.Color(3.0, 0.25, 0.2), yellow: new THREE.Color(3.0, 1.9, 0.25), green: new THREE.Color(0.3, 3.0, 1.2) };
const OFF = { red: new THREE.Color(0.22, 0.04, 0.04), yellow: new THREE.Color(0.22, 0.16, 0.03), green: new THREE.Color(0.03, 0.18, 0.08) };

export class TrafficSignalController {
  constructor(intersectionId, lib, parent, collision, destruction = null) {
    this.id = intersectionId;
    this.lib = lib;
    this.parent = parent;
    this.collision = collision;
    this.destruction = destruction;
    this.failed = false;
    this.phaseIndex = 0;
    this.timer = PHASES[0].duration;
    this.lamps = {
      ns: this._lampSet(),
      ew: this._lampSet(),
    };
    this._apply();
  }

  _lampSet() {
    const mk = (k) => new THREE.MeshBasicMaterial({ color: OFF[k].clone(), toneMapped: false });
    return { red: mk('red'), yellow: mk('yellow'), green: mk('green') };
  }

  /**
   * Poste com braço sobre a via. Os focos ficam voltados para -Z local;
   * rot gira o conjunto; armLength define o comprimento do braço (+X local).
   */
  addPole({ x, y = 0, z, rot = 0, armLength = 8, group = 'ns', heads = [0.6, 0.85] }) {
    const g = new THREE.Group();
    const metal = this.lib.solid(0x9aa2ab, 0.4, 0.75);
    const housing = this.lib.solid(0xe0b21f, 0.5, 0.2);
    const dark = this.lib.solid(0x1d1f24, 0.6, 0.3);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 6.4, 10), metal);
    pole.position.y = 3.2;
    g.add(pole);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, armLength, 8), metal);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(armLength / 2, 6.0, 0);
    g.add(arm);
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), metal);
    brace.rotation.z = Math.PI / 2 - 0.55;
    brace.position.set(1.0, 5.4, 0);
    g.add(brace);
    const lamps = this.lamps[group];
    for (const f of heads) {
      const hx = armLength * f;
      const head = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.15, 0.34), housing);
      head.add(box);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.35, 0.04), dark);
      back.position.z = 0.19;
      head.add(back);
      ['red', 'yellow', 'green'].forEach((k, i) => {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), lamps[k]);
        lens.position.set(0, 0.36 - i * 0.36, -0.175);
        lens.rotation.y = Math.PI;
        head.add(lens);
        const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.18, 12, 1, true, Math.PI * 0.5, Math.PI), dark);
        visor.rotation.x = Math.PI / 2;
        visor.position.set(0, 0.36 - i * 0.36, -0.26);
        head.add(visor);
      });
      head.position.set(hx, 5.35, 0);
      g.add(head);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(x, y, z);
    g.rotation.y = rot;
    this.parent.add(g);
    const collider = this.collision.addCylinder({ id: `${this.id}_pole_${x.toFixed(0)}_${z.toFixed(0)}`, x, z, radius: 0.2, minY: y, maxY: y + 6.4, cameraBlocker: false, walkable: false });
    this.destruction?.registerObject(collider.id, 'signal', g, [collider], () => this.fail());
    return g;
  }

  getState(group) {
    if (this.failed) return 'stop';
    return PHASES[this.phaseIndex][group];
  }

  fail() {
    this.failed = true;
    for (const group of ['ns', 'ew']) for (const color of ['red', 'yellow', 'green']) this.lamps[group][color].color.copy(OFF[color]);
  }

  /** Tempo (s) até o grupo sair do estado atual (travessia de pedestres). */
  timeInState(group) {
    if (this.failed) return 0;
    const st = PHASES[this.phaseIndex][group];
    let t = this.timer;
    for (let k = 1; k < PHASES.length; k++) {
      const ph = PHASES[(this.phaseIndex + k) % PHASES.length];
      if (ph[group] !== st) break;
      t += ph.duration;
    }
    return t;
  }

  _apply() {
    const phase = PHASES[this.phaseIndex];
    for (const group of ['ns', 'ew']) {
      const state = phase[group];
      for (const k of ['red', 'yellow', 'green']) {
        this.lamps[group][k].color.copy(state === k ? ON[k] : OFF[k]);
      }
    }
  }

  update(dt) {
    if (this.failed) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.phaseIndex = (this.phaseIndex + 1) % PHASES.length;
      this.timer += PHASES[this.phaseIndex].duration;
      this._apply();
    }
  }
}
