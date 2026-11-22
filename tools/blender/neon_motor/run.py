# Uso (Blender 5.x em modo background):
#   blender --background --factory-startup --python tools/blender/neon_motor/run.py -- palm_compact [bay_city_100 ...] [--render] [--all]
# Gera: assets-src/vehicles/<arquivo>.blend, public/models/vehicles/<arquivo>.glb,
#       docs/screenshots/neon-motor/<arquivo>.png (renders) e tools/blender/neon_motor/out/<arquivo>.json (relatório).
import sys, os, json, math, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy, bmesh
import numpy as np
from mathutils import Vector
import nm_lib
import nm_car
from nm_lib import G

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SPECS = json.load(open(os.path.join(ROOT, 'src', 'vehicles', 'models', 'neon-motor-specs.json'), encoding='utf-8'))['vehicles']
OUT_BLEND = os.path.join(ROOT, 'assets-src', 'vehicles')
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'vehicles')
OUT_PNG = os.path.join(ROOT, 'docs', 'screenshots', 'neon-motor')
OUT_REP = os.path.join(HERE, 'out')
for p in (OUT_BLEND, OUT_GLB, OUT_PNG, OUT_REP):
    os.makedirs(p, exist_ok=True)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = '--render' in argv
ids = [a for a in argv if not a.startswith('--')]
if '--all' in argv or not ids:
    ids = [s['type'] for s in SPECS]


