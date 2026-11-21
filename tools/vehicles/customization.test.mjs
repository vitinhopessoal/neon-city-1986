import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../../src/world/World.js';
import { createCoastalCity } from '../../src/world/districts/CoastalCity.js';
import { VehicleDamage } from '../../src/vehicles/VehicleDamage.js';
import { SPECS } from '../../src/vehicles/VehicleFactory.js';
import { PARTS, PAINTS, defaultConfig, isCompatible, sanitizeConfig } from '../../src/vehicles/customization/CustomizationCatalog.js';
import { computeHandling, applyPerformance, statsFor } from '../../src/vehicles/customization/VehiclePerformance.js';
import { applyAppearance, partSummary, topY } from '../../src/vehicles/customization/VehicleAppearance.js';

function canvasStub() {
  const c = { width: 1, height: 1, classes: new Set(), appendChild() {}, remove() {} };
  c.classList = { add: s => c.classes.add(s), remove: s => c.classes.delete(s), toggle() {} };
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({ canvas: c, measureText: t => ({ width: String(t).length * 12 }), createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }, { get: (o, k) => k in o ? o[k] : () => {} });
  c.getContext = () => ctx; return c;
}

test('catálogo: compatibilidade por modelo e regras entre peças', () => {
  assert.equal(isCompatible('spoiler', 'wing', 'sports'), true);
  assert.equal(isCompatible('spoiler', 'wing', 'sedan'), false, 'asa alta só no NEON GT');
  assert.equal(isCompatible('spoiler', 'wing', 'convertible'), false);
  assert.equal(isCompatible('ride', 'high', 'sports'), false, 'elevada só no sedã');
  assert.equal(isCompatible('bumper', 'retro', 'sports'), false);
  assert.equal(isCompatible('spoiler', 'wing', 'sports', { bumper: 'retro' }), false, 'regra entre peças');
  for (const cat of Object.keys(PARTS)) for (const type of Object.keys(SPECS)) {
    const stock = PARTS[cat].options[0];
    assert.equal(isCompatible(cat, stock.id, type), true, `opção original de ${cat} serve em ${type}`);
  }
  const s = sanitizeConfig({ wheels: 'inexistente', engine: 99, paint: 'ocean_blue', spoiler: 'wing' }, { type: 'sedan', appearance: { color: 0xffffff } });
  assert.equal(s.wheels, 'stock'); assert.equal(s.engine, 0); assert.equal(s.paint, 'ocean_blue'); assert.equal(s.spoiler, 'none', 'peça incompatível vinda de save é descartada');
});

test('desempenho: melhorias alteram o manuseio real e preservam a identidade dos carros', () => {
  const full = { ...defaultConfig(null), engine: 3, trans: 2, brakes: 2, susp: 2, tires: 'grip', armor: 2 };
  const gt = computeHandling('sports', full).handling, sedanFull = computeHandling('sedan', full).handling;
  const gt0 = SPECS.sports.handling;
  assert.ok(gt.engineForce > gt0.engineForce * 1.4, 'motor + transmissão aumentam a força');
  assert.ok(gt.maxSpeed > gt0.maxSpeed && gt.maxSpeed < gt0.maxSpeed * 1.2, 'velocidade máxima sobe com limite');
  assert.ok(gt.brakeForce > gt0.brakeForce, 'freios melhores');
  assert.ok(gt.rollGain < gt0.rollGain, 'suspensão reduz rolagem');
  assert.ok(gt.maxSpeed > sedanFull.maxSpeed && gt.engineForce / gt.mass > sedanFull.engineForce / sedanFull.mass, 'NEON GT continua acima do PALM SEDAN com tudo instalado');
  assert.equal(computeHandling('sports', defaultConfig(null)).handling.engineForce, gt0.engineForce, 'sem peças = fábrica');
  const a = statsFor('sports', defaultConfig(null)), b = statsFor('sports', full);
  for (const k of ['speed', 'accel', 'brake', 'control', 'resist']) assert.ok(b[k] >= a[k], `barra ${k} reflete a melhoria`);
  assert.ok(SPECS.sports.handling.engineForce === gt0.engineForce, 'SPECS de fábrica nunca são alterados');
});

