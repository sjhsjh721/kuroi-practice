"""Copy the canonical native assets unchanged; content-address the offline library."""
from pathlib import Path
import hashlib,json,shutil
root=Path(__file__).resolve().parents[1]
source=root.parent/'app/src/main/assets/library'
target=root/'public/library'
if not source.is_dir():
    source=target
    manifest_path=root/'public/library-manifest.json'
    if not manifest_path.exists(): raise SystemExit('Library manifest is required for a standalone checkout')
    expected=json.loads(manifest_path.read_text())
    for item in expected['files']:
        file=target/item['path']
        if not file.exists() or hashlib.sha256(file.read_bytes()).hexdigest()!=item['sha256']:
            raise SystemExit('Restore the verified deployment bundle library before building: '+item['path'])
if not source.is_dir():
    raise SystemExit('Canonical native library or copied public/library is required')
target.mkdir(parents=True,exist_ok=True)
entries=[]
for file in sorted(source.rglob('*')):
    if not file.is_file(): continue
    name=file.relative_to(source).as_posix();dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True)
    if not dest.exists() or hashlib.sha256(dest.read_bytes()).digest()!=hashlib.sha256(file.read_bytes()).digest(): shutil.copy2(file,dest)
    entries.append({'path':name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
version=hashlib.sha256(json.dumps(entries,sort_keys=True).encode()).hexdigest()[:16]
(root/'public/library-manifest.json').write_text(json.dumps({'version':version,'files':entries},ensure_ascii=False,separators=(',',':')))
licenses=root/'public/licenses';licenses.mkdir(exist_ok=True)
original_license=root.parent/'third_party/lucide/LICENSE'
if original_license.exists(): shutil.copy2(original_license,licenses/'lucide.txt')
print(f'Library {version}: {len(entries)} files / {sum(e["bytes"] for e in entries):,} bytes')
