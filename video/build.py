# Build the English demo video from the raw Playwright recordings + Piper voice-over.
# Output: out/vestire-listing-studio-demo.mp4 (1920x1080), captions .srt/.ass, optional vertical cut.
import json, os, subprocess, wave, zipfile, textwrap, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
PROJ = os.path.dirname(HERE)
B = "build"; OUT = "."; os.makedirs(B, exist_ok=True)
W, H, FPS = 1920, 1080, 25
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"; FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
TEAL = (45, 212, 191); NAVY = (6, 26, 46); WHITE = (240, 248, 250); GREY = (160, 186, 196)
LEAD, GAP, TAIL = 0.6, 0.35, 0.8
DUR = json.load(open("tts/durations.json"))
FORCE = os.environ.get("FORCE", "").split(",")
def ff(args, log):
    if os.path.exists(args[-1]) and args[-1].startswith(B + "/seg_") and log not in FORCE and "all" not in FORCE and os.path.getsize(args[-1]) > 1000: return
    r = subprocess.run(["ffmpeg", "-v", "error", "-y"] + args, capture_output=True, text=True)
    if r.returncode: print(r.stderr); open(f"{B}/{log}.err", "w").write(r.stderr); sys.exit(f"ffmpeg failed: {log}")
def font(p, s): return ImageFont.truetype(p, s)
def vo_len(beat): return sum(x[2] for x in DUR[beat]) + GAP * (len(DUR[beat]) - 1)
def need(beat, tail=TAIL): return round(LEAD + vo_len(beat) + tail, 2)

# ---------- still images ----------
def gradient():
    y = np.linspace(0, 1, H)[:, None]; x = np.linspace(0, 1, W)[None, :]
    r = 6 + 10 * x * (1 - y); g = 26 + 40 * (1 - y) * x + 10 * y; b = 46 + 50 * (1 - y) * x
    im = np.stack([r + 0 * y, g + 0 * x, b + 0 * x], -1).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(im); glow = Image.new("RGB", (W, H), (0, 0, 0)); d = ImageDraw.Draw(glow)
    d.ellipse((1100, -300, 2200, 700), fill=(10, 80, 90)); d.ellipse((-300, 600, 700, 1500), fill=(10, 40, 80))
    return Image.blend(img, glow.filter(ImageFilter.GaussianBlur(220)), 0.35)
BG = gradient()
def text_block(d, x, y, lines, maxw):
    for txt, f, col, gap in lines:
        for ln in wrap(d, txt, f, maxw):
            d.text((x, y), ln, font=f, fill=col); y += f.size + 12
        y += gap
    return y
def wrap(d, txt, f, maxw):
    out, cur = [], ""
    for w in txt.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) <= maxw: cur = t
        else: out.append(cur); cur = w
    return out + [cur]
PX, PY, PW, PH = 330, 70, 434, 940  # phone screen
def phone_bg(name, kicker, title, sub):
    im = BG.copy(); d = ImageDraw.Draw(im)
    d.rounded_rectangle((PX - 22, PY - 22, PX + PW + 22, PY + PH + 22), 64, fill=(8, 12, 18), outline=(60, 80, 92), width=3)
    text_block(d, 900, 210, [(kicker, font(FB, 30), TEAL, 18), (title, font(FB, 64), WHITE, 22), (sub, font(FR, 36), GREY, 0)], 900)
    im.save(f"{B}/bg_{name}.png")
