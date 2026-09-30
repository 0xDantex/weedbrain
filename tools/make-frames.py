"""Build the scene frames from the 45 source frames.

  art/frames/weedbrain_frame_NNN.webp  ->  src/frames/NNN.webp   1280 x 720

The 90 source frames are whole 16:9 scenes (1672 x 941 pixel art: the joint,
his couch, the bud pile, the room), so each is only scaled to the scene's
1280 x 720. They are the earlier set of 45 with an in-between after each. src/frames/buds.webp is
the bud texture the fallback brain plate uses; it is kept as it is.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art/frames"
OUT = ROOT / "src/frames"
SW, SH = 1280, 720


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    nums = sorted(int(p.stem[-3:]) for p in SRC.glob("weedbrain_frame_*.webp"))
    assert len(nums) == 90, nums
    for n in nums:
        im = Image.open(SRC / f"weedbrain_frame_{n:03d}.webp").convert("RGB")
        im.resize((SW, SH), Image.LANCZOS).save(OUT / f"{n:03d}.webp", quality=84, method=6)
    total = sum((OUT / f"{n:03d}.webp").stat().st_size for n in nums)
    print(f"{len(nums)} frames, {total // 1024} KB")


if __name__ == "__main__":
    main()
