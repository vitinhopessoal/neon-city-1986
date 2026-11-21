import * as THREE from 'three';
import { SPECS } from '../vehicles/VehicleFactory.js';

/**
 * Garagens das residências. Reutiliza os veículos e a física existentes:
 * guardar = registrar os dados do carro e retirá-lo da simulação; retirar =
 * devolver o MESMO objeto (carros do mapa) ou recriá-lo pela fábrica a partir
 * dos dados salvos (carros vindos do trânsito ou de um carregamento).
 *
 * Regras anti-duplicação:
 *  - cada carro tem um id persistente (pid) único entre todas as garagens e o mundo;
 *  - o registro é gravado ANTES de o carro sair do mundo (se a remoção falhar,
 *    o registro é desfeito) e removido só DEPOIS de o carro voltar ao mundo;
 *  - ao carregar, carros do mapa guardados numa garagem são ocultados.
 */
const _v = new THREE.Vector3();

export class PropertyGarage {
  constructor(pm) {
    this.pm = pm;
    this.game = pm.game;
    this.garages = new Map(); // id -> { def, prop, door:{x,z}, bays:[{x,z,heading}], vehicles:[rec] }
    this.hidden = new Map(); // pid -> Vehicle (carros do mapa guardados)
    this.owned = new Set(); // pids de carros do jogador persistidos no mundo
    this.worldIds = new Set();
    this.originalPose = new Map();
    this.kept = new Map(); // garagem -> registros (enquanto o mapa ativo não tem a garagem)
    this.group = null;
    this.stats = { stored: 0, retrieved: 0, refused: 0 };
  }

  // ------------------------------------------------------------ mapa
  setup(env, defs) {
    this.env = env;
    // Carros guardados sobrevivem à troca de mapa (o mapa não tem garagens → ficam registrados).
    for (const [id, g] of this.garages) this.kept.set(id, g.vehicles);
    this.garages.clear();
    this.hidden.clear();
    if (!this.group) { this.group = new THREE.Group(); this.group.name = 'garage-vehicles'; }
    if (!this.group.parent) this.game.scene.add(this.group);
    this.worldIds = new Set((env.vehicles || []).map((v) => v.id));
    // Objetos originais dos carros do mapa: sempre reaproveitados (nunca um segundo exemplar).
    this.worldObjects = new Map((env.vehicles || []).map((v) => [v.id, v]));
    this.originalPose = new Map((env.vehicles || []).map((v) => [v.id, { x: v.root.position.x, y: v.root.position.y, z: v.root.position.z, heading: v.physics?.heading ?? v.root.rotation.y }]));
    if (env.isImported) return;
    const blds = env.districts?.flatMap((d) => d.buildings) || [];
    for (const def of defs) {
      const g = def.property.garage;
      if (!g) continue;
      const bld = blds.find((b) => b.id === def.buildingId);
      if (!bld) continue;
      const s = Math.sin(bld.rotY || 0), c = Math.cos(bld.rotY || 0);
      const W = (p) => (p.world ? { x: p.x, z: p.z, heading: p.heading ?? 0 } : { x: bld.x + p.lx * c + p.lz * s, z: bld.z - p.lx * s + p.lz * c, heading: (bld.rotY || 0) + (p.heading ?? 0) });
      const bays = g.bays.map(W);
      // Vagas de rua usadas como baia: reservadas (o trânsito não estaciona nelas).
      for (const b of bays) for (const spot of env.parkingSpots || []) if (Math.hypot(spot.x - b.x, spot.z - b.z) < 1.5) { spot.occupied = true; spot.reservedBy = g.id; }
      this.garages.set(g.id, { def: g, prop: def, door: W(g.door), bays, vehicles: this.kept.get(g.id) || [] });
      this.kept.delete(g.id);
    }
    this._ensureMarkers();
    // Carros do mapa que estão guardados continuam fora do mundo (sem segundo exemplar).
    for (const g of this.garages.values()) for (const r of g.vehicles) {
      const v = (env.vehicles || []).find((o) => o.id === r.pid && o.root.visible);
      if (v) this._removeFromWorld(v, r.pid);
    }
  }

