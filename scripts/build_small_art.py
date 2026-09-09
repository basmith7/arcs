#!/usr/bin/env python3
"""Generate half-size `.sm.webp` copies of the card art.

The card art is 744x1039 (827x1417 for leaders and fates), and *nothing in the app renders it
at that size except the zoom*. The hand shows a card at 118x165, the court rail at 98x139, a
draft card at 150 wide. One in-game screen therefore decoded ~10 megapixels — about 41 MB of
raster — to paint a few hundred thousand pixels of card, and every repaint resampled those
oversized bitmaps. That is what made the hand's hover lift stutter.

Half size covers every one of those uses with room to spare on a 2x display, so the small copy
is what the app loads everywhere; `CardZoom` and `LeaderCardReader` keep the full-size art,
because those two are where a card is actually read.

The output is committed alongside the originals. Assets are tracked in this repo on purpose
(GitHub Pages cannot resolve LFS pointers, and there is no build step that could generate
these at deploy time) — so re-run this after `fetch_assets.py` brings in new art:

    python3 scripts/build_small_art.py [--force] [--dry-run]

Requires ImageMagick (`magick`).
"""
import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "assets", "images")

# The card-shaped art, and only that. Board maps keep their resolution because they are drawn
# large; icons and figures are small enough already that a second copy would not pay for itself.
CARD_DIRS = ["action", "court", "empire", "lore", "leader", "fate", "setup"] + [
    "f%02d" % n for n in range(1, 25)
]

SUFFIX = ".sm.webp"
QUALITY = "82"


def variants(directory):
    """Every original in `directory`, paired with the path its small copy belongs at."""
    path = os.path.join(IMAGES, directory)
    if not os.path.isdir(path):
        return
    for name in sorted(os.listdir(path)):
        if not name.endswith(".webp") or name.endswith(SUFFIX):
            continue
        src = os.path.join(path, name)
        yield src, src[: -len(".webp")] + SUFFIX


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="rebuild copies that already exist")
    ap.add_argument("--dry-run", action="store_true", help="list what would be written")
    args = ap.parse_args()

    if subprocess.call(["which", "magick"], stdout=subprocess.DEVNULL) != 0:
        sys.exit("ImageMagick (`magick`) is required and was not found on PATH.")

    made = skipped = 0
    for directory in CARD_DIRS:
        for src, dst in variants(directory):
            if os.path.exists(dst) and not args.force:
                skipped += 1
                continue
            if args.dry_run:
                print("would write", os.path.relpath(dst, ROOT))
                made += 1
                continue
            subprocess.check_call(
                ["magick", src, "-resize", "50%", "-quality", QUALITY, "-define",
                 "webp:method=6", dst]
            )
            made += 1
    print("small copies written: %d, already present: %d" % (made, skipped))


if __name__ == "__main__":
    main()
