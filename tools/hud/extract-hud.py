"""Export only the HUD textures used by the game from user-supplied VC TXDs.

Usage: python tools/hud/extract-hud.py tools/ai-reference-temp/hud
Native RenderWare D3D8 DXT1/DXT3 -> RGBA PNG, using Python's standard library.
The supplied TXDs (including weapon TXDs from gta3.img) stay outside public/.
"""
import binascii
import pathlib
import struct
import sys
import zlib

DEST = pathlib.Path(__file__).resolve().parents[2] / 'public' / 'hud' / 'vice'
WANTED = {'font1', 'radardisc', 'radar_north', 'radar_centre', 'fist',
          'colt45', 'buddyshot', 'ingramsl', 'tec9', 'm4', 'uzi'}


def write_png(path, width, height, pixels):
    def chunk(kind, data):
        return (struct.pack('>I', len(data)) + kind + data
                + struct.pack('>I', binascii.crc32(kind + data) & 0xffffffff))
    rows = b''.join(b'\0' + pixels[y*width*4:(y+1)*width*4] for y in range(height))
    path.write_bytes(b'\x89PNG\r\n\x1a\n'
                     + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


def decode_dxt(data, width, height, compression):
    def rgb565(v):
        return [(v >> 11 & 31)*255//31, (v >> 5 & 63)*255//63, (v & 31)*255//31]
    pixels = bytearray(width*height*4)
    stride = 8 if compression == 1 else 16
    for by in range(0, height, 4):
        for bx in range(0, width, 4):
            off = ((by//4)*(width//4) + bx//4)*stride
            block = data[off:off+stride]
            c0, c1, bits = struct.unpack_from('<HHI', block, 0 if compression == 1 else 8)
            a, b = rgb565(c0), rgb565(c1)
            colors = [a, b, [(2*a[k]+b[k])//3 for k in range(3)],
                      [(a[k]+2*b[k])//3 for k in range(3)]]
            transparent = compression == 1 and c0 <= c1
            if transparent:
                colors[2] = [(a[k]+b[k])//2 for k in range(3)]
                colors[3] = [0, 0, 0]
            alpha = int.from_bytes(block[:8], 'little')
            for j in range(16):
                idx = bits >> (2*j) & 3
                al = ((alpha >> (4*j) & 15)*17 if compression == 3
                      else (0 if transparent and idx == 3 else 255))
                dst = ((by+j//4)*width + bx+j%4)*4
                pixels[dst:dst+4] = bytes(colors[idx] + [al])
    return pixels


def extract(directory):
    DEST.mkdir(parents=True, exist_ok=True)
    for path in sorted(directory.glob('*.txd')):
        blob = path.read_bytes()
        i = 12
        while i+12 <= len(blob):
            kind, size, _ = struct.unpack_from('<III', blob, i)
            if not size:
                break
            if kind == 21:
                tex = blob[i+24:i+12+size]
                name = tex[8:40].split(b'\0')[0].decode('ascii')
                if name in WANTED:
                    platform = struct.unpack_from('<I', tex)[0]
                    width, height = struct.unpack_from('<HH', tex, 80)
                    compression = tex[87]
                    if platform != 8 or compression not in (1, 3):
                        raise ValueError(f'Unsupported texture: {name}')
                    count = struct.unpack_from('<I', tex, 88)[0]
                    pixels = decode_dxt(tex[92:92+count], width, height, compression)
                    # The supplied pack uses a yellow/green weapon backdrop.
                    # Match the user's pink/purple reference while retaining
                    # the original blue weapon drawing and outlined frame.
                    if name in {'colt45', 'buddyshot', 'ingramsl', 'tec9', 'm4', 'uzi'}:
                        for p in range(0, len(pixels), 4):
                            r, g, b, a = pixels[p:p+4]
                            if a and r > 60 and g > 80 and b < 100:
                                y = (p//4)//width
                                pixels[p:p+4] = bytes([164+y//2, 76+y//3, 174+y//2, 255])
                    write_png(DEST / (name+'.png'), width, height, pixels)
                    print(f'{name}: {width}x{height}')
            i += 12+size


if __name__ == '__main__':
    extract(pathlib.Path(sys.argv[1]))
