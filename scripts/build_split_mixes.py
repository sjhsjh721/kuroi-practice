"""Create independently adjustable, single-clock MR/guide files for the PWA.

Channel 0: normalized mono MR. Channel 1: normalized, word-anchored guide.
Native originals and old mix files are never overwritten by this pipeline.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('OMP_NUM_THREADS','1')
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from pathlib import Path
import numpy as np
import soundfile as sf
from sync_audio import ROOT, PWA, ORIGINAL, CACHE, PIPELINE, BASELINE_TRACKS, anchored_part, anchor_audit

RATE=44100
OUTPUT=PWA/'generated/mix-v2'
# Bump on waveform-processing changes; catalogue formatting and validation-only
# changes do not require recomputing identical encoded audio.
RENDER_VERSION='r2-crisp5-lufs20-peak1.5-aac128-44100-encodedpeak-v2'

def run(args, **kwargs):
    return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kwargs)

@lru_cache(maxsize=2)
def audio(path):
    return np.frombuffer(run(['ffmpeg','-v','error','-i',str(ORIGINAL/path),'-f','f32le','-ac','1','-ar',str(RATE),'-']).stdout,dtype='<f4').copy()

def loudness(path):
    result=run(['ffmpeg','-hide_banner','-i',str(path),'-af','loudnorm=I=-20:TP=-8:LRA=11:print_format=json','-f','null','-'])
    return json.loads(re.findall(r'\{[^{}]*\}',result.stderr.decode())[-1])

def render(track):
    OUTPUT.mkdir(parents=True,exist_ok=True)
    key=hashlib.sha256((RENDER_VERSION+PIPELINE).encode()).hexdigest()[:12]
    meta=OUTPUT/(track['source']+'.'+key+'.json')
    current_path='mixes/v2/'+Path(track['path']).name
    target=OUTPUT/current_path;target.parent.mkdir(parents=True,exist_ok=True)
    if meta.exists() and target.exists():return json.loads(meta.read_text())
    x,y,_=anchored_part(track)
    mr=audio(track['reference']);guide=audio(track['source'])
    mr_duration=len(mr)/RATE
    y=np.clip(y,0,mr_duration)
    offset=int(round(y[0]*RATE));end=int(round(y[-1]*RATE))
    desired=max(1,end-offset)
    with tempfile.TemporaryDirectory(prefix='render-',dir=CACHE) as scratch:
        scratch=Path(scratch)
        sf.write(scratch/'source.wav',guide,RATE,subtype='FLOAT')
        frames=np.rint(x*RATE).astype(np.int64)
        targets=np.rint((y-y[0])*RATE).astype(np.int64)
        keep=np.r_[True,np.diff(frames)>0]
        frames,targets=frames[keep],targets[keep]
        # Rubber Band accepts a non-decreasing map. Preserve distinct source
        # points at pause boundaries so pauses do not shift later vocal entries.
        (scratch/'time.map').write_text('\n'.join(f'{a} {b}' for a,b in zip(frames,targets)))
        run(['rubberband','--fast','--crisp','5','--duration',str(desired/RATE),'--timemap',str(scratch/'time.map'),str(scratch/'source.wav'),str(scratch/'aligned.wav')])
        warped,sr=sf.read(scratch/'aligned.wav',dtype='float32');assert sr==RATE
        assert abs(len(warped)-desired)<=512,(track['source'],'time-map output length',len(warped),desired)
        stem=np.zeros_like(mr);count=min(len(warped),desired,len(stem)-offset)
        fade=min(220,count//2)
        warped[:fade]*=np.linspace(0,1,fade);warped[count-fade:count]*=np.linspace(1,0,fade)
        stem[offset:offset+count]=warped[:count]
        sf.write(scratch/'mr.wav',mr[offset:end],RATE,subtype='FLOAT')
        sf.write(scratch/'guide.wav',stem[offset:end],RATE,subtype='FLOAT')
        ml,hl=loudness(scratch/'mr.wav'),loudness(scratch/'guide.wav')
        mi,hi=float(ml['input_i']),float(hl['input_i'])
        # Match gated loudness, cap each encoded channel, then use the app's
        # common mix-bus soft limiter for rare coincident peaks at 100% sliders.
        mp=20*np.log10(max(float(np.max(np.abs(mr))),1e-8))
        hp=20*np.log10(max(float(np.max(np.abs(stem))),1e-8))
        common=min(-20.,-1.5-mp+mi,-1.5-hp+hi)
        mg,hg=10**((common-mi)/20),10**((common-hi)/20)
        stereo=np.c_[mr*mg,stem*hg].astype('<f4')
        for attempt in range(4):
            run(['ffmpeg','-v','error','-y','-f','f32le','-ac','2','-ar',str(RATE),'-i','-','-c:a','aac','-b:a','128k','-aac_ms','0','-aac_is','0','-movflags','+faststart',str(target)],input=stereo.tobytes())
            decoded=np.frombuffer(run(['ffmpeg','-v','error','-i',str(target),'-f','f32le','-']).stdout,dtype='<f4')
            encoded_peak=float(np.max(np.abs(decoded)))
            if encoded_peak<=.95:break
            adjustment=.90/encoded_peak
            stereo*=adjustment;mg*=adjustment;hg*=adjustment;common+=20*np.log10(adjustment)
        assert encoded_peak<=.95,(track['source'],'encoded AAC peak',encoded_peak)
    audit=anchor_audit(track)
    errors=[abs(r['afterError']) for r in audit['rows']]
    result={k:track[k] for k in ['number','type','role','title','path','reference','source']}
    result.update(previousPath=track['path'],path=current_path)
    result.update(layout='mr-left-harmony-right-v2',durationMs=round(mr_duration*1000),partStartMs=round(y[0]*1000),partEndMs=round(y[-1]*1000),preview=True,
        method='sung-word anchors + chroma/onset MrMsDTW + Rubber Band R2 crisp5 + independent loudness-matched channels',
        renderer='rubberband-r2-crisp5',targetSamples=desired,renderedSamples=len(warped),encodedPeak=encoded_peak,
        normalization=dict(mrInputLUFS=mi,harmonyInputLUFS=hi,targetLUFS=round(common,3),mrGain=float(mg),harmonyGain=float(hg)),
        validation=dict(heldoutWords=audit['heldoutWords'],beforeMedianSeconds=audit['beforeMedian'],afterMedianSeconds=audit['afterMedian'],afterP90Seconds=float(np.percentile(errors,90)) if errors else None),pipeline=key)
    meta.write_text(json.dumps(result,ensure_ascii=False,indent=2))
    (CACHE/(track['source']+'.word-audit.json')).write_text(json.dumps(audit,ensure_ascii=False,indent=2))
    print('RENDER',track['source'],result['normalization'],result['validation'],flush=True)
    return result

def number_group(group):return [render(t) for t in group]

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--number',type=int);p.add_argument('--source');p.add_argument('--workers',type=int,default=2);args=p.parse_args()
    tracks=BASELINE_TRACKS
    selected=[t for t in tracks if (not args.number or t['number']==args.number) and (not args.source or t['source']==args.source)]
    groups=[[t for t in selected if t['number']==n] for n in sorted({t['number'] for t in selected})]
    if args.workers==1:results=[r for g in groups for r in number_group(g)]
    else:
        with ProcessPoolExecutor(max_workers=args.workers) as pool:results=[r for group in pool.map(number_group,groups) for r in group]
    if len(results)==58:
        (OUTPUT/'mix-catalog-v2.json').write_text(json.dumps(dict(version=2,tracks=results),ensure_ascii=False,indent=2))
    (ROOT/'artifacts/mix-rebuild-v083.json').write_text(json.dumps(dict(recordings=len(results),tracks=results),ensure_ascii=False,indent=2))
    print('DONE',len(results),flush=True)
