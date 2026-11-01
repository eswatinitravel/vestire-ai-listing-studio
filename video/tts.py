import json, subprocess, wave, os
import os
# Voice: en_US-kristin-medium (Piper; trained from scratch on public-domain LibriVox audio, see MODEL_CARD-kristin.txt).
# Override with VOICE=en_US-ljspeech-high (public-domain LJ Speech). LENGTH sets the pace (1.12 = gentle, slower).
VOICE=os.environ.get("VOICE","en_US-kristin-medium"); LENGTH=os.environ.get("LENGTH","1.12")
M=f"/workspace/work/tts-models/{VOICE}.onnx"
v=json.load(open('vo.json')); out={}
SPOKEN = {"Vestire": "Vesteeray", "SlimSAM": "Slim Sam", "CSV": "C S V"}
def sp(t):
    for k,x in SPOKEN.items(): t=t.replace(k,x)
    return t
for beat, lines in v:
    out[beat]=[]
    for i,t in enumerate(lines):
        f=f"tts/{beat}_{i}.wav"
        subprocess.run(["python3","-m","piper","-m",M,"-f",f,"--length-scale",LENGTH,"--noise-scale","0.6","--sentence-silence","0.35"],input=sp(t).encode(),check=True,capture_output=True)
        w=wave.open(f); d=w.getnframes()/w.getframerate(); out[beat].append([t,f,round(d,3)])
json.dump(out,open('tts/durations.json','w'),indent=1)
tot=0
for b,l in out.items():
    s=sum(x[2] for x in l); tot+=s; print(b, round(s,2), [x[2] for x in l])
print("total speech", round(tot,1))
