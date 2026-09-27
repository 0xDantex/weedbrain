"""Build the scene's assets from the 45 source frames (1400 x 1400).

  art/frames/weedbrain_frame_NN.webp  ->  src/frames/NN.webp   1280 x 720, the whole scene: the picture at its own proportions, the art carried on to both sides
                                          src/frames/buds.webp the bud texture the pile layer is cut from

The source frames were cut out of a sheet and come in two shapes: three of
every five are a portrait panel of about 1280 x 1370 with a white margin on
the left and right, a dark border line at the bottom and a sliver of the next
panel under it; the other two are a landscape picture of 1400 x ~1010 with
white bands above and below. They are two framings, not one picture
squashed: `panel()` finds the picture inside each frame and it keeps its own
proportions. (An earlier version stretched the landscape ones to the portrait
box and the character came out too tall.)

Frames 31-35 do not exist in the set. Nothing is redrawn and nothing is
scaled above its source size.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art/frames"
OUT = ROOT / "src/frames"
SW, SH = 1280, 720  # the whole scene
FH = SH
SEAM = 70  # px on the left and right edge, where the picture meets the wide white scene


def frame(n):
    return Image.open(SRC / f"weedbrain_frame_{n:02d}.webp").convert("RGB")


def panel(im):
    """The box of the actual picture: inside the white margins and any dark border lines."""
    g = np.asarray(im.convert("L")).astype(int)
    H, W = g.shape
    colw = (g > 238).mean(0)
    roww = (g > 238).mean(1)
    L = next(x for x in range(W) if colw[x] < 0.9)
    R = next(x for x in range(W - 1, -1, -1) if colw[x] < 0.9)
    T = next(y for y in range(H) if roww[y] < 0.9)
    B = next(y for y in range(H - 1, -1, -1) if roww[y] < 0.9)
    rd = (g[:, L:R + 1] < 40).mean(1)
    cd = (g[T:B + 1, :] < 40).mean(0)
    bottom = [y for y in range(B, B - 60, -1) if rd[y] > 0.8]
    top = [y for y in range(T, T + 25) if rd[y] > 0.8]
    left = [x for x in range(L, L + 25) if cd[x] > 0.8]
    right = [x for x in range(R, R - 25, -1) if cd[x] > 0.8]
    x0 = max(left) + 2 if left else L
    x1 = min(right) - 2 if right else R
    y0 = max(top) + 2 if top else T
    y1 = min(bottom) - 2 if bottom else B
    return (x0, y0, x1 + 1, y1 + 1)


def horizon(pic, side):
    """Row where the bud pile starts at one edge of the picture (0 left, 1 right).

    Buds are told from skin and suit by colour: green at least as strong as
    red and clearly above blue. The pile never starts above the middle of
    the frame, whatever the edge shows.
    """
    a = np.asarray(pic.convert("RGB")).astype(np.float32)
    band = a[:, :50] if side == 0 else a[:, -50:]
    r, g, b = band[..., 0], band[..., 1], band[..., 2]
    bud = ((g >= r * 0.9) & (g > b * 1.2) & (band.mean(2) < 225)).mean(1)
    bud = np.convolve(bud, np.ones(21) / 21, mode="same")
    rows = np.where(bud > 0.35)[0]
    y = int(rows.min()) if len(rows) else SH - 110
    return int(np.clip(y, SH * 0.55, SH - 70))


def scene_frame(im, tex):
    """One whole 1280 x 720 scene, drawn as if the art had been that wide.

    The picture keeps its own proportions at 720 px tall. The rest of the
    width continues the art: paper white above, and the bud pile carried on
    at the height it meets each edge of the picture, built from the same bud
    texture with a clumpy outline. The picture is feathered into it over
    SEAM px so no border shows.
    """
    rnd = np.random.default_rng(7)
    pic = im.crop(panel(im))
    w = round(pic.width * SH / pic.height)
    pic = pic.resize((w, SH), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=2.0, percent=95, threshold=3))
    x0 = (SW - w) // 2
    out = np.full((SH, SW, 3), 255, np.float32)
    t = np.asarray(tex).astype(np.float32)  # 260 tall
    th = t.shape[0]
    hl, hr = horizon(pic, 0), horizon(pic, 1)
    # the outline of the pile across the whole width: meets the picture at
    # its own horizon on each side and rolls gently toward the scene's edges
    xs = np.arange(SW)
    top = np.empty(SW, np.float32)
    for x in xs:
        if x < x0 + SEAM:
            d = (x0 + SEAM - x) / max(1, x0 + SEAM)
            top[x] = hl - 40 * d + 18 * np.sin(x / 57.0) + 10 * np.sin(x / 23.0 + 1)
        else:
            d = (x - (x0 + w - SEAM)) / max(1, SW - x0 - w + SEAM)
            top[x] = hr - 40 * max(0, d) + 18 * np.sin(x / 61.0 + 2) + 10 * np.sin(x / 21.0)
    # clumps along the outline
    for _ in range(90):
        cx = rnd.integers(0, SW)
        r = rnd.integers(10, 26)
        lo, hi = max(0, cx - r), min(SW, cx + r)
        dx = xs[lo:hi] - cx
        top[lo:hi] = np.minimum(top[lo:hi], top[cx] + 6 - np.sqrt(np.maximum(0, r * r - dx * dx)) * 0.6)
    top = np.clip(top, 120, SH)
    yy = np.arange(SH)[:, None]
    below = yy >= top[None, :]
    # tile the texture from the outline down so every column starts at a
    # clean row of buds
    rows = ((yy - top[None, :]).astype(int) % th)
    buds = t[rows, xs[None, :] % t.shape[1]]
    # a little depth: slightly darker toward the bottom and right under the edge
    shade = 1 - 0.18 * np.clip((yy - top[None, :]) / 300, 0, 1) - 0.2 * np.exp(-np.maximum(0, yy - top[None, :]) / 5)
    out = np.where(below[..., None], buds * shade[..., None], out)
    # soft outline so the pile does not look cut out
    img = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    mask = Image.fromarray((below * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    base = Image.new("RGB", (SW, SH), (255, 255, 255))
    base.paste(img, (0, 0), mask)
    # the picture, feathered at its left and right edges
    ramp = np.ones(w, np.float32)
    ramp[:SEAM] = np.linspace(0, 1, SEAM) ** 1.2
    ramp[-SEAM:] = ramp[:SEAM][::-1]
    alpha = Image.fromarray((ramp[None, :].repeat(SH, 0) * 255).astype(np.uint8))
    base.paste(pic, (x0, 0), alpha)
    return base

def buds():
    """A 1280 x 260 bud texture at the scale the scene draws frames.

    Cut from the bottom left of frames that show nothing but buds there, then
    built up from many small round pieces with soft edges laid over each
    other, so no straight seam survives.
    """
    import random
    rnd = random.Random(7)
    s = FH / 1370
    src = [frame(6).crop((75, 1200, 470, 1378)), frame(26).crop((75, 1180, 420, 1366)), frame(11).crop((75, 1200, 420, 1376))]
    src = [p.resize((round(p.width * s), round(p.height * s)), Image.LANCZOS) for p in src]
    tex = Image.new("RGB", (1280, 260))
    x = 0
    while x < 1280:
        p = src[rnd.randrange(len(src))]
        for y in range(0, 260, p.height):
            tex.paste(p, (x, y))
        x += p.width
    for _ in range(420):
        p = src[rnd.randrange(len(src))]
        d = rnd.randrange(40, min(88, p.height - 2))
        sx, sy = rnd.randrange(0, p.width - d), rnd.randrange(0, p.height - d)
        piece = p.crop((sx, sy, sx + d, sy + d))
        if rnd.random() < 0.5:
            piece = piece.transpose(Image.FLIP_LEFT_RIGHT)
        yy, xx = np.mgrid[0:d, 0:d]
        r = np.sqrt((xx - d / 2) ** 2 + (yy - d / 2) ** 2) / (d / 2)
        mask = Image.fromarray((np.clip((1 - r) * 3, 0, 1) * 255).astype(np.uint8))
        tex.paste(piece, (rnd.randrange(-d // 2, 1280 - d // 2), rnd.randrange(-d // 2, 260 - d // 2)), mask)
    tex.save(OUT / "buds.webp", quality=88, method=6)
    return tex


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    nums = sorted(int(p.stem[-2:]) for p in SRC.glob("weedbrain_frame_*.webp"))
    assert len(nums) == 45, nums
    tex = buds()
    for n in nums:
        scene_frame(frame(n), tex).save(OUT / f"{n:02d}.webp", quality=86, method=6)
    total = sum(p.stat().st_size for p in OUT.glob("*.webp"))
    print(f"{len(nums)} frames + buds.webp, {total // 1024} KB")


if __name__ == "__main__":
    main()
