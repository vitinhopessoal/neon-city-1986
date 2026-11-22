# NEON MOTORCYCLES — gerador paramétrico de motos (Blender 5.x).
# Lê uma entrada de src/vehicles/models/neon-moto-specs.json e monta:
# MotorcycleRoot / Frame, Engine, FuelTank, Seat, Exhaust, Bodywork, Lights, Plate_R (fixos)
#                / FrontFork (pivô no eixo de direção, inclinado pelo rake): garfo, guidão, farol,
#                  instrumentos, para-lama, FrontWheel (Tire_F, Rim_F)
#                / Swingarm (pivô da balança): balança, corrente, RearWheel (Tire_R, Rim_R)
#                / âncoras do piloto: Rider_Hip, Peg_L/R (raiz) e Grip_L/R (no garfo)
import bpy, math, sys, os
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'neon_motor'))
from nm_lib import *


def catmull(pts, n=6):
    """Curva suave passando pelos pontos de controle (Catmull-Rom)."""
    P = [Vector(p) for p in pts]
    if len(P) < 3:
        return P
    out = []
    for i in range(len(P) - 1):
        p0 = P[max(i - 1, 0)]; p1 = P[i]; p2 = P[i + 1]; p3 = P[min(i + 2, len(P) - 1)]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    return out


def tube(name, pts, r, mat, segs=10, cap=True, smooth_pts=0):
    """Tubo de seção circular ao longo de uma polilinha (transporte paralelo do referencial)."""
    P = catmull(pts, smooth_pts) if smooth_pts else [Vector(p) for p in pts]
    rings, prevN = [], None
    rr = r if isinstance(r, (list, tuple)) else [r] * len(P)
    if len(rr) != len(P):
        rr = [lerp(rr[0], rr[-1], i / max(len(P) - 1, 1)) for i in range(len(P))]
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        if prevN is None:
            a = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
            n = t.cross(a).normalized()
        else:
            n = (prevN - t * prevN.dot(t)).normalized()
        b = t.cross(n)
        prevN = n
        rings.append([tuple(p + (n * math.cos(2 * math.pi * k / segs) + b * math.sin(2 * math.pi * k / segs)) * rr[i]) for k in range(segs)])
    ob = loft(name, rings, mat, cap=cap)
    shade(ob, 50)
    return ob


def arc_pts(cy, cz, rad, a0, a1, n=10, x=0.0):
    """Pontos de um arco no plano YZ (ângulo 0 = frente, 90° = topo)."""
    return [(x, cy + math.sin(a0 + (a1 - a0) * i / n) * rad, cz + math.cos(a0 + (a1 - a0) * i / n) * rad) for i in range(n + 1)]


