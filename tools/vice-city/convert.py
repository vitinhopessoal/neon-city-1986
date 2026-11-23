"""Local VC RenderWare -> sector GLBs and triangle collision sidecars.

Requires numpy and DragonFF's gtaLib (GPL-3.0-or-later, separate dependency).
No game resource is embedded in this source or written to public/.
"""
import argparse, binascii, collections, hashlib, json, math, pathlib, re, struct, sys, time, zlib
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCAL = ROOT / 'tools/vice-city-local'
sys.path.insert(0, str(LOCAL / 'vendor/DragonFF-master'))
from gtaLib import dff, txd, col

C = np.array([[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]], dtype=float)
INTERIORS = {'bank','club','concerth','hotel','lawyers','mall','mansion','stadint','stripclb','yacht'}


def sections(path):
    section = ''
    for line in path.read_text(errors='replace').splitlines():
        line = line.split('#')[0].strip()
        if not line: continue
        if ',' not in line: section = line.lower(); continue
        yield section, [v.strip() for v in line.split(',')]


def placement(values):
    ident, name, interior = int(values[0]), values[1].lower(), int(values[2])
    xyz = list(map(float, values[3:6])); scales = list(map(float, values[6:9]))
    x,y,z,w = map(float, values[9:13])
    # VC stores inverse rotations. DragonFF's IPL importer uses (x,y,z,-w).
    w = -w; n = math.sqrt(x*x+y*y+z*z+w*w) or 1; x,y,z,w = x/n,y/n,z/n,w/n
    m = np.eye(4)
    m[:3,:3] = [[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],
                [2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],
                [2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]]
    m[:3,:3] = m[:3,:3] @ np.diag(scales); m[:3,3] = xyz
    return ident, name, interior, C @ m @ C.T


def png(path, w, h, pixels):
    def chunk(t, data):
        return struct.pack('>I',len(data))+t+data+struct.pack('>I',binascii.crc32(t+data)&0xffffffff)
    raw = b''.join(b'\0'+pixels[y*w*4:(y+1)*w*4] for y in range(h))
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))
                     +chunk(b'IDAT',zlib.compress(raw, 3))+chunk(b'IEND',b''))


