"""Verify actual encoded channels, balance, MR clock and Rubber Band landmarks."""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
import argparse
import json
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import correlate, correlation_lags
from build_split_mixes import RATE, audio, loudness, run
from sync_audio import ROOT, PWA, CACHE

def inspect(track, library):
    assert track['renderer']=='rubberband-r2-crisp5'
    assert abs(track['renderedSamples']-track['targetSamples'])<=512
    raw=run(['ffmpeg','-v','error','-i',str(library/track['path']),'-f','f32le','-ac','2','-ar',str(RATE),'-']).stdout
    decoded=np.frombuffer(raw,dtype='<f4').reshape(-1,2)
    assert np.isfinite(decoded).all()
    mr=audio(track['reference']);n=min(len(mr),len(decoded))
    assert abs(len(mr)-len(decoded))<=1024,(track['path'],len(mr),len(decoded))
    peak=float(np.max(np.abs(decoded)));assert peak<.98,(track['path'],peak)
    offsets=[];correlations=[]
    for f in [.05,.25,.5,.75,.95]:
        at=int((n-RATE)*f);reference=mr[at:at+RATE];actual=decoded[at:at+RATE,0]
        if np.sqrt(np.mean(reference**2))<.001:continue
        result=correlate(actual,reference,method='fft');lags=correlation_lags(len(actual),len(reference))
        valid=abs(lags)<=round(.002*RATE);lag=int(lags[valid][np.argmax(result[valid])]);offsets.append(lag/RATE*1000)
        correlations.append(float(np.dot(actual,reference)/max(np.linalg.norm(actual)*np.linalg.norm(reference),1e-9)))
    assert offsets and max(abs(x) for x in offsets)<2,(track['path'],offsets)
    assert max(offsets)-min(offsets)<1,(track['path'],offsets)
    start=round(track['partStartMs']/1000*RATE);end=min(n,round(track['partEndMs']/1000*RATE))
    with tempfile.TemporaryDirectory(prefix='verify-',dir=CACHE) as temp:
        temp=Path(temp)
        for c in [0,1]:sf.write(temp/f'{c}.wav',decoded[start:end,c],RATE,subtype='FLOAT')
        ml,hl=loudness(temp/'0.wav'),loudness(temp/'1.wav')
    left,right=float(ml['input_i']),float(hl['input_i']);difference=left-right
    assert abs(difference)<.6,(track['path'],left,right)
    return dict(path=track['path'],samples=len(decoded),peak=peak,mrClockOffsetsMs=offsets,mrCorrelation=correlations,mrLUFS=left,harmonyLUFS=right,balanceDifferenceLU=difference,wordValidation=track['validation'])

def rubberband_probe():
    rng=np.random.default_rng(17);duration=4
    t=np.arange(RATE*duration)/RATE;source=(np.sin(2*np.pi*440*t)*.05).astype('f4')
    a=np.array([0.,.5,1.5,2.5,3.5,4.]);b=np.array([0.,1.,2.,4.,4.5,5.])
    for at in a[1:-1]:
        index=round(at*RATE);width=round(.012*RATE)
        source[index:index+width]+=rng.normal(size=width).astype('f4')*.25*np.hanning(width)
    with tempfile.TemporaryDirectory(prefix='rubberband-probe-',dir=CACHE) as temp:
        temp=Path(temp);sf.write(temp/'in.wav',source,RATE,subtype='FLOAT')
        (temp/'map').write_text('\n'.join(f'{round(x*RATE)} {round(y*RATE)}' for x,y in zip(a,b)))
        run(['rubberband','--fast','--crisp','5','--duration','5','--timemap',str(temp/'map'),str(temp/'in.wav'),str(temp/'out.wav')])
        output,sr=sf.read(temp/'out.wav');assert sr==RATE
    errors=[]
    for target in b[1:-1]:
        start=round((target-.15)*RATE);chunk=output[start:round((target+.15)*RATE)]
        observed=(start+np.argmax(np.abs(chunk)))/RATE
        errors.append(float(observed-target))
    pitches=[]
    for start,end in [(0.1,.7),(2.5,3.1)]:
        part=output[round(start*RATE):round(end*RATE)]
        freq=np.fft.rfftfreq(len(part),1/RATE);power=np.abs(np.fft.rfft(part*np.hanning(len(part))))
        pitches.append(float(freq[np.argmax(power)]))
    assert max(abs(e) for e in errors)<.025,errors
    assert abs(len(output)/RATE-5)<.002
    assert all(abs(p-440)<2 for p in pitches),pitches
    return dict(markerErrorsSeconds=errors,pitchHz=pitches,duration=len(output)/RATE)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--library',type=Path,default=PWA/'public/library');args=p.parse_args()
    tracks=json.loads((args.library/'mix-catalog-v2.json').read_text())['tracks'];assert len(tracks)==58
    probe=rubberband_probe()
    with ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(lambda t:inspect(t,args.library),tracks))
    report=dict(status='PASS',recordings=len(rows),rubberband=probe,maxBalanceDifferenceLU=max(abs(r['balanceDifferenceLU']) for r in rows),maxMRClockOffsetMs=max(abs(x) for r in rows for x in r['mrClockOffsetsMs']),tracks=rows,
        limitation='Held-out ASR word timing is automatic evidence, not human musical ground truth. One short part has no held-out words.')
    (ROOT/'artifacts/mix-output-validation-v083.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='tracks'},ensure_ascii=False))
