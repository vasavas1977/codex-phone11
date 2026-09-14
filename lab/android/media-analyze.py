#!/usr/bin/env python3
"""Analyze only exported synthetic lab media. No speech recognition or network calls."""
import argparse, array, hashlib, io, json, math, pathlib, shutil, subprocess, sys, tempfile, wave

FREQUENCIES=(440,697,1209)
WINDOW_SECONDS=.1
MIN_SIGNAL_SECONDS=.5

def decoded(file):
    file=pathlib.Path(file).resolve(strict=True)
    if not file.is_file() or file.stat().st_size>32*1024*1024:
        raise ValueError('Media must be a bounded local file')
    raw=file.read_bytes()
    if raw[:4]==b'RIFF':
        data=raw
    else:
        if file.suffix.lower()!='.mp3' or not shutil.which('ffmpeg'):
            raise ValueError('Expected PCM WAV or MP3 with local ffmpeg installed')
        # Restrict the decoder to this local file; no playlist/network protocols.
        result=subprocess.run(['ffmpeg','-v','error','-protocol_whitelist','file,pipe','-i',str(file),
            '-t','21','-map','0:a:0','-acodec','pcm_s16le','-f','wav','pipe:1'],capture_output=True,timeout=30)
        if result.returncode: raise ValueError('Local decoder failed')
        data=result.stdout
    with wave.open(io.BytesIO(data)) as w:
        rate,channels,width=w.getframerate(),w.getnchannels(),w.getsampwidth()
        if width!=2 or channels not in (1,2) or not 8000<=rate<=48000:
            raise ValueError('Expected mono/stereo PCM16 at 8..48 kHz')
        pcm=w.readframes(int(rate*21)+1)
    if len(pcm)//(2*channels)>rate*20.5:
        raise ValueError('Capture exceeds the bounded lab duration')
    samples=array.array('h');samples.frombytes(pcm)
    if sys.byteorder!='little':samples.byteswap()
    return samples,rate,channels,hashlib.sha256(raw).hexdigest()

def frequency_fraction(values,freq,rate,energy):
    # Goertzel evaluates the exact known frequency, independently of FFT bin rounding.
    coeff=2*math.cos(2*math.pi*freq/rate);a=b=0.
    for value in values:
        nxt=value+coeff*a-b;b=a;a=nxt
    power=max(0.,a*a+b*b-coeff*a*b)
    return 2*power/(len(values)*energy) if energy else 0.

def analyze(file):
    samples,rate,channels,digest=decoded(file);frames=len(samples)//channels;n=round(rate*WINDOW_SECONDS)
    output=[]
    for channel in range(channels):
        source=[samples[i]/32768. for i in range(channel,len(samples),channels)]
        tone_windows={str(f):[] for f in FREQUENCIES};dtmf=[];rms=[]
        for offset in range(0,len(source)-n+1,n):
            values=source[offset:offset+n];mean=sum(values)/n
            energy=sum((x-mean)**2 for x in values)
            db=10*math.log10(energy/n) if energy else -120.;rms.append(db)
            tapered=[(v-mean)*(.5-.5*math.cos(2*math.pi*i/(n-1))) for i,v in enumerate(values)]
            window_energy=sum(v*v for v in tapered)
            fractions={f:frequency_fraction(tapered,f,rate,window_energy) for f in FREQUENCIES}
            if db < -50: continue
            t=round(offset/rate,3)
            for f in FREQUENCIES:
                if fractions[f]>=.18:tone_windows[str(f)].append(t)
            if fractions[697]>=.12 and fractions[1209]>=.12 and fractions[697]+fractions[1209]>=.4:
                dtmf.append(t)
        output.append({'channel':channel+1,'tone440Seconds':round(len(tone_windows['440'])*WINDOW_SECONDS,2),
            'dtmf1Seconds':round(len(dtmf)*WINDOW_SECONDS,2),'dtmf1Windows':dtmf,
            'maxWindowRmsDbfs':round(max(rms,default=-120.),2)})
    return {'file':str(pathlib.Path(file)),'sha256':digest,'sampleRate':rate,'channels':channels,
        'durationSeconds':round(frames/rate,3),'measurements':output}

