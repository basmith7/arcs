#!/usr/bin/env python3
"""Render the rules PDFs in `assets/rules` to one WebP per page.

The in-game rules reader (`apps/web/src/components/RulesModal.tsx`) shows pages as images
rather than embedding the PDFs. A browser's own PDF viewer brings its own chrome, which reads
as a different program dropped into the middle of this one, and it degrades badly on a phone.
Page images render in the app's console chrome, scroll like anything else, and cost nothing
until the reader is opened. What they lose is text search — which is why the reader also links
the source PDF, and why those stay in the repo beside their pages.

200 dpi is the trade this settled on: 1418x2048 for a rulebook page, ~300 KB of WebP, so the
whole set is under 9 MB and stays sharp on a 2x display at the width the reader draws it. 150
dpi is a third smaller and visibly soft on the rulebook's body text.

Output is committed, like the card art and for the same reason — assets are tracked in this
repo on purpose (GitHub Pages cannot resolve LFS pointers, and no build step at deploy time
could generate these). Re-run after changing anything in `assets/rules`:

    python3 scripts/build_rules_pages.py [--force] [--dry-run]

`apps/web/src/rules.ts` declares each document's page count, and `apps/web/test/rules.test.ts`
holds it to what this wrote — so a re-render that changes a page count fails there rather than
silently truncating the reader.

Requires Poppler (`pdftoppm`) and ImageMagick (`magick`).
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RULES = os.path.join(ROOT, "assets", "rules")

# The documents, by the basename of their PDF. Order is the reader's tab order.
DOCS = ["condensed-aid", "aid-booklet", "base-rulebook"]

DPI = "200"
QUALITY = "82"


def page_count(pdf):
    out = subprocess.check_output(["pdfinfo", pdf], text=True)
    for line in out.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":", 1)[1])
    sys.exit("no page count in `pdfinfo %s`" % pdf)


def render(pdf, outdir):
    """Render every page of `pdf` into `outdir` as `01.webp`, `02.webp`, ..."""
    tmp = tempfile.mkdtemp(prefix="arcs-rules-")
    try:
        subprocess.check_call(
            ["pdftoppm", "-r", DPI, "-png", pdf, os.path.join(tmp, "page")],
            # pdftoppm warns about font weights in these files on every page and renders them
            # correctly anyway; the noise would bury anything that actually mattered.
            stderr=subprocess.DEVNULL,
        )
        pages = sorted(n for n in os.listdir(tmp) if n.endswith(".png"))
        for i, name in enumerate(pages, start=1):
            subprocess.check_call(
                ["magick", os.path.join(tmp, name), "-quality", QUALITY, "-define",
                 "webp:method=6", os.path.join(outdir, "%02d.webp" % i)]
            )
        return len(pages)
    finally:
        shutil.rmtree(tmp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-render documents already rendered")
    ap.add_argument("--dry-run", action="store_true", help="list what would be written")
    args = ap.parse_args()

    for tool in ("pdftoppm", "pdfinfo", "magick"):
        if shutil.which(tool) is None:
            sys.exit("`%s` is required and was not found on PATH." % tool)

    for doc in DOCS:
        pdf = os.path.join(RULES, doc + ".pdf")
        if not os.path.exists(pdf):
            sys.exit("missing %s" % os.path.relpath(pdf, ROOT))
        outdir = os.path.join(RULES, "pages", doc)
        if os.path.isdir(outdir) and os.listdir(outdir) and not args.force:
            print("%-16s already rendered, skipping" % doc)
            continue
        if args.dry_run:
            print("%-16s would render %d pages" % (doc, page_count(pdf)))
            continue
        # A re-render must not leave pages behind from a longer previous version of the file.
        shutil.rmtree(outdir, ignore_errors=True)
        os.makedirs(outdir)
        n = render(pdf, outdir)
        size = sum(os.path.getsize(os.path.join(outdir, f)) for f in os.listdir(outdir))
        print("%-16s %2d pages, %.1f MB" % (doc, n, size / 1e6))


if __name__ == "__main__":
    main()
