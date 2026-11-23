import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { TriangleCollisionSystem } from '../../src/physics/TriangleCollisionSystem.js';

const folder = resolve('dev-maps/vice-city');
const report = JSON.parse(await readFile(resolve(folder, 'conversion-report.json'), 'utf8'));
const collision = new TriangleCollisionSystem();
const sectors = [];
const checkedImages = new Set();
const started = performance.now();
for (const record of report.sectors) {
  const manifest = JSON.parse(await readFile(resolve(folder, record.sourceSector + '.manifest.json'), 'utf8'));
  Object.assign(record, manifest);
  const buffer = await readFile(resolve(folder, manifest.file));
  const length = buffer.readUInt32LE(12), gltf = JSON.parse(buffer.subarray(20, 20 + length));
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(8) !== buffer.byteLength) throw new Error('Invalid GLB '+manifest.file);
  let renderedTriangles = 0;
  const meshTriangles = gltf.meshes.map(mesh => mesh.primitives.reduce((sum, primitive) => {
    const indices = gltf.accessors[primitive.indices], positions = gltf.accessors[primitive.attributes.POSITION];
    if (indices.count % 3 || positions.min.some(v => !Number.isFinite(v)) || positions.max.some(v => !Number.isFinite(v))) throw new Error('Invalid geometry '+mesh.name);
    return sum + indices.count / 3;
  }, 0));
  for (const node of gltf.nodes) {
    if (!node.matrix.every(Number.isFinite)) throw new Error('Invalid transform');
    renderedTriangles += meshTriangles[node.mesh] || 0;
  }
  await Promise.all(gltf.images.filter(image => {
    if (checkedImages.has(image.uri)) return false;
    checkedImages.add(image.uri); return true;
  }).map(image => access(resolve(folder, image.uri))));
  const col = await readFile(resolve(folder, manifest.collisionFile));
  collision.addBuffer(col.buffer.slice(col.byteOffset, col.byteOffset + col.byteLength), manifest.sourceSector);
  sectors.push({ sector: manifest.sourceSector, bytes: buffer.byteLength, objects: gltf.nodes.length,
    renderedTriangles, uniqueMeshes: gltf.meshes.length, materialCount: gltf.materials.length, imageReferences: gltf.images.length });
}
const loadCollisionMs = performance.now() - started;
const spawns = [];
for (const manifest of report.sectors) {
  const results = (manifest.spawnCandidates || [manifest.spawn]).map(candidate => {
    const y = collision.getGroundHeight(candidate.x, candidate.z, candidate.y, 0.4);
    return { ...candidate, y, valid: Math.abs(y - candidate.y) < 1.5 && collision.isVolumeFree(candidate.x, y, candidate.z, 0.4, 1.85) };
  });
  const chosen = results.find(p => p.valid);
  spawns.push({ sector: manifest.sourceSector, valid: !!chosen, spawn: chosen || null });
}

// Find an actual pair of overlapping COL floors, preferably on a bridge.
let layers = null;
const bridgeFloors = [...collision.colliders.values()].filter(c => c.type === 'tri' && c.walkable && c.id.startsWith('bridge:'));
for (const face of bridgeFloors) {
  const v = face.vertices, x = (v[0] + v[3] + v[6]) / 3, z = (v[2] + v[5] + v[8]) / 3;
  const values = [];
  for (const other of collision._gather(x - 0.01, z - 0.01, x + 0.01, z + 0.01)) {
    if (!other.walkable || other.type !== 'tri') continue;
    const y = collision._topAt(other, x, z);
    if (y !== null && y > 5.9 && !values.some(v => Math.abs(v - y) < 0.1)) values.push(y);
  }
  values.sort((a, b) => a - b);
  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] < 2 || values[i] - values[i - 1] > 30) continue;
    const lower = values[i - 1], upper = values[i];
    const lowerResult = collision.getGroundHeight(x, z, lower, 0.36), upperResult = collision.getGroundHeight(x, z, upper, 0.36);
    if (Math.abs(lower - lowerResult) < 0.01 && Math.abs(upper - upperResult) < 0.01) {
      layers = { x, z, lower, upper, lowerResult, upperResult, lowerCeiling: collision.getCeilingHeight(x, z, lower + 1.8) };
      break;
    }
  }
  if (layers) break;
}
const textureFiles = (await readdir(resolve(folder, 'textures'))).filter(n => n.endsWith('.png'));
let textureBytes = 0, texturePixels = 0;
for (let i = 0; i < textureFiles.length; i += 32) {
  const buffers = await Promise.all(textureFiles.slice(i, i + 32).map(file => readFile(resolve(folder, 'textures', file))));
  for (const buffer of buffers) {
    textureBytes += buffer.byteLength; texturePixels += buffer.readUInt32BE(16) * buffer.readUInt32BE(20);
  }
}
const output = { sectors, totalSectors: sectors.length, totalGLBBytes: sectors.reduce((s, v) => s + v.bytes, 0),
  totalObjects: sectors.reduce((s,v) => s + v.objects, 0), totalRenderedTriangles: sectors.reduce((s,v) => s + v.renderedTriangles, 0),
  collisionTriangles: collision.triangleCount, collisionObjects: collision.colliders.size, textureFiles: textureFiles.length,
  texturePNGBytes: textureBytes, estimatedTextureGPUBytesWithMipmaps: Math.round(texturePixels * 4 * 4 / 3),
  loadCollisionAndAuditMs: Math.round(loadCollisionMs), spawns, actualOverlappingBridgeFloors: layers,
  missingModels: report.missingModels, missingTextures: report.missingTextures, missingCOLBindings: report.modelsWithoutCOLBinding,
  conversionErrors: report.errors, memory: process.memoryUsage(),
  limitations: ['CPU validation; GPU frame rate is not measured by this script.', 'Original mission/area triggers, path traffic and moving bridge scripts are not imported.'] };
await writeFile(resolve(folder, 'validation-report.json'), JSON.stringify(output, null, 2));
await writeFile(resolve(folder, 'conversion-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sectors: output.totalSectors, objects: output.totalObjects, triangles: output.totalRenderedTriangles,
  collisionTriangles: output.collisionTriangles, validSpawns: spawns.filter(s => s.valid).length,
  missingModels: output.missingModels.length, missingTextures: output.missingTextures.length,
  missingCOL: output.missingCOLBindings.length, actualOverlappingBridgeFloors: layers,
  loadCollisionAndAuditMs: output.loadCollisionAndAuditMs }));
if (report.errors.length || report.missingModels.length || report.missingTextures.length) process.exitCode = 1;
