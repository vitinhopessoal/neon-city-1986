# Uso: blender --background --factory-startup --python tools/blender/neon_moto/run_moto.py -- [tipo ...] [--render] [--all]
# Saídas: assets-src/motorcycles/<arquivo>.blend, public/models/motorcycles/<arquivo>.glb,
#         docs/screenshots/neon-moto/<arquivo>.jpg e tools/blender/neon_moto/out/<arquivo>.json
import sys, os, json, math, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'neon_motor'))
import bpy, bmesh
import numpy as np
from mathutils import Vector
import nm_lib
from nm_lib import G
import nm_moto

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SPECS = json.load(open(os.path.join(ROOT, 'src', 'vehicles', 'models', 'neon-moto-specs.json'), encoding='utf-8'))['bikes']
OUT_BLEND = os.path.join(ROOT, 'assets-src', 'motorcycles')
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'motorcycles')
OUT_PNG = os.path.join(ROOT, 'docs', 'screenshots', 'neon-moto')
OUT_REP = os.path.join(HERE, 'out')
for p in (OUT_BLEND, OUT_GLB, OUT_PNG, OUT_REP):
    os.makedirs(p, exist_ok=True)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = '--render' in argv
ids = [a for a in argv if not a.startswith('--')] or [s['type'] for s in SPECS]
if '--all' in argv:
    ids = [s['type'] for s in SPECS]


