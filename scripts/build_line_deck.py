"""Export Seonkwan's original script turns and their cues; never edit the PDF.

Uses the independently audited speaker/line ownership from the existing app.
Requires the native project's data sources and its PyMuPDF environment.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data"))
from build_highlights import lines, label_tokens, compact

source = ROOT / "data/original/script.pdf"
audit_path = ROOT / "artifacts/role-highlight-audit-v05.json"
audit = json.loads(audit_path.read_text())
runtime = json.loads((ROOT / "app/src/main/assets/library/role-highlights.json").read_text())
role = 1 << next(i for i, p in enumerate(runtime["profiles"]) if p["id"] == "선관")
doc = pymupdf.open(source)
scenes, turns = [], []
scene, active, song, part = None, None, None, 0
expected, recovered = set(), set()

for pi, page in enumerate(doc):
    if pi < 2:
        continue
    rows = lines(page)
    regions = audit["scriptPages"][pi]["regions"]
    groups, row_regions = [], {}
    for ri, row in enumerate(rows):
        tokens = label_tokens(row["left"])
        if not tokens:
            continue
        raw = compact(row["left"])
        if groups and row["y"] - groups[-1]["endY"] < 23 and (groups[-1]["raw"].endswith(",") or groups[-1]["raw"].count("(") > groups[-1]["raw"].count(")")):
            g = groups[-1]
            g["raw"] += raw
            g["rows"].append(ri)
            g["endY"] = row["y"]
        else:
            groups.append(dict(id=f"p{pi+1}-y{row['y']:.2f}", raw=raw, y=row["y"], endY=row["y"], rows=[ri], page=pi+1))
    groups = [g for g in groups if not g["raw"].startswith("(") and g["raw"].count("(") == g["raw"].count(")")]
    for gi, region in enumerate(regions):
        x0, y0, x1, y1 = [v*d for v,d in zip(region["box"], [page.rect.width, page.rect.height]*2)]
        matches = [(ri,c) for ri,row in enumerate(rows) for c in row["chars"] if x0 <= (c["box"][0]+c["box"][2])/2 <= x1 and y0 <= (c["box"][1]+c["box"][3])/2 <= y1]
        assert matches, (pi+1, region)
        ri = matches[0][0]
        text = "".join(c["c"] for _,c in matches)
        # Padded boxes can contain an adjacent slash/parenthesis. Recover only
        # the audited glyph sequence, retaining the source's internal spaces.
        indexes = [i for i,c in enumerate(text) if not c.isspace() and c not in "\u200b\ufeff"]
        wanted = compact(region["text"])
        full = compact(text)
        at = full.find(wanted)
        assert at >= 0, (pi+1, wanted, full)
        text = text[indexes[at]:indexes[at+len(wanted)-1]+1]
        item = dict(text=text, roles=region["roles"], kind=region["kind"], page=pi+1, region=f"{pi}:{gi}", x=x0)
        row_regions.setdefault(ri, []).append(item)
        if region["kind"] == "dialogue" and region["roles"] & role:
            expected.add(item["region"])
    for g in groups:
        g["mask"] = 0
        for ri in g["rows"]:
            for r in row_regions.get(ri, []):
                if r["kind"] == "speaker":
                    g["mask"] |= r["roles"]
    for ri, row in enumerate(rows):
        text = row["text"].strip()
        if row["y"] > 720:
            continue
        if re.match(r"\d+장[.]", compact(text)):
            number = int(re.match(r"\d+", text).group())
            scene = dict(id=f"scene-{number}", number=number, title=re.sub(r"^\d+장\.\s*", "", text), page=pi+1)
            scenes.append(scene)
            active, song = None, None
            part += 1
            continue
        marker = re.search(r"No\.?\s*(\d+)", text)
        if marker:
            song = None if "끝" in text else int(marker.group(1))
            part += 1
            continue
        candidates = [g for g in groups if g["y"]-9 <= row["y"]]
        if candidates:
            active = candidates[-1]
        if not active or not scene:
            continue
        segments = sorted([r for r in row_regions.get(ri, []) if r["kind"] == "dialogue"], key=lambda r:r["x"])
        if not segments and active["raw"] == "동의회원":
            body = "".join(c["c"] for c in row["body"]).strip()
            if body and not body.startswith("("):
                segments = [dict(text=body, roles=0, page=pi+1, region=None)]
        if not segments:
            continue
        key = f"{active['id']}-{part}"
        if not turns or turns[-1]["id"] != key:
            turns.append(dict(id=key, sceneId=scene["id"], speaker=active["raw"], primaryMask=active["mask"], kind="가사" if song else "대사", song=song, segments=[]))
        turns[-1]["segments"].extend(segments)
        recovered.update(r["region"] for r in segments if r["roles"] & role)

assert expected == recovered, (expected-recovered, recovered-expected)

def speech(turn, selected):
    parts, directions = [], []
    for segment in selected:
        text = segment["text"]
        backing = segment["roles"] != turn["primaryMask"]
        if backing and turn["kind"] == "가사":
            text = text.strip("() ")
        else:
            directions.extend(re.findall(r"\(([^()]*)\)", text))
            text = re.sub(r"\([^()]*\)", "", text).strip()
        if text:
            parts.append(text)
    return "\n".join(parts).strip(), directions

cards, previous = [], None
for turn in turns:
    chosen = [r for r in turn["segments"] if r["roles"] & role]
    if chosen:
        answer, directions = speech(turn, chosen)
        nonverbal = not answer and bool(directions)
        if nonverbal:
            answer = "(" + " · ".join(directions) + ")"
            directions = []
        if answer:
            others = [r for r in turn["segments"] if not r["roles"] & role]
            if not turn["primaryMask"] & role and others:
                cue, _ = speech(turn, others)
                cue_speaker = turn["speaker"]
                speaker = "선관 · 합창"
            else:
                cue, cue_speaker = "", "장면 시작"
                if previous and previous["sceneId"] == turn["sceneId"]:
                    cue, _ = speech(previous, previous["segments"])
                    cue_speaker = previous["speaker"]
                speaker = turn["speaker"]
            pages = sorted(set(r["page"] for r in chosen))
            cards.append(dict(id=turn["id"], sceneId=turn["sceneId"], speaker=speaker, kind="행동" if nonverbal else turn["kind"], song=turn["song"], answer=answer, directions=directions, cueSpeaker=cue_speaker, cue=cue, pages=pages, regionIds=[r["region"] for r in chosen]))
    previous = turn

for scene in scenes:
    scene["count"] = sum(c["sceneId"] == scene["id"] for c in cards)
assert len(scenes) == 13
assert len({c["id"] for c in cards}) == len(cards)
assert all(c["answer"] and c["pages"] for c in cards)
assert {r for c in cards for r in c["regionIds"]} == expected
deck = dict(version=1, role="선관", characters=runtime["profiles"][2]["characters"], sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), ownershipSha256=hashlib.sha256(audit_path.read_bytes()).hexdigest(), ownedRegions=len(expected), scenes=scenes, cards=cards)
target = Path(__file__).resolve().parents[1] / "src/data/seonkwan-lines.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(deck, ensure_ascii=False, indent=2)+"\n")
print(json.dumps(dict(cards=len(cards), scenes=scenes, ownedRegions=len(expected)), ensure_ascii=False))
