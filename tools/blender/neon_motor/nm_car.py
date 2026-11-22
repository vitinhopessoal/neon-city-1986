# NEON MOTOR COMPANY — gerador paramétrico de carros (carroceria loft + booleanos reais).
# Lê uma entrada de src/vehicles/models/neon-motor-specs.json e monta a cena com a hierarquia
# VehicleRoot / Body / Chassis / Interior / Windows / Lights / Wheel_* / Door_* / Hood / Trunk|Tailgate /
# SteeringWheel / Popup_* / Plate_F / Plate_R.
import bpy, math
from mathutils import Vector, Matrix
from nm_lib import *

V_ROWS = [0.0, 0.07, 0.3, 0.55, 0.8, 0.93, 1.0]   # linhas da estufa (base, vidro..., teto)
GLASS_V = (0.07, 0.93)


class Car:
    def __init__(self, spec):
        self.s = spec
        d, b, st = spec['dims'], spec['body'], spec['style']
        self.d, self.b, self.st = d, b, st
        self.W2 = d['width'] / 2
        self.r = d['wheelRadius']
        self.wb = d['wheelBase']
        self.track = d['track']
        self.L2o = d['length'] / 2
        self.bumperOut = 0.0 if st['bumper'] == 'body' else 0.055
        self.L2 = self.L2o - self.bumperOut
        self.doorT = 0.075
        self.rear = b['rear']
        self.objs = {k: [] for k in ('body', 'windows', 'lights', 'interior', 'chassis')}
        self.pivots = {}          # nome -> {'hinge': (x,y,z), 'objs': [...], 'axis': 'X'|'Y'}
        self.wheels = {}
        self.report = {'warnings': []}
        self._mk_materials()

    # ------------------------------------------------------------ materiais
    def _mk_materials(self):
        s, st = self.s, self.st
        metallic = s['category'] != 'popular'
        self.M = {
            'paint': material('Paint', s['color'], metal=0.55 if metallic else 0.15, rough=0.28 if metallic else 0.38, coat=1.0 if metallic else 0.5, coat_rough=0.08),
            'chrome': material('Chrome', '#e8ecf2', metal=1.0, rough=0.08),
            'trim': material('Black_Trim', '#141417', metal=0.1, rough=0.55),
            'grille': material('Grille', '#0b0b0d', metal=0.2, rough=0.6),
            'rubber': material('Rubber', '#151517', rough=0.9),
            'rim': material('Rim', '#d4d8de' if st.get('rimColor') != 'gold' else '#c9a227', metal=1.0, rough=0.22),
            'glass': material('Glass', '#1b2a3a', metal=0.1, rough=0.03, alpha=0.4),
            'head': material('Headlight', '#f4f6ff', metal=0.3, rough=0.1, emit='#fff2d6', emit_strength=0.6),
            'tail': material('Taillight', '#8a0f18', rough=0.2, emit='#ff2030', emit_strength=0.6),
            'reverse': material('Reverse', '#d8dce4', rough=0.15, emit='#ffffff', emit_strength=0.0),
            'amber': material('Amber', '#c87a10', rough=0.2, emit='#ff9a20', emit_strength=0.4),
            'interior': material('Interior', st['interior'], rough=0.75),
            'seat': material('Seat', st['seat'], rough=0.7),
            'carpet': material('Carpet', '#1e1d1f', rough=0.95),
            'headliner': material('Headliner', '#cfc8bb', rough=0.9),
            'gauge': material('Gauge', '#ff8cc8', emit='#ff8cc8', emit_strength=1.5),
            'plate': material('Plate', '#f2f2ee', rough=0.5),
            'chassis': material('Chassis', '#0e0e10', rough=0.8),
            'wood': material('Wood', '#7a4524', rough=0.45, coat=0.6),
            'vinyl': material('Vinyl', '#2a1e22', rough=0.6),
            'stripe': material('Stripe', '#ff5fa8', metal=0.3, rough=0.35, coat=0.8),
        }

    # ------------------------------------------------------------ forma
    def halfw(self, z):
        b, L2 = self.b, self.L2
        t = clamp((z - b['cowlZ']) / max(L2 - b['cowlZ'], 0.05), 0.0, 1.0)
        w = self.W2 - b['frontTaper'] * t * t
        rc = b['cornerFront']
        zc = L2 - rc
        if z > zc:
            dd = min(z - zc, rc)
            w -= rc - math.sqrt(max(rc * rc - dd * dd, 0.0))
        rr = b['cornerRear']
        zr = -L2 + rr
        if z < zr:
            dd = min(zr - z, rr)
            w -= rr - math.sqrt(max(rr * rr - dd * dd, 0.0))
        return w

    def belt(self, z):
        b = self.b
        t = clamp((b['cowlZ'] - z) / (b['cowlZ'] + self.L2), 0.0, 1.0)
        return lerp(b['beltY'], b['beltRear'], t)

    def top(self, z):
        b, L2 = self.b, self.L2
        if z >= b['cowlZ']:
            t = (z - b['cowlZ']) / max(L2 - b['cowlZ'], 0.05)
            return lerp(b['cowlY'], b['noseTopY'], t) + 0.012 * math.sin(math.pi * t)
        y = self.belt(z)
        k = clamp((z - (b['cowlZ'] - 0.15)) / 0.15, 0.0, 1.0)
        y = lerp(y, b['cowlY'], k)
        if self.rear in ('notch', 'mid', 'roadster'):
            zb = b['rearBaseZ'] if self.rear != 'mid' else b['roofRearZ'] - 0.07
            deck0 = b.get('deckY', y)
            if z < zb:
                t = clamp((zb - z) / (zb + L2), 0.0, 1.0)
                yd = lerp(deck0, b['tailTopY'], t)
                k = clamp((zb - z) / 0.06, 0.0, 1.0)
                y = lerp(y, yd, k)
        else:
            if z < -L2 + 0.3:
                y = lerp(y, b['tailTopY'], ((-L2 + 0.3) - z) / 0.3)
        return y

    def arch_r(self):
        return self.r + (0.065 if self.s['category'] == 'luxo' else 0.055)

    def side_top(self, z):
        """Altura dos ombros: nunca abaixo do topo do pneu + folga perto dos eixos."""
        t = self.top(z)
        fy = 2 * self.r + 0.055
        ra = self.arch_r()
        k = 0.0
        for zA in (self.wb / 2, -self.wb / 2):
            dd = abs(z - zA)
            if dd < ra:
                k = 1.0
            elif dd < ra + 0.22:
                k = max(k, smooth(1 - (dd - ra) / 0.22))
        return max(t, lerp(t, fy, k)) if fy > t else t

    def ring(self, z):
        b = self.b
        w = self.halfw(z)
        t = self.top(z)
        endk = smooth((abs(z) - (self.L2 - 0.5)) / 0.5)
        bot = b['bottomY'] + 0.07 * endk
        sill = b['sillY'] + 0.07 * endk
        ts = self.side_top(z)
        shoulder = min(max(self.belt(z), ts + 0.03) - 0.06, ts - 0.035)
        crease = min(b['creaseY'], shoulder - 0.06)
        sill = min(sill, crease - 0.06)
        bot = min(bot, sill - 0.05)
        wb = w - b['shoulderInset']
        cr = b['crown']
        right = [(w - 0.14, bot), (w - 0.035, sill), (w, crease), (w - 0.02, shoulder), (wb, ts), (wb * 0.5, t + cr * 0.75 + (ts - t) * 0.35)]
        pts = [(0.0, bot)] + right + [(0.0, t + cr)] + [(-x, y) for (x, y) in reversed(right)]
        return [(x, y, z) for (x, y) in pts]

    def stations(self):
        L2 = self.L2
        zs = set()
        rf, rr = self.b['cornerFront'], self.b['cornerRear']
        for i in range(8):
            a = (i / 7) * math.pi / 2
            zs.add(round(L2 - rf + math.sin(a) * rf, 5))
            zs.add(round(-L2 + rr - math.sin(a) * rr, 5))
        z = -L2 + rr
        while z < L2 - rf:
            zs.add(round(z, 5))
            z += 0.07
        for k in ('cowlZ', 'roofFrontZ', 'roofRearZ', 'rearBaseZ'):
            v = self.b.get(k)
            if v is not None and -L2 < v < L2:
                zs.add(round(v, 5))
        return sorted(zs)

    # ------------------------------------------------------------ regiões de corte
    def band(self, name, z0, z1, xlo, xhi, ylo, yhi, mat, steps=None):
        """Sólido entre z0..z1 com seção retangular [xlo(z), xhi(z)] x [ylo(z), yhi(z)] (funções ou constantes)."""
        f = lambda v: (v if callable(v) else (lambda z, c=v: c))
        xlo, xhi, ylo, yhi = f(xlo), f(xhi), f(ylo), f(yhi)
        n = steps or max(2, int(abs(z1 - z0) / 0.06) + 1)
        rings = []
        for i in range(n + 1):
            z = lerp(z0, z1, i / n)
            a, b_, c, d = xlo(z), xhi(z), ylo(z), yhi(z)
            rings.append([(a, c, z), (b_, c, z), (b_, d, z), (a, d, z)])
        return loft(name, rings, mat)

    def cut(self, cutter_fn, op='DIFFERENCE'):
        boolean(self.body, cutter_fn(), op)

    def split_piece(self, name, region_fn, gap_fn):
        """Separa uma peça (porta, capô...) da carroceria: interseção com a região + vão na carroceria."""
        piece = duplicate(self.body, name)
        boolean(piece, region_fn(), 'INTERSECT')
        boolean(self.body, gap_fn(), 'DIFFERENCE')
        return piece

    # ------------------------------------------------------------ carroceria
    def build_body(self):
        b, M = self.b, self.M
        rings = [self.ring(z) for z in self.stations()]
        self.body = loft('BodyShell', rings, M['paint'])
        bevel_mod(self.body, width=0.022, segments=2, angle=26)
        # Caixas de roda (o material do cortador vira o forro preto do para-lama).
        ra = self.r + (0.065 if self.s['category'] == 'luxo' else 0.055)
        for zA in (self.wb / 2, -self.wb / 2):
            for sx in (1, -1):
                self.cut(lambda zA=zA, sx=sx: cylinder('arch', (sx * (self.W2 - 0.03), self.r + 0.01, zA), ra, 0.56, M['chassis'], 'X', 36))
        # Cabine (paredes internas e assoalho na cor do interior).
        rear = self.rear
        cz1 = b['cowlZ'] - 0.03
        if rear in ('hatch', 'wagon', 'fastback'):
            cz0 = -self.L2 + 0.13
        elif rear == 'mid':
            cz0 = b['roofRearZ'] - 0.06
        else:
            cz0 = b['rearBaseZ'] + 0.04
        self.cabin = (cz0, cz1)
        dt = self.doorT
        self.cut(lambda: self.band('cabin', cz0, cz1, lambda z: -(self.halfw(z) - dt), lambda z: self.halfw(z) - dt, self.d['floorY'], 2.5, M['interior']))
        self._lamp_recesses()
        if b.get('sideIntake'):
            for sx in (1, -1):
                zc = -self.wb / 2 + self.r + 0.42
                self.cut(lambda sx=sx, zc=zc: box('intake', (sx * (self.W2 + 0.02), b['creaseY'] + 0.07, zc), (0.14, 0.17, 0.46), M['grille'], bevel=0.02, rot=(0, 0, 0)))
        self._panels()
        self.objs['body'].append(self.body)

    def _lamp_recesses(self):
        st, M, L2 = self.st, self.M, self.L2
        nose = self.b['noseTopY']
        self.lamps = {'head': [], 'tail': [], 'grille': None}
        hw, hh = st['headSize']
        flatw = self.halfw(L2) - 0.03
        yH = nose - 0.035 - hh / 2
        kind = st['head']
        if kind == 'rect' or kind == 'slim':
            for sx in (1, -1):
                x = sx * (flatw - hw / 2 - 0.02)
                self.lamps['head'].append((x, yH, hw, hh))
        elif kind == 'quad':
            for sx in (1, -1):
                for k in (0, 1):
                    x = sx * (flatw - hw / 2 - 0.02 - k * (hw + 0.03))
                    self.lamps['head'].append((x, yH, hw, hh))
        for (x, y, w, h) in self.lamps['head']:
            self.cut(lambda x=x, y=y, w=w, h=h: box('hrec', (x, y, L2 + 0.05), (w + 0.03, h + 0.03, 0.16), M['trim']))
        # Grade entre os faróis.
        if self.lamps['head']:
            inner = min(abs(l[0]) - l[2] / 2 for l in self.lamps['head']) - 0.04
        else:
            inner = flatw - 0.12
        gh = hh + 0.02 if st['grille'] != 'slot' else 0.07
        gy = yH if st['grille'] != 'slot' else self.b['noseTopY'] - 0.16
        if kind == 'popup':
            inner = flatw - 0.25
        self.lamps['grille'] = (inner, gy, gh)
        self.cut(lambda: box('grec', (0, gy, L2 + 0.05), (inner * 2, gh, 0.15), M['grille']))
        # Lanternas.
        tl = st['tail']
        rw = self.halfw(-L2) - 0.03
        ty = self.b['tailTopY'] - 0.13
        if tl in ('band', 'band_full', 'louver', 'wide'):
            self.lamps['tail'] = [(0.0, ty, rw * 2 - 0.04, 0.15 if tl != 'louver' else 0.13)]
        elif tl == 'tall':
            for sx in (1, -1):
                self.lamps['tail'].append((sx * (rw - 0.10), ty - 0.08, 0.17, 0.32))
        else:
            for sx in (1, -1):
                self.lamps['tail'].append((sx * (rw - 0.22), ty, 0.40, 0.16))
        for (x, y, w, h) in self.lamps['tail']:
            self.cut(lambda x=x, y=y, w=w, h=h: box('trec', (x, y, -L2 - 0.05), (w + 0.02, h + 0.02, 0.14), M['trim']))

    def _panels(self):
        b, M, L2, st = self.b, self.M, self.L2, self.st
        ins = b['shoulderInset'] + 0.012
        g = 0.005
        top = self.top
        # Faróis escamoteáveis.
        if st['head'] == 'popup':
            z0, z1 = L2 - 0.62, L2 - 0.17
            for sx, nm in ((1, 'Popup_L'), (-1, 'Popup_R')):
                xa, xb = 0.30, None
                xb_f = lambda z: self.halfw(z) - ins - 0.02
                lo = (lambda z, xa=xa: xa) if sx > 0 else (lambda z: -(self.halfw(z) - ins - 0.02))
                hi = xb_f if sx > 0 else (lambda z, xa=xa: -xa)
                lo_g = (lambda z, xa=xa: xa - g) if sx > 0 else (lambda z: -(self.halfw(z) - ins - 0.02 + g))
                hi_g = (lambda z: self.halfw(z) - ins - 0.02 + g) if sx > 0 else (lambda z, xa=xa: -xa + g)
                piece = self.split_piece(nm,
                    lambda: self.band('pr', z0, z1, lo, hi, lambda z: top(z) - 0.045, lambda z: top(z) + 0.5, M['chassis']),
                    lambda: self.band('pg', z0 - g, z1 + g, lo_g, hi_g, lambda z: top(z) - 0.05, lambda z: top(z) + 0.5, M['chassis']))
                xm = sx * (0.30 + (self.halfw(z1) - ins - 0.02 - 0.30) / 2)
                wl = (self.halfw(z1) - ins - 0.02 - 0.30) - 0.04
                # Farol sob a tampa: lente voltada para baixo-frente fechada, para a frente aberta (-1,2 rad).
                hinge = (xm, top(z0) - 0.005, z0)
                lamp = self._popup_lamp(nm, hinge, xm, wl, z1, top(z1))
                self.pivots[nm] = {'hinge': hinge, 'objs': [piece, lamp], 'axis': 'X'}
        # Capô.
        hz0, hz1 = b['cowlZ'] + 0.035, L2 - 0.055
        hood = self.split_piece('Hood',
            lambda: self.band('hr', hz0, hz1, lambda z: -(self.halfw(z) - ins), lambda z: self.halfw(z) - ins, lambda z: top(z) - 0.05, lambda z: top(z) + 0.6, M['chassis']),
            lambda: self.band('hg', hz0 - g, hz1 + g, lambda z: -(self.halfw(z) - ins + g), lambda z: self.halfw(z) - ins + g, lambda z: top(z) - 0.055, lambda z: top(z) + 0.6, M['chassis']))
        self.pivots['Hood'] = {'hinge': (0.0, top(hz0) + 0.01, hz0), 'objs': [hood], 'axis': 'X'}
        # Porta-malas / tampa do motor / tampa traseira.
        if self.rear in ('notch', 'mid', 'roadster'):
            if self.rear == 'mid':
                tz0, tz1 = -L2 + 0.09, b['roofRearZ'] - 0.13
            else:
                tz0, tz1 = -L2 + 0.07, b['rearBaseZ'] - 0.035
            trunk = self.split_piece('Trunk',
                lambda: self.band('tr', tz0, tz1, lambda z: -(self.halfw(z) - ins), lambda z: self.halfw(z) - ins, lambda z: top(z) - 0.05, lambda z: top(z) + 0.6, M['chassis']),
                lambda: self.band('tg', tz0 - g, tz1 + g, lambda z: -(self.halfw(z) - ins + g), lambda z: self.halfw(z) - ins + g, lambda z: top(z) - 0.055, lambda z: top(z) + 0.6, M['chassis']))
            self.pivots['Trunk'] = {'hinge': (0.0, top(tz1) + 0.01, tz1), 'objs': [trunk], 'axis': 'X'}
        else:
            yb = 0.55
            tz0, tz1 = -L2 - 0.12, -L2 + 0.16
            gate = self.split_piece('Tailgate',
                lambda: self.band('tgr', tz0, tz1, lambda z: -(self.halfw(z) - 0.10), lambda z: self.halfw(z) - 0.10, yb, lambda z: top(z) + 0.6, M['chassis']),
                lambda: self.band('tgg', tz0 - g, tz1 + g, lambda z: -(self.halfw(z) - 0.10 + g), lambda z: self.halfw(z) - 0.10 + g, yb - g, lambda z: top(z) + 0.6, M['chassis']))
            self.pivots['Tailgate'] = {'hinge': (0.0, b['roofY'], b['roofRearZ']), 'objs': [gate], 'axis': 'X'}
        # Portas (dobradiça na borda dianteira).
        ids = [('Door_FL', 1, 0), ('Door_FR', -1, 0), ('Door_RL', 1, 1), ('Door_RR', -1, 1)]
        self.doors = []
        for nm, sx, k in ids:
            if k >= len(b['doorZ']):
                continue
            z1, z0 = b['doorZ'][k]
            xi = self.W2 - self.doorT - 0.03
            yb, yt = b['sillY'] + 0.035, self.belt((z0 + z1) / 2) + 0.45
            cx = sx * (xi + (0.6 / 2))
            piece = self.split_piece(nm,
                lambda: box('dr', (cx, (yb + yt) / 2, (z0 + z1) / 2), (0.6, yt - yb, (z1 - z0) - 2 * g), M['chassis']),
                lambda: box('dg', (cx, (yb + yt) / 2 - g / 2, (z0 + z1) / 2), (0.6 + 0.01, yt - yb + g, (z1 - z0) + 2 * g), M['chassis']))
            hinge = (sx * self.halfw(z1), b['creaseY'], z1)
            self.pivots[nm] = {'hinge': hinge, 'objs': [piece], 'axis': 'Y'}
            self.doors.append({'name': nm, 'side': sx, 'z0': z0, 'z1': z1, 'rear': k == 1})

    def _popup_lamp(self, nm, hinge, xm, wl, z1, ytop):
        M = self.M
        # Caixa do farol logo abaixo da tampa, na borda dianteira (fica dentro da carroceria fechada).
        zf = z1 - 0.02
        housing = box(nm + '_housing', (xm, ytop - 0.11, zf - 0.07), (wl, 0.12, 0.14), M['trim'], bevel=0.01)
        # Lente: face inferior-dianteira; gira -1,2 rad em torno de X e passa a olhar para a frente.
        lens = box(nm + '_lens', (xm, ytop - 0.165, zf - 0.03), (wl - 0.04, 0.012, 0.09), M['head'], bevel=0.003, rot=(-0.37, 0, 0))
        return join([housing, lens], nm + '_lamp')

    # ------------------------------------------------------------ estufa
    def greenhouse(self):
        b, M = self.b, self.M
        rear = self.rear
        ins, tum = b['shoulderInset'], b['tumblehome']
        A0z, A1z, C1z = b['cowlZ'], b['roofFrontZ'], b['roofRearZ']
        if rear == 'mid':
            C0z, C0y = C1z - 0.07, b['deckY']
        else:
            C0z, C0y = b['rearBaseZ'], None
        roofY, crown, bow = b['roofY'], b['crown'], b['bow']

        def Bp(z, sx):
            y = self.side_top(z) if C0y is None or z > C0z + 1e-6 else C0y
            return Vector((sx * (self.halfw(z) - ins), y, z))

        def Tp(z, sx, s=None):
            return Vector((sx * (self.halfw(z) - tum), roofY, z))

        Vs = V_ROWS
        frame = MB()
        rear_frame = MB()
        glass = {}

        def add_patch(mb, grid, glass_fn, tag):
            ids = [[mb.add_v(tuple(p)) for p in row] for row in grid]
            for i in range(len(grid) - 1):
                for j in range(len(grid[0]) - 1):
                    q = [ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j]]
                    gname = glass_fn(i, j)
                    if gname:
                        g = glass.setdefault(gname, MB())
                        pts = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]]
                        g.face([g.add_v(tuple(p)) for p in pts])
                    else:
                        mb.face(q)

        roadster = rear == 'roadster'
        # ---- Para-brisa.
        xA0 = self.halfw(A0z) - ins
        xA1 = self.halfw(A1z) - tum
        pa = clamp(b['pillarA'] / xA0, 0.05, 0.3)
        Ss = [-1.0, -1.0 + pa] + [(-1.0 + pa) + (2 - 2 * pa) * k / 8 for k in range(1, 8)] + [1.0 - pa, 1.0]
        Ss = sorted(set(round(s, 6) for s in Ss))
        Ss_w = Ss if not roadster else Ss
        def wpt(s, v):
            base = Vector((s * xA0, self.top(A0z), A0z))
            topp = Vector((s * xA1, roofY + crown * (1 - s * s), A1z + bow * (1 - s * s)))
            return base.lerp(topp, v)
        grid = [[wpt(s, v) for s in Ss_w] for v in Vs]
        add_patch(frame, grid, lambda i, j: 'Windshield' if (Vs[i] >= GLASS_V[0] - 1e-6 and Vs[i + 1] <= GLASS_V[1] + 1e-6 and Ss_w[j] >= -1 + pa - 1e-6 and Ss_w[j + 1] <= 1 - pa + 1e-6) else None, 'ws')
        if roadster:
            # Barra superior do para-brisa.
            pass
        else:
            # ---- Laterais.
            lenB = abs(A0z - C0z)
            zb = lambda u: lerp(A0z, C0z, u)
            zt = lambda u: lerp(A1z, C1z, u)
            ua = clamp(b['pillarA'] * 0.8 / lenB, 0.02, 0.2)
            uc = 1 - clamp(b['pillarC'] / lenB, 0.03, 0.6)
            wins = []      # (u0, u1, nome, pivô)
            doorZ = b['doorZ']
            if len(doorZ) == 1:
                zs = doorZ[0][1]
                us = (A0z - zs) / lenB
                if b.get('quarterGlass') and us < uc - 0.05:
                    pb = 0.045 / lenB
                    wins = [(ua, us - pb / 2, 'Glass_Door_F', 'F'), (us + pb / 2, uc, 'Glass_Quarter', None)]
                else:
                    wins = [(ua, uc, 'Glass_Door_F', 'F')]
            else:
                zs = doorZ[0][1]
                us = (A0z - zs) / lenB
                pb = max(b['pillarB'], 0.05) / lenB
                zr = doorZ[1][1]
                ur = (A0z - zr) / lenB
                if rear == 'wagon':
                    pc = max(b['pillarC'], 0.06) / lenB
                    wins = [(ua, us - pb / 2, 'Glass_Door_F', 'F'), (us + pb / 2, ur - pc * 0.3, 'Glass_Door_R', 'R'), (ur + pc * 0.7, uc, 'Glass_Cargo', None)]
                else:
                    wins = [(ua, us - pb / 2, 'Glass_Door_F', 'F'), (us + pb / 2, min(uc, ur + 0.02), 'Glass_Door_R', 'R')]
            Us = {0.0, 1.0}
            for (u0, u1, *_r) in wins:
                Us.add(round(u0, 6)); Us.add(round(u1, 6))
            for k in range(1, 6):
                Us.add(round(k / 6, 6))
            Us = sorted(Us)
            self.side_wins = wins
            for sx in (1, -1):
                grid = [[Bp(zb(u), sx).lerp(Tp(zt(u), sx), v) for u in Us] for v in Vs]
                def gf(i, j, sx=sx):
                    if not (Vs[i] >= GLASS_V[0] - 1e-6 and Vs[i + 1] <= GLASS_V[1] + 1e-6):
                        return None
                    for (u0, u1, nm, pv) in wins:
                        if Us[j] >= u0 - 1e-6 and Us[j + 1] <= u1 + 1e-6:
                            return f'{nm}_{"L" if sx > 0 else "R"}'
                    return None
                add_patch(frame, grid, gf, 'side')
            # ---- Teto.
            rows = [zt(u) for u in Us]
            n = len(rows)
            bowR = bow * 0.6
            def rpt(s, k):
                z = rows[k]
                bt = lerp(bow, -bowR, k / (n - 1)) * (1 - s * s)
                return Vector((s * (self.halfw(z) - tum), roofY + crown * (1 - s * s), z + bt))
            grid = [[rpt(s, k) for s in Ss] for k in range(n)]
            add_patch(frame, grid, lambda i, j: None, 'roof')
            # ---- Vidro traseiro.
            xC0 = self.halfw(C0z) - ins
            y0 = Bp(C0z, 1).y
            pr = clamp(0.06 / xC0, 0.03, 0.2)
            def bpt(s, v):
                base = Vector((s * xC0, y0, C0z))
                topp = rpt(s, n - 1)
                return base.lerp(topp, v)
            Sr = sorted(set([round(s, 6) for s in Ss] + [round(-1 + pr, 6), round(1 - pr, 6)]))
            # O vidro traseiro usa a mesma divisão do teto na aresta superior: as colunas precisam coincidir.
            Sr = Ss
            grid = [[bpt(s, v) for s in Sr] for v in Vs]
            target = rear_frame if self.rear in ('hatch', 'wagon', 'fastback') else frame
            add_patch(target, grid, lambda i, j: 'Glass_Rear' if (Vs[i] >= GLASS_V[0] - 1e-6 and Vs[i + 1] <= GLASS_V[1] + 1e-6 and Sr[j] >= -1 + pa - 1e-6 and Sr[j + 1] <= 1 - pa + 1e-6) else None, 'rear')
        # Objetos.
        fr = frame.to_object('Greenhouse', [M['paint'], M['headliner']])
        if b.get('vinylRoof'):
            for p in fr.data.polygons:
                c = p.center
                if c.z > roofY - 0.02:
                    pass
        solidify(fr, 0.03, -1.0, 1)
        shade(fr, 30)
        self.objs['body'].append(fr)
        if len(rear_frame.v):
            rf = rear_frame.to_object('TailgateFrame', [M['paint'], M['headliner']])
            solidify(rf, 0.03, -1.0, 1)
            shade(rf, 30)
            self.pivots['Tailgate']['objs'].append(rf)
        for nm, mb in glass.items():
            ob = mb.to_object(nm, [M['glass']])
            # Recuo de 6 mm para dentro (a moldura aparece em volta do vidro).
            c = Vector((0, 0, 0))
            for v in ob.data.vertices:
                c += v.co
            c /= max(len(ob.data.vertices), 1)
            n = Vector((0, 0, 0))
            for p in ob.data.polygons:
                n += p.normal
            n.normalize()
            ob.data.transform(Matrix.Translation(-n * 0.006))
            flat(ob)
            if nm.startswith('Glass_Door_'):
                pv = ('Door_F' if nm[11] == 'F' else 'Door_R') + nm[-1]
                if pv in self.pivots:
                    self.pivots[pv]['objs'].append(ob)
                    continue
            if nm == 'Glass_Rear' and 'Tailgate' in self.pivots:
                self.pivots['Tailgate']['objs'].append(ob)
                continue
            self.objs['windows'].append(ob)
        if rear == 'mid':
            for sx in (1, -1):
                mb = MB()
                p = [Tp(C1z, sx), Vector((sx * (self.halfw(C0z) - ins), b['deckY'], C0z)), Vector((sx * (self.halfw(b['rearBaseZ']) - ins - 0.02), b['deckY'] + 0.005, b['rearBaseZ']))]
                mb.face([mb.add_v(tuple(q)) for q in p])
                ob = mb.to_object('Buttress', [M['paint']])
                solidify(ob, 0.04, -1.0 if sx > 0 else 1.0)
                self.objs['body'].append(ob)
        if roadster:
            # Arcos de proteção atrás dos bancos e carenagens.
            for s in self.s['seats']:
                x, z = s['x'], s['z'] - 0.42
                hoop = []
                for k in range(13):
                    a = math.pi * k / 12
                    hoop.append((x + 0.22 * math.cos(a), self.b['beltY'] + 0.30 * math.sin(a), z))
                ob = strip_path('Hoop', [(p[0], p[2]) for p in hoop], [(0, 0)], M['chrome']) if False else None
                bar = cylinder('hoopL', (x + 0.21, self.b['beltY'] + 0.14, z), 0.022, 0.30, M['chrome'], 'Y', 12)
                bar2 = cylinder('hoopR', (x - 0.21, self.b['beltY'] + 0.14, z), 0.022, 0.30, M['chrome'], 'Y', 12)
                bar3 = cylinder('hoopT', (x, self.b['beltY'] + 0.29, z), 0.022, 0.44, M['chrome'], 'X', 12)
                fair = box('fairing', (x, self.b['beltY'] + 0.04, z - 0.32), (0.36, 0.10, 0.62), M['paint'], bevel=0.045)
                self.objs['body'] += [bar, bar2, bar3, fair]
            # Moldura do para-brisa (barra superior cromada).
            topbar = box('wsTop', (0, roofY + 0.012, A1z + bow * 0.5), (xA1 * 2, 0.03, 0.05), M['trim'], bevel=0.01)
            self.objs['body'].append(topbar)

    # ------------------------------------------------------------ frente/traseira
    def front_rear(self):
        st, M, L2, b = self.st, self.M, self.L2, self.b
        parts = self.objs['lights']
        body = self.objs['body']
        # Faróis.
        for i, (x, y, w, h) in enumerate(self.lamps['head']):
            parts.append(box(f'HeadLens{i}', (x, y, L2 - 0.012), (w, h, 0.03), M['head'], bevel=0.006))
            for k in range(1, 4):
                parts.append(box(f'HeadFlute{i}', (x - w / 2 + k * w / 4, y, L2 + 0.0045), (0.004, h - 0.02, 0.004), M['trim']))
            parts.append(box(f'HeadLine{i}', (x, y, L2 + 0.0045), (w - 0.02, 0.004, 0.004), M['trim']))
            body.append(box(f'HeadBezel{i}', (x, y, L2 - 0.03), (w + 0.03, h + 0.03, 0.02), M['chrome'] if st['trim'] == 'chrome' else M['trim'], bevel=0.004))
        # Piscas.
        flatw = self.halfw(L2) - 0.03
        if st['head'] == 'popup' or st['head'] == 'slim':
            for sx in (1, -1):
                parts.append(box('Turn', (sx * (flatw - 0.18), 0.40, L2 + 0.004), (0.24, 0.05, 0.02), M['amber'], bevel=0.004))
        else:
            for sx in (1, -1):
                hy = min(l[1] for l in self.lamps['head']) if self.lamps['head'] else 0.6
                parts.append(box('Turn', (sx * (flatw - 0.12), hy - 0.13, L2 + 0.004), (0.2, 0.05, 0.02), M['amber'], bevel=0.004))
        # Laterais (marcadores âmbar).
        for sx in (1, -1):
            zz = self.wb / 2 + self.r + 0.20
            parts.append(box('Marker', (sx * (self.halfw(zz) + 0.002), b['creaseY'] - 0.02, zz), (0.012, 0.035, 0.08), M['amber'], bevel=0.003))
        # Grade.
        inner, gy, gh = self.lamps['grille']
        g = st['grille']
        if g == 'slats':
            for k in range(4):
                body.append(box('Slat', (0, gy - gh / 2 + (k + 0.6) * gh / 4.2, L2 - 0.03), (inner * 2 - 0.02, 0.012, 0.02), M['trim']))
        elif g == 'mesh':
            for k in range(5):
                body.append(box('MeshH', (0, gy - gh / 2 + (k + 0.5) * gh / 5, L2 - 0.035), (inner * 2 - 0.02, 0.008, 0.012), M['trim']))
            n = int(inner * 2 / 0.05)
            for k in range(n):
                body.append(box('MeshV', (-inner + (k + 0.5) * inner * 2 / n, gy, L2 - 0.035), (0.008, gh - 0.01, 0.012), M['trim']))
        elif g in ('chrome_vertical', 'chrome_egg'):
            n = int(inner * 2 / 0.045)
            for k in range(n):
                body.append(box('GrV', (-inner + (k + 0.5) * inner * 2 / n, gy, L2 - 0.02), (0.012, gh - 0.02, 0.025), M['chrome']))
            if g == 'chrome_egg':
                for k in range(3):
                    body.append(box('GrH', (0, gy - gh / 2 + (k + 1) * gh / 4, L2 - 0.02), (inner * 2 - 0.02, 0.012, 0.025), M['chrome']))
            body.append(box('GrFrame', (0, gy, L2 + 0.005), (inner * 2 + 0.04, gh + 0.04, 0.02), M['chrome'], bevel=0.008))
            body.append(box('GrFrameIn', (0, gy, L2 + 0.012), (inner * 2 - 0.0, gh - 0.0, 0.03), M['grille']))
        else:  # slot
            for k in range(2):
                body.append(box('SlotBar', (0, gy - gh / 4 + k * gh / 2, L2 - 0.02), (inner * 2 - 0.02, 0.01, 0.02), M['trim']))
        # Emblema da marca (frente e traseira).
        brand = self.s['brand']
        body.append(self.text_mesh('BadgeF', brand.split()[0], (0, gy + gh / 2 + 0.035 if g != 'slot' else self.b['noseTopY'] - 0.06, L2 + 0.004), 0.045, M['chrome'], facing='front'))
        body.append(self.text_mesh('BadgeR', self.s['name'], (-(self.halfw(-L2) - 0.32), self.b['tailTopY'] - 0.27, -L2 - 0.004), 0.04, M['chrome'], facing='rear'))
        # Lanternas.
        tl = st['tail']
        for i, (x, y, w, h) in enumerate(self.lamps['tail']):
            parts.append(box(f'TailLens{i}', (x, y, -L2 + 0.01), (w, h, 0.03), M['tail'], bevel=0.006))
            if tl in ('band', 'band_full', 'louver', 'wide'):
                for sx in (1, -1):
                    parts.append(box('Rev', (sx * 0.24, y - h * 0.18, -L2 - 0.008), (0.16, h * 0.4, 0.012), M['reverse'], bevel=0.003))
                if tl == 'band':
                    body.append(box('TailCenter', (0, y, -L2 - 0.006), (0.62, h + 0.004, 0.014), M['trim'], bevel=0.003))
                if tl in ('band_full', 'louver'):
                    for k in range(3):
                        body.append(box('TailLouver', (0, y - h / 2 + (k + 0.75) * h / 3.5, -L2 - 0.012), (w, 0.012, 0.016), M['trim']))
                if tl == 'wide':
                    body.append(box('TailChrome', (0, y - h / 2 - 0.012, -L2 - 0.006), (w + 0.02, 0.016, 0.014), M['chrome']))
            else:
                parts.append(box('Rev', (x - math.copysign(w * 0.25, x) * 0, y - h * 0.3, -L2 - 0.008), (w * 0.4, h * 0.25, 0.012), M['reverse'], bevel=0.003))
        # Para-choques.
        kind = st['bumper']
        if kind in ('black', 'chrome'):
            mat = M['trim'] if kind == 'black' else M['chrome']
            yb, hb = (0.40, 0.17) if kind == 'black' else (0.42, 0.15)
            for front in (True, False):
                body.append(self.bumper('BumperF' if front else 'BumperR', front, yb, hb, mat))
                if kind == 'chrome':
                    body.append(self.bumper('BumperStrip', front, yb, 0.035, M['rubber'], extra=0.012))
        else:
            # Integrados: lábio/spoiler dianteiro e difusor traseiro em preto.
            body.append(self.bumper('Splitter', True, self.b['bottomY'] + 0.11, 0.05, M['trim'], extra=-0.035))
            body.append(self.bumper('Diffuser', False, self.b['bottomY'] + 0.12, 0.07, M['trim'], extra=-0.04))
        # Placas.
        self.plates = []
        fy = 0.40 if kind != 'body' else self.b['bottomY'] + 0.22
        fz = self.L2o + (0.012 if kind != 'body' else 0.006)
        self.plates.append(self.plate('Plate_F', (0, fy, fz), True))
        ry = self.b['tailTopY'] - 0.30
        self.plates.append(self.plate('Plate_R', (0, ry, -L2 - 0.016), False))
        body.append(box('PlateRecess', (0, ry, -L2 - 0.006), (0.44, 0.22, 0.012), M['trim'], bevel=0.004))
        # Escapamento.
        ex = [0.45, -0.45] if self.s['category'] == 'luxo' else [-0.45]
        for x in ex:
            self.objs['chassis'].append(cylinder('Exhaust', (x, self.b['bottomY'] + 0.06, -self.L2o + 0.07), 0.035, 0.22, M['chrome'], 'Z', 16))
        # Ornamento de capô.
        if st.get('ornament'):
            orn = box('Ornament', (0, self.b['noseTopY'] + 0.04, L2 - 0.08), (0.02, 0.07, 0.05), M['chrome'], bevel=0.006)
            self.pivots['Hood']['objs'].append(orn)

    def bumper(self, name, front, yc, h, mat, extra=0.0):
        L2 = self.L2
        out = self.bumperOut + extra
        wrap = 0.42
        sgn = 1 if front else -1
        pts = []
        # Caminho no plano (x, z) acompanhando o contorno, da lateral esquerda à direita.
        n = 10
        zs = [L2 - wrap + (wrap) * k / n for k in range(n + 1)]
        side = [(self.halfw(z), z) for z in zs]
        if not front:
            side = [(self.halfw(-z), -z) for z in zs]
        def offset_path(path):
            res = []
            for i, (x, z) in enumerate(path):
                a = path[max(i - 1, 0)]; b_ = path[min(i + 1, len(path) - 1)]
                tx, tz = b_[0] - a[0], b_[1] - a[1]
                l = math.hypot(tx, tz) or 1
                nx, nz = tz / l, -tx / l
                if nx * x + nz * (z * sgn) < 0:
                    nx, nz = -nx, -nz
                res.append((x + nx * out, z + nz * out))
            return res
        # Lado +x (de trás para a frente), frente, lado -x.
        right = side
        across = [(x, (L2 if front else -L2)) for x in [side[-1][0] * (1 - 2 * k / 8) for k in range(1, 8)]]
        left = [(-x, z) for (x, z) in reversed(side)]
        path = offset_path(right + across + left)
        if not front:
            path = list(reversed(path))
        d = 0.09
        hh = h / 2
        sec = [(0.0, yc - hh), (d * 0.7, yc - hh), (d, yc - hh * 0.5), (d, yc + hh * 0.5), (d * 0.7, yc + hh), (0.0, yc + hh)]
        # A seção avança para fora a partir da superfície (offset positivo = para fora).
        rings = []
        for i, (x, z) in enumerate(path):
            a = path[max(i - 1, 0)]; b_ = path[min(i + 1, len(path) - 1)]
            tx, tz = b_[0] - a[0], b_[1] - a[1]
            l = math.hypot(tx, tz) or 1
            nx, nz = tz / l, -tx / l
            if nx * x + nz * z < 0:
                nx, nz = -nx, -nz
            rings.append([(x + nx * (o - d), y, z + nz * (o - d)) for (o, y) in sec])
        ob = loft(name, rings, mat)
        shade(ob, 35)
        return ob

    def plate(self, name, c, front):
        mb = MB()
        w, h = 0.40, 0.20
        x, y, z = c
        if front:
            q = [(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)]
            # normal +Z do jogo (para a frente); ordem anti-horária vista de frente
            q = [q[1], q[0], q[3], q[2]] if False else q
        else:
            q = [(x + w / 2, y - h / 2, z), (x - w / 2, y - h / 2, z), (x - w / 2, y + h / 2, z), (x + w / 2, y + h / 2, z)]
        mb.face([mb.add_v(p) for p in q])
        ob = mb.to_object(name, [self.M['plate']])
        uv = ob.data.uv_layers.new(name='UVMap')
        # UV fixo: canto inferior esquerdo da placa (visto de fora) = (0, 0).
        coords = {}
        for v in ob.data.vertices:
            gx, gy, gz = v.co.x, v.co.z, -v.co.y
            u = (gx - (x - w / 2)) / w
            if not front:
                u = 1 - u
            coords[v.index] = (u, (gy - (y - h / 2)) / h)
        for loop in ob.data.loops:
            uv.data[loop.index].uv = coords[loop.vertex_index]
        # Normal para fora.
        want = 1 if front else -1
        if (ob.data.polygons[0].normal.y * -1) * want < 0:
            ob.data.flip_normals()
        flat(ob)
        return ob

    def text_mesh(self, name, text, c, size, mat, facing='front'):
        cu = bpy.data.curves.new(name, 'FONT')
        cu.body = text
        cu.size = size
        cu.extrude = 0.003
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        ob = bpy.data.objects.new(name, cu)
        link(ob)
        if facing == 'front':
            ob.rotation_euler = (math.pi / 2, 0, 0)
        else:
            ob.rotation_euler = (math.pi / 2, 0, math.pi)
        ob.location = G(*c)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        mw = ob.matrix_world.copy()
        bpy.data.objects.remove(ob, do_unlink=True)
        me.transform(mw)
        me.materials.clear()
        me.materials.append(mat)
        o2 = bpy.data.objects.new(name, me)
        link(o2)
        flat(o2)
        return o2

    # ------------------------------------------------------------ laterais
    def sides(self):
        st, M, b = self.st, self.M, self.b
        L2 = self.L2
        zf = self.wb / 2 - (self.r + 0.08)
        zr = -self.wb / 2 + (self.r + 0.08)
        def segments(z0, z1):
            """Divide [z1 (frente) .. z0 (trás)] nos trechos de cada porta."""
            cuts = [(None, z1, z0)]
            out = []
            for d in self.doors:
                pass
            return cuts
        def add_strip(name, y, h, mat, depth=0.012, zmin=zr, zmax=zf, out=0.004):
            for sx in (1, -1):
                # Trechos: corpo e portas daquele lado.
                spans = [(zmin, zmax)]
                pieces = []
                ds = [d for d in self.doors if d['side'] == sx]
                ra = self.arch_r() + 0.03
                arch_top = self.r + 0.01 + ra
                cuts = {zmin, zmax} | {d['z0'] for d in ds if zmin < d['z0'] < zmax} | {d['z1'] for d in ds if zmin < d['z1'] < zmax}
                arches = []
                if y - h / 2 < arch_top:
                    for zA in (self.wb / 2, -self.wb / 2):
                        arches.append((zA - ra, zA + ra))
                        cuts |= {v for v in (zA - ra, zA + ra) if zmin < v < zmax}
                edges = sorted(cuts)
                fine = []
                for a, c in zip(edges[:-1], edges[1:]):
                    n = max(1, int(math.ceil((c - a) / 0.45)))
                    fine += [(a + (c - a) * k / n, a + (c - a) * (k + 1) / n) for k in range(n)]
                for a, c in fine:
                    zc = (a + c) / 2
                    if any(lo < zc < hi for lo, hi in arches):
                        continue
                    owner = next((d['name'] for d in ds if d['z0'] <= zc <= d['z1']), None)
                    xs = sx * (self.halfw(zc) + out)
                    dw = self.halfw(c) - self.halfw(a)
                    yaw = math.atan2(sx * dw, c - a)
                    # Emendas internas se sobrepõem 4 mm; só há folga nas bordas reais (portas, caixas de roda).
                    seglen = math.hypot(c - a, dw) + 0.004 - (0.008 if a in cuts else 0.002) - (0.008 if c in cuts else 0.002)
                    ob = box(name, (xs, y, zc), (depth, h, max(seglen, 0.01)), mat, bevel=(0.003 if h >= 0.04 else 0.0), seg=1, rot=(0, yaw, 0))
                    if owner:
                        self.pivots[owner]['objs'].append(ob)
                    else:
                        self.objs['body'].append(ob)
        if st.get('rubStrip'):
            add_strip('RubStrip', b['creaseY'] - 0.06, 0.05, M['trim'], depth=0.02, out=0.006)
        if st.get('trim') == 'chrome':
            add_strip('ChromeLine', b['creaseY'] - 0.02, 0.018, M['chrome'], zmin=-L2 + 0.25, zmax=L2 - 0.3)
        if st.get('sideStripe'):
            add_strip('Stripe', b['creaseY'] + 0.05, 0.035, M['stripe'], depth=0.004, zmin=-L2 + 0.2, zmax=L2 - 0.25, out=0.0015)
        if st.get('woodPanels'):
            add_strip('WoodPanel', (b['sillY'] + b['creaseY']) / 2 + 0.06, (b['creaseY'] - b['sillY']) - 0.02, M['wood'], depth=0.008, out=0.002)
            add_strip('WoodTrimT', b['creaseY'] + 0.06, 0.016, M['chrome'], depth=0.012, out=0.004)
            add_strip('WoodTrimB', b['sillY'] + 0.07, 0.016, M['chrome'], depth=0.012, out=0.004)
        # Soleiras pretas.
        for sx in (1, -1):
            self.objs['body'].append(box('Rocker', (sx * (self.W2 - 0.03), b['sillY'] - 0.02, 0), (0.05, 0.05, abs(zf - zr) - 0.02), M['trim'], bevel=0.01))
        # Retrovisores e maçanetas (nas portas dianteiras).
        for d in self.doors:
            sx = d['side']
            if not d['rear']:
                zc = d['z1'] - 0.14
                y = self.belt(zc) + 0.07
                arm = box('MirrorArm', (sx * (self.halfw(zc) + 0.03), y - 0.03, zc), (0.06, 0.03, 0.05), M['trim'], bevel=0.008)
                head = box('Mirror', (sx * (self.halfw(zc) + 0.10), y, zc - 0.02), (0.15, 0.085, 0.07), M['paint'] if self.s['category'] != 'popular' else M['trim'], bevel=0.02)
                glassm = box('MirrorGlass', (sx * (self.halfw(zc) + 0.10), y, zc - 0.058), (0.13, 0.068, 0.006), M['chrome'])
                self.pivots[d['name']]['objs'] += [arm, head, glassm]
            zh = d['z0'] + 0.14
            hd = box('Handle', (sx * (self.halfw(zh) + 0.006), b['creaseY'] + 0.11, zh), (0.018, 0.028, 0.12), M['chrome'] if st['trim'] == 'chrome' else M['trim'], bevel=0.006)
            self.pivots[d['name']]['objs'].append(hd)
        # Tomadas laterais (aletas).
        if b.get('sideIntake'):
            for sx in (1, -1):
                zc = -self.wb / 2 + self.r + 0.42
                for k in range(4):
                    self.objs['body'].append(box('IntakeFin', (sx * (self.W2 - 0.02), b['creaseY'] + 0.0 + k * 0.045, zc), (0.02, 0.012, 0.44), M['trim']))
        # Bagageiro de teto.
        if b.get('roofRack'):
            mat = M['chrome'] if st['trim'] == 'chrome' else M['trim']
            z0, z1 = b['roofRearZ'] + 0.12, b['roofFrontZ'] - 0.15
            for sx in (1, -1):
                x = sx * (self.halfw((z0 + z1) / 2) - b['tumblehome'] - 0.04)
                self.objs['body'].append(box('RackRail', (x, b['roofY'] + 0.05, (z0 + z1) / 2), (0.03, 0.025, abs(z1 - z0)), mat, bevel=0.008))
                for zz in (z0, z1):
                    self.objs['body'].append(box('RackFoot', (x, b['roofY'] + 0.025, zz), (0.04, 0.04, 0.06), M['trim'], bevel=0.008))
            for zz in (z0 + 0.35, z1 - 0.35):
                self.objs['body'].append(box('RackBar', (0, b['roofY'] + 0.065, zz), ((self.halfw(zz) - b['tumblehome'] - 0.04) * 2, 0.02, 0.03), mat, bevel=0.006))
        # Teto de vinil (executivo).
        if b.get('vinylRoof'):
            z0, z1 = b['roofRearZ'] - 0.02, b['roofFrontZ'] + 0.12
            self.objs['body'].append(box('Vinyl', (0, b['roofY'] + b['crown'] + 0.004, (z0 + z1) / 2), ((self.halfw(0) - b['tumblehome']) * 2 - 0.02, 0.012, abs(z1 - z0)), M['vinyl'], bevel=0.005))
        # Aerofólios (na tampa traseira).
        sp = st.get('spoiler', 'none')
        holder = 'Trunk' if 'Trunk' in self.pivots else 'Tailgate'
        tz = -L2 + 0.12
        ty = self.top(tz)
        if sp == 'lip':
            self.pivots[holder]['objs'].append(box('SpoilerLip', (0, ty + 0.02, -L2 + 0.08), ((self.halfw(-L2 + 0.1) - 0.06) * 2, 0.03, 0.10), M['paint'], bevel=0.012, rot=(-0.15, 0, 0)))
        elif sp == 'ducktail':
            self.pivots[holder]['objs'].append(box('Ducktail', (0, ty + 0.025, -L2 + 0.09), ((self.halfw(-L2 + 0.1) - 0.05) * 2, 0.04, 0.16), M['paint'], bevel=0.015, rot=(-0.25, 0, 0)))
        elif sp == 'wing_low':
            w = (self.halfw(tz) - 0.05) * 2
            objs = [box('Wing', (0, ty + 0.16, tz + 0.02), (w, 0.03, 0.26), M['paint'], bevel=0.012, rot=(0.08, 0, 0))]
            for sx in (1, -1):
                objs.append(box('WingPost', (sx * (w / 2 - 0.12), ty + 0.08, tz + 0.04), (0.03, 0.14, 0.12), M['trim'], bevel=0.006))
            self.pivots[holder]['objs'] += objs
        if b.get('louvers') and 'Trunk' in self.pivots:
            z0, z1 = -L2 + 0.25, b['roofRearZ'] - 0.2
            n = int(abs(z1 - z0) / 0.07)
            for k in range(n):
                zz = z0 + (k + 0.5) * (z1 - z0) / n
                self.pivots['Trunk']['objs'].append(box('Louver', (0, self.top(zz) + 0.012, zz), ((self.halfw(zz) - 0.2) * 2, 0.012, 0.035), M['trim'], rot=(-0.3, 0, 0)))

    # ------------------------------------------------------------ chassi
    def chassis(self):
        M, b = self.M, self.b
        L = self.L2 * 2
        self.objs['chassis'].append(box('Underbody', (0, b['bottomY'] - 0.012, 0), (self.W2 * 2 - 0.32, 0.02, L - 0.7), M['chassis']))
        for zA in (self.wb / 2, -self.wb / 2):
            self.objs['chassis'].append(cylinder('Axle', (0, self.r, zA), 0.035, self.track - 0.3, M['chassis'], 'X', 10))
            for sx in (1, -1):
                self.objs['chassis'].append(cylinder('Spring', (sx * (self.track / 2 - 0.28), self.r + 0.12, zA), 0.05, 0.22, M['chassis'], 'Y', 10))
        self.objs['chassis'].append(box('Tank', (0, b['bottomY'] + 0.05, -self.wb / 2 + 0.55), (0.8, 0.12, 0.45), M['chassis'], bevel=0.02))

    # ------------------------------------------------------------ rodas
    def wheel_geo(self, nm, sx):
        r, tw = self.r, self.d['tireWidth']
        hw = tw / 2
        rr = r * 0.64
        M = self.M
        prof = [(-hw * 0.85, rr * 0.98), (-hw, rr * 1.04), (-hw - 0.012, r * 0.8), (-hw - 0.006, r * 0.93), (-hw + 0.022, r)]
        # Banda com sulcos.
        g = [(-hw * 0.3, 0), (hw * 0.3, 0)]
        tread = [(-hw + 0.022, r)]
        for gx, _ in g:
            tread += [(gx - 0.008, r), (gx - 0.006, r - 0.007), (gx + 0.006, r - 0.007), (gx + 0.008, r)]
        tread += [(hw - 0.022, r)]
        prof = prof[:-1] + tread + [(hw + 0.006, r * 0.93), (hw + 0.012, r * 0.8), (hw, rr * 1.04), (hw * 0.85, rr * 0.98), (-hw * 0.85, rr * 0.98)]
        tire = lathe(f'Tire_{nm}', prof, M['rubber'], segs=28)
        rim = self.rim_geo(f'Rim_{nm}', rr, hw)
        if sx < 0:
            R = Matrix.Rotation(math.pi, 4, 'Z')
            for o in (tire, rim):
                o.data.transform(R)
        return tire, rim

    def rim_geo(self, nm, rr, hw):
        M = self.M
        style = self.st['rim']
        parts = []
        face_x = hw * 0.55
        barrel = lathe(nm + 'b', [(-hw * 0.85, rr * 0.97), (-hw * 0.85, rr * 0.9), (face_x - 0.02, rr * 0.9), (face_x, rr * 0.98), (hw * 0.9, rr * 1.02), (hw * 0.95, rr * 0.99)], M['rim'], segs=32)
        parts.append(barrel)
        parts.append(cylinder(nm + 'disc', (face_x - 0.07, 0, 0), rr * 0.78, 0.012, M['chassis'], 'X', 24))
        if style == 'hubcap':
            parts.append(lathe(nm + 'cap', [(face_x - 0.01, rr * 0.9), (face_x + 0.01, rr * 0.88), (face_x + 0.025, rr * 0.55), (face_x + 0.03, rr * 0.2), (face_x + 0.031, 0.001)], M['rim'], segs=32))
            for k in range(8):
                a = 2 * math.pi * k / 8
                parts.append(box(nm + 'slot', (face_x + 0.02, math.cos(a) * rr * 0.68, math.sin(a) * rr * 0.68), (0.012, 0.035, 0.012), M['trim'], rot=(a, 0, 0)))
        elif style == 'steel':
            parts.append(lathe(nm + 'dsk', [(face_x - 0.01, rr * 0.9), (face_x + 0.008, rr * 0.86), (face_x + 0.012, rr * 0.4), (face_x + 0.02, rr * 0.3), (face_x + 0.021, 0.001)], M['trim'], segs=32))
            for k in range(6):
                a = 2 * math.pi * k / 6
                parts.append(cylinder(nm + 'hole', (face_x + 0.014, math.cos(a) * rr * 0.6, math.sin(a) * rr * 0.6), rr * 0.11, 0.012, M['chassis'], 'X', 12))
            parts.append(lathe(nm + 'ring', [(face_x + 0.0, rr * 0.99), (face_x + 0.012, rr * 0.95), (face_x + 0.006, rr * 0.86)], M['chrome'], segs=32))
            parts.append(cylinder(nm + 'cc', (face_x + 0.026, 0, 0), rr * 0.26, 0.016, M['chrome'], 'X', 20, bevel=0.005))
        elif style == 'wire':
            parts.append(lathe(nm + 'dish', [(face_x - 0.03, rr * 0.92), (face_x - 0.01, rr * 0.3), (face_x, 0.001)], M['chrome'], segs=32))
            for k in range(20):
                a = 2 * math.pi * k / 20
                for tw_ in (0.25, -0.25):
                    parts.append(box(nm + 'w', (face_x - 0.005, math.cos(a) * rr * 0.52, math.sin(a) * rr * 0.52), (0.004, 0.004, rr * 0.82), M['chrome'], rot=(a + tw_, 0, 0)))
            parts.append(cylinder(nm + 'ko', (face_x + 0.02, 0, 0), rr * 0.2, 0.04, M['chrome'], 'X', 8, bevel=0.006))
        elif style == 'turbine':
            parts.append(lathe(nm + 'base', [(face_x - 0.01, rr * 0.9), (face_x + 0.004, rr * 0.86), (face_x + 0.006, 0.001)], M['rim'], segs=32))
            for k in range(14):
                a = 2 * math.pi * k / 14
                parts.append(box(nm + 'bl', (face_x + 0.012, math.cos(a) * rr * 0.55, math.sin(a) * rr * 0.55), (0.014, 0.02, rr * 0.6), M['chrome'], rot=(a, 0.35, 0)))
            parts.append(cylinder(nm + 'cc', (face_x + 0.024, 0, 0), rr * 0.25, 0.02, M['chrome'], 'X', 20, bevel=0.006))
        elif style == 'fivespoke':
            parts.append(cylinder(nm + 'hub', (face_x, 0, 0), rr * 0.3, 0.05, M['rim'], 'X', 20, bevel=0.01))
            for k in range(5):
                a = 2 * math.pi * k / 5
                parts.append(box(nm + 'sp', (face_x + 0.005, math.cos(a) * rr * 0.58, math.sin(a) * rr * 0.58), (0.03, 0.085, rr * 0.66), M['rim'], bevel=0.012, rot=(a + math.pi / 2, 0, 0)))
            parts.append(cylinder(nm + 'cc', (face_x + 0.03, 0, 0), rr * 0.16, 0.02, M['trim'], 'X', 16))
        elif style == 'dish':
            parts.append(lathe(nm + 'dish', [(face_x - 0.01, rr * 0.92), (face_x + 0.01, rr * 0.88), (face_x + 0.015, rr * 0.2), (face_x + 0.02, 0.001)], M['rim'], segs=32))
            for k in range(5):
                a = 2 * math.pi * k / 5
                parts.append(cylinder(nm + 'hole', (face_x + 0.012, math.cos(a) * rr * 0.58, math.sin(a) * rr * 0.58), rr * 0.15, 0.018, M['chassis'], 'X', 14))
            parts.append(cylinder(nm + 'cc', (face_x + 0.03, 0, 0), rr * 0.17, 0.02, M['trim'], 'X', 16))
        elif style == 'dial':
            parts.append(lathe(nm + 'dsk', [(face_x - 0.01, rr * 0.92), (face_x + 0.012, rr * 0.88), (face_x + 0.016, 0.001)], M['rim'], segs=32))
            for k in range(8):
                a = 2 * math.pi * k / 8
                parts.append(cylinder(nm + 'hole', (face_x + 0.012, math.cos(a) * rr * 0.62, math.sin(a) * rr * 0.62), rr * 0.13, 0.016, M['chassis'], 'X', 14))
            parts.append(cylinder(nm + 'cc', (face_x + 0.026, 0, 0), rr * 0.24, 0.02, M['chrome'], 'X', 20, bevel=0.005))
        else:  # blade
            parts.append(lathe(nm + 'base', [(face_x - 0.02, rr * 0.9), (face_x - 0.006, rr * 0.86), (face_x - 0.004, 0.001)], M['chassis'], segs=32))
            for k in range(10):
                a = 2 * math.pi * k / 10
                parts.append(box(nm + 'bl', (face_x + 0.004, math.cos(a) * rr * 0.55, math.sin(a) * rr * 0.55), (0.018, 0.03, rr * 0.7), M['rim'], bevel=0.006, rot=(a + 0.5, 0, 0)))
            parts.append(cylinder(nm + 'cc', (face_x + 0.02, 0, 0), rr * 0.22, 0.03, M['rim'], 'X', 20, bevel=0.008))
        return join(parts, nm)

    def build_wheels(self):
        r = self.r
        for nm, sx, sz in (('FL', 1, 1), ('FR', -1, 1), ('RL', 1, -1), ('RR', -1, -1)):
            hub = (sx * self.track / 2, r, sz * self.wb / 2)
            tire, rim = self.wheel_geo(nm, sx)
            for o in (tire, rim):
                o.location = G(*hub)
            e = empty(f'Wheel_{nm}', hub)
            self.wheels[nm] = {'empty': e, 'objs': [tire, rim], 'hub': hub}

    # ------------------------------------------------------------ interior
    def interior(self):
        s, b, M = self.s, self.b, self.M
        I = self.objs['interior']
        fy = self.d['floorY']
        cz0, cz1 = self.cabin
        inw = self.W2 - self.doorT
        I.append(box('Carpet', (0, fy + 0.006, (cz0 + cz1) / 2), (inw * 2 - 0.02, 0.012, abs(cz1 - cz0) - 0.02), M['carpet']))
        sport = s['family'] == 'sports' or s['category'] == 'luxo'
        fronts = [x for x in s['seats'] if not x.get('rear')]
        rears = [x for x in s['seats'] if x.get('rear')]
        for st in fronts:
            I += self.seat(st, sport)
        if rears:
            x0 = rears[0]
            w = abs(rears[0]['x'] - rears[-1]['x']) + 0.5
            I += self.seat({**x0, 'x': 0.0}, False, width=min(w, inw * 2 - 0.08), bench=True)
        drv = next(x for x in s['seats'] if x.get('driver'))
        wh = s['wheel']
        dash_rear = wh['z'] + 0.17
        dash_front = b['cowlZ'] - 0.02
        dash_top = b['cowlY'] - 0.035
        I.append(box('Dash', (0, dash_top - 0.12, (dash_rear + dash_front) / 2 + 0.02), (inw * 2 - 0.02, 0.24, dash_front - dash_rear + 0.04), M['interior'], bevel=0.03))
        I.append(box('DashLower', (0, dash_top - 0.33, dash_rear + 0.14), (inw * 2 - 0.04, 0.20, 0.16), M['interior'], bevel=0.03))
        # Painel de instrumentos.
        dx = drv['x']
        I.append(box('Binnacle', (dx, dash_top + 0.025, dash_rear + 0.08), (0.46, 0.09, 0.2), M['interior'], bevel=0.025))
        gz = dash_rear + 0.006
        gy = dash_top - 0.035
        n = 3 if sport else 2
        for k in range(n):
            gx = dx + (k - (n - 1) / 2) * (0.13 if n == 3 else 0.17)
            rad = 0.05 if n == 3 else 0.065
            I.append(cylinder('Gauge', (gx, gy, gz), rad, 0.006, M['gauge'], 'Z', 24))
            I.append(lathe('GaugeRing', [(0, 0)], M['chrome']) if False else cylinder('GaugeRim', (gx, gy, gz + 0.004), rad + 0.008, 0.004, M['chrome'], 'Z', 24))
            I.append(box('Needle', (gx + 0.012, gy + 0.012, gz - 0.006), (0.004, rad * 0.8, 0.003), M['plate'], rot=(0, 0, -0.8)))
        # Console central, rádio, saídas de ar.
        I.append(box('Stack', (0, dash_top - 0.17, dash_rear + 0.02), (0.24, 0.22, 0.06), M['trim'], bevel=0.01))
        I.append(box('Radio', (0, dash_top - 0.14, dash_rear - 0.012), (0.18, 0.05, 0.01), M['chrome']))
        for k in range(4):
            I.append(box('Vent', (0, dash_top - 0.07 + 0, dash_rear - 0.012 + 0), (0.2, 0.006, 0.012), M['grille']) if k == 0 else box('VentS', ((k - 2.5) * 0.0 + (1 if k % 2 else -1) * (inw - 0.12), dash_top - 0.06, dash_rear - 0.01), (0.1, 0.05, 0.012), M['grille']))
        cz_mid = (dash_rear + drv['z']) / 2 - 0.1
        I.append(box('Console', (0, fy + 0.11, cz_mid), (0.2, 0.2, abs(dash_rear - drv['z']) + 0.25), M['interior'], bevel=0.025))
        I.append(cylinder('Shifter', (0, fy + 0.27, drv['z'] + 0.28), 0.008, 0.16, M['chrome'], 'Y', 8))
        I.append(box('Knob', (0, fy + 0.36, drv['z'] + 0.28), (0.035, 0.035, 0.035), M['trim'], bevel=0.012))
        if self.st.get('wood'):
            I.append(box('WoodDash', (0, dash_top - 0.075, dash_rear - 0.003), (inw * 2 - 0.1, 0.04, 0.008), M['wood']))
            I.append(box('WoodConsole', (0, fy + 0.215, cz_mid), (0.18, 0.006, abs(dash_rear - drv['z']) + 0.1), M['wood']))
        # Pedais.
        for k, px in enumerate((dx - 0.1, dx, dx + 0.1)):
            I.append(box('Pedal', (px, fy + 0.1, dash_rear + 0.38 - 0.0), (0.06, 0.09, 0.015), M['trim'], rot=(-0.6, 0, 0)))
        # Coluna da direção (não gira).
        wy, wz, tilt = wh['y'], wh['z'], wh['tilt']
        I.append(cylinder('Column', (dx, wy - math.cos(tilt) * 0.2 * 0 + 0.0 - 0.0 + 0.0, wz + 0.0), 0.028, 0.0001, M['trim'], 'Y', 8) if False else
                 cylinder('Column', (dx, wy - 0.06, wz + 0.17), 0.028, 0.34, M['trim'], 'Z', 10, rot=(-(math.pi / 2 - tilt), 0, 0)))
        # Retrovisor interno e para-sóis.
        if self.rear != 'roadster':
            I.append(box('RearMirror', (0, b['roofY'] - 0.11, b['roofFrontZ'] - 0.06), (0.22, 0.06, 0.02), M['trim'], bevel=0.01))
            for sx in (1, -1):
                I.append(box('Visor', (sx * 0.36, b['roofY'] - 0.05, b['roofFrontZ'] - 0.12), (0.34, 0.012, 0.16), M['headliner'], bevel=0.004))
        # Bandeja traseira / assoalho de carga.
        if self.rear in ('notch',):
            I.append(box('Parcel', (0, self.belt(b['rearBaseZ']) - 0.03, b['rearBaseZ'] + 0.22), (inw * 2 - 0.02, 0.02, 0.4), M['interior']))
        if self.rear in ('hatch', 'wagon', 'fastback'):
            r0 = rears[0]['z'] - 0.45 if rears else fronts[0]['z'] - 0.5
            I.append(box('CargoFloor', (0, fy + 0.10, (r0 + cz0) / 2), (inw * 2 - 0.02, 0.02, abs(r0 - cz0) - 0.04), M['carpet']))
        if self.rear in ('mid', 'roadster'):
            I.append(box('Bulkhead', (0, (fy + self.belt(cz0)) / 2, cz0 + 0.03), (inw * 2 - 0.02, self.belt(cz0) - fy, 0.03), M['interior']))
        # Forros das portas (peças próprias, abrem com a porta).
        for d in self.doors:
            sx = d['side']
            zc = (d['z0'] + d['z1']) / 2
            ln = abs(d['z1'] - d['z0']) - 0.12
            x = sx * (self.halfw(zc) - self.doorT - 0.012)
            yb, yt = b['sillY'] + 0.09, self.belt(zc) - 0.02
            card = box(f'DoorCard_{d["name"][5:]}', (x, (yb + yt) / 2, zc), (0.024, yt - yb, ln), M['interior'], bevel=0.008)
            arm = box('Armrest', (x - sx * 0.035, b['creaseY'] - 0.0, zc - 0.05), (0.05, 0.05, ln * 0.55), M['interior'], bevel=0.015)
            hdl = box('InHandle', (x - sx * 0.014, b['creaseY'] + 0.1, d['z1'] - 0.2), (0.012, 0.03, 0.09), M['chrome'])
            card = join([card, arm, hdl], f'DoorCard_{d["name"][5:]}')
            self.pivots[d['name']]['objs'].append(card)

    def seat(self, st, sport, width=None, bench=False):
        M = self.M
        x, hip, z, rec = st['x'], st['hipY'], st['z'], st['recline']
        fy = self.d['floorY']
        w = width or (0.50 if not sport else 0.48)
        out = []
        out.append(box('Cushion', (x, hip - 0.09, z + 0.04), (w, 0.12, 0.5), M['seat'], bevel=0.035))
        if hip - 0.15 - fy > 0.03:
            out.append(box('SeatBase', (x, (fy + hip - 0.15) / 2, z + 0.02), (w * 0.85, hip - 0.15 - fy, 0.42), M['interior']))
        bz = z - 0.25 - math.sin(rec) * 0.2
        out.append(box('Back', (x, hip + 0.25, bz), (w, 0.6, 0.12), M['seat'], bevel=0.035, rot=(-rec * 0.8, 0, 0)))
        if sport and not bench:
            for sx in (1, -1):
                out.append(box('Bolster', (x + sx * (w / 2 - 0.035), hip + 0.18, bz + 0.05), (0.07, 0.42, 0.14), M['seat'], bevel=0.03, rot=(-rec * 0.8, 0, 0)))
        if not bench:
            out.append(box('Headrest', (x, hip + 0.64, z - 0.33 - math.sin(rec) * 0.42), (0.26, 0.16, 0.1), M['seat'], bevel=0.03, rot=(-rec * 0.8, 0, 0)))
        return out

    def steering(self):
        s, M = self.s, self.M
        drv = next(x for x in s['seats'] if x.get('driver'))
        wh = s['wheel']
        rad = 0.175 if s['category'] != 'luxo' else 0.165
        mb_parts = []
        # Aro (toro no plano XZ local, eixo +Y do jogo).
        segs, tube = 28, 0.017
        ringv = []
        mb = MB()
        rows = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            row = []
            for j in range(8):
                bq = 2 * math.pi * j / 8
                rr = rad + tube * math.cos(bq)
                row.append(mb.add_v((rr * math.cos(a), tube * math.sin(bq), rr * math.sin(a))))
            rows.append(row)
        for i in range(segs):
            for j in range(8):
                a0, a1 = rows[i], rows[(i + 1) % segs]
                mb.face([a0[j], a1[j], a1[(j + 1) % 8], a0[(j + 1) % 8]])
        rim = mb.to_object('SW_rim', [M['trim']])
        shade(rim, 60)
        parts = [rim]
        n = s['style'].get('steering', 3)
        angs = {2: [0, math.pi], 3: [0, math.pi, -math.pi / 2], 4: [math.pi / 4, 3 * math.pi / 4, -math.pi / 4, -3 * math.pi / 4]}[n]
        for a in angs:
            parts.append(box('SW_spoke', (math.cos(a) * rad * 0.5, -0.012, math.sin(a) * rad * 0.5), (rad, 0.014, 0.035), M['trim'] if n != 4 else M['chrome'], bevel=0.005, rot=(0, -a, 0)))
        parts.append(cylinder('SW_hub', (0, -0.02, 0), 0.055, 0.045, M['trim'], 'Y', 16, bevel=0.01))
        parts.append(cylinder('SW_badge', (0, 0.004, 0), 0.025, 0.006, M['chrome'], 'Y', 16))
        ob = join(parts, 'SteeringWheel')
        ob.location = G(drv['x'], wh['y'], wh['z'])
        ob.rotation_euler = (-wh['tilt'], 0, 0)
        self.steer = ob

    # ------------------------------------------------------------ montagem
    def assemble(self):
        root = empty('VehicleRoot')
        root['neonType'] = self.s['type']
        root['neonModel'] = self.s['model']
        root['specVersion'] = 1
        self.root = root
        groups = {'body': 'Body', 'windows': 'Windows', 'lights': 'Lights', 'interior': 'Interior', 'chassis': 'Chassis'}
        self.final = {}
        for k, nm in groups.items():
            ob = join(self.objs[k], nm)
            if ob is None:
                continue
            if k != 'windows':
                shade(ob, 35) if k in ('interior', 'chassis', 'lights') else None
            parent(ob, root)
            self.final[nm] = ob
        for p in self.plates:
            parent(p, root)
        for nm, pv in self.pivots.items():
            objs = pv['objs']
            main = objs[0]
            rest = [o for o in objs[1:] if not (o.name.startswith('DoorCard_') or o.name.startswith('Glass_'))]
            cards = [o for o in objs[1:] if o.name.startswith('DoorCard_')]
            glass = [o for o in objs[1:] if o.name.startswith('Glass_')]
            main = join([main] + rest, nm)
            set_origin(main, pv['hinge'])
            parent(main, root)
            for o in cards + glass:
                parent(o, main)
            if nm.startswith('Popup'):
                pass
            self.final[nm] = main
        for nm, w in self.wheels.items():
            e = w['empty']
            parent(e, root)
            for o in w['objs']:
                o.location = G(*w['hub'])
                bpy.context.view_layer.update()
                parent(o, e)
        parent(self.steer, root)
        bpy.context.view_layer.update()

    def build(self):
        self.build_body()
        self.greenhouse()
        self.front_rear()
        self.sides()
        self.chassis()
        self.build_wheels()
        self.interior()
        self.steering()
        self.assemble()
        return self