def evaluate(local,peer=None):
    down=[r['channel'] for r in local['measurements'] if r['tone440Seconds']>=MIN_SIGNAL_SECONDS]
    sent=[r['channel'] for r in local['measurements'] if r['dtmf1Seconds']>=MIN_SIGNAL_SECONDS]
    mapping=None
    if len(down)==len(sent)==1 and down[0]!=sent[0]:
        mapping={'received440Channel':down[0],'syntheticSendChannel':sent[0],'basis':'observed spectral signatures; no assumed channel order'}
    peer_tone=bool(peer and any(r['dtmf1Seconds']>=MIN_SIGNAL_SECONDS for r in peer['measurements']))
    down_ok=local['channels']==2 and bool(down)
    return {'status':'PASS' if down_ok and mapping and peer_tone else 'INCOMPLETE',
        'decodedDownlink440':'PASS' if down_ok else 'FAIL',
        'localSyntheticSend':'PASS' if sent else 'FAIL',
        'empiricalChannelMapping':mapping,
        'independentPeerUplinkDtmf1':'PASS' if peer_tone else 'FAIL' if peer else 'NOT_PROVEN',
        'scope':'Synthetic decoded media only; no microphone, speaker audibility, speech, or handset acceptance',
        'local':local,'peerReceived':peer}

def self_test():
    with tempfile.TemporaryDirectory(prefix='phone11-media-analysis-') as tmp:
        rate=16000
        def write(name,reverse=False,silent=False,mono=False):
            path=pathlib.Path(tmp,name);values=array.array('h')
            for i in range(rate):
                a=int(8000*math.sin(2*math.pi*440*i/rate)) if not silent else 0
                b=int(4000*(math.sin(2*math.pi*697*i/rate)+math.sin(2*math.pi*1209*i/rate))) if not silent else 0
                values.extend([b] if mono else [b,a] if reverse else [a,b])
            if sys.byteorder!='little':values.byteswap()
            with wave.open(str(path),'wb') as w:w.setnchannels(1 if mono else 2);w.setsampwidth(2);w.setframerate(rate);w.writeframes(values.tobytes())
            return path
        normal=analyze(write('normal.wav'));reverse=analyze(write('reverse.wav',True));peer=analyze(write('peer.wav',mono=True));silence=analyze(write('silent.wav',silent=True))
        assert evaluate(normal)['independentPeerUplinkDtmf1']=='NOT_PROVEN'
        assert evaluate(normal,peer)['status']=='PASS'
        assert evaluate(reverse,peer)['empiricalChannelMapping']['received440Channel']==2
        assert evaluate(silence,peer)['decodedDownlink440']=='FAIL'
        assert evaluate(normal,silence)['independentPeerUplinkDtmf1']=='FAIL'
    return {'selfTest':'PASS','scope':'Generated signals validate detector only; no actual Siprix media proof'}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('local',nargs='?');parser.add_argument('--peer-received');parser.add_argument('--self-test',action='store_true');args=parser.parse_args()
    if args.self_test: result=self_test()
    elif args.local: result=evaluate(analyze(args.local),analyze(args.peer_received) if args.peer_received else None)
    else: parser.error('Supply exported synthetic media or --self-test')
    print(json.dumps(result,indent=2));return 0 if result.get('status',result.get('selfTest'))=='PASS' else 2
if __name__=='__main__':
    try:sys.exit(main())
    except (ValueError,OSError,EOFError,wave.Error,subprocess.SubprocessError):
        print(json.dumps({'status':'ERROR','reason':'Invalid local synthetic media or unavailable decoder'}));sys.exit(1)
