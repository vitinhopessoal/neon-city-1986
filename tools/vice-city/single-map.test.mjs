import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveManager } from '../../src/save/SaveManager.js';
import { MapManager } from '../../src/maps/MapManager.js';

function fixture({ activeId = 'vice-city', activationFails = false } = {}) {
  const restored = { activations: [], economy: [], positions: [] };
  const registry = new Map([['vice-city', { id: 'vice-city', label: 'VICE CITY' }]]);
  const game = {
    maps: {
      registry, activeId, defaultId: 'vice-city',
      list: () => [...registry.values()],
      async activate(id) {
        restored.activations.push(id);
        if (activationFails) return false;
        this.activeId = id;
        return true;
      },
    },
    vehicles: { interaction: {} },
    properties: {
      defs: [], garageIds: () => [], deserialize() {},
      placePlayerSafely: (...args) => restored.positions.push(args),
    },
    economy: { deserialize: value => restored.economy.push(value) },
    inventory: { deserialize() {} },
    world: { timeOfDay: 'morning' },
    player: { status: { setHealth() {}, setWanted() {} } },
    mapEnv: { spawnPoint: { x: 263.2, y: 9.86, z: 1247.9, yaw: 0 } },
  };
  const manager = Object.create(SaveManager.prototype);
  manager.game = game;
  const save = { map: 'vice-city', gameId: 'old-save', playTime: 120,
    economy: { money: 850 }, inventory: {}, time: { minutes: 540 },
    player: { x: -359, y: 20.657, z: -38, yaw: 1, health: 80 } };
  return { game, manager, save, restored };
}

test('saves from removed maps recover at the Vice City spawn and retain progress', async () => {
  for (const map of ['sunset-beach', 'test-city', 'vice-city-ocean']) {
    const { game, manager, save, restored } = fixture({ activeId: null });
    save.map = map;
    const result = await manager.apply(save);
    assert.deepEqual(restored.activations, ['vice-city']);
    assert.deepEqual(restored.positions, [[263.2, 9.86, 1247.9, 0]]);
    assert.deepEqual(restored.economy, [{ money: 850 }]);
    assert.equal(manager.gameId, 'old-save');
    assert.equal(game.playTime, 120);
    assert.match(result.warnings[0], /VICE CITY/);
    assert.equal(save.map, map, 'the original stored save is left intact');
  }
});

test('current Vice City saves preserve their position, including elevated streets', async () => {
  const { manager, save, restored } = fixture();
  const result = await manager.apply(save);
  assert.deepEqual(restored.activations, []);
  assert.deepEqual(restored.positions, [[-359, 20.657, -38, 1]]);
  assert.deepEqual(result.warnings, []);
});

test('a missing local city cannot partially restore a save into an unloaded world', async () => {
  const { manager, save, restored } = fixture({ activeId: null, activationFails: true });
  save.map = 'sunset-beach';
  await assert.rejects(manager.apply(save), /carregar o mapa/);
  assert.deepEqual(restored.activations, ['vice-city']);
  assert.deepEqual(restored.economy, []);
  assert.deepEqual(restored.positions, []);
});

test('removed map IDs cannot activate through the map manager', async () => {
  const map = Object.create(MapManager.prototype);
  map.registry = new Map();
  map.activeId = 'vice-city';
  map.register({ id: 'vice-city', label: 'VICE CITY' });
  assert.equal(map.defaultId, 'vice-city');
  for (const id of ['sunset-beach', 'test-city', 'vice-city-ocean']) {
    await assert.rejects(map.activate(id), /Mapa não registrado/);
  }
  assert.equal(await map.activate('vice-city'), true);
});
