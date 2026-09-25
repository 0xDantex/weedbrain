"""Build the README and share images from captures of the working build.

  python3 tools/make-images.py terminal OUT.png "$ command" < output.txt
  python3 tools/make-images.py strip                    docs/img/stages.png
  python3 tools/make-images.py hero CANVAS.png          src/img/scene-smoking.png + src/og.png
  python3 tools/make-images.py pair LEFT.png RIGHT.png OUT.png
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BG = (11, 9, 7)
INK = (239, 230, 216)
DIM = (148, 136, 120)
ORANGE = (235, 108, 37)
GREEN = (185, 224, 122)
RED = (255, 106, 77)


def font(size):
    for p in ["/System/Library/Fonts/SFNSMono.ttf", "/System/Library/Fonts/Menlo.ttc"]:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


def terminal(out, cmd, text):
    f = font(22)
    lines = [cmd, ""] + text.rstrip("\n").split("\n")
    w = max(f.getlength(l) for l in lines) + 80
    lh = 32
    h = len(lines) * lh + 110
    im = Image.new("RGB", (int(w), h), BG)
    d = ImageDraw.Draw(im)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse((28 + i * 28, 24, 44 + i * 28, 40), fill=c)
    y = 70
    for l in lines:
        col = INK
        if l.startswith("$"):
            col = ORANGE
        elif "SELL" in l[:16]:
            col = RED
        elif "BUY" in l[:16]:
            col = GREEN
        elif l.startswith("  [") or l.startswith("          "):
            col = DIM
        if "HASH" in l or "hash" in l.split("  ")[-1:][0]:
            pass
        d.text((40, y), l, font=f, fill=col)
        y += lh
    im.save(out, optimize=True)


def strip(out):
    picks = [(3, "CANDY"), (13, "SMOKING"), (22, "COLD"), (28, "TEETH"), (43, "RAGING"), (50, "ARMED")]
    W, H, pad, cap = 252, 316, 16, 56
    im = Image.new("RGB", (len(picks) * (W + pad) + pad, H + cap + pad * 2), BG)
    d = ImageDraw.Draw(im)
    f = font(22)
    for i, (n, name) in enumerate(picks):
        fr = Image.open(ROOT / f"src/frames/f{n:02d}.png")
        x = pad + i * (W + pad)
        im.paste(fr, (x, pad))
        d.text((x, pad + H + 14), name, font=f, fill=INK)
    im = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
    im.save(out, optimize=True)


def hero(canvas):
    sc = Image.open(canvas).convert("RGB")
    sc.resize((sc.width * 2, sc.height * 2), Image.NEAREST).save(ROOT / "src/img/scene-smoking.png", optimize=True)
    og = Image.new("RGB", (1200, 630), BG)
    s = sc.resize((sc.width * 552 // sc.height, 552), Image.NEAREST)
    og.paste(s, (1200 - s.width - 39, 39))
    d = ImageDraw.Draw(og)
    big, mid = font(52), font(22)
    d.text((44, 170), "WEED BRAIN", font=big, fill=INK)
    lines = ["A buy throws him a joint.", "A sell sends a buzzkill.", "The haze is the drawdown."]
    for i, l in enumerate(lines):
        d.text((46, 262 + i * 38), l, font=mid, fill=(ORANGE if i == 0 else INK))
    d.text((46, 520), "live on Robinhood Chain", font=font(18), fill=DIM)
    og.save(ROOT / "src/og.png", optimize=True)


def pair(a, b, out):
    A, B = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    h = max(A.height, B.height)
    im = Image.new("RGB", (A.width + B.width + 48, h + 48), BG)
    im.paste(A, (16, 24))
    im.paste(B, (A.width + 32, 24))
    im.save(out, optimize=True)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "terminal":
        terminal(sys.argv[2], sys.argv[3], sys.stdin.read())
    elif cmd == "strip":
        strip(sys.argv[2])
    elif cmd == "hero":
        hero(sys.argv[2])
    elif cmd == "pair":
        pair(sys.argv[2], sys.argv[3], sys.argv[4])
