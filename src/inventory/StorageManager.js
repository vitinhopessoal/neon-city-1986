import { AMMO_TYPES } from '../weapons/WeaponDefinitions.js';

/**
 * Armários das residências. Cada transferência é "transacional": valida
 * tudo antes de alterar qualquer lado, e a soma (jogador + armário) de cada
 * arma e de cada tipo de munição é conservada — nada é duplicado ou perdido.
 */
export class StorageManager {
  constructor(inventory) {
    this.inventory = inventory;
    this.boxes = {}; // propId -> { weapons: { id: { loaded } }, ammo: { cat: n } }
  }

  box(propId) {
    if (!this.boxes[propId]) this.boxes[propId] = { weapons: {}, ammo: Object.fromEntries(Object.keys(AMMO_TYPES).map((k) => [k, 0])) };
    return this.boxes[propId];
  }

  /** Uma arma não pode estar em dois lugares (inventário e algum armário). */
  _storedAnywhere(id) {
    return Object.entries(this.boxes).find(([, b]) => b.weapons[id])?.[0] || null;
  }

  depositWeapon(propId, id) {
    const b = this.box(propId);
    if (!this.inventory.inv.get(id)) return { ok: false, msg: 'Você não está com essa arma.' };
    if (this._storedAnywhere(id)) return { ok: false, msg: 'Essa arma já está guardada.' };
    const taken = this.inventory.takeWeapon(id);
    if (!taken) return { ok: false, msg: 'Não foi possível guardar.' };
    b.weapons[id] = { loaded: taken.loaded };
    return { ok: true, msg: 'Arma guardada no armário.' };
  }

  withdrawWeapon(propId, id) {
    const b = this.box(propId);
    const s = b.weapons[id];
    if (!s) return { ok: false, msg: 'Essa arma não está neste armário.' };
    if (this.inventory.inv.get(id)) return { ok: false, msg: 'Você já carrega essa arma.' };
    if (!this.inventory.putWeapon(id, s.loaded)) return { ok: false, msg: 'Não foi possível retirar.' };
    delete b.weapons[id];
    return { ok: true, msg: 'Arma retirada.' };
  }

  depositAmmo(propId, cat, n) {
    const b = this.box(propId);
    if (!(cat in AMMO_TYPES)) return { ok: false, msg: 'Munição inválida.' };
    const k = this.inventory.takeAmmo(cat, n);
    if (!k) return { ok: false, msg: 'Sem munição desse tipo para guardar.' };
    b.ammo[cat] = (b.ammo[cat] || 0) + k;
    return { ok: true, msg: `${k} cartuchos guardados.` };
  }

  withdrawAmmo(propId, cat, n) {
    const b = this.box(propId);
    if (!(cat in AMMO_TYPES)) return { ok: false, msg: 'Munição inválida.' };
    const want = Math.min(n | 0, b.ammo[cat] || 0);
    if (!want) return { ok: false, msg: 'O armário não tem essa munição.' };
    const k = this.inventory.putAmmo(cat, want);
    if (!k) return { ok: false, msg: 'Você já está com a munição máxima.' };
    b.ammo[cat] -= k;
    return { ok: true, msg: `${k} cartuchos retirados.` };
  }

  serialize() {
    return JSON.parse(JSON.stringify(this.boxes));
  }

  deserialize(d, validProps, validWeapons) {
    this.boxes = {};
    const seen = new Set();
    for (const [pid, b] of Object.entries(d || {})) {
      if (!validProps.has(pid) || !b || typeof b !== 'object') continue;
      const box = this.box(pid);
      for (const [id, s] of Object.entries(b.weapons || {})) {
        // Arma no inventário E no armário (save adulterado): fica só no inventário.
        if (!validWeapons.has(id) || seen.has(id) || this.inventory.inv.get(id)) continue;
        seen.add(id);
        box.weapons[id] = { loaded: Math.max(0, s?.loaded | 0) };
      }
      for (const k of Object.keys(AMMO_TYPES)) { const n = b.ammo?.[k]; box.ammo[k] = Number.isSafeInteger(n) && n > 0 ? n : 0; }
    }
  }
}
