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
BG = (22, 18, 14)
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
    picks = []
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
    sc.save(ROOT / "src/img/scene.png", optimize=True)
    og = Image.new("RGB", (1200, 630), (255, 255, 255))
    # the middle of the scene, where he is, on the right; the name on white on the left
    s = sc.crop((250, 0, 1030, 720)).resize((683, 630), Image.LANCZOS)
    og.paste(s, (1200 - 683, 0))
    fade = Image.linear_gradient("L").rotate(90).resize((120, 630))
    og.paste(Image.new("RGB", (120, 630), (255, 255, 255)), (1200 - 683, 0), fade.transpose(Image.FLIP_LEFT_RIGHT))
    d = ImageDraw.Draw(og)
    pix = lambda n: ImageFont.truetype(str(ROOT / "art/fonts/Tiny5-Regular.ttf"), n)
    d.text((44, 200), "WEEDBRAIN", font=pix(72), fill=(22, 18, 14))
    d.text((48, 290), "he smokes himself", font=pix(34), fill=(228, 87, 46))
    d.text((48, 340), "on the trades of one", font=pix(26), fill=(125, 116, 102))
    d.text((48, 372), "Pons v2 token", font=pix(26), fill=(125, 116, 102))
    d.text((48, 560), "live on Robinhood Chain", font=font(18), fill=(125, 116, 102))
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
