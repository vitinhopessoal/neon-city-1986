# NEON MOTOR COMPANY — biblioteca de modelagem (Blender 5.x, bpy/bmesh).
# Todas as funções recebem coordenadas do JOGO (metros; frente = +Z, motorista = +X, Y para cima)
# e convertem para o Blender (Z para cima) com G(). O exportador glTF (+Y up) devolve exatamente
# as coordenadas do jogo: Blender (x, y, z) -> glTF (x, z, -y).
import bpy, bmesh, math
from mathutils import Vector, Matrix

def G(x, y, z):
    return Vector((x, -z, y))

def clamp(v, a, b):
    return a if v < a else b if v > b else v

def lerp(a, b, t):
    return a + (b - a) * t

def smooth(t):
    t = clamp(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)

# ------------------------------------------------------------------ cena
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    return sc

def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj

# ------------------------------------------------------------------ materiais
_MATS = {}

def hex_rgb(h):
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b), 1.0)

def material(name, color='#808080', metal=0.0, rough=0.5, emit=None, emit_strength=0.0, alpha=1.0, coat=0.0, coat_rough=0.1):
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    col = hex_rgb(color) if isinstance(color, str) else color
    bsdf.inputs['Base Color'].default_value = col
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if emit:
        bsdf.inputs['Emission Color'].default_value = hex_rgb(emit)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    if coat > 0:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = coat_rough
    m.diffuse_color = col
    _MATS[name] = m
    return m

def reset_materials():
    _MATS.clear()

# ------------------------------------------------------------------ malhas
class MB:
    """Construtor de malha em coordenadas do jogo, com material por face."""
    def __init__(self):
        self.v = []
        self.f = []
        self.fm = []

    def add_v(self, p):
        self.v.append(tuple(p))
        return len(self.v) - 1

    def face(self, idx, mat=0):
        self.f.append(list(idx))
        self.fm.append(mat)

    def to_object(self, name, mats, smooth_angle=None, coll=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata([G(*p) for p in self.v], [], self.f)
        me.update()
        for m in mats:
            me.materials.append(m)
        for i, p in enumerate(me.polygons):
            p.material_index = self.fm[i]
        ob = bpy.data.objects.new(name, me)
        link(ob, coll)
        fix_normals(ob)
        if smooth_angle is not None:
            shade(ob, smooth_angle)
        return ob

def fix_normals(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()

def shade(ob, angle_deg=32):
    """Suave com arestas vivas acima do ângulo (o glTF exporta as normais divididas)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    lim = math.radians(angle_deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0) <= lim
        else:
            e.smooth = True
    bm.to_mesh(me)
    bm.free()

def flat(ob):
    for p in ob.data.polygons:
        p.use_smooth = False

def loft(name, rings, mat, cap=True, coll=None):
    """Malha a partir de anéis fechados (todos com o mesmo número de pontos)."""
    mb = MB()
    n = len(rings[0])
    ids = [[mb.add_v(p) for p in r] for r in rings]
    for k in range(len(rings) - 1):
        a, b = ids[k], ids[k + 1]
        for i in range(n):
            j = (i + 1) % n
            mb.face([a[i], a[j], b[j], b[i]])
    if cap:
        mb.face(list(reversed(ids[0])))
        mb.face(ids[-1])
    return mb.to_object(name, [mat], coll=coll)

def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = ob.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob

def solver():
    return 'MANIFOLD'

def boolean(target, cutter, op='DIFFERENCE', keep=False):
    mod = target.modifiers.new('bool', 'BOOLEAN')
    mod.operation = op
    try:
        mod.solver = solver()
    except Exception:
        mod.solver = 'EXACT'
    mod.object = cutter
    apply_modifiers(target)
    if not keep:
        bpy.data.objects.remove(cutter, do_unlink=True)
    return target

def duplicate(ob, name):
    d = ob.copy()
    d.data = ob.data.copy()
    d.name = name
    d.data.name = name
    link(d)
    return d

def bevel_mod(ob, width=0.015, segments=2, angle=30):
    mod = ob.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.use_clamp_overlap = True
    apply_modifiers(ob)
    return ob

def solidify(ob, thickness=0.03, offset=-1.0, mat_offset=0):
    mod = ob.modifiers.new('solid', 'SOLIDIFY')
    mod.thickness = thickness
    mod.offset = offset
    mod.material_offset = mat_offset
    mod.material_offset_rim = mat_offset
    mod.use_even_offset = True
    apply_modifiers(ob)
    return ob

def join(objs, name):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    target = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=target, object=target, selected_objects=objs, selected_editable_objects=objs):
            bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target

def set_origin(ob, game_pt):
    """Move a origem do objeto para um ponto (coordenadas do jogo) sem mover a malha."""
    p = G(*game_pt)
    ob.data.transform(Matrix.Translation(-p + ob.location))
    ob.location = p

def parent(child, par):
    # matrix_world só é recalculado após o depsgraph: sem isto, uma origem recém-movida seria perdida.
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = par
    child.matrix_parent_inverse = par.matrix_world.inverted()
    child.matrix_world = mw

def empty(name, game_pt=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = 0.2
    e.location = G(*game_pt)
    link(e)
    return e

# ------------------------------------------------------------------ primitivas
def _bm_to_obj(bm, name, mat, coll=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    return ob

def box(name, c, s, mat, bevel=0.0, seg=2, rot=(0, 0, 0)):
    """Caixa centrada em c (jogo) com tamanhos s=(x,y,z); rot = (rx, ry, rz) em radianos no espaço do jogo."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]))  # ainda em "jogo" (x, y, z)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(s) * 0.45), segments=seg, affect='EDGES', profile=0.5, clamp_overlap=True)
    R = Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[2], 4, 'Z')
    for v in bm.verts:
        p = R @ v.co
        v.co = G(p.x + c[0], p.y + c[1], p.z + c[2])
    ob = _bm_to_obj(bm, name, mat)
    fix_normals(ob)
    shade(ob, 40)
    return ob

def cylinder(name, c, radius, length, mat, axis='X', segs=20, bevel=0.0, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=radius, radius2=radius, depth=length)
    if bevel > 0:
        caps = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6]
        bmesh.ops.bevel(bm, geom=caps, offset=bevel, segments=2, affect='EDGES', profile=0.5, clamp_overlap=True)
    # Cone nasce ao longo do Z local -> orienta no espaço do jogo.
    if axis == 'X':
        M = Matrix.Rotation(math.pi / 2, 4, 'Y')
    elif axis == 'Y':
        M = Matrix.Rotation(-math.pi / 2, 4, 'X')
    else:
        M = Matrix.Identity(4)
    if rot is not None:
        M = (Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[2], 4, 'Z')) @ M
    for v in bm.verts:
        p = M @ v.co
        v.co = G(p.x + c[0], p.y + c[1], p.z + c[2])
    ob = _bm_to_obj(bm, name, mat)
    fix_normals(ob)
    shade(ob, 35)
    return ob