class Sources:
    def __init__(self, source, out):
        self.source, self.out = source, out
        self.img = (source/'models/gta3.img').open('rb')
        blob = (source/'models/gta3.dir').read_bytes(); self.entries = {}
        for i in range(0,len(blob),32):
            off, size, name = struct.unpack_from('<II24s',blob,i)
            self.entries[name.split(b'\0')[0].decode().lower()] = (off,size)
        self.defs = {}; self.sectors = {}; self.collisions = {}; self.textures = {}; self.texture_info = {}; self.models = {}
        self.missing_textures = set(); self.missing_models = set(); self.no_col = set(); self.errors = []
        self.collision_cache = {}
        self.signature = hashlib.sha256(blob+(source/'models/generic.txd').read_bytes()).hexdigest()
        cache_path = out/'texture-cache.json'
        if cache_path.exists():
            cache = json.loads(cache_path.read_text())
            if cache.get('signature')==self.signature: self.texture_info = cache['textures']
        else:
            # Reuse textures of a previously validated local pilot, without
            # decompressing the same dictionaries again for the full export.
            for path in out.glob('*.glb'):
                data = path.read_bytes(); length = struct.unpack_from('<I',data,12)[0]; doc = json.loads(data[20:20+length])
                for material in doc.get('materials',[]):
                    ref = material.get('pbrMetallicRoughness',{}).get('baseColorTexture')
                    if not ref: continue
                    uri = doc['images'][doc['textures'][ref['index']]['source']]['uri']; image = out/uri
                    if not image.exists():continue
                    image_data = image.read_bytes(); w,h = struct.unpack_from('>II',image_data,16); offset=8; compressed=b''
                    while offset<len(image_data):
                        n=struct.unpack_from('>I',image_data,offset)[0]
                        if image_data[offset+4:offset+8]==b'IDAT':compressed+=image_data[offset+8:offset+8+n]
                        offset+=12+n
                    raw=np.frombuffer(zlib.decompress(compressed),dtype=np.uint8).reshape(h,w*4+1)[:,1:].reshape(-1,4)
                    self.texture_info[material['name'].lower()]={'uri':uri,'alpha':bool(np.any(raw[:,3]<250)),'width':w,'height':h}
        for path in (source/'data').rglob('*.ide'):
            for section, v in sections(path):
                if section not in ('objs','tobj') or not v[0].isdigit(): continue
                self.defs[int(v[0])] = {'name':v[1].lower(),'txd':v[2].lower(),'section':section,
                    'flags':int(v[-3] if section=='tobj' else v[-1]),
                    'hours':list(map(int,v[-2:])) if section=='tobj' else None}
        for path in (source/'data').rglob('*.ipl'):
            instances = [placement(v) for sec,v in sections(path) if sec=='inst' and len(v)>=13]
            if instances: self.sectors[path.stem.lower()] = instances
        for path in list((source/'data').rglob('*.col'))+[source/'models/coll/generic.col']:
            parsed = col.coll(); parsed.load_file(str(path))
            for model in parsed.models: self.collisions[model.model_name.lower()] = model
        self.texture_names = collections.defaultdict(list)
        for name in self.entries:
            if not name.endswith('.txd'): continue
            data = self.read(name); i = 12
            while i+12 <= len(data):
                kind,size,_ = struct.unpack_from('<III',data,i)
                if not size: break
                if kind==21:
                    texname = data[i+32:i+64].split(b'\0')[0].decode(errors='replace').lower()
                    self.texture_names[texname].append(name[:-4])
                i += 12+size

    def read(self, name):
        off,size = self.entries[name.lower()]; self.img.seek(off*2048); return self.img.read(size*2048)

    def txd(self, name):
        name = name.lower()
        if name not in self.textures:
            t = txd.txd()
            if name=='generic': t.load_file(str(self.source/'models/generic.txd'))
            elif name+'.txd' in self.entries: t.load_memory(self.read(name+'.txd'))
            self.textures[name] = {v.name.lower():v for v in t.native_textures}
        return self.textures[name]

    def texture(self, dictionary, name):
        name = name.lower(); key = dictionary+'/'+name
        if key in self.texture_info:
            if self.texture_info[key] is None: self.missing_textures.add(key)
            return self.texture_info[key]
        value = self.txd(dictionary).get(name) or self.txd('generic').get(name)
        if not value:
            for other in self.texture_names.get(name,[]):
                value = self.txd(other).get(name)
                if value: break
        if not value:
            self.missing_textures.add(key); self.texture_info[key] = None; return None
        # Shared external PNGs avoid embedding the same dictionary in every GLB.
        data = bytes(value.to_rgba()); digest = hashlib.sha256(data+struct.pack('<II',value.width,value.height)).hexdigest()[:20]
        directory = self.out/'textures'; directory.mkdir(parents=True,exist_ok=True)
        path = directory/(digest+'.png')
        if not path.exists(): png(path,value.width,value.height,data)
        a = np.frombuffer(data,dtype=np.uint8)[3::4]
        result = {'uri':'textures/'+path.name,'alpha':bool(np.any(a<250)), 'width':value.width,'height':value.height}
        self.texture_info[key] = result; return result

    def model(self, name):
        if name not in self.models:
            if name+'.dff' not in self.entries: self.missing_models.add(name); return None
            value = dff.dff(); value.load_memory(self.read(name+'.dff')); self.models[name] = value
        return self.models[name]


