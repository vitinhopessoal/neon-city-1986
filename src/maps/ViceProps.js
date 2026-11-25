import * as THREE from 'three';
import { DestructionSystem, BREAKABLE_PROFILES, fracturePart } from '../world/DestructionSystem.js';

/**
 * Objetos pequenos do Vice City convertido que carros e motos derrubam: postes,
 * hidrantes, bancos, lixeiras, caixas, vasos, árvores pequenas... Casas, prédios
 * e árvores grandes continuam estáticos (não entram na lista ou passam do limite
 * de tamanho).
 *
 * O conversor grava cada instância do IPL como um nó do GLB (extras.vcModel e a
 * matriz), mas a colisão (VCC1) é uma lista de faces sem dono. Aqui:
 *  1) extractProps() tira os nós quebráveis da cena ANTES do ImportedMap fundir
 *     tudo em lotes estáticos (senão não daria para esconder um poste sozinho);
 *  2) buildProps() desenha as instâncias em InstancedMesh por modelo e região,
 *     associa a cada objeto as faces/esferas de COL que ficam dentro da sua caixa
 *     (são removidas quando ele quebra) e registra tudo no DestructionSystem, que
 *     já resolve batida, destroços, água do hidrante e tiros.
 * Nada é reconvertido: funciona com a pasta dev-maps/vice-city existente.
 */
export const PROP_RULES = [
  [/^(mlamppost|lamppost\d+|streetlamp\d+|doublestreetlght\d+|lampost_coast)$/, 'streetLamp'],
  [/^telgrphpole\d*$/, 'pole'],
  [/^bollardlight$/, 'viceBollard'],
  [/^(parkbench\d+|gardenbench\w*|stonebench\d+)$/, 'viceBench'],
  [/^(fire_hydrant|miamifirehyd)$/, 'viceHydrant'],
  [/^(wastebin|bin\d+|rcyclbank\d+)$/, 'viceBin'],
  [/^parkingmeter\w*$/, 'viceMeter'],
  [/^(newstandnew\d+|newsstand\d+|papermachn\d+)$/, 'viceNews'],
  [/^m?postbox\d+$/, 'mailbox'],
  [/^(phonebooth\d+|miamphon)$/, 'vicePhone'],
  [/^(bussign\d+|noparkingsign\d+)$/, 'viceSign'],
  [/^(cardboardbox\d*|woodenbox|blackbag\d+|junk_tyre|beachball)$/, 'box'],
  [/^barrel\d+$/, 'barrel'],
  [/^(trafficcone|barrierm)$/, 'barrier'],
  [/^dump\d+$/, 'dumpster'],
  [/^(kb_chr_tbl_test|chairsntable\w*|cl_tablesetlrg|cl_tblesetsml|parktable\d+|kb_canopy_test)$/, 'table'],
  [/^lounge_wood_\w+$/, 'viceLounger'],
  [/^(kb_pot_\d+|pot_\d+|kb_planter\+bush\d*|kb_planterbush\d+)$/, 'pot'],
  // Árvores: só as pequenas (palmeirinhas, arbustos). As grandes ficam acima do limite.
  [/^(veg_palmkb\d+|new_bushsm|rose_bush\d+)$/, 'smallTree'],
];
/** Altura máxima (m) de uma árvore que um veículo derruba. */
export const SMALL_TREE_MAX_HEIGHT = 6.5;
const MAX_HEIGHT = 14, MAX_SPAN = 4.5;
const TILE = 400; // instâncias agrupadas por região: culling por distância e frustum

export function propType(model) {
  for (const [pattern, type] of PROP_RULES) if (pattern.test(model)) return type;
  return null;
}

/** Tipo quebrável para um objeto com estas dimensões no mundo, ou null (fica estático). */
export function classifyProp(model, size) {
  const type = propType(model);
  if (!type || !BREAKABLE_PROFILES[type]) return null;
  if (size.y > MAX_HEIGHT || Math.max(size.x, size.z) > MAX_SPAN) return null;
  if (type === 'smallTree' && size.y > SMALL_TREE_MAX_HEIGHT) return null;
  return type;
}

const _box = new THREE.Box3(), _size = new THREE.Vector3(), _inv = new THREE.Matrix4();

/**
 * Remove da cena (raiz com um grupo por setor) os nós dos objetos quebráveis e
 * devolve as instâncias: { model, type, matrix, meshes, box }.
 */
export function extractProps(sceneRoot) {
  sceneRoot.updateMatrixWorld(true);
  const instances = [];
  for (const sector of [...sceneRoot.children]) {
    const byKey = new Map();
    for (const node of sector.children) {
      const model = node.userData?.vcModel;
      const type = model ? propType(model) : null;
      if (!type) continue;
      const meshes = [];
      node.traverse(o => { if (o.isMesh) meshes.push(o); });
      if (!meshes.length) continue;
      // Um objeto com várias partes (atomics) vira vários nós com a mesma matriz.
      const e = node.matrixWorld.elements;
      const key = `${model}|${e[12].toFixed(3)}|${e[13].toFixed(3)}|${e[14].toFixed(3)}`;
      let inst = byKey.get(key);
      if (!inst) {
        inst = { model, type, matrix: node.matrixWorld.clone(), nodes: [], meshes: [], box: new THREE.Box3() };
        byKey.set(key, inst);
      }
      inst.nodes.push(node);
      for (const mesh of meshes) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        inst.box.union(_box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
        inst.meshes.push(mesh);
      }
    }
    for (const inst of byKey.values()) {
      inst.type = classifyProp(inst.model, inst.box.getSize(_size));
      if (!inst.type) continue;
      for (const node of inst.nodes) node.removeFromParent();
      delete inst.nodes;
      instances.push(inst);
    }
  }
  return instances;
}

