"""High-resolution chroma/onset alignment; analysis only, no native asset writes.

Sync Toolbox 1.4.2 implements the published chroma+DLNCO/MrMsDTW method:
https://groupmm.github.io/synctoolbox/
https://resources.mpi-inf.mpg.de/MIR/SyncRWC60/2009_EwertMuellerGrosche_HighResAudioSync_ICASSP.pdf
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('MPLBACKEND', 'Agg')
import argparse
import hashlib
import json
import subprocess
import time
import io
import contextlib
from functools import lru_cache
from pathlib import Path
import numpy as np
from synctoolbox.feature.pitch import audio_to_pitch_features
from synctoolbox.feature.pitch_onset import audio_to_pitch_onset_features
from synctoolbox.feature.chroma import pitch_to_chroma
from synctoolbox.feature.dlnco import pitch_onset_features_to_DLNCO
from synctoolbox.feature.utils import normalize_feature
from synctoolbox.dtw.mrmsdtw import sync_via_mrmsdtw, sync_via_mrmsdtw_with_anchors
from sklearn.linear_model import RANSACRegressor

PWA = Path(__file__).resolve().parents[1]
ROOT = PWA.parent if (PWA.parent/'app/src/main/assets/library').exists() else PWA
ORIGINAL = ROOT / 'data/original' if (ROOT/'data/original').exists() else PWA/'public/library'
CACHE = ROOT / 'data/sync-v2'
INPUTS=json.loads(Path(__file__).with_name('sync-inputs.json').read_text())
BASELINE_TRACKS=INPUTS['tracks']
PIPELINE=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:12]
SR = 22050
FPS = 50

def decode(path):
    return np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-']), dtype='<f4').copy()

def chroma_for(pitch):
    chroma=pitch_to_chroma(pitch)
    chroma=np.sqrt(np.maximum(chroma-.5*(np.roll(chroma,1,axis=0)+np.roll(chroma,-1,axis=0)),0))
    result=normalize_feature(chroma,2,1e-7)
    result[:,np.max(pitch,axis=0)<np.max(pitch)*1e-5]=0
    return result

@lru_cache(maxsize=8)
def features(path):
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / (path + '.features.npz')
    if dest.exists():
        f = np.load(dest)
        return chroma_for(f['pitch']), f['onset'], f['pitch'], float(f['duration'])
    started = time.time()
    raw = decode(ORIGINAL / path).astype(float)
    with contextlib.redirect_stdout(io.StringIO()):
        pitch = audio_to_pitch_features(raw, feature_rate=FPS, midi_min=36, midi_max=96)
    chroma = chroma_for(pitch)
    with contextlib.redirect_stdout(io.StringIO()):
        peaks = audio_to_pitch_onset_features(raw, midi_min=36, midi_max=96)
    onset = pitch_onset_features_to_DLNCO(peaks, pitch.shape[1], feature_rate=FPS, midi_min=36, midi_max=96)
    np.savez_compressed(dest, chroma=chroma.astype('f4'), onset=onset.astype('f4'), pitch=pitch.astype('f4'), duration=len(raw)/SR)
    print('FEATURE', path, round(time.time()-started, 2), flush=True)
    return chroma, onset, pitch, len(raw)/SR

def path_times(wp, length):
    # Use the median of all target frames, rather than an arbitrary duplicate.
    out = np.full(length, np.nan)
    for x in np.unique(wp[0]):
        out[int(x)] = np.median(wp[1, wp[0] == x]) / FPS
    good = np.flatnonzero(np.isfinite(out))
    return np.maximum.accumulate(np.interp(np.arange(length), good, out[good]))

def align_pair(number):
    dest = CACHE / f'ar-mr-{number}.v2.npz'
    if dest.exists(): return np.load(dest)['time']
    a, ao, _, _ = features(f'ar_{number}.mp3')
    m, mo, _, _ = features(f'mr_{number}.mp3')
    wp = sync_via_mrmsdtw(a, m, ao, mo, input_feature_rate=FPS, step_weights=np.array([1.15,1.15,1.]), threshold_rec=1_000_000)
    values = path_times(wp, a.shape[1])
    np.savez_compressed(dest, time=values)
    print('PAIR', number, flush=True)
    return values

def guide_clock(track, beats, guide):
    """Recover a MIDI practice recording's steady clock when audio confirms it.

    The source score-DTW curve can freeze on rests or repeat a note. Fit its
    dominant tempo, then check every pitched note with separate IIR features.
    Variable-tempo guides retain their original clock if that check gets worse.
    """
    cache=CACHE/(track['source']+'.clock-'+PIPELINE+'.json')
    if cache.exists():return json.loads(cache.read_text())
    model=RANSACRegressor(min_samples=2,residual_threshold=.15,max_trials=2000,random_state=0)
    model.fit(beats[:,None],guide)
    slope=float(model.estimator_.coef_[0]);intercept=float(model.estimator_.intercept_)
    inliers=float(np.mean(model.inlier_mask_))
    chroma,_,_,duration=features(track['source'])
    notes=[e for e in role_notes(track['number'],track['role']) if beats[0]<=e['start']<=beats[-1]]
    b=np.array([e['start']+min((e['end']-e['start'])*.3,.25) for e in notes])
    midi=np.array([e['midi']%12 for e in notes],dtype=int)
    def match(times):
        k=np.clip(np.rint(times*FPS).astype(int),0,chroma.shape[1]-1)
        return float(np.mean(chroma[midi,k])) if len(k) else 0.
    raw=match(np.interp(b,beats,guide));linear=match(b*slope+intercept)
    use=bool(inliers>=.6 and slope>0 and linear>=raw*.95)
    report=dict(slope=slope,intercept=intercept,inliers=inliers,notePitchBefore=raw,notePitchLinear=linear,notes=len(notes),useLinear=use)
    cache.write_text(json.dumps(report,indent=2));print('CLOCK',track['source'],report,flush=True)
    return report

@lru_cache(maxsize=64)
def role_notes(number, role):
    return INPUTS['notes'][str(number)][role]

def word_anchor_map(track, heldout=False):
    """Map the guide's musical clock to independently transcribed sung words.

    No guide frames are skipped to minimize a DTW path's accumulated cost.
    Speech interruptions and tempo changes are anchored on the AR performance.
    """
    native=ROOT/'app/src/main/assets/library/score-navigation.json'
    nav=json.loads((native if native.exists() else PWA/'public/library/score-navigation.json').read_text())
    audit=dict(anchors=INPUTS['words'][str(track['number'])])
    beats=np.array(nav['songs'][str(track['number'])]['beats'])
    guide=np.array(nav['tracks'][track['source']]['times'])/1000
    ar=np.array(nav['tracks'][f'ar_{track["number"]}.mp3']['times'])/1000
    valid=guide>=0
    b,h,a=beats[valid],guide[valid],ar[valid]
    clock=guide_clock(track,b,h)
    guide_duration=features(track['source'])[3]
    notes=role_notes(track['number'],track['role'])
    sung=[w for w in audit['anchors'] if any(e['start']-.125<=w['beat']<e['end']+.125 for e in notes)]
    words=sung if len(sung)>=4 else audit['anchors']
    grouped={}
    validation=[]
    for word in words:
        if not b[0]<=word['beat']<=b[-1]: continue
        x=float(word['beat']*clock['slope']+clock['intercept']) if clock['useLinear'] else float(np.interp(word['beat'],b,h))
        if x<0 or x>=guide_duration:continue
        validation.append((x,word['time'],word['holdout']))
        if heldout and word['holdout']:continue
        grouped.setdefault(x,[]).append(word['time'])
    points=[]
    for x,ys in sorted(grouped.items()):
        y=float(np.median(ys))
        if not points or (x>points[-1][0]+.12 and y>points[-1][1]+.05):points.append((x,y))
    # Unmatched edges retain the existing score boundary. Before the very first
    # sung word, extrapolate local musical tempo instead of stretching from t=0
    # across an instrumental introduction.
    begin=float(a[0]);end=float(a[-1])
    duration=features(track['source'])[3]
    if len(points)>=2 and b[0]<min(w['beat'] for w in audit['anchors']):
        first=np.array(points[:min(6,len(points))]);slopes=np.diff(first[:,1])/np.maximum(np.diff(first[:,0]),.001)
        reasonable=slopes[(slopes>.3)&(slopes<3)]
        ratio=float(np.median(reasonable)) if len(reasonable) else 1.
        begin=max(0,points[0][1]-points[0][0]*ratio)
    observed=(points[0][0],points[-1][0]) if len(points)>=2 else (0.,0.)
    if not points:points=list(zip(h[::max(1,len(h)//20)],a[::max(1,len(a)//20)]))
    if points[0][0]>.01:points.insert(0,(0.,min(begin,points[0][1]-.01)))
    if points[-1][0]<duration:
        last_slope=(a[-1]-a[-2])/max(.01,h[-1]-h[-2])
        end=max(points[-1][1]+.01,end+max(0,duration-h[-1])*np.clip(last_slope,.3,3))
        points.append((duration,end))
    points=np.array(points)
    return points,validation,observed

def anchored_part(track, heldout=False):
    dest=CACHE/(track['source']+('.heldout-' if heldout else '.anchored-')+PIPELINE+'.npz')
    if dest.exists():
        f=np.load(dest);return f['source'],f['mr'],f['ar']
    points,_,_=word_anchor_map(track,heldout=heldout)
    h,ho,_,hd=features(track['source'])
    a,ao,_,_=features(f'ar_{track["number"]}.mp3')
    lo=max(0,round(points[0,1]*FPS));hi=min(a.shape[1],round(points[-1,1]*FPS)+1)
    anchors=[(float(x),float(y-lo/FPS)) for x,y in points[1:-1] if .2<x<hd-.2 and lo/FPS+.2<y<(hi-1)/FPS-.2]
    wp=sync_via_mrmsdtw_with_anchors(h,a[:,lo:hi],ho,ao[:,lo:hi],input_feature_rate=FPS,step_weights=np.array([1.25,1.25,1.]),threshold_rec=1_000_000,anchor_pairs=anchors)
    xs=[];ys=[]
    for i in np.unique(wp[0]):
        targets=wp[1,wp[0]==i]
        if targets.max()-targets.min()>FPS*.3 and 0<i<h.shape[1]-1:
            xs.extend([(i-.49)/FPS,(i+.49)/FPS]);ys.extend([targets.min()/FPS+lo/FPS,targets.max()/FPS+lo/FPS])
        else:xs.append(i/FPS);ys.append(float(np.median(targets))/FPS+lo/FPS)
    x=np.array(xs);ar=np.array(ys)
    if x[-1]<hd:
        x=np.r_[x,hd];ar=np.r_[ar,ar[-1]+max(0,hd-x[-2])]
    pair=align_pair(track['number'])
    mr=np.interp(ar*FPS,np.arange(len(pair)),pair)
    np.savez_compressed(dest,source=x,mr=mr,ar=ar)
    return x,mr,ar

def anchor_audit(track):
    points,words,observed=word_anchor_map(track,heldout=True)
    pair=align_pair(track['number'])
    curve_x,curve_mr,_=anchored_part(track,heldout=True)
    old=np.array(track['anchors'])
    rows=[]
    for x,time,heldout in words:
        if not heldout or x<=observed[0] or x>=observed[1]:continue
        expected=float(np.interp(time*FPS,np.arange(len(pair)),pair))
        actual=float(np.interp(x,curve_x,curve_mr))
        before=float(np.interp(x,old[:,0],old[:,1]))
        rows.append(dict(sourceTime=x,referenceMR=expected,beforeError=before-expected,afterError=actual-expected))
    return dict(source=track['source'],heldoutWords=len(rows),beforeMedian=float(np.median([abs(r['beforeError']) for r in rows])) if rows else None,afterMedian=float(np.median([abs(r['afterError']) for r in rows])) if rows else None,rows=rows)

def probe(track):
    x,y,ar=anchored_part(track)
    old=np.array(track['anchors'])
    _,_,hp,_=features(track['source'])
    _,_,ap,_=features(f'ar_{track["number"]}.mp3')
    pair=align_pair(track['number'])
    # Report a separate 128-register pitch measure, not used as the DTW cost.
    hp=normalize_feature(np.sqrt(hp),2,1e-7);ap=normalize_feature(np.sqrt(ap),2,1e-7)
    active=np.max(hp,axis=0)>.25
    def agreement(times):
        frames=np.clip(np.rint(np.interp(np.arange(hp.shape[1])/FPS,x,times)*FPS).astype(int),0,ap.shape[1]-1)
        return float(np.mean(np.sum(hp[:,active]*ap[:,frames[active]],axis=0)))
    old_mr=np.interp(x,old[:,0],old[:,1])
    keep=np.r_[True,np.diff(pair)>.001]
    old_ar=np.interp(old_mr,pair[keep],np.arange(len(pair))[keep]/FPS)
    sample=np.arange(0,x[-1],10)
    report=dict(source=track['source'],registerPitchBefore=agreement(old_ar),registerPitchAfter=agreement(ar),wordAudit=anchor_audit(track),samples=np.round(np.c_[sample,np.interp(sample,x,old_mr),np.interp(sample,x,y)],3).tolist())
    print(json.dumps(report,ensure_ascii=False),flush=True)
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',default='harmony_선관_1.mp3');args=parser.parse_args()
    report=probe(next(t for t in BASELINE_TRACKS if t['source']==args.source))
    (ROOT/'artifacts'/('sync-probe-'+args.source+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2))