def tri_count(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    ob.evaluated_get(dg).to_mesh_clear()
    return n


def game_bbox(objs):
    mn = Vector((1e9, 1e9, 1e9)); mx = -mn
    for ob in objs:
        if ob.type != 'MESH':
            continue
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            g = Vector((w.x, w.z, -w.y))
            mn = Vector(map(min, mn, g)); mx = Vector(map(max, mx, g))
    return mn, mx


def non_manifold(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    n = sum(1 for e in bm.edges if not e.is_manifold)
    bm.free()
    return n


def animate(car):
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, 30
    acts = []
    for nm, ob in car.final.items():
        if nm.startswith('Door_'):
            side = 1 if nm.endswith('L') else -1
            rot = ('rotation_euler', 2, -side * 1.05)
        elif nm == 'Hood':
            rot = ('rotation_euler', 0, -0.95)
        elif nm == 'Trunk':
            rot = ('rotation_euler', 0, 1.0)
        elif nm == 'Tailgate':
            rot = ('rotation_euler', 0, 1.15)
        elif nm.startswith('Popup'):
            rot = ('rotation_euler', 0, -1.2)
        else:
            continue
        ob.rotation_euler = (0, 0, 0)
        ob.keyframe_insert('rotation_euler', frame=1)
        e = list(ob.rotation_euler); e[rot[1]] = rot[2]; ob.rotation_euler = e
        ob.keyframe_insert('rotation_euler', frame=30)
        if ob.animation_data and ob.animation_data.action:
            ob.animation_data.action.name = f'{nm}_Open'
        acts.append(f'{nm}_Open')
    sc.frame_set(1)
    return acts


def validate(car, spec):
    d = spec['dims']
    rep = {}
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('Plate')]
    mn, mx = game_bbox([o for o in meshes if not o.name.startswith(('Tire_', 'Rim_'))])
    rep['bbox'] = {'min': [round(v, 3) for v in mn], 'max': [round(v, 3) for v in mx]}
    rep['size'] = {'length': round(mx.z - mn.z, 3), 'width': round(mx.x - mn.x, 3), 'height': round(mx.y, 3)}
    checks = []
    def chk(name, ok, info):
        checks.append({'check': name, 'ok': bool(ok), 'info': info})
    chk('comprimento', abs(rep['size']['length'] - d['length']) / d['length'] < 0.06, f"{rep['size']['length']} vs {d['length']}")
    chk('largura (com retrovisores)', rep['size']['width'] >= d['width'] - 0.04 and rep['size']['width'] < d['width'] + 0.4, f"{rep['size']['width']} vs {d['width']}")
    chk('altura', abs(rep['size']['height'] - d['height']) < 0.08, f"{rep['size']['height']} vs {d['height']}")
    # Rodas: centro no eixo, pneu tocando o chão.
    for nm, w in car.wheels.items():
        tmn, tmx = game_bbox([w['objs'][0]])
        cx = (tmn.x + tmx.x) / 2; cy = (tmn.y + tmx.y) / 2; cz = (tmn.z + tmx.z) / 2
        hub = w['hub']
        ok = abs(cx - hub[0]) < 0.02 and abs(cy - hub[1]) < 0.01 and abs(cz - hub[2]) < 0.01 and abs(tmn.y) < 0.012
        chk(f'roda {nm} alinhada', ok, f'centro ({cx:.3f},{cy:.3f},{cz:.3f}) chão {tmn.y:.3f}')
    # Pivôs.
    for nm, ob in car.final.items():
        if nm.startswith('Door_'):
            p = ob.matrix_world.translation
            g = (p.x, p.z, -p.y)
            dz = next(dd for dd in car.doors if dd['name'] == nm)
            chk(f'dobradiça {nm}', abs(g[2] - dz['z1']) < 0.01 and abs(abs(g[0]) - car.halfw(dz['z1'])) < 0.02, f'({g[0]:.3f},{g[1]:.3f},{g[2]:.3f})')
    # Cabeça do motorista abaixo do teto interno (estimativa: quadril + 0,74 m * cos(recline/2)).
    drv = next(x for x in spec['seats'] if x.get('driver'))
    head = drv['hipY'] + 0.80 * math.cos(drv['recline'] * 0.55)
    roof_in = spec['body']['roofY'] - 0.035
    if spec['body']['rear'] != 'roadster':
        chk('cabeça do motorista abaixo do teto', head < roof_in, f'cabeça≈{head:.2f} teto interno {roof_in:.2f}')
    rep['checks'] = checks
    tris = {}
    total = 0
    for ob in bpy.data.objects:
        if ob.type == 'MESH':
            t = tri_count(ob)
            tris[ob.name] = t
            total += t
    rep['triangles'] = total
    rep['trianglesByObject'] = dict(sorted(tris.items(), key=lambda kv: -kv[1])[:20])
    rep['materials'] = sorted({m.name for o in bpy.data.objects if o.type == 'MESH' for m in o.data.materials if m})
    rep['nonManifoldBodyEdges'] = non_manifold(car.final['Body'])
    def tree(ob, depth=0):
        out = [('  ' * depth) + ob.name]
        for c in sorted(ob.children, key=lambda c: c.name):
            out += tree(c, depth + 1)
        return out
    rep['hierarchy'] = tree(car.root)
    return rep


# ------------------------------------------------------------------ renders
def setup_render(spec):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    try:
        sc.eevee.taa_render_samples = 24
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = 900, 560
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in [i.identifier for i in sc.view_settings.bl_rna.properties['look'].enum_items] else 'None'
    world = bpy.data.worlds.new('W')
    sc.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.22, 0.24, 0.3, 1)
    bg.inputs['Strength'].default_value = 0.9
    gm = nm_lib.material('Studio_Floor', '#6b6d75', rough=0.85)
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.name = 'Studio_Floor'
    floor.data.materials.append(gm)
    sun = bpy.data.lights.new('Sun', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(6)
    so = bpy.data.objects.new('Sun', sun); bpy.context.scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(140))
    for i, (x, y, z, e) in enumerate(((4, -5, 4, 900), (-5, 3, 3, 500), (0, 6, 5, 400))):
        a = bpy.data.lights.new(f'Area{i}', 'AREA'); a.energy = e; a.size = 4
        ao = bpy.data.objects.new(f'Area{i}', a); bpy.context.scene.collection.objects.link(ao)
        ao.location = (x, y, z)
        d = Vector((0, 0, 0.6)) - ao.location
        ao.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.cameras.new('Cam'); cam.lens = 50
    co = bpy.data.objects.new('Cam', cam); bpy.context.scene.collection.objects.link(co)
    sc.camera = co
    return co, floor


