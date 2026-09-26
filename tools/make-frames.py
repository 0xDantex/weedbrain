"""Build the scene's assets from the 45 source frames (1400 x 1400).

  art/frames/weedbrain_frame_NN.webp  ->  src/frames/NN.webp   the picture at its own proportions, 720 tall, edges fading out
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
FADE = 80  # px on the left and right edge, where the picture meets the wide white scene


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


def scene_frame(im):
    """The picture at its own proportions, 720 px tall.

    The portrait panels come out about 673 wide, the landscape ones about
    1000: each keeps the shape it was drawn in. The left and right edges fade
    to transparent over FADE px so the picture sits in the wide scene with no
    hard border; the scene fills the rest.
    """
    pic = im.crop(panel(im))
    w = round(pic.width * SH / pic.height)
    pic = pic.resize((w, SH), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=2.0, percent=95, threshold=3))
    ramp = np.ones(w, np.float32)
    ramp[:FADE] = np.linspace(0, 1, FADE) ** 1.4
    ramp[-FADE:] = ramp[:FADE][::-1]
    alpha = (ramp[None, :] * 255).repeat(SH, 0)
    return Image.fromarray(np.dstack([np.asarray(pic), alpha.astype(np.uint8)]), "RGBA")

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
    for n in nums:
        scene_frame(frame(n)).save(OUT / f"{n:02d}.webp", quality=88, method=6, exact=True)
    buds()
    total = sum(p.stat().st_size for p in OUT.glob("*.webp"))
    print(f"{len(nums)} frames + buds.webp, {total // 1024} KB")


if __name__ == "__main__":
    main()
