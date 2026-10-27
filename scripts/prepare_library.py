"""Preserve native originals and publish the PWA's versioned split-channel mixes."""
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[1]
source = root.parent / 'app/src/main/assets/library'
target = root / 'public/library'
derived = root / 'generated/mix-v2'
current_manifest = root / 'public/library-manifest-v2.json'

def verify(manifest):
    data = json.loads(manifest.read_text())
    for item in data['files']:
        file = target / item['path']
        if not file.exists() or hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
            raise SystemExit('Restore the verified deployment bundle library before building: ' + item['path'])
    return data

def copy(file, name):
    dest = target / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    sha = hashlib.sha256(file.read_bytes()).hexdigest()
    if not dest.exists() or hashlib.sha256(dest.read_bytes()).hexdigest() != sha:
        shutil.copy2(file, dest)
    return {'path': name, 'bytes': file.stat().st_size, 'sha256': sha}

target.mkdir(parents=True, exist_ok=True)
if source.is_dir():
    catalog = derived / 'mix-catalog-v2.json'
    if not catalog.is_file():
        raise SystemExit('Generate 58 split-channel mixes with scripts/build_split_mixes.py first')
    entries = []
    for file in sorted(source.rglob('*')):
        if not file.is_file(): continue
        name = file.relative_to(source).as_posix()
        entry = copy(file, name)
        # Keep the old premixes at their original URLs for already-open older
        # app clients. They are not included in the new offline download pack.
        if name != 'mix-catalog.json' and not name.startswith('mixes/'):
            entries.append(entry)
    entries.append(copy(catalog, 'mix-catalog-v2.json'))
    mixes = json.loads(catalog.read_text())['tracks']
    if len(mixes) != 58: raise SystemExit('All 58 synchronized mixes are required')
    for track in mixes:
        if track['layout'] != 'mr-left-harmony-right-v2': raise SystemExit('Wrong audio layout')
        if track.get('renderer') != 'rubberband-r2-crisp5': raise SystemExit('Use the timestamp-verified renderer')
        if track.get('encodedPeak', 2) > .95: raise SystemExit('Verify encoded audio peak headroom before building')
        entries.append(copy(derived / track['path'], track['path']))
    entries.sort(key=lambda f: f['path'])
    version = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()[:16]
    data = {'version': version, 'files': entries}
    current_manifest.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
else:
    data = verify(current_manifest)
    # Old client compatibility files are shipped too, without making new users
    # download obsolete mixes. Restore them from the release bundle unchanged.
    verify(root / 'public/library-manifest.json')
licenses = root / 'public/licenses'
licenses.mkdir(exist_ok=True)
original_license = root.parent / 'third_party/lucide/LICENSE'
if original_license.exists(): shutil.copy2(original_license, licenses / 'lucide.txt')
print(f'Library {data["version"]}: {len(data["files"])} current files / {sum(e["bytes"] for e in data["files"]):,} bytes')
