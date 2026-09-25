"""Clean the 50 source frames and pack them for the page.

The source frames came out of a comic-panel layout, so some carry a panel
border along the left or right edge. Only the detected border columns
(plus two pixels of antialiasing on each side) are repainted, row by row,
as a blend of the clean pixels on either side of the line. Output: src/frames/f01..f50.png (cleaned) and src/frames/atlas.webp
(10 columns x 5 rows) that the page decodes once.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art/raw"
OUT = ROOT / "src/frames"
BG = np.array([235, 108, 37])
W, H = 252, 316


def border_cols(im, xs, inward):
    """A panel border is a thin dark column with wall showing just inside it.

    The robe also reaches the frame edge in the late frames, but there the
    pixels inside it are dark too, so it is left alone.
    """
    band = im[40:280]
    dark = lambda x: np.abs(band[:, x] - BG).sum(1) > 150
    wall = lambda x: np.abs(band[:, x] - BG).sum(1) < 60
    out = []
    for x in xs:
        probe = x + 4 * inward
        if 0 <= probe < W and dark(x).mean() > 0.6 and (dark(x) & wall(probe)).mean() > 0.25:
            out.append(x)
    return out


def repaint(im, cols):
    a, b = min(cols) - 2, max(cols) + 2
    lo, hi = a - 1, b + 1
    if lo < 0:
        lo = hi
    if hi >= W:
        hi = lo
    for x in range(max(a, 0), min(b, W - 1) + 1):
        t = 0.5 if lo == hi else (x - lo) / (hi - lo)
        im[:, x] = (im[:, lo] * (1 - t) + im[:, hi] * t).astype(np.int32)


def clean(im):
    left = border_cols(im, range(0, 16), 1)
    if left:
        repaint(im, left)
    right = border_cols(im, range(236, W), -1)
    if right:
        repaint(im, right)
    return im, left, right


def main():
    atlas = Image.new("RGB", (W * 10, H * 5))
    for i in range(1, 51):
        im = np.array(Image.open(RAW / f"Halloweed_{i:02d}.png").convert("RGB")).astype(np.int32)
        im, left, right = clean(im)
        img = Image.fromarray(im.astype(np.uint8))
        img.save(OUT / f"f{i:02d}.png", optimize=True)
        atlas.paste(img, (((i - 1) % 10) * W, ((i - 1) // 10) * H))
        if left or right:
            print(f"f{i:02d} left={left} right={right}")
    atlas.save(OUT / "atlas.webp", quality=86, method=6)
    print("atlas", atlas.size, (OUT / "atlas.webp").stat().st_size, "bytes")


if __name__ == "__main__":
    sys.exit(main())