def tri_count(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    ob.evaluated_get(dg).to_mesh_clear()
    return n


def bbox(objs):
    mn = Vector((1e9, 1e9, 1e9)); mx = -mn
    for ob in objs:
        if ob.type != 'MESH':
            continue
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            g = Vector((w.x, w.z, -w.y))
            mn = Vector(map(min, mn, g)); mx = Vector(map(max, mx, g))
    return mn, mx


def animate(m):
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, 30
    acts = []
    for nm, axis, val in (('FrontFork', 2, 0.45), ('Swingarm', 0, 0.12)):
        ob = m.final[nm]
        base = list(ob.rotation_euler)
        ob.keyframe_insert('rotation_euler', frame=1)
        e = list(base); e[axis] += val
        ob.rotation_euler = e
        ob.keyframe_insert('rotation_euler', frame=15)
        ob.rotation_euler = base
        ob.keyframe_insert('rotation_euler', frame=30)
        if ob.animation_data and ob.animation_data.action:
            ob.animation_data.action.name = {'FrontFork': 'Steer', 'Swingarm': 'Suspension'}[nm]
        acts.append(ob.animation_data.action.name)
    for nm in ('FrontWheel', 'RearWheel'):
        ob = m.final[nm]
        ob.rotation_euler = (0, 0, 0)
        ob.keyframe_insert('rotation_euler', frame=1)
        ob.rotation_euler = (-2 * math.pi, 0, 0)
        ob.keyframe_insert('rotation_euler', frame=30)
        ob.animation_data.action.name = f'{nm}_Spin'
        acts.append(f'{nm}_Spin')
        ob.rotation_euler = (0, 0, 0)
    sc.frame_set(1)
    return acts


def validate(m, spec):
    d = spec['dims']
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    mn, mx = bbox(meshes)
    rep = {'size': {'length': round(mx.z - mn.z, 3), 'width': round(mx.x - mn.x, 3), 'height': round(mx.y, 3)}}
    checks = []
    chk = lambda n, ok, info: checks.append({'check': n, 'ok': bool(ok), 'info': info})
    chk('comprimento', abs(rep['size']['length'] - d['length']) / d['length'] < 0.12, f"{rep['size']['length']} vs {d['length']}")
    chk('altura', abs(rep['size']['height'] - d['height']) < 0.18, f"{rep['size']['height']} vs {d['height']}")
    for k, ax, r in (('F', m.axF, d['rF']), ('R', m.axR, d['rR'])):
        t = m.wheelObjs[k][0]
        tmn, tmx = bbox([t])
        c = (tmn + tmx) / 2
        ok = abs(c.x) < 0.005 and abs(c.y - ax.y) < 0.01 and abs(c.z - ax.z) < 0.01 and abs(tmn.y) < 0.012
        chk(f'roda {k} alinhada', ok, f'centro ({c.x:.3f},{c.y:.3f},{c.z:.3f}) chão {tmn.y:.3f}')
    # Rodas no plano central e garfo apontando para o eixo dianteiro.
    fork = m.final['FrontFork']
    p = fork.matrix_world.translation
    chk('pivô do garfo na caixa de direção', abs(p.x) < 1e-4 and abs(p.z - m.H.y) < 1e-3, f'({p.x:.3f},{p.z:.3f},{-p.y:.3f})')
    sw = m.final['Swingarm'].matrix_world.translation
    chk('pivô da balança', abs(sw.z - m.S.y) < 1e-3, f'({sw.x:.3f},{sw.z:.3f},{-sw.y:.3f})')
    rd = spec['rider']
    chk('banco sob o quadril do piloto', abs(rd['hipY'] - d['seatY'] - 0.1) < 0.06, f"quadril {rd['hipY']} banco {d['seatY']}")
    rep['checks'] = checks
    tris = {o.name: tri_count(o) for o in meshes}
    rep['triangles'] = sum(tris.values())
    rep['trianglesByObject'] = dict(sorted(tris.items(), key=lambda kv: -kv[1])[:16])
    rep['materials'] = sorted({mt.name for o in meshes for mt in o.data.materials if mt})
    def tree(ob, depth=0):
        out = [('  ' * depth) + ob.name]
        for c in sorted(ob.children, key=lambda c: c.name):
            out += tree(c, depth + 1)
        return out
    rep['hierarchy'] = tree(m.root)
    return rep


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    try:
        sc.eevee.taa_render_samples = 24
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = 900, 560
    sc.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('W'); sc.world = world
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.22, 0.24, 0.3, 1); bg.inputs['Strength'].default_value = 0.9
    gm = nm_lib.material('Studio_Floor', '#6b6d75', rough=0.85)
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    fl = bpy.context.active_object; fl.name = 'Studio_Floor'; fl.data.materials.append(gm)
    sun = bpy.data.lights.new('Sun', 'SUN'); sun.energy = 3.0; sun.angle = math.radians(6)
    so = bpy.data.objects.new('Sun', sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(50), math.radians(10), math.radians(140))
    for i, (x, y, z, e) in enumerate(((3, -3, 3, 500), (-3, 2, 2, 300), (0, 4, 3, 250))):
        a = bpy.data.lights.new(f'Area{i}', 'AREA'); a.energy = e; a.size = 3
        ao = bpy.data.objects.new(f'Area{i}', a); sc.collection.objects.link(ao); ao.location = (x, y, z)
        ao.rotation_euler = (Vector((0, 0, 0.6)) - ao.location).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.cameras.new('Cam'); co = bpy.data.objects.new('Cam', cam); sc.collection.objects.link(co); sc.camera = co
    return co


