/**
 * Gravador glTF 2.0 binário (GLB) mínimo para cenas do Three.js em Node.
 * Suporta: hierarquia de nós (TRS), malhas reutilizadas por vários nós
 * (mesma geometria + material => mesmo mesh glTF), múltiplas primitivas,
 * POSITION/NORMAL/TEXCOORD_0, índices, materiais PBR com textura PNG
 * embutida e "extras" (userData) por nó.
 *
 * Material: MeshStandardMaterial com userData.texture = { name, png }.
 */
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

export function exportGLB(root, { generator = 'NeonCity test-map builder', copyright = '' } = {}) {
  const json = {
    asset: { version: '2.0', generator, ...(copyright ? { copyright } : {}) },
    scene: 0,
    scenes: [{ name: root.name || 'scene', nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
    images: [],
    textures: [],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  };
  const chunks = [];
  let byteLength = 0;

  const addView = (buf, target) => {
    const byteOffset = byteLength;
    chunks.push(buf);
    byteLength += buf.length;
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      byteLength += pad;
    }
    const view = { buffer: 0, byteOffset, byteLength: buf.length };
    if (target) view.target = target;
    json.bufferViews.push(view);
    return json.bufferViews.length - 1;
  };

  const addAccessor = (typed, type, componentType, target, withMinMax = false) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const view = addView(Buffer.from(buf), target);
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const acc = { bufferView: view, componentType, count: typed.length / size, type };
    if (withMinMax) {
      const min = new Array(size).fill(Infinity);
      const max = new Array(size).fill(-Infinity);
      for (let i = 0; i < typed.length; i++) {
        const k = i % size;
        if (typed[i] < min[k]) min[k] = typed[i];
        if (typed[i] > max[k]) max[k] = typed[i];
      }
      acc.min = min;
      acc.max = max;
    }
    json.accessors.push(acc);
    return json.accessors.length - 1;
  };

  // ---------------------------------------------------------- texturas
  const textureCache = new Map();
  const textureIndex = (tex) => {
    if (textureCache.has(tex.name)) return textureCache.get(tex.name);
    const view = addView(tex.png);
    json.images.push({ name: tex.name, bufferView: view, mimeType: 'image/png' });
    json.textures.push({ sampler: 0, source: json.images.length - 1, name: tex.name });
    const idx = json.textures.length - 1;
    textureCache.set(tex.name, idx);
    return idx;
  };

  // --------------------------------------------------------- materiais
  const materialCache = new Map();
  const materialIndex = (m) => {
    if (materialCache.has(m.uuid)) return materialCache.get(m.uuid);
    const c = m.color;
    const mat = {
      name: m.name || undefined,
      pbrMetallicRoughness: {
        baseColorFactor: [c.r, c.g, c.b, m.opacity ?? 1],
        metallicFactor: m.metalness ?? 0,
        roughnessFactor: m.roughness ?? 1,
      },
    };
    if (m.userData.texture) mat.pbrMetallicRoughness.baseColorTexture = { index: textureIndex(m.userData.texture) };
    if (m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)) {
      const k = m.emissiveIntensity ?? 1;
      mat.emissiveFactor = [Math.min(1, m.emissive.r * k), Math.min(1, m.emissive.g * k), Math.min(1, m.emissive.b * k)];
    }
    if (m.side === 2) mat.doubleSided = true;
    json.materials.push(mat);
    const idx = json.materials.length - 1;
    materialCache.set(m.uuid, idx);
    return idx;
  };

  // ------------------------------------------------------------ malhas
  const geomCache = new Map();
  const primitive = (g, material) => {
    let attrs = geomCache.get(g.uuid);
    if (!attrs) {
      const pos = g.attributes.position.array;
      attrs = { POSITION: addAccessor(new Float32Array(pos), 'VEC3', FLOAT, ARRAY_BUFFER, true) };
      if (g.attributes.normal) attrs.NORMAL = addAccessor(new Float32Array(g.attributes.normal.array), 'VEC3', FLOAT, ARRAY_BUFFER);
      if (g.attributes.uv) attrs.TEXCOORD_0 = addAccessor(new Float32Array(g.attributes.uv.array), 'VEC2', FLOAT, ARRAY_BUFFER);
      let indices;
      if (g.index) {
        const count = g.attributes.position.count;
        const arr = count > 65535 ? new Uint32Array(g.index.array) : new Uint16Array(g.index.array);
        indices = addAccessor(arr, 'SCALAR', count > 65535 ? UNSIGNED_INT : UNSIGNED_SHORT, ELEMENT_ARRAY_BUFFER);
      }
      attrs = { attributes: attrs, indices };
      geomCache.set(g.uuid, attrs);
    }
    const p = { attributes: attrs.attributes, material: materialIndex(material) };
    if (attrs.indices !== undefined) p.indices = attrs.indices;
    return p;
  };

  const meshCache = new Map();
  const meshIndex = (obj) => {
    // Primitivas: o próprio mesh ou um grupo marcado como multi-primitiva.
    const parts = obj.userData.__primitives || [{ geometry: obj.geometry, material: obj.material }];
    const key = parts.map((p) => `${p.geometry.uuid}:${p.material.uuid}`).join('|');
    if (meshCache.has(key)) return meshCache.get(key);
    json.meshes.push({ name: obj.userData.__meshName || undefined, primitives: parts.map((p) => primitive(p.geometry, p.material)) });
    const idx = json.meshes.length - 1;
    meshCache.set(key, idx);
    return idx;
  };

  // ------------------------------------------------------------- nós
  const nodeIndex = (obj) => {
    const n = {};
    json.nodes.push(n);
    const idx = json.nodes.length - 1;
    if (obj.name) n.name = obj.name;
    const p = obj.position, q = obj.quaternion, s = obj.scale;
    if (p.x || p.y || p.z) n.translation = [p.x, p.y, p.z];
    if (q.x || q.y || q.z || q.w !== 1) n.rotation = [q.x, q.y, q.z, q.w];
    if (s.x !== 1 || s.y !== 1 || s.z !== 1) n.scale = [s.x, s.y, s.z];
    if (obj.isMesh || obj.userData.__primitives) n.mesh = meshIndex(obj);
    const extras = {};
    for (const [k, v] of Object.entries(obj.userData)) if (!k.startsWith('__')) extras[k] = v;
    if (Object.keys(extras).length) n.extras = extras;
    if (obj.children.length) n.children = obj.children.map(nodeIndex);
    return idx;
  };
  json.scenes[0].nodes = root.children.map(nodeIndex);

  // Remove listas vazias (glTF exige arrays não vazios quando presentes).
  for (const k of ['images', 'textures', 'materials']) if (json[k].length === 0) delete json[k];
  if (!json.textures) delete json.samplers;

  const bin = Buffer.concat(chunks);
  json.buffers[0].byteLength = bin.length;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const header = Buffer.alloc(12);
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"
  return {
    glb: Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]),
    summary: {
      nodes: json.nodes.length,
      meshes: json.meshes.length,
      primitives: json.meshes.reduce((a, m) => a + m.primitives.length, 0),
      materials: json.materials?.length ?? 0,
      textures: json.textures?.length ?? 0,
      accessors: json.accessors.length,
      binBytes: bin.length,
    },
  };
}
