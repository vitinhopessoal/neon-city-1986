/** State used by the HUD. Kept outside the UI so gameplay can award/spend money,
 * apply damage and change wanted level without editing DOM elements. */
export class PlayerStatus {
  constructor() {
    this.health = 100;
    this.money = 660;
    this.wanted = 0;
    this.minutes = 18 * 60 + 39;
    this._clock = 0;
    this._quiet = 0;
    this._heat = 0;
  }

  setHealth(value) {
    if (Number.isFinite(value)) this.health = Math.max(0, Math.min(100, Math.round(value)));
  }

  damage(amount) {
    if (Number.isFinite(amount) && amount > 0) this.setHealth(this.health - amount);
  }

  addMoney(amount) {
    if (Number.isFinite(amount)) this.money = Math.max(0, Math.min(99999999, this.money + Math.trunc(amount)));
  }

  spendMoney(amount) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.money) return false;
    this.money -= amount;
    return true;
  }

  setWanted(level) {
    if (!Number.isFinite(level)) return;
    this.wanted = Math.max(0, Math.min(6, Math.floor(level)));
    this._heat = this.wanted * 4;
    this._quiet = 0;
  }

  reportCrime(severity = 1) {
    if (!Number.isFinite(severity) || severity <= 0) return;
    this._heat = Math.min(24, this._heat + severity);
    this.wanted = Math.ceil(this._heat / 4);
    this._quiet = 0;
  }

  setTimePreset(name) {
    this.minutes = { morning: 9 * 60, sunset: 18 * 60 + 39, night: 23 * 60 }[name] ?? this.minutes;
    this._clock = 0;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Classic accelerated clock: one game minute per real second.
    this._clock += dt;
    const minutes = Math.floor(this._clock);
    this._clock -= minutes;
    this.minutes = (this.minutes + minutes) % 1440;
    if (this.wanted && !this.policeManaged) {
      this._quiet += dt;
      while (this._quiet >= 30 && this.wanted) {
        this._quiet -= 30;
        this._heat = Math.max(0, (this.wanted - 1) * 4);
        this.wanted = Math.ceil(this._heat / 4);
      }
    }
  }
}

export function formatClock(minutes) {
  const n = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

export function formatMoney(money) {
  return `$${String(Math.max(0, Math.min(99999999, Math.trunc(money)))).padStart(8, '0')}`;
}