def shoot(co, eye, tgt, path, lens=50):
    co.data.lens = lens
    co.location = G(*eye)
    co.rotation_euler = (G(*tgt) - co.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_set(m, spec):
    co = setup_render()
    L = spec['dims']['length']
    tmp = os.path.join(OUT_REP, 'tmp'); os.makedirs(tmp, exist_ok=True)
    base = spec['file']
    views = [
        ('side', (3.6, 0.65, 0.0), (0, 0.55, 0), 50),
        ('3q', (2.2, 1.2, 2.0), (0, 0.55, 0.05), 45),
        ('front', (0.25, 0.9, 3.4), (0, 0.6, 0), 50),
        ('rear3q', (-1.6, 1.3, -2.2), (0, 0.55, -0.1), 45),
        ('engine', (1.2, 0.6, 0.15), (0, 0.4, 0.05), 40),
        ('top', (0.4, 3.2, 0.3), (0, 0.4, 0.0), 40),
    ]
    shots = []
    for nm, eye, tgt, lens in views:
        p = os.path.join(tmp, f'{base}_{nm}.png'); shoot(co, eye, tgt, p, lens); shots.append(p)
    imgs = [bpy.data.images.load(s) for s in shots]
    w, h = imgs[0].size
    sheet = np.zeros((h * 2, w * 3, 4), dtype=np.float32)
    for i, im in enumerate(imgs):
        px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
        r, c = 1 - i // 3, i % 3
        sheet[r * h:(r + 1) * h, c * w:(c + 1) * w] = px
    out = bpy.data.images.new('sheet', w * 3, h * 2, alpha=True)
    out.pixels = sheet.ravel()
    out.filepath_raw = os.path.join(OUT_PNG, f'{base}.jpg'); out.file_format = 'JPEG'; bpy.context.scene.render.image_settings.quality = 88; out.save()
    for nm in ('Studio_Floor', 'Sun', 'Area0', 'Area1', 'Area2', 'Cam'):
        o = bpy.data.objects.get(nm)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    return os.path.join(OUT_PNG, f'{base}.jpg')


def export_lod(spec, ratio=0.3):
    """LOD distante: cópia de todas as malhas (modificadores aplicados) unida num objeto 'LOD1' e dizimada."""
    dg = bpy.context.evaluated_depsgraph_get()
    bpy.ops.object.select_all(action='DESELECT')
    dups = []
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        d = bpy.data.objects.new(o.name + '_lod', me)
        bpy.context.scene.collection.objects.link(d)
        d.matrix_world = o.matrix_world.copy()
        dups.append(d)
    for d in dups:
        d.select_set(True)
    bpy.context.view_layer.objects.active = dups[0]
    bpy.ops.object.join()
    lod = bpy.context.view_layer.objects.active
    lod.name = 'LOD1'
    dec = lod.modifiers.new('Decimate', 'DECIMATE')
    dec.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=dec.name)
    n = tri_count(lod)
    path = os.path.join(OUT_GLB, spec['file'] + '_lod1.glb')
    bpy.ops.object.select_all(action='DESELECT')
    lod.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_animations=False, export_materials='EXPORT', export_cameras=False, export_lights=False)
    bpy.data.objects.remove(lod, do_unlink=True)
    return n, os.path.getsize(path)


for tid in ids:
    spec = next(s for s in SPECS if s['type'] == tid)
    t0 = time.time()
    nm_lib.reset_scene(); nm_lib.reset_materials()
    m = nm_moto.Moto(spec).build()
    acts = animate(m)
    rep = validate(m, spec)
    rep['animations'] = acts
    rep['buildSeconds'] = round(time.time() - t0, 1)
    if RENDER:
        rep['render'] = render_set(m, spec)
    glb = os.path.join(OUT_GLB, spec['file'] + '.glb')
    blend = os.path.join(OUT_BLEND, spec['file'] + '.blend')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=False, export_apply=True, export_yup=True, export_extras=True, export_animations=True, export_materials='EXPORT', export_cameras=False, export_lights=False)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    if os.path.exists(blend + '1'):
        os.remove(blend + '1')
    rep['lod1Triangles'], rep['lod1Bytes'] = export_lod(spec)
    rep['glb'] = os.path.relpath(glb, ROOT).replace('\\', '/'); rep['blend'] = os.path.relpath(blend, ROOT).replace('\\', '/'); rep['glbBytes'] = os.path.getsize(glb)
    json.dump(rep, open(os.path.join(OUT_REP, spec['file'] + '.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    fails = [c for c in rep['checks'] if not c['ok']]
    print(f"NM_DONE {tid} tris={rep['triangles']} lod1={rep['lod1Triangles']} glb={rep['glbBytes']} fails={len(fails)} {[f['check'] + ': ' + f['info'] for f in fails]}")