class GLB:
    def __init__(self, source):
        self.source = source; self.bin = bytearray(); self.mesh_cache = {}; self.material_cache = {}; self.images_cache = {}
        self.doc = {'asset':{'version':'2.0','generator':'Neon City local RenderWare conversion / DragonFF gtaLib'},
            'scene':0,'scenes':[{'nodes':[]}], 'nodes':[], 'meshes':[], 'materials':[], 'buffers':[],
            'bufferViews':[], 'accessors':[], 'images':[], 'textures':[],
            'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],
            'extensionsUsed':['KHR_materials_unlit']}

    def accessor(self, data, kind, component=5126, target=34962, bounds=False):
        data = np.asarray(data,dtype={5126:'<f4',5125:'<u4'}[component])
        while len(self.bin)%4: self.bin.append(0)
        offset = len(self.bin); self.bin += data.tobytes()
        view = len(self.doc['bufferViews']); self.doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':data.nbytes,'target':target})
        a = {'bufferView':view,'componentType':component,'count':len(data),'type':kind}
        if bounds: a.update(min=data.min(axis=0).tolist(),max=data.max(axis=0).tolist())
        idx = len(self.doc['accessors']); self.doc['accessors'].append(a); return idx

    def material(self, dictionary, material):
        tex = self.source.texture(dictionary,material.textures[0].name) if material.textures else None
        key = (tex['uri'] if tex else '',tuple(material.color))
        if key in self.material_cache: return self.material_cache[key]
        rgba = np.array(material.color)/255
        rgb = np.where(rgba[:3]<=0.04045,rgba[:3]/12.92,((rgba[:3]+0.055)/1.055)**2.4)
        pbr = {'baseColorFactor':[float(v) for v in rgb]+[float(rgba[3])], 'metallicFactor':0,'roughnessFactor':1}
        if tex:
            uri = tex['uri']
            if uri not in self.images_cache:
                idx = len(self.doc['images']); self.doc['images'].append({'uri':uri}); self.doc['textures'].append({'sampler':0,'source':idx}); self.images_cache[uri] = idx
            pbr['baseColorTexture'] = {'index':self.images_cache[uri]}
        value = {'name':dictionary+'/'+(material.textures[0].name if material.textures else 'plain'),
            'pbrMetallicRoughness':pbr,'doubleSided':True,'extensions':{'KHR_materials_unlit':{}}}
        if rgba[3]<0.98: value['alphaMode']='BLEND'
        elif tex and tex['alpha']: value.update(alphaMode='MASK',alphaCutoff=0.35)
        idx = len(self.doc['materials']); self.doc['materials'].append(value); self.material_cache[key] = idx; return idx

    def mesh(self, name, dictionary):
        key = name,dictionary
        if key in self.mesh_cache: return self.mesh_cache[key]
        model = self.source.model(name)
        if not model: return []
        result = []
        for clump in model.clumps:
            frames = {}
            def frame(index):
                if index in frames: return frames[index]
                f = clump.frame_list[index]; m = np.eye(4); m[:3,:3] = np.array(f.rotation_matrix).T; m[:3,3] = f.position
                if f.parent>=0: m = frame(f.parent) @ m
                frames[index] = m; return m
            for atomic in clump.atomic_list:
                geom = clump.geometry_list[atomic.geometry]
                if not geom.vertices or not geom.triangles: continue
                transform = C @ frame(atomic.frame)
                vertices = np.array(geom.vertices); positions = vertices@transform[:3,:3].T+transform[:3,3]
                triangles = np.array([(t.a,t.b,t.c) for t in geom.triangles],dtype=np.uint32)
                normals = np.zeros_like(positions)
                if len(geom.normals)==len(vertices): normals = np.array(geom.normals) @ np.linalg.inv(transform[:3,:3])
                else:
                    cross = np.cross(positions[triangles[:,1]]-positions[triangles[:,0]],positions[triangles[:,2]]-positions[triangles[:,0]])
                    for j in range(3): np.add.at(normals,triangles[:,j],cross)
                normals /= np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-9)
                attrs = {'POSITION':self.accessor(positions,'VEC3',bounds=True),'NORMAL':self.accessor(normals,'VEC3')}
                if geom.uv_layers: attrs['TEXCOORD_0'] = self.accessor(geom.uv_layers[0],'VEC2')
                if geom.prelit_colors:
                    colors = np.array(geom.prelit_colors,dtype=float)/255
                    # RW adds timecycle ambient light to prelighting. A direct
                    # unlit multiplication would turn zero-prelit roads/trees
                    # black. Bake a documented daytime ambient contribution.
                    colors[:,:3] = np.clip(0.55 + colors[:,:3] * 0.45,0,1)
                    colors[:,:3] = np.where(colors[:,:3]<=0.04045,colors[:,:3]/12.92,((colors[:,:3]+0.055)/1.055)**2.4)
                    attrs['COLOR_0'] = self.accessor(colors,'VEC4')
                primitives = []
                for mi, mat in enumerate(geom.materials):
                    faces = triangles[[t.material==mi for t in geom.triangles]].reshape(-1)
                    if not len(faces): continue
                    primitives.append({'attributes':attrs,'indices':self.accessor(faces,'SCALAR',5125,34963),'material':self.material(dictionary,mat)})
                idx = len(self.doc['meshes']); self.doc['meshes'].append({'name':name,'primitives':primitives})
                result.append((idx,positions))
        self.mesh_cache[key] = result; return result

    def write(self, path):
        self.doc['buffers'] = [{'byteLength':len(self.bin)}]
        js = json.dumps(self.doc,separators=(',',':')).encode()
        js += b' '*((-len(js))%4); self.bin += b'\0'*((-len(self.bin))%4)
        path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(self.bin))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(self.bin),0x004e4942)+self.bin)