def shoot(co, eye, target, path, lens=50):
    co.data.lens = lens
    co.location = G(*eye)
    d = G(*target) - co.location
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_set(car, spec, base):
    co, floor = setup_render(spec)
    L = spec['dims']['length']
    H = spec['dims']['height']
    tmp = os.path.join(OUT_REP, 'tmp')
    os.makedirs(tmp, exist_ok=True)
    shots = []
    dist = L * 1.55
    views = [
        ('3q', (L * 0.62, H * 0.95, L * 0.95), (0, H * 0.42, 0.1), 50),
        ('front', (0.0, H * 0.75, dist + 1.2), (0, H * 0.45, 0), 50),
        ('side', (dist + 1.6, H * 0.6, 0.0), (0, H * 0.45, 0), 50),
        ('rear', (-L * 0.55, H * 1.05, -L * 1.0), (0, H * 0.45, -0.1), 50),
    ]
    for nm, eye, tgt, lens in views:
        p = os.path.join(tmp, f'{base}_{nm}.png'); shoot(co, eye, tgt, p, lens); shots.append(p)
    # Portas, capô e faróis abertos.
    bpy.context.scene.frame_set(30)
    p = os.path.join(tmp, f'{base}_open.png')
    shoot(co, (L * 0.7, H * 1.25, L * 0.8), (0, H * 0.45, 0.0), p, 45); shots.append(p)
    bpy.context.scene.frame_set(1)
    # Interior: câmera no banco traseiro/central olhando o painel, teto oculto.
    drv = next(x for x in spec['seats'] if x.get('driver'))
    hide = [car.final.get('Body')]
    gh_hidden = []
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and ob.name in ('Body',):
            pass
    # Câmera dentro da cabine, atrás e acima do motorista, olhando o painel.
    eye = (drv['x'] * 0.35, min(spec['body']['roofY'] - 0.12, drv['hipY'] + 0.62), drv['z'] - 0.55)
    tgt = (drv['x'] * 0.6, spec['wheel']['y'] - 0.08, spec['wheel']['z'] + 0.35)
    co.data.clip_start = 0.02
    p = os.path.join(tmp, f'{base}_interior.png'); shoot(co, eye, tgt, p, 20); shots.append(p)
    co.data.clip_start = 0.1
    # Folha de contato 3x2.
    imgs = [bpy.data.images.load(s) for s in shots]
    w, h = imgs[0].size
    sheet = np.zeros((h * 2, w * 3, 4), dtype=np.float32)
    for i, im in enumerate(imgs):
        px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
        r, c = 1 - i // 3, i % 3
        sheet[r * h:(r + 1) * h, c * w:(c + 1) * w] = px
    out = bpy.data.images.new('sheet', w * 3, h * 2, alpha=True)
    out.pixels = sheet.ravel()
    out.filepath_raw = os.path.join(OUT_PNG, f'{base}.png')
    out.file_format = 'PNG'
    out.save()
    # Limpa o estúdio antes de salvar o .blend/exportar.
    for nm in ('Studio_Floor', 'Sun', 'Area0', 'Area1', 'Area2', 'Cam'):
        o = bpy.data.objects.get(nm)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    return os.path.join(OUT_PNG, f'{base}.png')


def export(car, spec):
    base = spec['file']
    bpy.ops.object.select_all(action='DESELECT')
    blend = os.path.join(OUT_BLEND, base + '.blend')
    glb = os.path.join(OUT_GLB, base + '.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=False, export_apply=True, export_yup=True,
                              export_extras=True, export_animations=True, export_texcoords=True, export_normals=True,
                              export_materials='EXPORT', export_cameras=False, export_lights=False)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    if os.path.exists(blend + '1'):
        os.remove(blend + '1')  # backup automático do Blender (não versionado)
    return blend, glb


summary = []
for tid in ids:
    spec = next(s for s in SPECS if s['type'] == tid)
    t0 = time.time()
    nm_lib.reset_scene()
    nm_lib.reset_materials()
    car = nm_car.Car(spec).build()
    acts = animate(car)
    rep = validate(car, spec)
    rep['animations'] = acts
    rep['buildSeconds'] = round(time.time() - t0, 1)
    if RENDER:
        rep['render'] = render_set(car, spec, spec['file'])
    blend, glb = export(car, spec)
    rep['blend'] = os.path.relpath(blend, ROOT).replace('\\', '/')
    rep['glb'] = os.path.relpath(glb, ROOT).replace('\\', '/')
    rep['glbBytes'] = os.path.getsize(glb)
    json.dump(rep, open(os.path.join(OUT_REP, spec['file'] + '.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    fails = [c for c in rep['checks'] if not c['ok']]
    print(f"NM_DONE {tid} tris={rep['triangles']} glb={rep['glbBytes']} fails={len(fails)} {[f['check'] + ': ' + f['info'] for f in fails]}")
