"""The ten stage clips, from the normalized scene frames (src/frames/NN.webp).

Three variants of each, like the set they were first cut in:
  clips/NN-slug.webp|gif          720 x 720 with the stage name and level bar
  clips/NN-slug-clean.webp|gif    720 x 720, no text (a copy of the webp goes to src/clips/)
  clips/NN-slug-wide.webp|gif     1280 x 720 for posts
Each clip plays its frames forward and back with a short hold at both ends.
"""
from pathlib import Path
import shutil
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FR = ROOT / "src/frames"
OUT = ROOT / "clips"
SITE = ROOT / "src/clips"
FONTS = ROOT / "art/fonts"

# (first frame, last frame, slug, name, caption, level)
CLIPS = [
    (1, 9, "01-shades", "SHADES OFF", "flat out in the pile", 1.00),
    (10, 19, "02-heavy", "EYES HEAVY", "smoking, going nowhere", 0.88),
    (20, 29, "03-mug", "THE MUG", "reaching for a drink", 0.76),
    (30, 39, "04-spill", "SPILLED", "it goes all over him", 0.62),
    (40, 49, "05-soaked", "SOAKED", "no drink, no patience", 0.48),
    (50, 60, "06-fists", "FISTS", "teeth grinding, first tremors", 0.34),
    (61, 70, "07-suit", "SUIT ON", "cold and done talking", 0.22),
    (71, 80, "08-aiming", "AIMING", "steadies it at the camera", 0.10),
    (81, 86, "09-firing", "FIRING", "muzzle flash, shells", 0.03),
    (86, 90, "10-blast", "BLAST", "the whole frame goes", 0.00),
]


def font(s):
    return ImageFont.truetype(str(FONTS / "Tiny5-Regular.ttf"), s)


def mono(s):
    f = ImageFont.truetype(str(FONTS / "JetBrainsMono[wght].ttf"), s)
    f.set_variation_by_name("Regular")
    return f


def canvas(n, w, h):
    art = Image.open(FR / f"{n:03d}.webp").convert("RGB")
    # frames are the whole 1280 x 720 scene; a square clip is its middle
    out = art.crop(((art.width - w) // 2, 0, (art.width + w) // 2, h))
    return out


def label(im, name, sub, lvl):
    im = im.copy()
    w, h = im.size
    bar, pad, fs, ms = max(3, h // 170), max(12, w // 42), max(24, h // 20), max(13, h // 38)
    top = h - fs - ms - pad
    d = ImageDraw.Draw(im)
    d.rectangle([0, top, w, h], fill=(14, 12, 16))
    d.rectangle([0, top - bar, w, top], fill=(40, 34, 40))
    d.rectangle([0, top - bar, int(w * lvl), top], fill=(120, 230, 120) if lvl > 0.5 else (240, 120, 60))
    d.text((pad, top + 4), name, font=font(fs), fill=(255, 255, 255))
    d.text((pad + 1, h - ms - pad + 5), sub, font=mono(ms), fill=(186, 186, 186))
    return im


def save(frames, durs, stem):
    wp = OUT / f"{stem}.webp"
    frames[0].save(wp, save_all=True, append_images=frames[1:], duration=durs, loop=0, quality=86, method=4)
    q = [f.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
    gp = OUT / f"{stem}.gif"
    q[0].save(gp, save_all=True, append_images=q[1:], duration=durs, loop=0, optimize=True)
    return wp, gp


def main():
    OUT.mkdir(exist_ok=True)
    SITE.mkdir(exist_ok=True)
    for a, b, slug, name, sub, lvl in CLIPS:
        idx = list(range(a, b + 1))
        seq = idx + idx[-2:0:-1]
        durs = [60] * len(seq)
        durs[0] = 260
        durs[len(idx) - 1] = 260
        for suffix, w, h, text in (("", 720, 720, True), ("-clean", 720, 720, False), ("-wide", 1280, 720, False)):
            frames = [canvas(n, w, h) for n in seq]
            if text:
                frames = [label(f, name, sub, lvl) for f in frames]
            wp, gp = save(frames, durs, slug + suffix)
            if suffix == "-clean":
                shutil.copy(wp, SITE / wp.name)
        print(f"{slug:10s} {len(seq):2d} frames")
    sheet()


def sheet():
    cols, sw, sh = 5, 280, 300
    im = Image.new("RGB", (cols * (sw + 10) + 10, 2 * (sh + 62) + 46), (16, 16, 18))
    d = ImageDraw.Draw(im)
    d.text((12, 10), "WEEDBRAIN - 10 CLIPS", font=font(28), fill=(240, 240, 240))
    for n, (a, b, slug, name, sub, lvl) in enumerate(CLIPS):
        cx, cy = 10 + (n % cols) * (sw + 10), 44 + (n // cols) * (sh + 62)
        mid = list(range(a, b + 1))[(b - a + 1) // 2]
        fr = Image.open(FR / f"{mid:03d}.webp").convert("RGB")
        fr = fr.crop((280, 0, 1000, 720)).resize((sw, sh), Image.LANCZOS)
        im.paste(fr, (cx, cy))
        d.rectangle([cx, cy + sh, cx + sw, cy + sh + 4], fill=(40, 34, 40))
        d.rectangle([cx, cy + sh, cx + int(sw * lvl), cy + sh + 4], fill=(120, 230, 120) if lvl > 0.5 else (240, 120, 60))
        d.text((cx + 2, cy + sh + 8), f"{n + 1:02d}  {name}", font=font(19), fill=(240, 240, 240))
        d.text((cx + 3, cy + sh + 30), f"frames {a}-{b}, {sub}", font=mono(10), fill=(150, 150, 154))
    im.save(ROOT / "docs/img/clips.png", optimize=True)


if __name__ == "__main__":
    main()
