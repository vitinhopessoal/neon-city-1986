import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { PlayerStatus, formatClock, formatMoney } from '../../src/player/PlayerStatus.js';
import { InputManager, DEFAULT_BINDINGS } from '../../src/core/InputManager.js';
import { readFile } from 'node:fs/promises';

test('the supplied font, radar frame and every displayed weapon icon are valid bundled PNGs', async () => {
  for (const name of ['font1', 'radardisc', 'fist', 'colt45', 'buddyshot', 'm4', 'ingramsl', 'tec9']) {
    const png = await readFile(new URL(`../../public/hud/vice/${name}.png`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const dimension = name === 'font1' ? 512 : name === 'radardisc' ? 128 : 64;
    assert.equal(png.readUInt32BE(16), dimension);
    assert.equal(png.readUInt32BE(20), dimension);
  }
});

test('health and wallet reflect gameplay, clamp invalid amounts and preserve balance on failed purchases', () => {
  const s = new PlayerStatus();
  assert.equal(s.health, 100); assert.equal(s.money, 660); assert.equal(s.wanted, 0);
  s.damage(25); assert.equal(s.health, 75);
  s.damage(-10); s.damage(NaN); assert.equal(s.health, 75);
  s.damage(1000); assert.equal(s.health, 0);
  s.setHealth(300); assert.equal(s.health, 100);
  assert.equal(s.spendMoney(700), false); assert.equal(s.money, 660);
  assert.equal(s.spendMoney(-3), false); assert.equal(s.spendMoney(1.5), false);
  assert.equal(s.spendMoney(60), true); assert.equal(s.money, 600);
  s.addMoney(200); assert.equal(s.money, 800);
  s.addMoney(Infinity); assert.equal(s.money, 800);
  s.addMoney(1e12); assert.equal(formatMoney(s.money), '$99999999');
  s.addMoney(-1e12); assert.equal(formatMoney(s.money), '$00000000');
});

test('clock matches the reference, wraps midnight and tracks manual time presets', () => {
  const s = new PlayerStatus();
  assert.equal(formatClock(s.minutes), '18:39');
  s.update(0.5); assert.equal(formatClock(s.minutes), '18:39');
  s.update(0.5); assert.equal(formatClock(s.minutes), '18:40');
  s.minutes = 1439; s.update(1); assert.equal(formatClock(s.minutes), '00:00');
  for (const [preset, time] of [['morning', '09:00'], ['sunset', '18:39'], ['night', '23:00']]) {
    s.setTimePreset(preset); assert.equal(formatClock(s.minutes), time);
  }
});

test('six wanted levels respond to crimes and decay only after a quiet interval', () => {
  const s = new PlayerStatus();
  s.reportCrime(0.5); assert.equal(s.wanted, 1);
  s.update(29); assert.equal(s.wanted, 1);
  s.reportCrime(4); assert.equal(s.wanted, 2);
  s.update(1); assert.equal(s.wanted, 2);
  s.reportCrime(100); assert.equal(s.wanted, 6);
  s.update(30); assert.equal(s.wanted, 5);
  s.update(150); assert.equal(s.wanted, 0);
  s.setWanted(-3); assert.equal(s.wanted, 0);
  s.setWanted(10); assert.equal(s.wanted, 6);
});

test('F3 prevents browser find, emits once per press, and has no binding conflict', () => {
  const input = Object.create(InputManager.prototype);
  Object.assign(input, { enabled: true, _down: new Set(), _pressed: new Set(), _codeToActions: new Map([['F3', ['toggleHUD']]]) });
  let prevented = 0;
  const event = { code: 'F3', repeat: false, preventDefault: () => prevented++ };
  input._onKeyDown(event); assert.equal(prevented, 1); assert.equal(input.wasPressed('toggleHUD'), true);
  input.endFrame(); input._onKeyDown({ ...event, repeat: true });
  assert.equal(input.wasPressed('toggleHUD'), false);
  input._onKeyUp(event); input._onKeyDown(event); assert.equal(input.wasPressed('toggleHUD'), true);
  assert.deepEqual(Object.entries(DEFAULT_BINDINGS).filter(([, keys]) => keys.includes('F3')).map(([key]) => key), ['toggleHUD']);
});

test('primary HUD updates values and all weapon categories; F3 retains the radar and status node', async () => {
  const oldDocument = globalThis.document, oldImage = globalThis.Image;
  const operations = [];
  const context = new Proxy({}, { get: (_obj, key) => (...args) => operations.push([key, ...args]) });
  class Element {
    constructor() {
      this.children = []; this.style = {}; this.attrs = {}; this.classes = new Set();
      this.classList = { toggle: (c, on) => { if (on ?? !this.classes.has(c)) this.classes.add(c); else this.classes.delete(c); }, add: c => this.classes.add(c), remove: c => this.classes.delete(c) };
    }
    set className(value) { this.classes = new Set(value.split(' ')); }
    get className() { return [...this.classes].join(' '); }
    set innerHTML(value) { this.html = value; }
    querySelector(selector) { return this.nodes?.[selector] ?? (this.nodes ??= {}, this.nodes[selector] = new Element()); }
    querySelectorAll() { return []; }
    appendChild(node) { this.children.push(node); }
    getContext() { return context; }
    setAttribute(key, value) { this.attrs[key] = value; }
  }
  globalThis.document = { createElement: () => new Element() };
  globalThis.Image = class {};
  let server;
  try {
    server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
    const { HUD } = await server.ssrLoadModule('/src/ui/HUD.js');
    const { weaponIcon } = await server.ssrLoadModule('/src/ui/StatusHUD.js');
    const hud = new HUD(new Element()), status = new PlayerStatus();
    const radar = new Element(); hud.el.appendChild(radar);
    hud.status.update(status, { name: 'BREN TEN', category: 'pistol' }, true);
    assert.match(hud.status.canvas.attrs['aria-label'], /Dinheiro \$00000660.*Saúde 100.*0 de 6/);
    assert.match(hud.status.icon.src, /colt45.png$/);
    // Exercise the real supplied font rendering path, not just the fallback.
    hud.status.font.onload();
    assert.ok(operations.filter(([op]) => op === 'drawImage').length > 180);
    status.damage(20); status.reportCrime(5); status.addMoney(100);
    hud.status.update(status, null, false);
    assert.match(hud.status.canvas.attrs['aria-label'], /\$00000760.*Saúde 80.*2 de 6/);
    assert.match(hud.status.icon.src, /fist.png$/);
    const before = operations.length; hud.status.update(status, null, false);
    assert.equal(operations.length, before, 'unchanged HUD does not repaint each frame');
    for (const [def, expected] of [[{ category: 'shotgun' }, 'buddyshot'], [{ category: 'carbine' }, 'm4'], [{ category: 'compact', id: 'mac10' }, 'ingramsl'], [{ category: 'compact', id: 'kg99' }, 'tec9']]) {
      assert.equal(weaponIcon(def), expected);
    }
    assert.equal(hud.extrasHidden, true); assert.equal(hud.toggleExtras(), true); assert.equal(hud.toggleExtras(), false);
    assert.ok(hud.el.children.includes(hud.status.el)); assert.ok(hud.el.children.includes(radar));
    assert.ok(hud.el.classes.has('hud-extras-hidden'));
  } finally {
    await server?.close(); globalThis.document = oldDocument; globalThis.Image = oldImage;
  }
});
