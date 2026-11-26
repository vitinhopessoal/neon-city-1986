import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ProtagonistModel, PROTAGONIST_BONES } from '../../src/player/ProtagonistModel.js';
import { Player } from '../../src/player/Player.js';
import { WeaponInventory } from '../../src/weapons/WeaponInventory.js';
import { buildWeaponModel } from '../../src/weapons/WeaponModels.js';

test('user GLB loads with all bones and weapon attachment points', async () => {
  const bytes = await readFile(new URL('../../public/models/protagonist/protagonist.glb', import.meta.url));
  const loader = new GLTFLoader();
  // Node has no image decoder: retain actual mesh/skin/rig, stub only texture decoding.
  loader.register(() => ({ name: 'asset-test-texture', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const visual = new ProtagonistModel(gltf);
  assert.equal(visual.bones.length, PROTAGONIST_BONES.length);
  assert.ok(visual.triangles > 20000);
  const player = new Player({ scene: new THREE.Scene(), world: { collision: {} }, config: {} });
  visual.configureSeat(player.animator.hipsBaseY);
  player.scene.add(visual.root);
  player.visual = visual;
  assert.equal(player.setModelMode('glb'), 'glb');
  for (const name of ['wristR', 'wristL', 'hips', 'chest']) {
    const bone = player.getAttachBone(name);
    assert.ok(bone.isBone, name);
    bone.updateWorldMatrix(true, false);
    assert.ok(bone.matrixWorld.elements.every(Number.isFinite), name);
  }
  assert.ok(player.model.bodyMeshes.every(m => !m.visible));
  assert.equal(player.setModelMode('original'), 'original');
  assert.ok(player.model.bodyMeshes.every(m => m.visible));
  visual.dispose();
  player.model.dispose();
});

test('the nine firearms and the knife remain owned, selectable and generate valid models', () => {
  const inv = new WeaponInventory();
  inv.grantAll();
  assert.equal(inv.list().length, 10);
  assert.equal(inv.list().filter(e => e.def.mode !== 'melee').length, 9);
  assert.equal(inv.get('knife')?.def.hold, 'knife');
  assert.equal(inv.bySlot(8).length, 2);
  for (const entry of inv.list()) {
    assert.ok(entry.loaded > 0);
    if (entry.def.mode !== 'melee') assert.ok(inv.reserve[entry.def.category] > 0);
    const model = buildWeaponModel(entry.def);
    assert.ok(model.triangles > 0, entry.def.id);
    assert.ok(model.anchors.grip.toArray().every(Number.isFinite));
    const box = new THREE.Box3().setFromObject(model.root);
    assert.ok(!box.isEmpty());
    assert.ok(box.min.toArray().every(Number.isFinite));
    assert.ok(box.max.toArray().every(Number.isFinite));
    model.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }
});