  /** Marcação visual discreta das baias (retângulo pintado) e totem da garagem. */
  _ensureMarkers() {
    if (this.markerGroup) this.markerGroup.removeFromParent();
    const grp = new THREE.Group();
    grp.name = 'garage-markers';
    const paint = new THREE.MeshBasicMaterial({ color: 0x45f3ff, transparent: true, opacity: 0.55, depthWrite: false });
    const totem = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.4, metalness: 0.4 });
    const lamp = new THREE.MeshStandardMaterial({ color: 0x5dff9c, emissive: 0x5dff9c, emissiveIntensity: 1.6 });
    for (const g of this.garages.values()) {
      for (const b of g.bays) {
        const frame = new THREE.Group();
        frame.position.set(b.x, this._groundY(b.x, b.z) + 0.02, b.z);
        frame.rotation.y = b.heading;
        for (const [w, d, x, z] of [[2.6, 0.08, 0, 2.6], [2.6, 0.08, 0, -2.6], [0.08, 5.2, 1.3, 0], [0.08, 5.2, -1.3, 0]]) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint);
          m.rotation.x = -Math.PI / 2; m.position.set(x, 0, z); frame.add(m);
        }
        grp.add(frame);
      }
      const d = g.door;
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.3, 0.18), totem);
      t.position.set(d.x, this._groundY(d.x, d.z) + 0.65, d.z);
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.14, 0.2), lamp);
      l.position.set(d.x, this._groundY(d.x, d.z) + 1.22, d.z);
      grp.add(t, l);
    }
    this.game.scene.add(grp);
    this.markerGroup = grp;
  }

  _groundY(x, z) {
    return this.env?.collision ? this.env.collision.getGroundHeight(x, z, 1.0, 1.0) : 0;
  }

  ids() { return [...this.garages.keys()]; }
  forProperty(propId) { return [...this.garages.values()].find((g) => g.prop.id === propId) || null; }

  // ------------------------------------------------------------ dados do carro
  recordOf(v) {
    const ap = v.appearance || {};
    // Cor BASE da pintura (o dano escurece o material; não deve ser gravado como cor).
    const paint = Number.isSafeInteger(ap.color) ? ap.color : (v.mats?.paint?.color?.getHex?.() ?? 0xffffff);
    return {
      pid: v.persistId || v.id, type: v.type, model: v.spec.model, color: paint,
      stripe: Number.isSafeInteger(ap.stripe) ? ap.stripe : null, plate: typeof ap.plate === 'string' ? ap.plate.slice(0, 12) : '',
      integrity: Math.round((v.damage?.integrity ?? 100) * 10) / 10,
      // Personalização NEON CUSTOMS (dados simples; reaplicada ao retirar/carregar).
      ...(v.custom ? { custom: { ...v.custom } } : {}),
    };
  }

  /** Veículo estacionado numa baia da garagem (parado, sem motorista IA, não policial). */
  vehicleInBay(g) {
    const vm = this.game.vehicles;
    let best = null, bd = 3.0;
    for (const v of vm.list) {
      if (v.police || v.driver === 'ai' || !v.root.visible) continue;
      if (v.physics && Math.abs(v.physics.speed) > 1.0) continue;
      for (const b of g.bays) {
        const d = Math.hypot(v.root.position.x - b.x, v.root.position.z - b.z);
        if (d < bd) { bd = d; best = v; }
      }
    }
    return best;
  }

  _allStoredPids() {
    const s = new Set();
    for (const g of this.garages.values()) for (const r of g.vehicles) s.add(r.pid);
    return s;
  }

  // ------------------------------------------------------------ guardar
  store(garageId) {
    const g = this.garages.get(garageId);
    const vm = this.game.vehicles;
    if (!g) return { ok: false, msg: 'Garagem inexistente.' };
    if (!this.pm.owns(g.prop.id)) return { ok: false, msg: 'Esta garagem não é sua.' };
    const v = this.vehicleInBay(g);
    if (!v) return { ok: false, msg: 'Estacione o carro dentro da vaga marcada e desça para guardá-lo.' };
    if (v === vm.playerVehicle || vm.state !== 'ON_FOOT') return { ok: false, msg: 'Desça do carro antes de guardá-lo.' };
    if (g.vehicles.length >= g.def.capacity) { this.stats.refused++; return { ok: false, msg: `Garagem cheia (${g.def.capacity}/${g.def.capacity}).` }; }
    // Carros do trânsito ganham um id persistente próprio (o id do trânsito é reciclado).
    if (!this.worldIds.has(v.id) && !v.persistId && v.id.startsWith('traffic')) v.persistId = `own_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const rec = this.recordOf(v);
    if (this._allStoredPids().has(rec.pid)) { this.stats.refused++; return { ok: false, msg: 'Este carro já está guardado.' }; }
    // 1) registra; 2) retira do mundo; falha → desfaz o registro.
    g.vehicles.push(rec);
    if (!this._removeFromWorld(v, rec.pid)) {
      g.vehicles.splice(g.vehicles.indexOf(rec), 1);
      this.stats.refused++;
      return { ok: false, msg: 'Não foi possível guardar este carro agora.' };
    }
    this.owned.add(rec.pid);
    if (vm.interaction.lastVehicle === v) vm.interaction.lastVehicle = null;
    if (this.game.interiors?.lastPlayerVehicle === v) this.game.interiors.lastPlayerVehicle = null;
    this.stats.stored++;
    return { ok: true, msg: `${rec.model} guardado (${g.vehicles.length}/${g.def.capacity}). Integridade ${Math.round(rec.integrity)}%.`, rec };
  }

  _removeFromWorld(v, pid) {
    const vm = this.game.vehicles;
    if (!vm.removeVehicle(v)) return false;
    if (v.collision && v.colliderId) v.collision.remove(v.colliderId);
    v.colliderId = null; v.collider = null;
    v.root.visible = false;
    v.engineOn = false;
    if (v.physics) v.physics.awake = false; // speed é derivado (somente leitura)
    if (this.worldIds.has(v.id)) this.hidden.set(pid, v);
    else this.game.world.vehicleFactory.dispose(v); // carro do trânsito: recriado pela fábrica ao retirar
    return true;
  }

  // ------------------------------------------------------------ retirar
  /** Baia livre (sem colisão com carros, paredes ou o jogador). */
  freeBay(g, v = null) {
    const vm = this.game.vehicles;
    const p = this.game.player.controller.position;
    for (const b of g.bays) {
      if (Math.hypot(p.x - b.x, p.z - b.z) < 3.2 && !this.game.interiors?.active) continue;
      if (vm.list.some((o) => o.root.visible && Math.hypot(o.root.position.x - b.x, o.root.position.z - b.z) < 4.2)) continue;
      const y = v ? vm._placementFree(v, b.x, b.z, b.heading) : this._groundY(b.x, b.z);
      if (y !== null) return { ...b, y };
    }
    return null;
  }

  retrieve(garageId, pid) {
    const g = this.garages.get(garageId);
    const vm = this.game.vehicles;
    if (!g) return { ok: false, msg: 'Garagem inexistente.' };
    const rec = g.vehicles.find((r) => r.pid === pid);
    if (!rec) return { ok: false, msg: 'Esse carro não está nesta garagem.' };
    if (vm.list.some((o) => (o.persistId || o.id) === pid && o.root.visible)) { this.stats.refused++; return { ok: false, msg: 'Esse carro já está na rua (duplicação evitada).' }; }
    let v = this.hidden.get(pid) || (this.worldIds.has(pid) ? this.worldObjects?.get(pid) : null) || null;
    if (!SPECS[rec.type]) return { ok: false, msg: 'Modelo de veículo desconhecido.' };
    const bay = this.freeBay(g, v || { id: pid, spec: SPECS[rec.type] });
    if (!bay) return { ok: false, msg: 'As vagas da garagem estão ocupadas. Libere a vaga marcada e tente de novo.' };
    if (!v) {
      v = this.game.world.vehicleFactory.create(rec.type, { id: pid, color: rec.color, stripe: rec.stripe ?? null, plate: rec.plate || null });
      this.group.add(v.root);
    }
    this._restore(v, rec, bay);
    this.hidden.delete(pid);
    g.vehicles.splice(g.vehicles.indexOf(rec), 1);
    this.owned.add(pid);
    this.stats.retrieved++;
    return { ok: true, msg: `${rec.model} retirado da garagem (integridade ${Math.round(rec.integrity)}%).`, vehicle: v };
  }

  _restore(v, rec, pose) {
    const vm = this.game.vehicles;
    v.root.visible = true;
    if (rec.pid !== v.id) v.persistId = rec.pid;
    if (v.mats?.paint && Number.isSafeInteger(rec.color)) { v.mats.paint.color.setHex(rec.color); v.appearance = { ...(v.appearance || {}), color: rec.color }; }
    if (!v.colliderId) v.attachCollider(this.env.collision);
    v.setPose(pose.x, pose.y ?? this._groundY(pose.x, pose.z), pose.z, pose.heading);
    vm.addVehicle(v);
    if (v.damage) {
      // O dano escurece a partir da cor base guardada em VehicleDamage: mantém-na igual à pintura salva.
      if (Number.isSafeInteger(rec.color)) v.damage._baseColor?.setHex(rec.color);
      v.damage.integrity = Math.max(0, Math.min(100, rec.integrity));
      v.damage._applyVisuals?.();
    }
    if (rec.custom && this.game.customs) this.game.customs.applyConfig(v, rec.custom);
    v.driver = null;
    v.state = 'parked';
    v.controls.brake = 1; v.controls.handbrake = true; v.controls.throttle = 0;
    if (v.physics) { v.physics.syncFromRoot(); v.physics.awake = false; }
  }

  // ------------------------------------------------------------ persistência
  serializeGarages() {
    const out = {};
    for (const [id, list] of this.kept) out[id] = list.map((r) => ({ ...r }));
    for (const [id, g] of this.garages) out[id] = g.vehicles.map((r) => ({ ...r }));
    return out;
  }

  /** Carros do jogador que estão no mundo (posição, integridade, cor). */
  serializeWorld() {
    const vm = this.game.vehicles;
    const out = [];
    const stored = this._allStoredPids();
    for (const v of vm.list) {
      const pid = v.persistId || v.id;
      if (!this.owned.has(pid) || stored.has(pid) || !v.root.visible || v.police) continue;
      const p = v.root.position;
      out.push({ ...this.recordOf(v), x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), heading: +(v.physics?.heading ?? v.root.rotation.y).toFixed(4) });
    }
    return out;
  }

  deserialize(garages, worldRecs, warnings) {
    const vm = this.game.vehicles;
    const factory = this.game.world.vehicleFactory;
    // 0) Estado atual volta ao normal: carros do mapa ocultos reaparecem na pose original;
    //    carros recriados pela fábrica (não pertencentes ao mapa) são descartados.
    for (const [pid, v] of this.hidden) {
      const o = this.originalPose.get(v.id);
      if (o) this._restore(v, { pid: v.id, color: v.appearance?.color ?? v.mats?.paint?.color.getHex(), integrity: 100 }, o);
      v.persistId = undefined;
    }
    this.hidden.clear();
    for (const v of [...vm.list]) {
      if (this.worldIds.has(v.id) || (!v.persistId && !this.owned.has(v.id))) continue;
      if (v === vm.playerVehicle) vm.interaction.forceExit();
      vm.removeVehicle(v);
      factory.dispose(v);
    }
    for (const g of this.garages.values()) g.vehicles = [];
    this.kept.clear();
    this.owned = new Set();
    // 1) Garagens: carros do mapa guardados ficam ocultos (não há segundo exemplar).
    for (const [gid, list] of Object.entries(garages || {})) {
      const g = this.garages.get(gid);
      if (!g) { if (list.length) { this.kept.set(gid, list.map((r) => ({ ...r }))); for (const r of list) this.owned.add(r.pid); } if (list.length) warnings.push(`Garagem ${gid} indisponível neste mapa: ${list.length} carro(s) preservado(s) no save.`); continue; }
      for (const rec of list.slice(0, g.def.capacity)) {
        g.vehicles.push({ ...rec });
        this.owned.add(rec.pid);
        const v = vm.list.find((o) => o.id === rec.pid);
        if (v) this._removeFromWorld(v, rec.pid);
      }
    }
    // 2) Carros do jogador no mundo.
    for (const rec of worldRecs || []) {
      if (this._allStoredPids().has(rec.pid)) continue;
      let v = vm.list.find((o) => (o.persistId || o.id) === rec.pid) || (this.worldIds.has(rec.pid) ? this.worldObjects?.get(rec.pid) : null) || null;
      if (!v) {
        try {
          v = factory.create(rec.type, { id: rec.pid, color: rec.color, stripe: rec.stripe ?? null, plate: rec.plate || null });
          this.group.add(v.root);
        } catch { warnings.push(`Modelo de veículo desconhecido: ${rec.type}`); continue; }
      }
      let pose = { x: rec.x, y: rec.y, z: rec.z, heading: rec.heading };
      // Posição salva ocupada ou inválida: procura um lugar seguro próximo (nunca dentro de paredes).
      const y = vm._placementFree(v, rec.x, rec.z, rec.heading);
      if (y === null) {
        const spot = vm._findRecoverySpot({ id: v.id, spec: v.spec, physics: { x: rec.x, z: rec.z, heading: rec.heading } });
        if (spot) pose = spot; else warnings.push(`Sem lugar seguro para ${rec.model}: mantido na posição salva.`);
      } else pose.y = y;
      this._restore(v, rec, pose);
      this.owned.add(rec.pid);
    }
  }

  reset() {
    for (const g of this.garages.values()) g.vehicles = [];
    this.owned = new Set();
  }
}