class Moto:
    def __init__(self, spec):
        self.s = spec
        self.d, self.st, self.rd = spec['dims'], spec['style'], spec['rider']
        d = self.d
        self.zF, self.zR = d['wheelBase'] / 2, -d['wheelBase'] / 2
        self.u = Vector((0, math.cos(d['rake']), -math.sin(d['rake'])))   # eixo de direção (para cima)
        Lf = (d['headY'] - d['rF']) / math.cos(d['rake'])
        self.axF = Vector((0, d['rF'], self.zF))
        self.H = self.axF + self.u * Lf                                    # caixa de direção
        self.axR = Vector((0, d['rR'], self.zR))
        self.S = Vector((0, d['swingY'], d['swingZ']))                     # pivô da balança
        self.sport = spec['category'] == 'esportiva'
        self.custom = spec['category'] == 'custom'
        self.lo = spec['category'] == 'basica'          # orçamento menor de polígonos
        self.seg = (lambda hi, lo: lo if self.lo else hi)
        self.groups = {k: [] for k in ('frame', 'engine', 'tank', 'seat', 'exhaust', 'body', 'lights', 'fork', 'swing')}
        self.fw = 0.2 if self.sport else 0.17 if self.custom else 0.15   # distância entre os tubos do garfo
        self._mats()

    def _mats(self):
        s, st = self.s, self.st
        rimc = {'gold': '#c9a227', 'black': '#1a1a1d', 'chrome': '#e6e9ee', 'silver': '#cfd3da'}[st.get('rimColor', 'silver')]
        self.M = {
            'paint': material('Paint', s['color'], metal=0.5, rough=0.28, coat=1.0, coat_rough=0.08),
            'stripe': material('Stripe', s['accent'], metal=0.35, rough=0.3, coat=0.8),
            'stripe2': material('Stripe2', s.get('accent2', s['accent']), metal=0.35, rough=0.3, coat=0.8),
            'chrome': material('Chrome', '#e8ecf2', metal=1.0, rough=0.07),
            'trim': material('Black_Trim', '#141417', metal=0.1, rough=0.55),
            'rubber': material('Rubber', '#151517', rough=0.9),
            'rim': material('Rim', rimc, metal=1.0, rough=0.22),
            'alu': material('EngineMetal', '#9da3ab', metal=0.9, rough=0.35),
            'frame': material('Chassis', '#16161a' if not self.sport else '#7b8088', metal=0.4, rough=0.45),
            'seat': material('Seat', '#1c1a1b', rough=0.7),
            'glass': material('Glass', '#2b3d52', metal=0.1, rough=0.03, alpha=0.45),
            'head': material('Headlight', '#f4f6ff', metal=0.3, rough=0.1, emit='#fff2d6', emit_strength=0.6),
            'tail': material('Taillight', '#8a0f18', rough=0.2, emit='#ff2030', emit_strength=0.6),
            'amber': material('Amber', '#c87a10', rough=0.2, emit='#ff9a20', emit_strength=0.4),
            'gauge': material('Gauge', '#ff8cc8', emit='#ff8cc8', emit_strength=1.5),
            'plate': material('Plate', '#f2f2ee', rough=0.5),
            'disc': material('Brake_Disc', '#8f9399', metal=0.95, rough=0.3),
        }

    def add(self, g, *obs):
        for o in obs:
            if o is not None:
                self.groups[g].append(o)

    # ------------------------------------------------------------ rodas
    def wheel(self, nm, rad, w, front):
        M, st = self.M, self.st
        side = min(max(w * 0.72, 0.055), rad * 0.3)   # altura do flanco
        rr = rad - side                                # raio do aro
        prof = []
        npf = self.seg(16, 10)
        for k in range(npf + 1):
            a = -math.pi / 2 + 2 * math.pi * k / npf
            prof.append((math.cos(a) * w / 2 * 1.02, (rad - side / 2) + math.sin(a) * side / 2))
        tire = lathe(f'Tire_{nm}', prof, M['rubber'], segs=self.seg(36, 28))
        parts = [lathe(f'Rim_{nm}_b', [(-w * 0.42, rr * 0.93), (-w * 0.42, rr * 1.0), (w * 0.42, rr * 1.0), (w * 0.42, rr * 0.93), (-w * 0.42, rr * 0.93)], M['rim'], segs=32)]
        hubw = 0.11 if front else 0.15
        parts.append(cylinder(f'Hub_{nm}', (0, 0, 0), 0.055 if not (not front and not self.sport) else 0.08, hubw, M['alu'], 'X', 16, bevel=0.008))
        style = st['wheels']
        if style == 'spoke':
            n = 32
            for k in range(n):
                a = 2 * math.pi * k / n
                side = 1 if k % 2 else -1
                a2 = a + (0.35 if k % 4 < 2 else -0.35)
                p0 = Vector((side * hubw * 0.4, math.sin(a) * 0.05, math.cos(a) * 0.05))
                p1 = Vector((side * 0.012, math.sin(a2) * rr * 0.96, math.cos(a2) * rr * 0.96))
                parts.append(tube(f'Spoke_{nm}{k}', [p0, p1], 0.0028, M['chrome'], segs=4, cap=False))
        else:
            nsp = 3 if style.startswith('cast3') else 6
            for k in range(nsp):
                a = 2 * math.pi * k / nsp
                for dx in ((0,) if nsp == 3 else (-0.02, 0.02)):
                    parts.append(box(f'Cast_{nm}{k}', (dx, math.sin(a) * rr * 0.55, math.cos(a) * rr * 0.55), (0.022, 0.05 if nsp == 3 else 0.028, rr * 0.9), M['rim'], bevel=0.008, rot=(-a, 0, 0)))
        # Discos de freio (dianteiro duplo nas esportivas/custom, simples nas básicas; traseiro à direita).
        sides = (1, -1) if front and (self.sport or self.custom) else ((1,) if front else (-1,))
        if not front and self.s['category'] == 'basica':
            parts.append(cylinder(f'Drum_{nm}', (-hubw * 0.45, 0, 0), 0.085, 0.05, M['alu'], 'X', 20, bevel=0.006))
        else:
            for sx in sides:
                parts.append(cylinder(f'Disc_{nm}{sx}', (sx * (hubw * 0.5 + 0.004), 0, 0), rr * (0.82 if front else 0.68), 0.006, M['disc'], 'X', 28))
        rim = join(parts, f'Rim_{nm}')
        return tire, rim, sides

    # ------------------------------------------------------------ garfo, guidão, farol
    def front(self):
        M, st, d, rd = self.M, self.st, self.d, self.rd
        u, H, ax = self.u, self.H, self.axF
        T = H + u * 0.11
        B = H - u * 0.07
        fw = self.fw
        for sx in (1, -1):
            off = Vector((sx * fw / 2, 0, 0))
            # Tubo interno (cromado) e bainha inferior (alumínio/preto).
            self.add('fork', tube('ForkTube', [T + off + u * 0.04, ax + off + u * 0.30], 0.019 if not self.sport else 0.022, M['chrome'], segs=self.seg(12, 8)))
            self.add('fork', tube('ForkLeg', [ax + off + u * 0.32, ax + off - u * 0.02], 0.026 if not self.sport else 0.03, M['trim'] if self.sport else M['alu'], segs=self.seg(12, 8)))
        # Mesas do garfo.
        for P, h in ((T, 0.035), (B, 0.03)):
            ry = -d['rake']
            self.add('fork', box('Clamp', tuple(P), (fw + 0.07, h, 0.075), M['alu'] if not self.custom else M['chrome'], bevel=0.0 if self.lo else 0.012, rot=(ry, 0, 0)))
        # Para-lama dianteiro.
        rF = d['rF']
        a0, a1 = {'custom': (15, 150), 'bobbed': (40, 115), 'sport': (35, 135)}.get(self.st['fenders'], (20, 145))
        fpts = arc_pts(ax.y, ax.z, rF + 0.028, math.radians(a0), math.radians(a1), 12)
        rings = [[(-d['wF'] / 2 - 0.012, y - 0.012, z), (-d['wF'] * 0.3, y + 0.004, z), (d['wF'] * 0.3, y + 0.004, z), (d['wF'] / 2 + 0.012, y - 0.012, z)] for (_, y, z) in fpts]
        fen = self._strip('FrontFender', rings, M['chrome'] if st['fenders'] in ('chrome', 'custom') else M['paint'])
        self.add('fork', fen)
        # Guidão.
        gw, gy, gz = rd['gripW'], rd['gripY'], rd['gripZ']
        barM = M['chrome'] if st['bars'] in ('pullback', 'ape', 'flat') and not self.sport else M['trim']
        grips = []
        if st['bars'] == 'clipon':
            for sx in (1, -1):
                root_ = T + Vector((sx * fw / 2, -0.03, 0))
                grip = Vector((sx * gw, gy, gz))
                self.add('fork', tube('Clipon', [root_, grip], 0.012, barM, segs=8))
                grips.append((sx, grip, (grip - root_).normalized()))
        else:
            c = T + u * 0.05 + Vector((0, 0.02, 0))
            if st['bars'] == 'ape':
                pts = [(-gw, gy, gz), (-gw * 0.85, gy - 0.02, gz + 0.03), (-0.1, c.y + 0.32, c.z + 0.02), (-0.09, c.y + 0.02, c.z), (0.09, c.y + 0.02, c.z), (0.1, c.y + 0.32, c.z + 0.02), (gw * 0.85, gy - 0.02, gz + 0.03), (gw, gy, gz)]
            elif st['bars'] == 'pullback':
                pts = [(-gw, gy, gz), (-gw * 0.8, gy + 0.02, gz + 0.08), (-0.18, c.y + 0.12, c.z + 0.04), (0, c.y + 0.05, c.z), (0.18, c.y + 0.12, c.z + 0.04), (gw * 0.8, gy + 0.02, gz + 0.08), (gw, gy, gz)]
            else:
                pts = [(-gw, gy, gz), (-gw * 0.75, gy + 0.01, gz + 0.04), (-0.12, c.y + 0.04, c.z + 0.02), (0, c.y + 0.02, c.z), (0.12, c.y + 0.04, c.z + 0.02), (gw * 0.75, gy + 0.01, gz + 0.04), (gw, gy, gz)]
            self.add('fork', tube('Handlebar', pts, 0.011, barM, segs=self.seg(8, 6), smooth_pts=self.seg(4, 3)))
            for sx in (1, -1):
                grips.append((sx, Vector((sx * gw, gy, gz)), Vector((sx, 0, 0))))
        for sx, g, dirv in grips:
            self.add('fork', tube('Grip', [g - dirv * 0.03, g + dirv * 0.1], 0.017, M['rubber'], segs=self.seg(10, 8)))
            self.add('fork', box('Lever', tuple(g + Vector((-sx * 0.05, 0.0, 0.06))), (0.16, 0.012, 0.02), M['alu'], bevel=0.0 if self.lo else 0.004, rot=(0, sx * 0.25, 0)))
            if not self.sport:
                stalk = [g + Vector((-sx * 0.06, 0.02, 0.0)), g + Vector((sx * 0.04, 0.15, -0.03))]
                self.add('fork', tube('MirrorStalk', stalk, 0.005, M['chrome'], segs=6))
                self.add('fork', cylinder('Mirror', tuple(stalk[1] + Vector((0, 0.025, 0))), 0.042, 0.018, M['chrome'], 'Z', self.seg(16, 10), bevel=0.0 if self.lo else 0.005))
        self.grips = [(sx, tuple(g)) for sx, g, _ in grips]
        # Farol e instrumentos (motos sem carenagem: presos ao garfo).
        if st['fairing'] == 'none':
            big = st['head'] == 'round_big'
            R = 0.095 if big else 0.08
            hp = H + Vector((0, -0.02, 0.17 if not self.custom else 0.2))
            self.add('fork', lathe('HeadShell', [(-0.09, 0.001), (-0.08, R * 0.6), (-0.03, R), (0.0, R * 1.02), (0.012, R * 1.02)], M['chrome'], segs=24, center=(0, 0, 0)) if False else self._lamp_bowl('HeadShell', hp, R))
            self.add('fork', cylinder('HeadLens', tuple(hp + Vector((0, 0, 0.006))), R * 0.9, 0.012, M['head'], 'Z', 24))
            for sx in (1, -1):
                tp = hp + Vector((sx * 0.17, -0.02, -0.06))
                self.add('fork', tube('TurnStalk', [hp + Vector((sx * 0.05, -0.02, -0.08)), tp], 0.006, M['chrome'], segs=6))
                self.add('fork', cylinder('TurnF', tuple(tp + Vector((0, 0, 0.02))), 0.025, 0.05, M['amber'], 'Z', self.seg(12, 8), bevel=0.0 if self.lo else 0.006))
            ip = T + u * 0.05 + Vector((0, 0.05, -0.02))
            for sx in ((1, -1) if not self.custom else (0,)):
                self.add('fork', cylinder('GaugeCup', tuple(ip + Vector((sx * 0.055, 0, 0))), 0.045, 0.05, M['trim'], 'Y', self.seg(16, 10), bevel=0.0 if self.lo else 0.006, rot=(-0.5, 0, 0)))
                self.add('fork', cylinder('Gauge', tuple(ip + Vector((sx * 0.055, 0.026, -0.012))), 0.038, 0.004, M['gauge'], 'Y', 16, rot=(-0.5, 0, 0)))

    def _lamp_bowl(self, name, p, R):
        prof = [(0, 0.001), (0.02, R * 0.55), (0.06, R * 0.95), (0.09, R * 1.03), (0.1, R * 1.03)]
        # Torno no eixo X → gira para o eixo Z (frente).
        ob = lathe(name, prof, self.M['chrome'], segs=24)
        ob.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))  # X do jogo (Blender X) → frente (Blender -Y)
        ob.data.transform(Matrix.Translation(G(p.x, p.y, p.z - 0.09)))
        return ob

    def _strip(self, name, rings, mat, thick=0.006):
        mb = MB()
        ids = [[mb.add_v(p) for p in r] for r in rings]
        for i in range(len(ids) - 1):
            for j in range(len(ids[0]) - 1):
                mb.face([ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j]])
        ob = mb.to_object(name, [mat])
        solidify(ob, thick, 0.0)
        shade(ob, 40)
        return ob

    # ------------------------------------------------------------ quadro e balança
    def frame(self):
        M, st, d, rd = self.M, self.st, self.d, self.rd
        H, S, u = self.H, self.S, self.u
        fr = M['frame']
        self.add('frame', tube('HeadTube', [H - u * 0.08, H + u * 0.1], 0.032, fr, segs=12))
        seatY = d['seatY']
        tailZ = self.zR + (0.22 if not self.custom else 0.35)
        if st['frame'] == 'spar':
            for sx in (1, -1):
                pts = [H + Vector((sx * 0.06, -0.02, -0.05)), Vector((sx * 0.15, d['headY'] - 0.12, H.z - 0.25)), Vector((sx * 0.15, S.y + 0.12, S.z + 0.1)), Vector((sx * 0.12, S.y, S.z))]
                rings = []
                for p in catmull(pts, 5):
                    rings.append([(p.x - 0.022, p.y - 0.05, p.z), (p.x + 0.022, p.y - 0.05, p.z), (p.x + 0.022, p.y + 0.05, p.z), (p.x - 0.022, p.y + 0.05, p.z)])
                beam = loft('Spar', rings, M['alu'])
                bevel_mod(beam, 0.008, 1, 40)
                self.add('frame', beam)
                self.add('frame', tube('SubFrame', [Vector((sx * 0.11, S.y + 0.14, S.z + 0.02)), Vector((sx * 0.08, seatY - 0.04, tailZ + 0.1))], 0.013, fr, segs=8))
        else:
            low = 0.17 if not self.custom else 0.19
            for sx in (1, -1):
                x = sx * (0.075 if st['frame'] != 'chopper' else 0.06)
                bb = [H + Vector((sx * 0.02, 0.02, -0.04)), Vector((x, seatY - 0.06, rd['hipZ'] + 0.25)), Vector((x, seatY - 0.08, rd['hipZ'] - 0.05)), Vector((x * 1.1, seatY - 0.06, tailZ))]
                self.add('frame', tube('Backbone', bb, 0.017, fr, segs=self.seg(10, 8), smooth_pts=self.seg(4, 3)))
                dn = [H + Vector((sx * 0.02, -0.05, 0.0)), Vector((x, low + 0.1, H.z - 0.25 if st['frame'] != 'chopper' else H.z - 0.45)), Vector((x, low, S.z + 0.25)), Vector((x, S.y - 0.03, S.z))]
                self.add('frame', tube('Downtube', dn, 0.017, fr, segs=self.seg(10, 8), smooth_pts=self.seg(4, 3)))
                self.add('frame', tube('Strut', [Vector((x, S.y, S.z)), Vector((x, seatY - 0.08, rd['hipZ'] - 0.05))], 0.014, fr, segs=8))
        # Balança traseira (pivô próprio).
        wR = d['wR']
        for sx in (1, -1):
            a = Vector((sx * 0.09, S.y, S.z)); b = Vector((sx * (wR / 2 + 0.035), self.axR.y, self.axR.z))
            if self.sport:
                rings = [[(p.x - 0.015, p.y - 0.035, p.z), (p.x + 0.015, p.y - 0.035, p.z), (p.x + 0.015, p.y + 0.035, p.z), (p.x - 0.015, p.y + 0.035, p.z)] for p in (a, (a + b) / 2, b)]
                arm = loft('SwingArm', rings, M['alu']); bevel_mod(arm, 0.006, 1, 40)
            else:
                arm = tube('SwingArm', [a, b], 0.02, M['frame'], segs=10)
            self.add('swing', arm)
        self.add('swing', cylinder('SwingPivot', tuple(S), 0.025, 0.2, M['alu'], 'X', 12))
        # Corrente e coroa (lado esquerdo).
        cx = 0.1
        top = [Vector((cx, S.y + 0.045, S.z + 0.12)), Vector((cx, self.axR.y + 0.11, self.axR.z))]
        bot = [Vector((cx, S.y - 0.04, S.z + 0.12)), Vector((cx, self.axR.y - 0.11, self.axR.z))]
        self.add('swing', tube('ChainTop', top, 0.006, M['trim'], segs=6), tube('ChainBot', bot, 0.006, M['trim'], segs=6))
        self.add('swing', cylinder('Sprocket', (cx, self.axR.y, self.axR.z), 0.11, 0.008, M['alu'], 'X', 24))
        self.add('swing', cylinder('Sprocket2', (cx, S.y, S.z + 0.12), 0.045, 0.01, M['alu'], 'X', 16))
        if not self.sport:
            self.add('swing', box('ChainGuard', (cx + 0.01, self.axR.y + 0.13, (S.z + self.axR.z) / 2 + 0.05), (0.01, 0.03, abs(self.axR.z - S.z) * 0.7), M['chrome'] if self.custom else M['trim'], bevel=0.004))
        # Amortecedores (fixos ao quadro; esticam visualmente pouco com a balança).
        if st['shocks'] == 'dual':
            for sx in (1, -1):
                lo = Vector((sx * (wR / 2 + 0.05), self.axR.y + 0.05, self.axR.z + 0.1))
                hi = Vector((sx * 0.09, d['seatY'] - 0.06, self.axR.z + 0.25))
                self.add('frame', tube('Shock', [lo, hi], 0.016, M['chrome'], segs=10))
                self.add('frame', tube('Spring', [lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.8], 0.026, M['stripe'] if self.sport else M['trim'], segs=10))
        else:
            self.add('frame', tube('MonoShock', [S + Vector((0, 0.05, 0.05)), Vector((0, d['seatY'] - 0.12, S.z + 0.2))], 0.022, M['stripe2'], segs=10))
        # Pedaleiras, cavalete lateral.
        for sx in (1, -1):
            pp = Vector((sx * 0.17, rd['pegY'], rd['pegZ']))
            self.add('frame', cylinder('Peg', tuple(pp), 0.016, 0.09, M['rubber'], 'X', 10, bevel=0.004))
            if self.custom:
                # Comandos avançados: barra do pedal até o berço inferior do quadro.
                self.add('frame', tube('PegMount', [pp - Vector((sx * 0.04, 0, 0)), Vector((sx * 0.1, pp.y - 0.04, pp.z - 0.06)), Vector((sx * 0.08, 0.21, S.z + 0.3))], 0.012, M['chrome'], segs=8, smooth_pts=3))
                self.add('frame', box('PedalPlate', tuple(pp + Vector((sx * 0.02, 0.03, 0.04))), (0.05, 0.012, 0.1), M['chrome'], bevel=0.004))
            else:
                self.add('frame', tube('PegMount', [pp - Vector((sx * 0.05, 0, 0)), Vector((sx * 0.08, pp.y + 0.04, pp.z - 0.03))], 0.01, M['alu'], segs=6))
            if self.s['seats'] > 1:
                pz = rd['hipZ'] - 0.38
                self.add('frame', cylinder('PegP', (sx * 0.16, rd['pegY'] + 0.08, pz), 0.012, 0.07, M['rubber'], 'X', 8))
        self.add('frame', tube('Kickstand', [Vector((0.11, 0.24, S.z + 0.22)), Vector((0.14, 0.2, S.z - 0.05))], 0.009, M['trim'], segs=6))
        self.tailZ = tailZ

    # ------------------------------------------------------------ motor
    def engine(self):
        M, st = self.M, self.st
        kind = st['engine']
        ez = (self.S.z + self.H.z) / 2 - 0.02
        if self.custom:
            ez = (self.S.z + self.H.z) / 2 - 0.08
        base_y = 0.3
        E = self.groups['engine']
        width = {'single': 0.2, 'twin': 0.28, 'vtwin': 0.22, 'vtwin_big': 0.25, 'inline4': 0.42}[kind]
        E.append(box('Crankcase', (0, base_y, ez), (width, 0.2, 0.36 if kind != 'inline4' else 0.34), M['alu'], bevel=0.04))
        E.append(box('Gearbox', (0, base_y - 0.02, ez - 0.22), (width * 0.8, 0.17, 0.2), M['alu'], bevel=0.035))
        for sx in (1, -1):
            E.append(cylinder('SideCover', (sx * width / 2, base_y, ez + (0.05 if sx > 0 else -0.04)), 0.085, 0.03, M['chrome'] if not self.sport else M['alu'], 'X', 20, bevel=0.01))
        def cyl_block(name, cx, tilt, h, w, n_fins=7):
            # Cilindro aletado inclinado (tilt em radianos, positivo = para a frente).
            up = Vector((0, math.cos(tilt), math.sin(tilt)))
            b0 = Vector((cx, base_y + 0.09, ez + (0.04 if tilt >= 0 else -0.05)))
            for k in range(n_fins):
                c = b0 + up * (0.02 + k * h / n_fins)
                E.append(box(f'{name}Fin{k}', tuple(c), (w, 0.012, w * 1.05), M['alu'], bevel=0.0 if self.lo else 0.004, rot=(tilt, 0, 0)))
            E.append(cylinder(f'{name}Bore', tuple(b0 + up * h * 0.5), w * 0.38, h, M['trim'], 'Y', 14, rot=(tilt, 0, 0)))
            head = b0 + up * (h + 0.04)
            E.append(box(f'{name}Head', tuple(head), (w * 1.05, 0.07, w * 1.1), M['chrome'] if self.custom else M['alu'], bevel=0.015, rot=(tilt, 0, 0)))
            return head, up
        heads = []
        if kind == 'single':
            heads.append(cyl_block('Cyl', 0, 0.25, 0.2, 0.13))
        elif kind == 'twin':
            for cx in (-0.065, 0.065):
                heads.append(cyl_block(f'Cyl{cx}', cx, 0.2, 0.2, 0.11))
        elif kind in ('vtwin', 'vtwin_big'):
            h = 0.24 if kind == 'vtwin' else 0.27
            heads.append(cyl_block('CylF', 0, 0.55, h, 0.14 if kind == 'vtwin' else 0.16, 8))
            heads.append(cyl_block('CylR', 0, -0.4, h, 0.14 if kind == 'vtwin' else 0.16, 8))
            E.append(cylinder('AirCleaner', (-0.14, base_y + 0.22, ez), 0.085, 0.05, M['chrome'], 'X', 24, bevel=0.012))
        else:
            for k, cx in enumerate((-0.15, -0.05, 0.05, 0.15)):
                heads.append(cyl_block(f'Cyl{k}', cx, 0.35, 0.16, 0.09, 6))
            E.append(box('CamCover', tuple(Vector((0, base_y + 0.27, ez + 0.13))), (0.44, 0.05, 0.12), M['trim'] if not self.sport else M['stripe2'], bevel=0.015, rot=(0.35, 0, 0)))
            E.append(box('Radiator', (0, 0.62, self.H.z - 0.14), (0.34, 0.24, 0.04), M['trim'], bevel=0.008, rot=(-0.25, 0, 0)))
        self.heads = heads
        self.ez = ez
        # Carburador/caixa de ar sob o tanque.
        self.add('engine', box('Airbox', (0, base_y + 0.28, ez - 0.12), (width * 0.6, 0.1, 0.16), M['trim'], bevel=0.02))

    # ------------------------------------------------------------ tanque, banco, carroceria
    def tank_seat(self):
        M, st, d, rd = self.M, self.st, self.d, self.rd
        z0 = self.H.z - 0.06
        z1 = rd['hipZ'] + (0.16 if not self.custom else 0.2)
        topF = d['headY'] + (0.06 if not self.sport else 0.02)
        topR = d['seatY'] + (0.08 if not self.custom else 0.1)
        kind = st['tank']
        W = {'compact': 0.13, 'classic': 0.16, 'teardrop': 0.15, 'peanut': 0.1, 'sport': 0.17}[kind]
        Ht = {'compact': 0.17, 'classic': 0.2, 'teardrop': 0.2, 'peanut': 0.16, 'sport': 0.2}[kind]
        rings = []
        n = 12
        for i in range(n + 1):
            t = i / n
            z = lerp(z0, z1, t)
            ty = lerp(topF, topR, t) + 0.025 * math.sin(math.pi * t)
            prof = math.sin(math.pi * min(1, (t * 0.9 + 0.08))) ** 0.6
            if kind == 'teardrop':
                prof = math.sin(math.pi * (0.15 + t * 0.85)) ** 0.5 * (1.0 - 0.35 * t)
            w = W * (0.35 + 0.65 * prof)
            h = Ht * (0.45 + 0.55 * prof)
            ring = []
            for k in range(14):
                a = 2 * math.pi * k / 14
                se = 2.6 if kind == 'sport' else 2.2
                cx, cy = math.cos(a), math.sin(a)
                ring.append((math.copysign(abs(cx) ** (2 / se), cx) * w, ty - h / 2 + math.copysign(abs(cy) ** (2 / se), cy) * h / 2, z))
            rings.append(ring)
        tank = loft('FuelTank', rings, M['paint'])
        shade(tank, 40)
        self.add('tank', tank)
        self.add('tank', cylinder('FuelCap', (0, topF - 0.005 + 0.012, lerp(z0, z1, 0.35)), 0.032, 0.02, M['chrome'], 'Y', 16, bevel=0.005))
        if st.get('stripe') and not self.sport:
            for sx in (1, -1):
                self.add('tank', box('TankStripe', (sx * (W * 0.98), lerp(topF, topR, 0.45) - Ht * 0.25, lerp(z0, z1, 0.45)), (0.006, 0.035, (z0 - z1) * 0.7), M['stripe'], rot=(0, 0, 0)))
        if self.custom:
            self.add('tank', box('TankBadge', (0, lerp(topF, topR, 0.5) + 0.01, lerp(z0, z1, 0.5)), (0.04, 0.012, 0.12), M['stripe'], bevel=0.004))
        # Banco.
        sk = st['seat']
        sz0, sz1 = z1 + 0.02, self.tailZ + 0.05
        if sk == 'solo_low':
            sz1 = rd['hipZ'] - 0.18
        rings = []
        for i in range(10):
            t = i / 9
            z = lerp(sz0, sz1, t)
            h = d['seatY'] + 0.04
            if sk == 'stepped_custom':
                h = d['seatY'] + 0.03 + (0.09 if t > 0.55 else 0.0) * smooth((t - 0.5) / 0.1)
            elif sk == 'stepped_sport':
                h = d['seatY'] + 0.02 + 0.08 * smooth((t - 0.5) / 0.12)
            elif sk == 'solo_low':
                h = d['seatY'] + 0.03 + 0.06 * smooth((t - 0.6) / 0.4)
            w = 0.13 if t > 0.15 else 0.1
            if sk == 'solo_low':
                w = 0.15 * (1 - 0.3 * abs(t - 0.6))
            rings.append([(-w, h - 0.06, z), (w, h - 0.06, z), (w * 1.02, h - 0.015, z), (w * 0.75, h + 0.012, z), (-w * 0.75, h + 0.012, z), (-w * 1.02, h - 0.015, z)])
        seat = loft('Seat', rings, M['seat'])
        bevel_mod(seat, 0.012, 2, 35)
        self.add('seat', seat)
        # Carenagem traseira (esportivas) / tampas laterais.
        if self.sport:
            tz0, tz1 = rd['hipZ'] - 0.1, self.zR - 0.1
            rings = []
            for i in range(8):
                t = i / 7
                z = lerp(tz0, tz1, t)
                y0 = d['seatY'] - 0.13 + 0.15 * t
                y1 = d['seatY'] + 0.06 + 0.07 * t
                w = 0.15 * (1 - 0.5 * t)
                rings.append([(-w * 0.7, y0, z), (w * 0.7, y0, z), (w, lerp(y0, y1, 0.45), z), (w * 0.8, y1, z), (-w * 0.8, y1, z), (-w, lerp(y0, y1, 0.45), z)])
            tail = loft('TailCowl', rings, M['paint'])
            bevel_mod(tail, 0.012, 2, 35)
            self.add('body', tail)
            for sx in (1, -1):
                self.add('body', box('TailStripe', (sx * 0.116, d['seatY'] + 0.035, (tz0 + tz1) / 2), (0.006, 0.028, abs(tz1 - tz0) * 0.75), M['stripe'], rot=(-0.33, sx * 0.075, 0)))
            self.tailEnd = Vector((0, d['seatY'] + 0.06, tz1))
        else:
            for sx in (1, -1):
                self.add('body', box('SideCover', (sx * 0.085, d['seatY'] - 0.09, rd['hipZ'] + 0.04), (0.022, 0.1, 0.17), M['paint'] if not self.custom else M['chrome'], bevel=0.03, rot=(0.25, 0, 0)))
            # Para-lama traseiro.
            rR = d['rR']
            a0, a1 = (60, 175) if st['fenders'] != 'bobbed' else (75, 150)
            fpts = arc_pts(self.axR.y, self.axR.z, rR + 0.035, math.radians(a0), math.radians(a1), 12)
            rings = [[(-d['wR'] / 2 - 0.014, y - 0.012, z), (-d['wR'] * 0.3, y + 0.005, z), (d['wR'] * 0.3, y + 0.005, z), (d['wR'] / 2 + 0.014, y - 0.012, z)] for (_, y, z) in fpts]
            self.add('body', self._strip('RearFender', rings, M['chrome'] if st['fenders'] == 'chrome' else M['paint']))
            self.tailEnd = Vector((0, self.axR.y + (rR + 0.05) * math.sin(math.radians(125)), self.axR.z + (rR + 0.05) * math.cos(math.radians(125))))
        if sk == 'dual':
            gr = [Vector((0.12, d['seatY'] + 0.02, rd['hipZ'] - 0.2)), Vector((0.13, d['seatY'] + 0.05, self.tailZ + 0.12)), Vector((0, d['seatY'] + 0.06, self.tailZ + 0.02)), Vector((-0.13, d['seatY'] + 0.05, self.tailZ + 0.12)), Vector((-0.12, d['seatY'] + 0.02, rd['hipZ'] - 0.2))]
            self.add('body', tube('GrabRail', gr, 0.01, M['chrome'], segs=8, smooth_pts=4))
        if st.get('sissyBar'):
            sb = [Vector((0.09, d['seatY'], self.zR + 0.25)), Vector((0.08, d['seatY'] + 0.55, self.zR + 0.15)), Vector((0, d['seatY'] + 0.62, self.zR + 0.13)), Vector((-0.08, d['seatY'] + 0.55, self.zR + 0.15)), Vector((-0.09, d['seatY'], self.zR + 0.25))]
            self.add('body', tube('SissyBar', sb, 0.011, M['chrome'], segs=8, smooth_pts=5))
            self.add('seat', box('Backrest', (0, d['seatY'] + 0.3, self.zR + 0.2), (0.2, 0.22, 0.05), M['seat'], bevel=0.02, rot=(-0.15, 0, 0)))

    def _shell(self, name, sections, mat, cap_front=False, thick=0.007, angle=45):
        """Casca aberta a partir de seções (listas de pontos) ao longo do eixo Z."""
        mb = MB()
        rows = [[mb.add_v(p) for p in sec] for sec in sections]
        for i in range(len(rows) - 1):
            for j in range(len(rows[0]) - 1):
                mb.face([rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]])
        if cap_front:
            mb.face(list(reversed(rows[0])))
        ob = mb.to_object(name, [mat])
        solidify(ob, thick, -1.0)
        shade(ob, angle)
        return ob

    def fairing(self):
        M, st, d, rd = self.M, self.st, self.d, self.rd
        if st['fairing'] == 'none':
            return
        H = self.H
        ang = st['fairing'] == 'full_angular'
        hy = d['headY']
        zN, zB = H.z + 0.31, H.z - 0.04           # bico e base do para-brisa
        # Carenagem superior (bico): seção em U fechada no topo, estreita na frente.
        secs = []
        n = 9
        for i in range(n + 1):
            t = i / n
            z = lerp(zN, zB, t)
            e = math.sin(t * math.pi / 2)
            top = lerp(hy - 0.09, hy + 0.05, smooth(t))
            bot = lerp(hy - 0.25, 0.6, e)
            w = lerp(0.085, 0.215, e ** 0.75)
            if ang:
                prof = [(-1.0, 0.0), (-1.08, 0.5), (-0.62, 0.95), (0.0, 1.06), (0.62, 0.95), (1.08, 0.5), (1.0, 0.0)]
            else:
                prof = []
                for k in range(11):
                    a = -math.pi / 2 + math.pi * k / 10
                    prof.append((math.sin(a) * 1.03, abs(math.cos(a)) ** 0.65))
            secs.append([(px * w, bot + py * (top - bot), z) for px, py in prof])
        self.add('body', self._shell('Fairing', secs, M['paint'], cap_front=True, angle=30 if ang else 50))
        self.noseTop = secs[0]
        # Painéis laterais: do bico até sob o tanque, cobrindo o motor.
        zS0, zS1 = H.z + 0.07, rd['hipZ'] + 0.2
        for sx in (1, -1):
            secs = []
            m = 8
            for i in range(m + 1):
                t = i / m
                z = lerp(zS0, zS1, t)
                top = lerp(0.68, 0.75, t)
                if t < 0.4:
                    bot = lerp(0.6, 0.25, smooth(t / 0.4))
                elif t < 0.78:
                    bot = 0.25
                else:
                    bot = lerp(0.25, 0.56, smooth((t - 0.78) / 0.22))
                wt, wm, wb = lerp(0.215, 0.19, t), lerp(0.25, 0.235, t), lerp(0.225, 0.2, t)
                if ang:
                    col = [(wt, top), (wm + 0.01, lerp(top, bot, 0.42)), (wb, bot)]
                else:
                    col = [(wt, top), (wm * 0.98, lerp(top, bot, 0.25)), (wm, lerp(top, bot, 0.5)), (wm * 0.97, lerp(top, bot, 0.75)), (wb, bot)]
                pts = [(sx * x, y, z) for x, y in col]
                secs.append(pts if sx > 0 else list(reversed(pts)))
            self.add('body', self._shell('SidePanel', secs, M['paint'], angle=30 if ang else 50))
        # Quilha sob o motor.
        secs = []
        for i in range(5):
            t = i / 4
            z = lerp(zS0 - 0.12, zS1 + 0.12, t)
            yb = 0.18 + 0.05 * abs(t - 0.45)
            secs.append([(-0.2, 0.27, z), (-0.12, yb + 0.02, z), (0.0, yb, z), (0.12, yb + 0.02, z), (0.2, 0.27, z)])
        self.add('body', self._shell('BellyPan', secs, M['paint'], angle=35))
        # Faixas de cor nos painéis (diagonais, acompanhando o painel).
        for sx in (1, -1):
            x = sx * 0.257
            self.add('body', box('FairingStripe', (x, 0.52, lerp(zS0, zS1, 0.4)), (0.006, 0.05, 0.46), M['stripe'], rot=(0.32, 0, 0)))
            self.add('body', box('FairingStripe2', (x, 0.44, lerp(zS0, zS1, 0.45)), (0.006, 0.025, 0.4), M['stripe2'], rot=(0.32, 0, 0)))
        # Faróis no bico.
        fy = hy - 0.17
        for sx in (1, -1):
            if ang:
                self.add('lights', box('HeadLens', (sx * 0.042, fy + 0.01, zN + 0.004), (0.07, 0.04, 0.012), M['head'], bevel=0.004, rot=(0, 0, sx * 0.3)))
            else:
                self.add('lights', box('HeadLens', (sx * 0.042, fy, zN + 0.004), (0.075, 0.07, 0.012), M['head'], bevel=0.006))
        # Para-brisa sobre o topo da carenagem, subindo em direção ao piloto.
        rings = []
        for i in range(5):
            t = i / 4
            z = lerp(lerp(zN, zB, 0.3), zB - 0.03, t)
            y = lerp(hy - 0.01, hy + 0.21, t)
            w = 0.1 + 0.075 * t
            rings.append([(-w, y - 0.025, z), (-w * 0.5, y, z), (0, y + 0.008, z), (w * 0.5, y, z), (w, y - 0.025, z)])
        mb = MB()
        ids = [[mb.add_v(p) for p in r] for r in rings]
        for i in range(4):
            for j in range(4):
                mb.face([ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j]])
        ws = mb.to_object('Windscreen', [M['glass']])
        flat(ws)
        self.add('body', ws)
        # Painel atrás do para-brisa, retrovisores na carenagem.
        for sx in (1, 0, -1):
            self.add('body', cylinder('Gauge', (sx * 0.065, hy + 0.05, zB - 0.02), 0.034, 0.004, M['gauge'], 'Y', 16, rot=(-0.6, 0, 0)))
        for sx in (1, -1):
            self.add('body', tube('MirrorArm', [Vector((sx * 0.2, hy + 0.0, zB + 0.04)), Vector((sx * 0.27, hy + 0.06, zB + 0.02))], 0.008, M['trim'], segs=6))
            self.add('body', box('Mirror', (sx * 0.29, hy + 0.07, zB + 0.02), (0.1, 0.05, 0.03), M['paint'], bevel=0.012))
            self.add('lights', box('TurnF', (sx * 0.29, hy + 0.06, zB + 0.04), (0.06, 0.018, 0.012), M['amber'], bevel=0.004))

    # ------------------------------------------------------------ escapamento, luzes traseiras, placa
    def exhaust(self):
        M, st = self.M, self.st
        X = self.groups['exhaust']
        kind = st['exhaust']
        endZ = self.zR - 0.05
        if kind in ('four_into_one', 'four_into_one_high'):
            col = Vector((-0.12, 0.2, self.ez - 0.1))
            for k, (hd, up) in enumerate(self.heads):
                p0 = hd + up * -0.02 + Vector((0, -0.02, 0.06))
                X.append(tube(f'Header{k}', [p0, p0 + Vector((0, -0.12, 0.05)), Vector((hd.x * 0.8, 0.2, self.ez + 0.18)), col], 0.018, M['chrome'], segs=8, smooth_pts=4))
            mz = endZ + 0.25
            my = 0.32 if kind == 'four_into_one' else 0.55
            X.append(tube('LinkPipe', [col, Vector((-0.16, 0.24, self.S.z)), Vector((-0.17, my, mz + 0.18))], 0.03, M['chrome'], segs=10, smooth_pts=4))
            X.append(cylinder('Muffler', (-0.17, my + 0.03, mz), 0.055, 0.36, M['alu'] if kind == 'four_into_one' else M['trim'], 'Z', 18, bevel=0.012, rot=(-0.15, 0, 0)))
        else:
            pipes = []
            for k, (hd, up) in enumerate(self.heads):
                side = -1 if kind != 'staggered_dual' and kind != 'long_dual' else (-1)
                p0 = hd + Vector((0, -0.04, 0.05 if up.z > 0 else -0.05))
                if kind == 'low_single':
                    pts = [p0, p0 + Vector((-0.05, -0.15, 0.08)), Vector((-0.12, 0.2, self.ez + 0.05)), Vector((-0.15, 0.22, self.S.z)), Vector((-0.16, 0.28, endZ + 0.3))]
                    mf = (Vector((-0.16, 0.3, endZ + 0.2)), 0.05, 0.38)
                elif kind == 'twin_chrome':
                    sx = 1 if k == 0 else -1
                    pts = [p0, p0 + Vector((sx * 0.03, -0.15, 0.08)), Vector((sx * 0.12, 0.18, self.ez + 0.05)), Vector((sx * 0.15, 0.2, self.S.z)), Vector((sx * 0.16, 0.26, endZ + 0.32))]
                    mf = (Vector((sx * 0.16, 0.28, endZ + 0.2)), 0.045, 0.4)
                else:  # escapamentos custom à direita, um acima do outro
                    yo = 0.06 if k == 0 else -0.03
                    pts = [p0, p0 + Vector((-0.08, -0.06 if up.z > 0 else 0.0, 0.02)), Vector((-0.15, 0.24 + yo, self.ez - 0.05)), Vector((-0.17, 0.22 + yo, self.S.z)), Vector((-0.18, 0.24 + yo * 1.5, endZ + (0.25 if kind == 'staggered_dual' else 0.05)))]
                    mf = (Vector((-0.18, 0.25 + yo * 1.5, endZ + (0.1 if kind == 'staggered_dual' else -0.12))), 0.04, 0.42 if kind == 'staggered_dual' else 0.3)
                X.append(tube(f'Pipe{k}', pts, 0.02, M['chrome'], segs=self.seg(10, 8), smooth_pts=self.seg(4, 3)))
                X.append(cylinder(f'Muffler{k}', tuple(mf[0]), mf[1], mf[2], M['chrome'], 'Z', 16, bevel=0.01))

    def rear_lights(self):
        M = self.M
        te = self.tailEnd
        L = self.groups['lights']
        L.append(box('TailLight', tuple(te + Vector((0, 0.01, -0.01))), (0.12 if not self.custom else 0.08, 0.05, 0.04), M['tail'], bevel=0.008))
        for sx in (1, -1):
            p = te + Vector((sx * 0.13, -0.04, 0.02))
            L.append(cylinder('TurnR', tuple(p), 0.022, 0.05, M['amber'], 'Z', 12, bevel=0.006))
            self.add('body', tube('TurnRStalk', [te + Vector((sx * 0.04, -0.04, 0.03)), p + Vector((0, 0, 0.02))], 0.006, M['chrome'], segs=6))
        # Placa (UV inteira, voltada para trás).
        w, h = 0.2, 0.12
        c = te + Vector((0, -0.12, -0.04))
        mb = MB()
        q = [(c.x + w / 2, c.y - h / 2, c.z), (c.x - w / 2, c.y - h / 2, c.z), (c.x - w / 2, c.y + h / 2, c.z), (c.x + w / 2, c.y + h / 2, c.z)]
        mb.face([mb.add_v(p) for p in q])
        pl = mb.to_object('Plate_R', [M['plate']])
        uv = pl.data.uv_layers.new(name='UVMap')
        for loop in pl.data.loops:
            v = pl.data.vertices[loop.vertex_index].co
            gx, gy = v.x, v.z
            uv.data[loop.index].uv = (1 - (gx - (c.x - w / 2)) / w, (gy - (c.y - h / 2)) / h)
        if pl.data.polygons[0].normal.y < 0:
            pl.data.flip_normals()
        flat(pl)
        self.plate = pl
        self.add('body', box('PlateBracket', tuple(c + Vector((0, 0.07, 0.02))), (0.05, 0.08, 0.02), M['trim'], bevel=0.005))

    # ------------------------------------------------------------ montagem
    def build(self):
        self.frame()
        self.engine()
        self.tank_seat()
        self.fairing()
        self.front()
        self.exhaust()
        self.rear_lights()
        d = self.d
        tF, rF, sF = self.wheel('F', d['rF'], d['wF'], True)
        tR, rR, sR = self.wheel('R', d['rR'], d['wR'], False)
        # Pinças de freio (não giram): no garfo (frente) e na balança (trás).
        for sx in sF:
            self.add('fork', box('CaliperF', (sx * 0.065, self.axF.y + d['rF'] * 0.38, self.axF.z - d['rF'] * 0.32), (0.03, 0.08, 0.05), self.M['trim'] if not self.sport else self.M['stripe'], bevel=0.008))
        for sx in sR if self.s['category'] != 'basica' else ():
            self.add('swing', box('CaliperR', (sx * 0.085, self.axR.y + d['rR'] * 0.3, self.axR.z - d['rR'] * 0.4), (0.03, 0.07, 0.05), self.M['trim'], bevel=0.008))
        for o in (tF, rF):
            o.location = G(*self.axF)
        for o in (tR, rR):
            o.location = G(*self.axR)
        self.wheelObjs = {'F': (tF, rF), 'R': (tR, rR)}
        self.assemble()
        return self

    def assemble(self):
        root = empty('MotorcycleRoot')
        root['neonType'] = self.s['type']
        self.root = root
        names = {'frame': 'Frame', 'engine': 'Engine', 'tank': 'FuelTank', 'seat': 'Seat', 'exhaust': 'Exhaust', 'body': 'Bodywork', 'lights': 'Lights'}
        self.final = {}
        for k, nm in names.items():
            ob = join(self.groups[k], nm)
            if ob:
                parent(ob, root)
                self.final[nm] = ob
        parent(self.plate, root)
        # Garfo: pivô no eixo de direção, eixo local Y = eixo de direção (inclinado pelo rake).
        fork_mesh = join(self.groups['fork'], 'FrontForkMesh')
        fork = empty('FrontFork', tuple(self.H))
        fork.rotation_euler = (-self.d['rake'], 0, 0)
        parent(fork, root)
        parent(fork_mesh, fork)
        fw = empty('FrontWheel', tuple(self.axF))
        parent(fw, fork)
        for o in self.wheelObjs['F']:
            parent(o, fw)
        for sx, g in self.grips:
            e = empty('Grip_L' if sx > 0 else 'Grip_R', g)
            parent(e, fork)
        # Balança: pivô próprio; roda traseira presa a ela.
        sw_mesh = join(self.groups['swing'], 'SwingarmMesh')
        sw = empty('Swingarm', tuple(self.S))
        parent(sw, root)
        parent(sw_mesh, sw)
        rw = empty('RearWheel', tuple(self.axR))
        parent(rw, sw)
        for o in self.wheelObjs['R']:
            parent(o, rw)
        rd = self.rd
        for nm, p in (('Rider_Hip', (0, rd['hipY'], rd['hipZ'])), ('Peg_L', (0.17, rd['pegY'], rd['pegZ'])), ('Peg_R', (-0.17, rd['pegY'], rd['pegZ']))):
            parent(empty(nm, p), root)
        self.final['FrontFork'] = fork
        self.final['Swingarm'] = sw
        self.final['FrontWheel'] = fw
        self.final['RearWheel'] = rw
        bpy.context.view_layer.update()
