#!/usr/bin/env python3
# Web fonts for the exact page view: every font the engine has metrics for, converted from the Type 1 file
# pdfTeX embeds (pdftex.map, TeX Live 2025) to a WOFF2 font a browser can draw.
#
#   python3 packages/engine/tools/webfonts/build.py      (needs fonttools and brotli; run from the repo root)
#
# Writes public/fonts/tex/<file>.woff2, one per Type 1 file (ecrm1000 and tcrm1000 share sfrm1000), and
# packages/engine/data/webfonts.json: `fonts` gives each TFM name its file and an index into `codes`, the
# code point each character code is drawn with (0: none), shared by the TFMs with the same encoding. A glyph whose name has a Unicode value (Adobe Glyph List) gets it, so selected text copies as
# text; the others go to the Private Use Area. Positions never come from the font: the engine places each glyph.
# Only the outlines are used, so hints are dropped and metrics are the Type 1 widths.

import json
import os
import re
import sys

from fontTools import t1Lib
from fontTools.agl import AGL2UV
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.recordingPen import RecordingPen

TEXLIVE = ".cache/texlive/2025"
MAP = f"{TEXLIVE}/texmf-var/fonts/map/pdftex/updmap/pdftex.map"
METRICS = "packages/engine/data/fonts"
OUT = "public/fonts/tex"
MANIFEST = "packages/engine/data/webfonts.json"
PUA = 0xE000


def find_files():
    """Every .pfb and .enc under texmf-dist, by file name"""
    files = {}
    for root, _, names in os.walk(f"{TEXLIVE}/texmf-dist/fonts"):
        for n in names:
            if n.endswith((".pfb", ".enc")):
                files.setdefault(n, os.path.join(root, n))
    return files


def read_map():
    """pdftex.map: TFM name -> (pfb file, enc file or None)"""
    entries = {}
    for line in open(MAP, encoding="latin-1"):
        if not line.strip() or line[0] in "%#":
            continue
        tfm = line.split()[0]
        pfb = re.search(r"<<?\[?(\S+\.pfb)", line)
        enc = re.search(r"<\[?(\S+\.enc)", line)
        if pfb and tfm not in entries:
            entries[tfm] = (pfb.group(1), enc.group(1) if enc else None)
    return entries


def read_enc(path):
    """A PostScript encoding vector: the 256 glyph names"""
    text = re.sub(r"%[^\n]*", "", open(path, encoding="latin-1").read())
    body = text[text.index("[") + 1 : text.index("]")]
    names = re.findall(r"/([^\s/\[\]]+)", body)
    assert len(names) == 256, f"{path}: {len(names)} names"
    return names


def unicode_of(name):
    if name in AGL2UV:
        return AGL2UV[name]
    m = re.fullmatch(r"uni([0-9A-F]{4})", name) or re.fullmatch(r"u([0-9A-F]{4,6})", name)
    return int(m.group(1), 16) if m else None


PARSED = {}


def parse(path):
    if path not in PARSED:
        PARSED[path] = t1Lib.T1Font(path)
        PARSED[path].parse()
    return PARSED[path]


def build(pfb_path, names, out_path):
    """The glyphs `names` of a Type 1 font as a WOFF2 font; returns glyph name -> code point"""
    t1 = parse(pfb_path)
    glyphs = t1.getGlyphSet()
    names = [n for n in dict.fromkeys(names) if n in glyphs and n != ".notdef"]
    cmap, used, codepoints = {}, set(), {}
    pua = PUA
    for n in names:
        u = unicode_of(n)
        # control and space characters would be collapsed or dropped by the browser
        if u is None or u in used or u < 0x21 or 0x7F <= u < 0xA1 or u in (0xAD,):
            while pua in used:
                pua += 1
            u = pua
        used.add(u)
        cmap[u] = n
        codepoints[n] = u
    order = [".notdef"] + names
    charstrings, widths = {}, {}
    for n in order:
        g = glyphs[n]
        rec = RecordingPen()
        g.draw(rec)  # sets the width
        pen = T2CharStringPen(g.width, None)
        rec.replay(pen)
        charstrings[n] = pen.getCharString()
        widths[n] = (round(g.width), 0)
    family = "l0-" + os.path.basename(pfb_path)[:-4]
    fb = FontBuilder(1000, isTTF=False)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupCFF(family, {"FullName": family}, charstrings, {})
    fb.setupHorizontalMetrics(widths)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": family, "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=1000, usWinDescent=300)
    fb.setupPost()
    fb.font.flavor = "woff2"
    fb.save(out_path)
    return codepoints


def main():
    files = find_files()
    entries = read_map()
    tfms = sorted(f[:-5] for f in os.listdir(METRICS) if f.endswith(".json") and f != "index.json")
    # the character names each Type 1 file must have, over every TFM drawn with it
    plans = {}
    for tfm in tfms:
        if tfm not in entries:
            sys.exit(f"{tfm}: no pdftex.map entry")
        pfb, enc = entries[tfm]
        t1 = parse(files[pfb])
        vector = read_enc(files[enc]) if enc else t1.font["Encoding"]
        if not isinstance(vector, list):
            sys.exit(f"{tfm}: {pfb} has the standard encoding")
        plans.setdefault(pfb, {})[tfm] = vector
    os.makedirs(OUT, exist_ok=True)
    fonts, vectors = {}, []
    for pfb, by_tfm in sorted(plans.items()):
        names = [n for v in by_tfm.values() for n in v]
        name = pfb[:-4]
        codepoints = build(files[pfb], names, f"{OUT}/{name}.woff2")
        for tfm, vector in by_tfm.items():
            codes = {c: codepoints[n] for c, n in enumerate(vector) if n in codepoints}
            v = [codes.get(c, 0) for c in range(256)]
            if v not in vectors:
                vectors.append(v)
            fonts[tfm] = [name, vectors.index(v)]
        print(f"{name}: {len(codepoints)} glyphs, {os.path.getsize(f'{OUT}/{name}.woff2')} bytes ({', '.join(sorted(by_tfm))})")
    with open(MANIFEST, "w") as f:
        json.dump({"fonts": fonts, "codes": vectors}, f, separators=(",", ":"), sort_keys=True)
        f.write("\n")


if __name__ == "__main__":
    main()
