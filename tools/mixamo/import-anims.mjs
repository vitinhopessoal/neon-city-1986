/**
 * Importa as animações baixadas da Mixamo para public/models/anims/.
 *
 *   node tools/mixamo/import-anims.mjs "<pasta dos .fbx da Mixamo>"
 *
 * Os arquivos podem ter vindo "With Skin" (~15 MB cada, com o personagem e as
 * texturas embutidos). Aqui fica só o esqueleto e a animação: malha, materiais,
 * texturas, pele e pose de ligação são removidos do FBX (o resto do arquivo é
 * copiado byte a byte), e cada arquivo recebe um nome limpo (idle.fbx, walk.fbx...).
 * Também grava public/models/anims/anims.json com a lista usada pelo jogo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFBX, writeFBX } from './fbx-binary.mjs';

/** Nome na Mixamo (como o arquivo foi salvo) → nome no jogo. */
export const ANIMS = {
  'Breathing Idle': 'idle',
  'Walking': 'walk',
  'Running': 'run',
  'Walking Backwards': 'walk_back',
  'Left Strafe Walking': 'strafe_left',
  'Right Strafe Walking': 'strafe_right',
  'Jump': 'jump',
  'Falling Idle': 'fall',
  'Falling To Landing': 'land',
  'Swimming': 'swim',
  'Treading Water': 'tread_water',
  'Swimming To Edge': 'swim_to_edge',
  'Getting Up': 'getup',
  'Hit Reaction': 'hit',
  'Dying': 'dying',
  'Pistol Idle': 'pistol_idle',
  'Pistol Aim': 'pistol_aim',
  'Shooting Pistol': 'pistol_shoot',
  'Pistol Walk': 'pistol_walk',
  'Pistol Run': 'pistol_run',
  'Pistol Walk Backward': 'pistol_walk_back',
  'Pistol Strafe esquerda': 'pistol_strafe_left',
  'Pistol Strafe direita': 'pistol_strafe_right',
  'Rifle Idle': 'rifle_idle',
  'Rifle Aiming Idle': 'rifle_aim',
  'Firing Rifle': 'rifle_fire',
  'Rifle Walk': 'rifle_walk',
  'Rifle Run': 'rifle_run',
  'Backwards Rifle Walk': 'rifle_walk_back',
  'Rifle Side Step esquerda': 'rifle_strafe_left',
  'Rifle Side Step direita': 'rifle_strafe_right',
  'Rifle Walk To Stop': 'rifle_walk_stop',
  'Reloading': 'rifle_reload',
  'Knife Idle': 'knife_idle',
  'Stabbing': 'knife_stab',
};

const DROP = new Set(['Geometry', 'Material', 'Texture', 'Video', 'Deformer', 'Pose']);

/** FBX só com esqueleto e animação. */
export function stripFBX(buf) {
  const fbx = readFBX(buf);
  const objects = fbx.nodes.find(n => n.name === 'Objects');
  const connections = fbx.nodes.find(n => n.name === 'Connections');
  if (!objects || !connections) throw new Error('FBX sem Objects/Connections');
  const removed = new Set();
  objects.children = objects.children.filter(o => {
    const drop = DROP.has(o.name) || (o.name === 'Model' && o.props[2] === 'Mesh');
    if (drop) removed.add(o.props[0]);
    return !drop;
  });
  connections.children = connections.children.filter(c => !removed.has(c.props[1]) && !removed.has(c.props[2]));
  const out = writeFBX(fbx);
  const limbs = objects.children.filter(o => o.name === 'Model' && o.props[2] === 'LimbNode').length;
  const curves = objects.children.filter(o => o.name === 'AnimationCurve').length;
  return { buffer: out, limbs, curves, removed: removed.size };
}

function main() {
  const src = process.argv[2];
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const out = path.join(root, 'public/models/anims');
  if (!src || !fs.existsSync(src)) { console.error('Uso: node tools/mixamo/import-anims.mjs "<pasta dos .fbx>"'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  const list = [];
  const missing = [];
  for (const [title, name] of Object.entries(ANIMS)) {
    const file = path.join(src, `${title}.fbx`);
    if (!fs.existsSync(file)) { missing.push(title); continue; }
    const original = fs.readFileSync(file);
    const r = stripFBX(original);
    if (r.limbs < 20 || r.curves < 10) throw new Error(`${title}: esqueleto/animação incompletos (${r.limbs} ossos, ${r.curves} curvas)`);
    fs.writeFileSync(path.join(out, `${name}.fbx`), r.buffer);
    list.push({ name, file: `${name}.fbx`, mixamo: title, bytes: r.buffer.length });
    console.log(`${title.padEnd(26)} → ${name}.fbx  ${(original.length / 1048576).toFixed(1)} MB → ${(r.buffer.length / 1024).toFixed(0)} KB`);
  }
  fs.writeFileSync(path.join(out, 'anims.json'), JSON.stringify({ source: 'Mixamo', fps: 30, clips: list }, null, 2) + '\n');
  const extra = fs.readdirSync(src).filter(f => f.endsWith('.fbx') && !ANIMS[f.slice(0, -4)]);
  if (missing.length) console.log('Não encontrados:', missing.join(', '));
  if (extra.length) console.log('Ignorados (sem nome no jogo):', extra.join(', '));
  console.log(`${list.length} animações em public/models/anims (${(list.reduce((s, c) => s + c.bytes, 0) / 1048576).toFixed(1)} MB)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