def phone_frame():
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); m = Image.new("L", (W, H), 255); dm = ImageDraw.Draw(m)
    dm.rounded_rectangle((PX, PY, PX + PW, PY + PH), 46, fill=0)
    d = ImageDraw.Draw(im); d.rounded_rectangle((PX - 22, PY - 22, PX + PW + 22, PY + PH + 22), 64, fill=(8, 12, 18, 255), outline=(70, 92, 104, 255), width=3)
    d.rounded_rectangle((PX + PW // 2 - 60, PY + 10, PX + PW // 2 + 60, PY + 34), 12, fill=(8, 12, 18, 255))  # notch
    im.putalpha(Image.fromarray(np.minimum(np.array(im.split()[3]), np.array(m))))
    im.save(f"{B}/phone_frame.png")
def title_card():
    shirt = Image.open(os.path.join(PROJ, "assets-src", "demo-input.jpg")).convert("RGB")
    bg = shirt.resize((W, W)).crop((0, (W - H) // 2, W, (W + H) // 2)).filter(ImageFilter.GaussianBlur(28))
    bg = Image.blend(bg, Image.new("RGB", (W, H), NAVY), 0.72); d = ImageDraw.Draw(bg)
    sq = shirt.resize((720, 720)); bg.paste(sq, (1110, 150)); d.rectangle((1110, 150, 1830, 870), outline=TEAL, width=4)
    text_block(d, 110, 220, [("VESTIRE AI LISTING STUDIO", font(FB, 30), TEAL, 26), ("Small sellers lose hours on every listing", font(FB, 72), WHITE, 30),
                             ("Photos · background removal · captions · sizes · prices — for every single item.", font(FR, 36), GREY, 0)], 900)
    bg.save(f"{B}/title.png")
def zip_card(zpath):
    z = zipfile.ZipFile(zpath); names = sorted(z.namelist()); hdr = z.read("vestire-import.csv").decode().splitlines()[0]
    im = BG.copy(); d = ImageDraw.Draw(im)
    d.rounded_rectangle((PX - 22, PY - 22, PX + PW + 22, PY + PH + 22), 64, fill=(10, 30, 44), outline=(60, 80, 92), width=3)
    y = text_block(d, PX + 30, PY + 60, [("Listing pack (ZIP)", font(FB, 36), WHITE, 6), ("real contents of the downloaded file", font(FR, 22), GREY, 24)], PW - 60)
    for n in names:
        ico = "▣ " if n.startswith("images/") else "■ "
        d.text((PX + 34, y), ico + n, font=font(FM, 22), fill=TEAL if n.endswith(".csv") else WHITE); y += 44
    y += 20; d.text((PX + 34, y), "vestire-import.csv columns:", font=font(FB, 22), fill=GREY); y += 36
    for ln in textwrap.wrap(hdr.replace(",", ", "), 34): d.text((PX + 34, y), ln, font=font(FM, 19), fill=GREY); y += 28
    text_block(d, 900, 210, [("STEP 5 · SHARE", font(FB, 30), TEAL, 18), ("WhatsApp · ZIP · CSV", font(FB, 64), WHITE, 22), ("Images, captions, listing.json and a CSV in the Vestire import format.", font(FR, 36), GREY, 0)], 900)
    im.save(f"{B}/zipcard.png")
def end_card():
    im = BG.copy(); d = ImageDraw.Draw(im)
    d.rounded_rectangle((W // 2 - 70, 170, W // 2 + 70, 310), 34, fill=(8, 59, 82))
    d.line([(W // 2 - 34, 205), (W // 2, 275), (W // 2 + 34, 205)], fill=TEAL, width=16, joint="curve")
    def ctr(t, f, y, c):
        d.text(((W - d.textlength(t, font=f)) / 2, y), t, font=f, fill=c)
    ctr("Vestire AI Listing Studio", font(FB, 80), 360, WHITE)
    ctr("One photo. A full listing.", font(FR, 40), 470, GREY)
    ctr("vestire-listing-studio.pages.dev", font(FB, 52), 570, TEAL)
    ctr("Built with Meta Llama 4 Scout + Segment Anything", font(FB, 40), 670, WHITE)
    ctr("Open source · github.com/eswatinitravel/vestire-ai-listing-studio", font(FR, 28), 740, GREY)
    im.save(f"{B}/end.png")

# ---------- segments ----------
SEGS = []  # (name, beat, duration, style)
def seg_out(name): return f"{B}/seg_{name}.mp4"
ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), "-an"]
def clip_chain(i, a, b, speed, crop):
    return f"[{i}:v]trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{speed},fps={FPS},{crop}"
def still(name, beat, img, zoom_to=1.06, tail=TAIL, extra=0):
    D = need(beat, tail) + extra; n = int(D * FPS)
    vf = f"scale=3840:-2,zoompan=z='1+({zoom_to}-1)*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps={FPS},trim=duration={D}"
    ff(["-i", img, "-vf", vf, "-t", str(D)] + ENC + [seg_out(name)], name); SEGS.append((name, beat, D, "Wide"))
def desktop(name, beat, parts, extra_vf="", tail=TAIL):
    D = need(beat, tail); ins, chains = [], []
    for k, (src, a, b, sp) in enumerate(parts):
        ins += ["-i", f"raw/{src}"]; chains.append(clip_chain(k, a, b, sp, "crop=1280:720:0:0,scale=1920:1080:flags=lanczos,setsar=1") + f"[c{k}]")
    fc = ";".join(chains) + ";" + "".join(f"[c{k}]" for k in range(len(parts))) + f"concat=n={len(parts)}:v=1:a=0,tpad=stop_mode=clone:stop_duration={D}" + (("," + extra_vf) if extra_vf else "") + f",trim=duration={D}[v]"
    ff(ins + ["-filter_complex", fc, "-map", "[v]", "-t", str(D)] + ENC + [seg_out(name)], name); SEGS.append((name, beat, D, "Wide"))
def phone(name, beat, parts, bg, tail=TAIL, D=None, style="Side"):
    D = D or need(beat, tail); ins, chains = [], []
    for k, (src, a, b, sp) in enumerate(parts):
        ins += ["-i", f"raw/{src}"]; chains.append(clip_chain(k, a, b, sp, f"crop=390:844:0:0,scale={PW}:{PH}:flags=lanczos,setsar=1") + f"[c{k}]")
    n = len(parts); ins += ["-loop", "1", "-i", f"{B}/bg_{bg}.png", "-loop", "1", "-i", f"{B}/phone_frame.png"]
    fc = ";".join(chains) + ";" + "".join(f"[c{k}]" for k in range(n)) + f"concat=n={n}:v=1:a=0,tpad=stop_mode=clone:stop_duration={D}[ph];"
    fc += f"[{n}:v]fps={FPS},format=yuv420p[bg];[bg][ph]overlay={PX}:{PY}[a];[a][{n+1}:v]overlay=0:0,trim=duration={D}[v]"
    ff(ins + ["-filter_complex", fc, "-map", "[v]", "-t", str(D)] + ENC + [seg_out(name)], name)
    SEGS.append((name, beat, D, style))
def plain_still(name, img, D, style):
    ff(["-loop", "1", "-i", img, "-vf", f"fps={FPS},format=yuv420p", "-t", str(D)] + ENC + [seg_out(name)], name); SEGS.append((name, None, D, style))

# ---------- captions + audio ----------
SPOKEN = {"Vestire": "Vesteeray", "SlimSAM": "Slim Sam", "CSV": "C S V"}
def caption_pieces(text, maxc):
    if len(text) <= maxc: return [text]
    words = text.split(); best = None
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        score = abs(len(a) - len(b)) - (15 if a.endswith((",", ".", ":")) else 0)
        if best is None or score < best[0]: best = (score, a, b)
    return caption_pieces(best[1], maxc) + caption_pieces(best[2], maxc)
def build_audio_and_subs():
    t = 0.0; events = []; sr = 22050; total = sum(s[2] for s in SEGS); track = np.zeros(int((total + 1) * sr), np.int16)
    for name, beat, D, style in SEGS:
        if beat:
            c = t + LEAD
            for txt, f, dur in DUR[beat]:
                w = wave.open(f); a = np.frombuffer(w.readframes(w.getnframes()), np.int16); i0 = int(c * sr); track[i0:i0 + len(a)] = a[: len(track) - i0]
                pieces = caption_pieces(txt, 80 if style == "Side" else 92); L = sum(len(p) for p in pieces); cc = c
                for p in pieces:
                    d = dur * len(p) / L; events.append((cc, cc + d, p, style)); cc += d
                c += dur + GAP
        t += D
    with wave.open(f"{B}/vo.wav", "wb") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(track[: int(total * sr)].tobytes())
    def ts(x, sep): h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60; return f"{h:02d}:{m:02d}:{int(s):02d}{sep}{int(round((s % 1) * 1000)):03d}" if sep == "," else f"{h}:{m:02d}:{s:05.2f}"
    with open(f"{OUT}/vestire-listing-studio-demo.en.srt", "w") as f:
        for i, (a, b, p, _) in enumerate(events, 1): f.write(f"{i}\n{ts(a, ',')} --> {ts(min(b + 0.15, b), ',')}\n{p}\n\n")
    hdr = f"""[Script Info]\nScriptType: v4.00+\nPlayResX: {W}\nPlayResY: {H}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Wide,DejaVu Sans,46,&H00FFFFFF,&H00FFFFFF,&H40140C06,&H40140C06,-1,0,0,0,100,100,0,0,3,14,0,2,160,160,46,1
Style: Side,DejaVu Sans,42,&H00FFFFFF,&H00FFFFFF,&H40140C06,&H40140C06,-1,0,0,0,100,100,0,0,3,14,0,2,900,80,120,1
\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"""
    with open(f"{B}/captions.ass", "w") as f:
        f.write(hdr)
        for a, b, p, st in events: f.write(f"Dialogue: 0,{ts(a, '.')},{ts(b, '.')},{st},,0,0,0,,{p}\n")
    return total, events

if __name__ == "__main__":
    phone_frame(); title_card(); end_card(); zip_card("raw/m390-pack.zip")
    phone_bg("upload", "STEP 1 · ADD A PHOTO", "Any background · tap to guide", "Shot on the shop counter. Tap the garment so Segment Anything knows what to cut out.")
    phone_bg("share", "STEP 5 · SHARE", "WhatsApp · ZIP · CSV", "One tap to WhatsApp, or download the full listing pack.")
    phone_bg("draft", "STEP 6 · OPTIONAL", "Hidden draft · owner stays in control", "“Send to Vestire” is off by default. When enabled it creates the product as a hidden draft.")
    only = sys.argv[1:]
    still("01_problem", "problem", f"{B}/title.png")
    desktop("02_intro", "intro", [("desktop.webm", 0.5, 8.0, 1)])
    phone("03_upload", "upload", [("m390.webm", 11.5, 18.6, 1)], "upload")
    # generate: tap (real time) -> frozen SAM part at 4x -> finished timers, slow zoom + highlight
    Dg = need("generate"); z0 = 2.7 + 11 / 4 + 1.2; zn = int(z0 * FPS); zl = 2.5 * FPS
    zvf = (f"zoompan=z='if(lt(on,{zn}),1,min(1.25,1+(on-{zn})*0.25/{zl}))':x='(zoom-1)/0.25*190':y=0:d=1:s={W}x{H}:fps={FPS},"
           f"drawtext=fontfile={FB}:text='4x speed  ·  real run 16.1 s':x=60:y=60:fontsize=40:fontcolor=white:box=1:boxcolor=0x061a2e@0.85:boxborderw=18:enable='between(t,2.7,{2.7 + 11 / 4})',"
           f"drawbox=x=1500:y=118:w=335:h=620:color=0x2dd4bf@0.95:t=7:enable='gte(t,{z0 + 2.8})',"
           f"drawtext=fontfile={FB}:text='Live timers':x=1520:y=760:fontsize=40:fontcolor=0x2dd4bf:box=1:boxcolor=0x061a2e@0.85:boxborderw=12:enable='gte(t,{z0 + 2.8})'")
    desktop("04_generate", "generate", [("desktop.webm", 16.8, 19.5, 1), ("desktop.webm", 19.5, 30.5, 4), ("desktop.webm", 30.5, 35.0, 1)], extra_vf=zvf)
    desktop("05_gallery", "gallery", [("desktop.webm", 36.0, 41.0, 0.6)])
    Df = need("form"); desktop("06_form", "form", [("desktop.webm", 41.0, 60.0, round(19.0 / (Df - 0.6), 3))])
    Ds = need("share"); phone("07_share", "share", [("m390.webm", 66.3, 68.9, 1), ("m390-wa.webm", 0.0, 3.9, 1), ("m390.webm", 73.0, 75.8, 1)], "share", D=9.3)
    plain_still("07b_zip", f"{B}/zipcard.png", round(max(Ds - 9.3, 3.5), 2), "Side")
    phone("08_draft", "draft", [("m390.webm", 76.3, 82.3, 0.7)], "draft")
    still("09_end", "end", f"{B}/end.png", zoom_to=1.03, tail=1.6)
    json.dump(SEGS, open(f"{B}/segs.json", "w"), indent=1)
    print(SEGS); total, ev = build_audio_and_subs(); print("total", total, "captions", len(ev))
    open(f"{B}/list.txt", "w").write("".join(f"file 'seg_{n}.mp4'\n" for n, *_ in SEGS))
    ff(["-f", "concat", "-safe", "0", "-i", f"{B}/list.txt", "-c", "copy", f"{B}/joined.mp4"], "join")
    final = f"{OUT}/vestire-listing-studio-demo.mp4"
    ff(["-i", f"{B}/joined.mp4", "-i", f"{B}/vo.wav", "-vf", f"subtitles={B}/captions.ass", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart", "-shortest", final], "final")
    print("done", final)