def collision_geometry(model, spheres=True):
    triangles = []
    if model.mesh_verts:
        v = np.array(model.mesh_verts)
        triangles += [(v[[f.a,f.b,f.c]],f.surface.material) for f in model.mesh_faces]
    box_faces = [(0,2,3),(0,3,1),(4,5,7),(4,7,6),(0,1,5),(0,5,4),(2,6,7),(2,7,3),(0,4,6),(0,6,2),(1,3,7),(1,7,5)]
    for box in model.boxes:
        verts = np.array([[x,y,z] for x in (box.min[0],box.max[0]) for y in (box.min[1],box.max[1]) for z in (box.min[2],box.max[2])])
        triangles += [(verts[list(face)],box.surface.material) for face in box_faces]
    for sphere in model.spheres if spheres else []:
        verts = []
        for row in range(9):
            a = row*math.pi/8
            for j in range(12):
                b = j*math.pi/6; verts.append(np.array(sphere.center)+sphere.radius*np.array([math.sin(a)*math.cos(b),math.sin(a)*math.sin(b),math.cos(a)]))
        for row in range(8):
            for j in range(12):
                a,b,c,d = row*12+j,row*12+(j+1)%12,(row+1)*12+j,(row+1)*12+(j+1)%12
                triangles += [(np.array([verts[a],verts[b],verts[c]]),sphere.surface.material),(np.array([verts[b],verts[d],verts[c]]),sphere.surface.material)]
    return triangles


def convert(source, sector, hour=12):
    started = time.time(); builder = GLB(source); collision = bytearray(); candidates = []; floor_candidates = []; bbox = np.array([[np.inf]*3,[-np.inf]*3]); counts = collections.Counter()
    for ident,name,interior,transform in source.sectors[sector]:
        counts['placements'] += 1
        if name.startswith('lod') or name.startswith('islandlod'): counts['excludedLOD']+=1; continue
        definition = source.defs.get(ident)
        if not definition: source.errors.append({'sector':sector,'model':name,'error':'missing IDE'}); continue
        hours = definition['hours']
        if hours:
            start,end = hours
            active = start<=hour<end if start<end else hour>=start or hour<end
            if not active: counts['excludedTimeObjects']+=1; continue
        for mesh,positions in builder.mesh(name,definition['txd']):
            node = {'name':name,'mesh':mesh,'matrix':transform.T.reshape(-1).tolist(),
                'extras':{'collide':False,'castShadow':False,'vcModel':name,'vcID':ident,'vcInterior':interior}}
            index = len(builder.doc['nodes']); builder.doc['nodes'].append(node); builder.doc['scenes'][0]['nodes'].append(index)
            world = positions@transform[:3,:3].T+transform[:3,3]
            bbox[0] = np.minimum(bbox[0],world.min(axis=0)); bbox[1] = np.maximum(bbox[1],world.max(axis=0))
            counts['renderedObjects']+=1
        cm = source.collisions.get(name) or source.collisions.get(name[:22])
        if not cm: source.no_col.add(name); continue
        # collision coordinates are in GTA space; transform also from Z-up.
        original_transform = transform @ C
        if name not in source.collision_cache: source.collision_cache[name] = collision_geometry(cm,False)
        for sphere in cm.spheres:
            center = np.array(sphere.center)@original_transform[:3,:3].T+original_transform[:3,3]
            radius = sphere.radius*float(np.linalg.norm(original_transform[:3,:3],axis=0).max())
            collision += struct.pack('<9fHH',*center,radius,0,0,0,0,0,sphere.surface.material,1)
            counts['collisionSpheres']+=1; counts['collisionRecords']+=1
        for tri,surface in source.collision_cache[name]:
            tri = tri@original_transform[:3,:3].T+original_transform[:3,3]
            normal = np.cross(tri[1]-tri[0],tri[2]-tri[0]); area = np.linalg.norm(normal)/2
            if area<1e-7: continue
            collision += np.asarray(tri,dtype='<f4').tobytes()+struct.pack('<HH',surface,0); counts['collisionTriangles']+=1
            counts['collisionRecords']+=1
            if abs(normal[1])/(2*area)>0.98 and surface==1 and area>5:
                center = tri.mean(axis=0)
                if 6.1 < center[1] < 40: candidates.append({'x':float(center[0]),'y':float(center[1]),'z':float(center[2]),'yaw':0})
            if abs(normal[1])/(2*area)>0.9 and area>(0.02 if sector in INTERIORS else 3):
                center = tri.mean(axis=0)
                if center[1]>6.05: floor_candidates.append({'x':float(center[0]),'y':float(center[1]),'z':float(center[2]),'yaw':0})
    if not builder.doc['nodes']: raise ValueError(f'No meshes in {sector}')
    source.out.mkdir(parents=True,exist_ok=True)
    glb = source.out/(sector+'.glb'); builder.write(glb)
    sidecar = source.out/(sector+'.collision.bin'); sidecar.write_bytes(b'VCC1'+struct.pack('<I',counts['collisionRecords'])+collision)
    bounds = {'minX':float(bbox[0,0]),'maxX':float(bbox[1,0]),'minZ':float(bbox[0,2]),'maxZ':float(bbox[1,2])}
    target = np.array([270,1250]) if sector=='oceandrv' else (bbox[0,[0,2]]+bbox[1,[0,2]])/2
    candidates.sort(key=lambda p:np.linalg.norm(np.array([p['x'],p['z']])-target))
    floor_candidates.sort(key=lambda p:np.linalg.norm(np.array([p['x'],p['z']])-target)+p['y']*0.5)
    # Interiors can have road-tagged ceilings. Keep alternative real floor
    # samples so the runtime can reject ceilings/blocked points safely.
    candidates = candidates[:128] + floor_candidates[:128]
    if not candidates:
        candidates = [{'x':float((bbox[0,0]+bbox[1,0])/2),'y':float(bbox[1,1]+2),'z':float((bbox[0,2]+bbox[1,2])/2),'yaw':0}]
    spawn = candidates[0]
    vehicle_spawns = []
    for candidate in candidates:
        if math.hypot(candidate['x']-spawn['x'],candidate['z']-spawn['z'])<10: continue
        if any(math.hypot(candidate['x']-v['x'],candidate['z']-v['z'])<10 for v in vehicle_spawns):continue
        vehicle_spawns.append({**candidate,'heading':0})
        if len(vehicle_spawns)==8:break
    manifest = {'id':'vice-city-'+sector,'label':'VICE CITY / '+sector.upper(),'file':glb.name,'collisionFile':sidecar.name,
        'collisionFormat':'VCC1','scale':1,'spawn':spawn,'spawnCandidates':candidates[:256], 'bounds':bounds,
        'heightfieldCell':100,'defaultGroundHeight':-100,'triangleCollision':True,'addBoundaryWalls':False,
        'instanceThreshold':3,'chunkSize':180,'waterLevel':6,'vehicleSpawns':vehicle_spawns,
        'localOnly':True,'sourceSector':sector,'timeOfDay':hour,'generated':{**counts,'bytes':glb.stat().st_size,'seconds':round(time.time()-started,2)}}
    (source.out/(sector+'.manifest.json')).write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    (source.out/'texture-cache.json').write_text(json.dumps({'signature':source.signature,'textures':source.texture_info}),encoding='utf-8')
    print(json.dumps({'sector':sector,**counts,'bytes':glb.stat().st_size,'seconds':round(time.time()-started,1)}),flush=True)
    return manifest