def lathe(name, profile, mat, segs=32, center=(0, 0, 0), mats=None, flip=False):
    """Sólido de revolução em torno do eixo X do jogo. profile: [(x, r, matIndex?)] aberto/fechado.
    flip=True espelha em X (rodas do lado direito)."""
    mb = MB()
    rings = []
    for (px, pr, *rest) in profile:
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            x = -px if flip else px
            ring.append(mb.add_v((center[0] + x, center[1] + pr * math.cos(a), center[2] + pr * math.sin(a))))
        rings.append(ring)
    for i in range(len(rings) - 1):
        mi = profile[i][2] if len(profile[i]) > 2 else 0
        for k in range(segs):
            j = (k + 1) % segs
            a, b = rings[i], rings[i + 1]
            mb.face([a[k], a[j], b[j], b[k]], mi)
    ob = mb.to_object(name, mats or [mat])
    shade(ob, 40)
    return ob

def strip_path(name, path, section, mat, closed_section=True, caps=True):
    """Extrusão de uma seção 2D (n, y) ao longo de um caminho no plano XZ do jogo (y absoluto).
    path: [(x, z)]; section: [(offset normal, y)]. A normal aponta para fora (esquerda do sentido do caminho)."""
    rings = []
    n = len(path)
    for i, (x, z) in enumerate(path):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, n - 1)]
        tx, tz = b[0] - a[0], b[1] - a[1]
        l = math.hypot(tx, tz) or 1.0
        nx, nz = tz / l, -tx / l
        rings.append([(x + nx * o, y, z + nz * o) for (o, y) in section])
    return loft(name, rings, mat, cap=caps)
