import { PED_STATS } from './data/PedStats.js';

const clamp = x => Math.max(0, Math.min(1, x));
const STYLE_PROFILE = { beach: 'STAT_BEACH_GUY', suit: 'STAT_SUIT_GUY', tourist: 'STAT_TOURIST', elder: 'STAT_OLD_GUY', track: 'STAT_SPORTSFAN', dress: 'STAT_SHOPPER' };

/** Memory, perception and activity selection for our engine, not a GTA engine port. */
export class CitizenBrain {
  constructor({ id, style = 'casual', profile = STYLE_PROFILE[style] || 'STAT_STREET_GUY', random = Math.random } = {}) {
    this.id = id;
    this.profileId = profile;
    this.profile = PED_STATS[profile] || PED_STATS.STAT_STREET_GUY;
    this.random = random;
    this.time = 0;
    this.fear = 0;
    this.alert = 0;
    this.anger = 0;
    this.fatigue = random() * 0.3;
    this.social = random() * 0.5;
    this.sociability = 0.25 + random() * 0.65;
    this.memory = [];
    this.goal = 'walk';
    this.reason = 'circulando';
    this.threat = null;
    this.style = style;
    this.goalUntil = 0;
    this.stride = style === 'elder' ? 0.85 : 0.95 + random() * 0.15;
  }

  perceive(event, { distance = 0, visible = true } = {}) {
    const audible = ['gunshot', 'propBreak', 'collision', 'horn', 'siren'].includes(event.type);
    if (!visible && !audible) return false;
    const range = event.type === 'gunshot' ? 45 : event.type === 'weaponAim' ? 20 : event.type === 'siren' ? 26 : 22;
    if (distance > range) return false;
    const key = `${event.type}:${event.id || event.source || ''}`;
    const recent = this.memory.find(m => m.key === key && this.time - m.time < 0.8);
    if (recent) return false;
    const severity = { gunshot: 0.9, weaponAim: 0.75, collision: 0.65, propBreak: 0.55, horn: 0.12, siren: 0.22 }[event.type] || 0;
    if (!severity) return false;
    const exposure = Math.max(0.15, 1 - distance / range) * (visible ? 1 : 0.45);
    if (event.type === 'collision' || event.type === 'horn') this.anger = clamp(this.anger + this.profile.temper / 100 * exposure * 0.6);
    const sensitivity = 0.6 + this.profile.fear / 100;
    const gunPanic = event.type === 'gunshot' && (this.profile.flags & 128) ? 0.25 : 0;
    this.fear = clamp(this.fear + (severity * exposure + gunPanic) * sensitivity);
    this.alert = Math.max(this.alert, 0.4 + severity * 0.6);
    this.threat = { x: event.x, z: event.z };
    this.memory.push({ key, type: event.type, x: event.x, z: event.z, time: this.time });
    if (this.memory.length > 8) this.memory.shift();
    this.goal = this.fear > 0.42 ? 'flee' : 'watch';
    this.goalUntil = this.time + (this.goal === 'flee' ? 7 : 2.5);
    this.reason = event.type;
    return true;
  }

  update(dt, moving = false) {
    this.time += dt;
    this.fear = Math.max(0, this.fear - dt * 0.065);
    this.alert = Math.max(0, this.alert - dt * 0.16);
    this.anger = Math.max(0, this.anger - dt * 0.08);
    this.fatigue = clamp(this.fatigue + dt * (moving ? 0.003 : -0.025));
    this.social = clamp(this.social + dt * 0.007);
    this.memory = this.memory.filter(m => this.time - m.time < 30);
    if (this.time >= this.goalUntil && (this.goal === 'flee' || this.goal === 'watch')) {
      this.goal = this.fear > 0.35 ? 'flee' : 'walk';
      this.goalUntil = this.time + 2;
    }
  }

  chooseActivity({ canRest = false, canChat = false, canVisit = false } = {}) {
    if (this.goal === 'flee' || this.goal === 'watch') return this.goal;
    if (this.time < this.goalUntil) return this.goal;
    if (canRest && (this.fatigue > 0.55 || this.random() < 0.18)) this.goal = 'rest';
    else if (canChat && this.social * this.sociability > 0.22) { this.goal = 'chat'; this.social = 0; }
    else if (canVisit && this.random() < 0.35) this.goal = 'visit';
    else this.goal = 'walk';
    this.goalUntil = this.time + (this.goal === 'chat' ? 5 + this.random() * 4 : this.goal === 'rest' ? 10 : 3);
    this.reason = this.goal;
    return this.goal;
  }

  get fleeSpeed() { return (this.style === 'elder' ? 2.4 : 3.5) + this.fear * 0.9; }
  get turnRate() { return Math.max(4, this.profile.headingRate * 0.9); }
}