def main():
    from radar import build_radar
    parser = argparse.ArgumentParser(); parser.add_argument('--sector',default='oceandrv'); parser.add_argument('--all',action='store_true'); parser.add_argument('--hour',type=int,default=12)
    args = parser.parse_args(); out = ROOT/'dev-maps/vice-city'; source = Sources(LOCAL/'input',out)
    selected = sorted(source.sectors) if args.all else [args.sector]
    manifests = [convert(source,sector,args.hour) for sector in selected]
    radar = build_radar(out)
    for manifest in manifests:
        manifest['minimap'] = radar
        (out/(manifest['sourceSector']+'.manifest.json')).write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    exterior = manifests
    if args.all:
        seed = next(m for m in manifests if m['sourceSector']=='oceandrv')
        full = {**seed,'id':'vice-city','label':'VICE CITY / MAPA COMPLETO','files':[m['file'] for m in exterior],
            'collisionFiles':[m['collisionFile'] for m in exterior],
            'bounds':{key:float((min if key.startswith('min') else max)(m['bounds'][key] for m in exterior)) for key in ['minX','maxX','minZ','maxZ']},
            'generated':{'bytes':sum(m['generated']['bytes'] for m in exterior),'sectors':len(exterior)},
            'sectors':[{k:m[k] for k in ['id','file','collisionFile','bounds','sourceSector']} for m in exterior]}
        (out/'manifest.json').write_text(json.dumps(full,indent=2),encoding='utf-8')
    report = {'source':str(source.source),'definitionCount':len(source.defs),'placementCount':sum(len(v) for v in source.sectors.values()),
        'sectors':manifests,'missingModels':sorted(source.missing_models),'missingTextures':sorted(source.missing_textures),
        'modelsWithoutCOLBinding':sorted(source.no_col),'errors':source.errors,'textures':len(set(v['uri'] for v in source.texture_info.values() if v))}
    (out/('conversion-report.json' if args.all else args.sector+'.report.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')


if __name__=='__main__':main()