test('aparência: peças reais no modelo, materiais compartilhados intactos, sem acúmulo de malhas', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => canvasStub() };
  let world;
  try {
    const scene = new THREE.Scene();
    world = new World({ scene, renderer: {}, quality: { pointLights: false, decorDensity: 0.3 } });
    world.loadDistrict(createCoastalCity());
    const F = world.vehicleFactory;
    const a = F.create('sports', { id: 'test_a', color: 0xf2eee6, stripe: 0xff5fa8, plate: 'A 1' });
    const b = F.create('sports', { id: 'test_b', color: 0xf2eee6, plate: 'B 2' });
    a.damage = new VehicleDamage(a); b.damage = new VehicleDamage(b);
    const glassBefore = F.m.glass.opacity, rimMat = F.m.rim, seatColor = F.m.seatDark.color.getHex();
    const cfg = { ...defaultConfig(a), paint: 'ocean_blue', finish: 'metallic', wheels: 'mesh', tires: 'lowpro', ride: 'low', bumper: 'aero', skirts: 'aero', spoiler: 'wing', hood: 'vents', exhaust: 'dual', lights: 'sport', tint: 'dark', interior: 'red', paint2: 'neon_violet' };
    applyAppearance(a, cfg, F);
    assert.equal(a.mats.paint.color.getHex(), PAINTS.find(p => p.id === 'ocean_blue').hex);
    assert.equal(b.mats.paint.color.getHex(), 0xf2eee6, 'outro carro do mesmo modelo não muda');
    assert.equal(F.m.glass.opacity, glassBefore, 'vidro compartilhado intacto');
    assert.equal(F.m.seatDark.color.getHex(), seatColor, 'bancos compartilhados intactos');
    assert.equal(b.wheels[0].spin.children[1].material, rimMat, 'aros do outro carro intactos');
    assert.notEqual(a.wheels[0].spin.children[1].geometry, b.wheels[0].spin.children[1].geometry, 'aro novo instalado');
    const parts = partSummary(a);
    for (const p of ['bumperAero', 'skirtAero', 'spoilerWing', 'hoodVents', 'exhaustDual']) assert.ok(parts.some(n => n.includes(p)), `peça ${p} visível no modelo`);
    assert.equal(a.body.userData.rideOffset, -0.05);
    assert.ok(a.spec.height < SPECS.sports.height, 'altura (e colisor) rebaixados');
    const meshCount = () => { let n = 0; a.root.traverse(o => { if (o.isMesh) n++; }); return n; };
    const n1 = meshCount();
    for (let i = 0; i < 20; i++) applyAppearance(a, { ...cfg, spoiler: i % 2 ? 'lip' : 'wing' }, F);
    applyAppearance(a, cfg, F);
    assert.equal(meshCount(), n1, 'trocar peças repetidamente não acumula malhas');
    // Prévia cancelada: voltar à configuração original restaura o carro.
    applyAppearance(a, defaultConfig(b), F);
    assert.equal(partSummary(a).length, 0); assert.equal(a.body.userData.rideOffset, 0); assert.equal(a.spec.height, SPECS.sports.height);
    // Aerofólio fica sobre a tampa traseira (não flutua nem atravessa).
    const yTop = topY(SPECS.sports, -2.0);
    assert.ok(yTop > 0.6 && yTop < 1.0);
    // Desempenho aplicado só neste carro; resistência integrada ao sistema de danos.
    applyPerformance(a, { ...cfg, engine: 2, armor: 2 });
    assert.ok(a.spec.handling.engineForce > b.spec.handling.engineForce);
    const d0 = b.damage.applyImpact(12); b.damage.cooldown = 0;
    const d1 = a.damage.applyImpact(12);
    assert.ok(d1 < d0 && d1 >= d0 * 0.69, 'resistência reduz o dano sem tornar indestrutível');
    F.dispose(a); F.dispose(b);
  } finally {
    world?.destruction.dispose(); world?.lib.dispose();
    globalThis.document = oldDocument;
  }
});
