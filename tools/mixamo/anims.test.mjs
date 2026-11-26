import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { readFBX, writeFBX } from './fbx-binary.mjs';
import { stripFBX, ANIMS } from './import-anims.mjs';
import { PlayerClips } from '../../src/player/anims/PlayerClips.js';
import { RIG_JOINTS, RIG_PARENT } from '../../src/player/anims/MixamoRetarget.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'public/models/anims');
const HAVE = fs.existsSync(path.join(DIR, 'anims.json'));
const skip = HAVE ? false : 'public/models/anims não importado (node tools/mixamo/import-anims.mjs)';

/** Esqueleto com as posições do CharacterModel (mesma interface de joints). */
function character() {
  const POS = { hips: [0, 0.95, 0], spine: [0, 0.08, 0], chest: [0, 0, 0], neck: [0, 0.5, 0], head: [0, 0.1, 0],
    shoulderL: [0.205, 0.41, 0], elbowL: [0, -0.285, 0], wristL: [0, -0.255, 0], shoulderR: [-0.205, 0.41, 0], elbowR: [0, -0.285, 0], wristR: [0, -0.255, 0],
    hipL: [0.095, -0.05, 0], kneeL: [0, -0.42, 0], ankleL: [0, -0.4, 0], hipR: [-0.095, -0.05, 0], kneeR: [0, -0.42, 0], ankleR: [0, -0.4, 0] };
  const root = new THREE.Group(), J = {};
  for (const j of RIG_JOINTS) { J[j] = new THREE.Object3D(); J[j].name = j; J[j].position.fromArray(POS[j]); }
  for (const j of RIG_JOINTS) (RIG_PARENT[j] ? J[RIG_PARENT[j]] : root).add(J[j]);
  const joints = { hips: J.hips, spine: J.spine, chest: J.chest, neck: J.neck, head: J.head,
    arms: { L: { shoulder: J.shoulderL, elbow: J.elbowL, wrist: J.wristL }, R: { shoulder: J.shoulderR, elbow: J.elbowR, wrist: J.wristR } },
    legs: { L: { hip: J.hipL, knee: J.kneeL, ankle: J.ankleL }, R: { hip: J.hipR, knee: J.kneeR, ankle: J.ankleR } } };
  return { root, J, model: { joints } };
}

