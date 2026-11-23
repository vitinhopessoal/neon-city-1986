"""Package converted local assets only. Never uploads or copies GTA sources."""
import pathlib, zipfile, hashlib
root = pathlib.Path(__file__).resolve().parents[2]
folder = root/'dev-maps/vice-city'
target = root/'dev-maps/vice-city-converted.zip'
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=3) as archive:
    for file in sorted(folder.rglob('*')):
        if not file.is_file() or file.name=='texture-cache.json': continue
        if file.suffix not in ('.glb','.bin','.json','.png','.jpg'): continue
        archive.write(file, 'vice-city/'+file.relative_to(folder).as_posix())
    archive.write(root/'docs/VICE_CITY_LOCAL.md', 'LEIA-ME.md')
    archive.write(root/'docs/INTERFACE_VICE_CITY.md', 'INTERFACE_VICE_CITY.md')
print(str(target))
print('bytes',target.stat().st_size,'sha256',hashlib.file_digest(target.open('rb'),'sha256').hexdigest() if hasattr(hashlib,'file_digest') else hashlib.sha256(target.read_bytes()).hexdigest())