/**
 * Faces/esferas de COL do objeto: inteiramente dentro da sua caixa (com folga) e
 * acima do degrau que as rodas já sobem — o chão e o meio-fio em volta ficam.
 */
function ownColliders(collision, box) {
  const m = 0.3, base = box.min.y;
  const minX = box.min.x - m, maxX = box.max.x + m, minZ = box.min.z - m, maxZ = box.max.z + m;
  const minY = base - 0.3, maxY = box.max.y + 0.5;
  const inside = (x, y, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ && y >= minY && y <= maxY;
  const found = [];
  for (const c of [...collision._gather(minX, minZ, maxX, maxZ)]) {
    if (c.destructible || c.tags?.includes('boundary')) continue;
    if (c.type === 'tri') {
      const v = c.vertices;
      if (!inside(v[0], v[1], v[2]) || !inside(v[3], v[4], v[5]) || !inside(v[6], v[7], v[8])) continue;
      if (c.walkable ? c.minY < base + 0.15 : c.maxY < base + 0.35) continue;
      found.push(c);
    } else if (c.type === 'sphere') {
      if (!inside(c.cx, c.cy, c.cz) || c.cy + c.radius < base + 0.35) continue;
      found.push(c);
    }
  }
  return found;
}

/**
 * Cria o sistema de destruição do mapa com as instâncias extraídas.
 * parent: raiz visual do mapa; collision: TriangleCollisionSystem já preenchido.
 */
export function buildProps(parent, collision, instances, { respawn = { delay: 120, distance: 160 } } = {}) {
  const destruction = new DestructionSystem(parent, collision, { maxFragments: 160, respawn });
  const templates = new Map();
  const pools = new Map();
  const stats = { instances: 0, models: 0, pools: 0, colliders: 0, vehicleOnly: 0, byType: {} };
  for (const inst of instances) {
    // Mesmo modelo em setores diferentes: geometrias idênticas (o conversor gera a
    // malha uma vez por modelo); a primeira encontrada é a usada por todas as instâncias.
    const signature = inst.model + '|' + inst.meshes.map(m => `${m.geometry.attributes.position.count}:${m.material.uuid}`).join(',');
    let template = templates.get(signature);
    if (!template) {
      _inv.copy(inst.matrix).invert();
      const prims = inst.meshes.map(mesh => ({ geometry: mesh.geometry, material: mesh.material, local: _inv.clone().multiply(mesh.matrixWorld) }));
      const fragments = prims.map(p => {
        const local = p.geometry.clone().applyMatrix4(p.local);
        const part = fracturePart(local, p.material);
        local.dispose();
        destruction.ownedGeometries.add(part.geometry);
        return part;
      });
      template = { id: templates.size, prims, fragments };
      templates.set(signature, template);
    }
    const tile = `${Math.floor(inst.matrix.elements[12] / TILE)},${Math.floor(inst.matrix.elements[14] / TILE)}`;
    inst.bindings = template.prims.map((prim, i) => {
      const key = `${template.id}|${i}|${tile}`;
      let pool = pools.get(key);
      if (!pool) { pool = { prim, matrices: [] }; pools.set(key, pool); }
      pool.matrices.push(new THREE.Matrix4().multiplyMatrices(inst.matrix, prim.local));
      return { pool, index: pool.matrices.length - 1 };
    });
    inst.template = template;
  }
  for (const pool of pools.values()) {
    const { geometry, material } = pool.prim;
    const mesh = new THREE.InstancedMesh(geometry, material, pool.matrices.length);
    pool.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'vice-props';
    parent.add(mesh);
    pool.mesh = mesh;
  }
  for (const [i, inst] of instances.entries()) {
    const id = `vc_prop_${i}_${inst.model}`;
    let colliders = ownColliders(collision, inst.box);
    if (!colliders.length) {
      // Sem COL própria (arbustos): só os veículos o atingem; a pé continua atravessável.
      const b = inst.box;
      const ghost = collision.addAABB({ id: `${id}_vehicle`, ownerId: id, minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z,
        minY: b.min.y, maxY: b.max.y, solid: true, walkable: false, cameraBlocker: false });
      ghost.vehicleOnly = true;
      colliders = [ghost];
      stats.vehicleOnly++;
    }
    for (const c of colliders) c.ownerId ??= id;
    const bindings = inst.bindings.map(b => ({ mesh: b.pool.mesh, index: b.index }));
    destruction.register({ id, type: inst.type, matrix: inst.matrix, colliders, bindings, fragments: inst.template.fragments });
    stats.instances++;
    stats.colliders += colliders.length;
    stats.byType[inst.type] = (stats.byType[inst.type] || 0) + 1;
  }
  stats.models = templates.size;
  stats.pools = pools.size;
  return { destruction, stats };
}
