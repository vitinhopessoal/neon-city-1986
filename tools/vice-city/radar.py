"""Extract the installation's actual radar tiles; no invented street layout.

Calibration reference (tile order and native world limits):
https://github.com/mrxenginner/reVC/blob/miami/src/core/Radar.cpp
The conversion uses GTA (x,y,z) -> Three.js (x,z,-y), so radar image rows
increase along Three.js +Z. The 8x8 tiles cover [-2000,2000] on both axes.
"""
import binascii, hashlib, json, pathlib, struct, sys, zlib
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCAL = ROOT/'tools/vice-city-local'
sys.path.insert(0, str(LOCAL/'vendor/DragonFF-master'))
from gtaLib import txd


def build_radar(out=None):
    out = out or ROOT/'dev-maps/vice-city'
    entries = {}
    directory = (LOCAL/'input/models/gta3.dir').read_bytes()
    for offset in range(0, len(directory), 32):
        block, size, name = struct.unpack_from('<II24s', directory, offset)
        entries[name.split(b'\0')[0].decode().lower()] = (block, size)
    pixels = None
    sources = []
    with (LOCAL/'input/models/gta3.img').open('rb') as archive:
        for index in range(64):
            name = f'radar{index:02d}'
            block, size = entries[name+'.txd']
            archive.seek(block*2048)
            data = archive.read(size*2048)
            dictionary = txd.txd()
            dictionary.load_memory(data)
            image = next(t for t in dictionary.native_textures if t.name.lower() == name)
            if pixels is None:
                side = image.width
                pixels = np.zeros((side*8, side*8, 4), dtype=np.uint8)
            if image.width != side or image.height != side:
                raise ValueError('Radar tiles must be equally sized squares')
            x, y = index % 8, index // 8
            pixels[y*side:(y+1)*side, x*side:(x+1)*side] = np.frombuffer(bytes(image.to_rgba()), dtype=np.uint8).reshape(side, side, 4)
            sources.append({'dictionary': name+'.txd', 'sha256': hashlib.sha256(data).hexdigest()})
    def chunk(kind, data):
        return struct.pack('>I', len(data))+kind+data+struct.pack('>I', binascii.crc32(kind+data)&0xffffffff)
    height, width, _ = pixels.shape
    raw = b''.join(b'\0'+row.tobytes() for row in pixels)
    target = out/'radar/atlas.png'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('>IIBBBBB',width,height,8,6,0,0,0))
                      +chunk(b'IDAT',zlib.compress(raw,6))+chunk(b'IEND',b''))
    metadata = {'image': 'radar/atlas.png', 'bounds': {'minX': -2000, 'maxX': 2000, 'minZ': -2000, 'maxZ': 2000},
                'width': width, 'height': height, 'north': '-Z', 'source': '64 native radar TXDs from the local gta3.img copy'}
    (out/'radar/provenance.json').write_text(json.dumps({'calibrationReference': 'https://github.com/mrxenginner/reVC/blob/miami/src/core/Radar.cpp',
        'tiles': sources, 'minimap': metadata}, indent=2), encoding='utf-8')
    return metadata


if __name__ == '__main__':
    out = ROOT/'dev-maps/vice-city'
    metadata = build_radar(out)
    for path in [out/'manifest.json', *out.glob('*.manifest.json')]:
        if not path.exists(): continue
        manifest = json.loads(path.read_text(encoding='utf-8'))
        manifest['minimap'] = metadata
        path.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps(metadata))
