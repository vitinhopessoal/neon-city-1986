/**
 * Gravador GLB para uma única malha com pele (skin): POSITION, NORMAL,
 * TEXCOORD_0, JOINTS_0, WEIGHTS_0, índices, um material PBR com textura
 * base (e opcionalmente metallicRoughness) e um esqueleto de nós.
 */
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

export function writeSkinnedGLB({
  name, positions, normals, uvs, joints, weights, indices,
  bones, parents, bindLocal, inverseBind, baseColorPNG, metalRoughPNG,
  metallicFactor = 0, roughnessFactor = 0.8, rootExtras = {}, generator = 'NeonCity protagonist pipeline',
}) {
  const json = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
    images: [],
    textures: [],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    skins: [],
  };
  const chunks = [];
  let len = 0;
  const view = (buf, target) => {
    const byteOffset = len;
    chunks.push(buf);
    len += buf.length;
    const pad = (4 - (len % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); len += pad; }
    const v = { buffer: 0, byteOffset, byteLength: buf.length };
    if (target) v.target = target;
    json.bufferViews.push(v);
    return json.bufferViews.length - 1;
  };
  const accessor = (typed, type, componentType, target, minmax = false, normalized = false) => {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const a = {
      bufferView: view(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), target),
      componentType, count: typed.length / size, type,
    };
    if (normalized) a.normalized = true;
    if (minmax) {
      a.min = new Array(size).fill(Infinity);
      a.max = new Array(size).fill(-Infinity);
      for (let i = 0; i < typed.length; i++) {
        const k = i % size;
        a.min[k] = Math.min(a.min[k], typed[i]);
        a.max[k] = Math.max(a.max[k], typed[i]);
      }
    }
    json.accessors.push(a);
    return json.accessors.length - 1;
  };
  const image = (png, nm) => {
    json.images.push({ name: nm, mimeType: 'image/png', bufferView: view(png) });
    json.textures.push({ sampler: 0, source: json.images.length - 1, name: nm });
    return json.textures.length - 1;
  };

  const attributes = {
    POSITION: accessor(positions, 'VEC3', 5126, ARRAY_BUFFER, true),
    NORMAL: accessor(normals, 'VEC3', 5126, ARRAY_BUFFER),
    TEXCOORD_0: accessor(uvs, 'VEC2', 5126, ARRAY_BUFFER),
    JOINTS_0: accessor(joints, 'VEC4', 5121, ARRAY_BUFFER),
    WEIGHTS_0: accessor(weights, 'VEC4', 5126, ARRAY_BUFFER),
  };
  const big = positions.length / 3 > 65535;
  const ind = accessor(big ? Uint32Array.from(indices) : Uint16Array.from(indices), 'SCALAR', big ? 5125 : 5123, ELEMENT_ARRAY_BUFFER);

  const pbr = { baseColorFactor: [1, 1, 1, 1], metallicFactor, roughnessFactor };
  if (baseColorPNG) pbr.baseColorTexture = { index: image(baseColorPNG, `${name}_base`) };
  if (metalRoughPNG) pbr.metallicRoughnessTexture = { index: image(metalRoughPNG, `${name}_mr`) };
  json.materials.push({ name: `${name}_mat`, pbrMetallicRoughness: pbr });
  json.meshes.push({ name: `${name}_mesh`, primitives: [{ attributes, indices: ind, material: 0 }] });

  // Nós: 0 raiz, 1 malha, 2.. ossos.
  const boneNode = (i) => 2 + i;
  json.nodes.push({ name, children: [1, boneNode(0)], extras: rootExtras });
  json.nodes.push({ name: `${name}_mesh`, mesh: 0, skin: 0 });
  bones.forEach((b, i) => {
    const n = { name: b, translation: bindLocal[i].t, rotation: bindLocal[i].r };
    const kids = parents.map((p, k) => (p === i ? boneNode(k) : -1)).filter((k) => k >= 0);
    if (kids.length) n.children = kids;
    json.nodes.push(n);
  });
  json.skins.push({
    name: `${name}_skin`,
    joints: bones.map((_, i) => boneNode(i)),
    skeleton: boneNode(0),
    inverseBindMatrices: accessor(inverseBind, 'MAT4', 5126),
  });
  if (!json.images.length) { delete json.images; delete json.textures; delete json.samplers; }

  json.buffers[0].byteLength = len;
  const bin = Buffer.concat(chunks);
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}