const fetchDisk = async (url) => {
  const file = path.join(DIR, url.replace(/^anims\//, ''));
  const buf = fs.readFileSync(file);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

let shared = null;
async function loaded() {
  if (shared) return shared;
  const ch = character();
  const clips = new PlayerClips(ch.model);
  assert.equal(await clips.load('anims/', { fetchImpl: fetchDisk }), true, clips.status);
  shared = { ch, clips };
  return shared;
}

function ctx(over = {}) {
  return { mode: 'foot', speed: 0, fwd: 0, side: 0, strafe: false, grounded: true, vy: 0, walkSpeed: 3.3, runSpeed: 7.4,
    hold: null, aim: 0, firing: false, reload: -1, reloadDur: 2, hipsOffsetY: 0, ...over };
}

function step(clips, J, c, sec) {
  for (let t = 0; t < sec; t += 1 / 60) {
    for (const j of RIG_JOINTS) J[j].quaternion.identity(); // pose procedural neutra
    J.hips.position.set(0, 0.95, 0);
    clips.update(1 / 60, c);
    clips.apply(0);
  }
}

const world = (o) => o.getWorldPosition(new THREE.Vector3());

test('FBX binário: leitura e escrita byte a byte, poda de malha e texturas', { skip }, () => {
  const buf = fs.readFileSync(path.join(DIR, 'walk.fbx'));
  assert.ok(writeFBX(readFBX(buf)).equals(buf));
  const r = stripFBX(buf);
  assert.ok(r.limbs >= 30 && r.curves > 100);
  assert.ok(r.buffer.length <= buf.length);
});

test('todas as animações do jogo foram importadas', { skip }, () => {
  const list = JSON.parse(fs.readFileSync(path.join(DIR, 'anims.json'), 'utf8')).clips.map(c => c.name);
  for (const name of Object.values(ANIMS)) assert.ok(list.includes(name), `falta ${name}`);
  for (const name of list) assert.ok(fs.statSync(path.join(DIR, `${name}.fbx`)).size < 1.5 * 1048576, `${name}.fbx ainda tem a malha`);
});

test('a conversão mantém os pés no chão e a cabeça no alto em pé', { skip }, async () => {
  const { ch, clips } = await loaded();
  for (const [c, label] of [[ctx(), 'idle'], [ctx({ speed: 3.3, fwd: 3.3 }), 'walk'], [ctx({ speed: 7.4, fwd: 7.4 }), 'run'], [ctx({ hold: 'pistol', aim: 1 }), 'pistol aim']]) {
    let minFoot = Infinity, minHead = Infinity;
    for (let i = 0; i < 40; i++) {
      step(clips, ch.J, c, 1 / 30);
      ch.root.updateMatrixWorld(true);
      minFoot = Math.min(minFoot, world(ch.J.ankleL).y, world(ch.J.ankleR).y);
      minHead = Math.min(minHead, world(ch.J.head).y);
    }
    assert.ok(minFoot > -0.02 && minFoot < 0.2, `${label}: tornozelo ${minFoot.toFixed(2)}`);
    assert.ok(minHead > 1.35, `${label}: cabeça ${minHead.toFixed(2)}`);
  }
});

test('estados escolhem o clipe certo, com troca suave (crossFadeTo)', { skip }, async () => {
  const { ch, clips } = await loaded();
  const J = ch.J;
  const fades = clips.stats.crossFades;
  const expect = (c, name, sec = 0.4) => { step(clips, J, c, sec); assert.equal(clips.state, name); };
  expect(ctx(), 'idle');
  expect(ctx({ speed: 3.3, fwd: 3.3 }), 'walk');
  expect(ctx({ speed: 7.4, fwd: 7.4 }), 'run');
  assert.ok(clips.base.current.timeScale > 1.3, 'corrida acelerada para os 7,4 m/s do jogo');
  expect(ctx({ speed: 2, fwd: -2, strafe: true }), 'walk_back');
  expect(ctx({ speed: 2, side: 2, strafe: true }), 'strafe_left');
  expect(ctx({ speed: 2, side: -2, strafe: true }), 'strafe_right');
  expect(ctx({ hold: 'pistol' }), 'pistol_idle');
  expect(ctx({ hold: 'long', speed: 3.3, fwd: 3.3 }), 'rifle_walk');
  expect(ctx({ hold: 'long' }), 'rifle_walk_stop', 0.2);
  expect(ctx({ hold: 'long' }), 'rifle_idle', 1.5);
  expect(ctx({ hold: 'knife' }), 'knife_idle');
  expect(ctx({ mode: 'swim', speed: 2 }), 'swim');
  expect(ctx({ mode: 'swim' }), 'tread_water');
  expect(ctx({ mode: 'dead' }), 'dying');
  assert.ok(clips.stats.crossFades > fades + 10);
  // Camada de cima: mira, tiro, recarga, facada, reação a tiro.
  step(clips, J, ctx({ hold: 'pistol', aim: 1 }), 0.4); assert.equal(clips.upperState, 'pistol_aim'); assert.ok(clips.upperWeight > 0.9);
  step(clips, J, ctx({ hold: 'long', aim: 1, firing: true }), 0.2); assert.equal(clips.upperState, 'rifle_fire');
  step(clips, J, ctx({ hold: 'long', reload: 0.2 }), 0.2); assert.equal(clips.upperState, 'rifle_reload');
  clips.events.stab = true; step(clips, J, ctx({ hold: 'knife' }), 0.1); assert.equal(clips.upperState, 'knife_stab');
  step(clips, J, ctx(), 1.2);
  clips.events.hit = true; step(clips, J, ctx(), 0.1); assert.equal(clips.upperState, 'hit');
});

test('dirigindo, sentado ou caído da moto a pose volta a ser só a procedural', { skip }, async () => {
  const { ch, clips } = await loaded();
  step(clips, ch.J, ctx({ speed: 3.3, fwd: 3.3 }), 0.5);
  assert.ok(clips.weight > 0.95);
  step(clips, ch.J, ctx({ mode: 'off' }), 1.0);
  assert.ok(clips.weight < 0.01);
  for (const j of RIG_JOINTS) assert.ok(ch.J[j].quaternion.angleTo(new THREE.Quaternion()) < 0.02, `${j} ficou fora da pose procedural`);
  assert.equal(ch.J.hips.position.z, 0);
});
