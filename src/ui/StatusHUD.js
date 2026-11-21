import { formatClock, formatMoney } from '../player/PlayerStatus.js';

const ASSETS = `${import.meta.env.BASE_URL}hud/vice/`;

export function weaponIcon(def, drawn = true) {
  if (!def || !drawn) return 'fist';
  if (def.category === 'shotgun') return 'buddyshot';
  if (def.category === 'carbine') return 'm4';
  if (def.category === 'compact') return def.id === 'kg99' ? 'tec9' : 'ingramsl';
  return 'colt45';
}

/** Reference layout at 244x110, independently scaled from the 3D renderer.
 * The supplied VC atlas contains a second, heavy numeric face at row nine. */
export class StatusHUD {
  constructor(parent) {
    this.el = document.createElement('div');
    this.el.className = 'hud-status';
    this.el.innerHTML = '<canvas width="732" height="330" role="img"></canvas><img class="hud-weapon-icon" alt="" draggable="false">';
    parent.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.icon = this.el.querySelector('img');
    this.font = new Image();
    this.font.onload = () => { this._prepareFonts(); this._key = null; if (this._status) this.update(this._status, this._weapon, this._drawn); };
    this.font.src = `${ASSETS}font1.png`;
    // If an icon fails, retain a readable original unarmed icon.
    this.icon.onerror = () => { this.icon.onerror = null; this.icon.src = `${ASSETS}fist.png`; };
  }

  _prepareFonts() {
    this.tints = {};
    for (const [name, color] of Object.entries({ ink: '#080c12', time: '#7dc9ef', money: '#00b458', health: '#ed99dc', empty: '#285269', wanted: '#80c9ef' })) {
      const c = document.createElement('canvas'); c.width = c.height = 512;
      const ctx = c.getContext('2d');
      ctx.drawImage(this.font, 0, 0);
      ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = color; ctx.fillRect(0, 0, 512, 512);
      this.tints[name] = c;
    }
  }

  _glyph(char, x, y, w, h, color) {
    const ctx = this.ctx;
    const number = char >= '0' && char <= '9';
    const cell = number ? Number(char) : char.charCodeAt(0) - 32;
    const sx = (cell % 16) * 32;
    const star = char === '>';
    const sy = number ? 368 : Math.floor(cell / 16) * 40 + (star ? 0 : 6);
    const sw = number ? 18 : star ? 32 : 20, sh = number ? 24 : star ? 40 : 28;
    for (const [dx, dy] of [[-1.3, 0], [1.3, 0], [0, -1.3], [0, 1.3], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      ctx.drawImage(this.tints.ink, sx, sy, sw, sh, x+dx, y+dy, w, h);
    }
    ctx.drawImage(this.tints[color], sx, sy, sw, sh, x, y, w, h);
  }

  _text(text, right, y, color) {
    if (this.tints) {
      let x = right - text.length * 17;
      for (const char of text) { this._glyph(char, x, y, 17, 24, color); x += 17; }
    } else {
      const ctx = this.ctx;
      ctx.font = '900 26px Impact, "Arial Black", sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.lineWidth = 3; ctx.strokeStyle = '#080c12'; ctx.strokeText(text, right, y);
      ctx.fillStyle = { time: '#7dc9ef', money: '#00b458', health: '#ed99dc' }[color];
      ctx.fillText(text, right, y);
    }
  }

  update(status, def, drawn) {
    this._status = status; this._weapon = def; this._drawn = drawn;
    const time = formatClock(status.minutes), money = formatMoney(status.money);
    const icon = weaponIcon(def, drawn);
    const blink = status.searching && Math.floor((status.searchTime || 0) * 2) % 2;
    const key = `${time}|${money}|${status.health}|${status.wanted}|${icon}|${!!blink}`;
    if (this._key === key) return;
    this._key = key;
    if (this._icon !== icon) { this._icon = icon; this.icon.src = `${ASSETS}${icon}.png`; }
    this.icon.alt = icon === 'fist' ? 'Desarmado' : def.name;
    this.canvas.setAttribute('aria-label', `Horário ${time}. Dinheiro ${money}. Saúde ${status.health} de 100. Procurado: ${status.wanted} de 6 estrelas.`);
    const ctx = this.ctx;
    ctx.setTransform(3, 0, 0, 3, 0, 0); ctx.clearRect(0, 0, 244, 110);
    this._text(time, 158, 1, 'time');
    this._text(money, 158, 28, 'money');
    this._text(String(status.health).padStart(3, '0'), 158, 56, 'health');
    // Heart follows the reference's health number rather than adding another bar.
    ctx.save(); ctx.translate(75, 62); ctx.beginPath();
    ctx.moveTo(0, -2); ctx.bezierCurveTo(-12, -13, -19, 0, 0, 14);
    ctx.bezierCurveTo(19, 0, 12, -13, 0, -2); ctx.closePath();
    ctx.lineWidth = 2; ctx.strokeStyle = '#14121c'; ctx.fillStyle = '#ec98dc'; ctx.stroke(); ctx.fill(); ctx.restore();
    for (let i = 0; i < 6; i++) {
      const x = 12 + i * 26;
      if (this.tints) {
        // Sheriff's six-point star from font1, cell 30 (ASCII '>').
        this._glyph('>', x - 11, 79, 25, 31, i < status.wanted && !blink ? 'wanted' : 'empty');
      } else {
        ctx.beginPath();
        for (let j = 0; j < 12; j++) {
          const a = -Math.PI/2+j*Math.PI/6, r = j%2 ? 6 : 12;
          ctx.lineTo(x+Math.cos(a)*r, 96+Math.sin(a)*r);
        }
        ctx.closePath(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#080c12';
        ctx.fillStyle = i < status.wanted && !blink ? '#80c9ef' : '#285269'; ctx.fill(); ctx.stroke();
      }
    }
  }
}
