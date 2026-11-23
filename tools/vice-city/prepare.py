"""Copy the user's installation and pin the optional DragonFF reader locally."""
import argparse, hashlib, json, pathlib, shutil, subprocess, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCAL = ROOT/'tools/vice-city-local'
COMMIT = '319847f7803f102c5aa31fa38e8b3284117db40a'

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda:handle.read(1024*1024),b''): h.update(block)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source',type=pathlib.Path,required=True)
    parser.add_argument('--maps',type=pathlib.Path)
    args = parser.parse_args(); source = args.source.resolve(); target = LOCAL/'input'
    originals = [(source/'models/gta3.img',target/'models/gta3.img'),(source/'models/gta3.dir',target/'models/gta3.dir'),
        (source/'models/generic.txd',target/'models/generic.txd'),(source/'models/coll/generic.col',target/'models/coll/generic.col'),
        (source/'data/gta_vc.dat',target/'data/gta_vc.dat'),(args.maps or source/'data/maps/maps.rar',target/'data/maps.rar')]
    for name in ['water.dat','WATERPRO.DAT','surface.dat']:
        if (source/'data'/name).exists(): originals.append((source/'data'/name,target/'data'/name))
    report = []
    for original, copy in originals:
        if not original.is_file(): raise FileNotFoundError(original)
        copy.parent.mkdir(parents=True,exist_ok=True)
        before = sha(original)
        if not copy.exists() or sha(copy)!=before: shutil.copy2(original,copy)
        after = sha(original)
        if before!=after or sha(copy)!=before: raise RuntimeError(f'Copy verification failed: {original}')
        report.append({'original':str(original),'copy':str(copy),'bytes':original.stat().st_size,'sha256':before,'originalUnchanged':True})
        print('VERIFIED',original.name,flush=True)
    (LOCAL/'source-provenance.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    unrar = shutil.which('UnRAR') or r'C:\Program Files\WinRAR\UnRAR.exe'
    archive = target/'data/maps.rar'
    listing = subprocess.run([unrar,'lb',str(archive)],check=True,capture_output=True,text=True).stdout
    for item in listing.splitlines():
        p = pathlib.PureWindowsPath(item)
        if p.is_absolute() or '..' in p.parts: raise ValueError('Unsafe archive path: '+item)
    subprocess.run([unrar,'x','-y','-o+','-inul',str(archive),str(target/'data')+'\\'],check=True)
    vendor = LOCAL/'vendor'; vendor.mkdir(parents=True,exist_ok=True)
    archive_path = vendor/'DragonFF.zip'
    with urllib.request.urlopen(f'https://codeload.github.com/Parik27/DragonFF/zip/{COMMIT}',timeout=60) as response:
        archive_path.write_bytes(response.read())
    with zipfile.ZipFile(archive_path) as package:
        for item in package.infolist():
            if not (vendor/item.filename).resolve().is_relative_to(vendor.resolve()): raise ValueError('Unsafe dependency path')
        package.extractall(vendor)
    # The converter expects a stable local directory name, without installing
    # an addon globally or modifying the user's Blender preferences.
    extracted = vendor/f'DragonFF-{COMMIT}'
    shutil.copytree(extracted,vendor/'DragonFF-master',dirs_exist_ok=True)
    (vendor/'provenance.json').write_text(json.dumps({'repository':'https://github.com/Parik27/DragonFF','commit':COMMIT,
        'license':'GPL-3.0-or-later','archiveSHA256':sha(archive_path)},indent=2),encoding='utf-8')

if __name__=='__main__':main()
