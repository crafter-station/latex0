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
# A file already built for the same glyphs is kept as it is (its code points are read back), so a rebuild only adds files.
# A virtual font (PSNFSS's ptmr7t and friends, #340: no pdftex.map entry, a .vf file) gets a file of its own, <tfm>.woff2,
# each character drawn as its VF packet draws it: the raw fonts' glyphs (with the map's SlantFont and ExtendFont) moved and
# scaled, and its rules, so a composite (ffi, Ŋ, a small capital) is one glyph.

import json
import os
import re
import struct
import sys

from fontTools import t1Lib
from fontTools.agl import AGL2UV
from fontTools.fontBuilder import FontBuilder
from fontTools.ttLib import TTFont
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen

TEXLIVE = ".cache/texlive/2025"
MAP = f"{TEXLIVE}/texmf-var/fonts/map/pdftex/updmap/pdftex.map"
METRICS = "packages/engine/data/fonts"
OUT = "public/fonts/tex"
MANIFEST = "packages/engine/data/webfonts.json"
PUA = 0xE000


def find_files():
    """Every .pfb, .enc, .vf and .tfm under texmf-dist, by file name"""
    files = {}
    for root, _, names in os.walk(f"{TEXLIVE}/texmf-dist/fonts"):
        for n in names:
            if n.endswith((".pfb", ".enc", ".vf", ".tfm")):
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


def read_effects():
    """pdftex.map: TFM name -> (SlantFont, ExtendFont)"""
    effects = {}
    for line in open(MAP, encoding="latin-1"):
        if not line.strip() or line[0] in "%#":
            continue
        slant = re.search(r"(-?[\d.]+)\s+SlantFont", line)
        extend = re.search(r"(-?[\d.]+)\s+ExtendFont", line)
        effects.setdefault(line.split()[0], (float(slant.group(1)) if slant else 0.0, float(extend.group(1)) if extend else 1.0))
    return effects


def signed(b):
    return int.from_bytes(b, "big", signed=True)


def tfm_widths(path):
    """A TFM file's character widths, in fix_words of its design size"""
    d = open(path, "rb").read()
    _, lh, bc, ec, nw = struct.unpack(">HHHHH", d[:10])
    char_base = 24 + 4 * lh
    width_base = char_base + 4 * (ec - bc + 1)
    widths = [signed(d[width_base + 4 * j : width_base + 4 * j + 4]) for j in range(nw)]
    return {c: widths[d[char_base + 4 * (c - bc)]] for c in range(bc, ec + 1) if d[char_base + 4 * (c - bc)]}


def read_vf(path):
    """A virtual font: the fonts it uses (number -> (TFM name, scale as a fix_word)) and each character's DVI packet"""
    d = open(path, "rb").read()
    assert d[0] == 247 and d[1] == 202, f"{path}: not a VF file"
    i = 3 + d[2] + 8
    fonts, packets = {}, {}
    while True:
        op = d[i]
        if 243 <= op <= 246:
            n = op - 242
            f = int.from_bytes(d[i + 1 : i + 1 + n], "big")
            i += 1 + n
            _, s, _ = struct.unpack(">III", d[i : i + 12])
            a, l = d[i + 12], d[i + 13]
            i += 14
            fonts[f] = (d[i + a : i + a + l].decode("latin-1"), s)
            i += a + l
        elif op < 242:
            packets[d[i + 1]] = d[i + 5 : i + 5 + op]
            i += 5 + op
        elif op == 242:
            pl, cc, _ = struct.unpack(">III", d[i + 1 : i + 13])
            packets[cc] = d[i + 13 : i + 13 + pl]
            i += 13 + pl
        else:
            return fonts, packets


def run_packet(p, fonts, width):
    """What a VF packet draws (DVI commands, as dvitype reads them): ("char", TFM name, scale, code, h, v) and
    ("rule", h, v, width, height), in fix_words of the virtual font's size, v downwards; width(name, code) in fix_words of
    that font's size"""
    h = v = w = x = y = z = 0
    stack, out = [], []
    f = min(fonts)  # the first font defined is current at the start of a packet
    i = 0
    while i < len(p):
        o = p[i]
        i += 1
        if o <= 131 or 133 <= o <= 136:  # set_char_0–127, set1–4, put1–4
            n = 0 if o < 128 else o - 127 if o <= 131 else o - 132
            c = o if o < 128 else int.from_bytes(p[i : i + n], "big")
            i += n
            name, scale = fonts[f]
            out.append(("char", name, scale, c, h, v))
            if o <= 131:
                h += width(name, c) * scale / (1 << 20)
        elif o in (132, 137):  # set_rule, put_rule: height, width
            a, b = signed(p[i : i + 4]), signed(p[i + 4 : i + 8])
            i += 8
            if a > 0 and b > 0:
                out.append(("rule", h, v, b, a))
            if o == 132:
                h += b
        elif o == 138:
            pass
        elif o == 141:
            stack.append((h, v, w, x, y, z))
        elif o == 142:
            h, v, w, x, y, z = stack.pop()
        elif 143 <= o <= 146:
            h += signed(p[i : i + o - 142])
            i += o - 142
        elif o == 147 or o == 152:
            h += w if o == 147 else x
        elif 148 <= o <= 151:
            w = signed(p[i : i + o - 147])
            i += o - 147
            h += w
        elif 153 <= o <= 156:
            x = signed(p[i : i + o - 152])
            i += o - 152
            h += x
        elif 157 <= o <= 160:
            v += signed(p[i : i + o - 156])
            i += o - 156
        elif o == 161 or o == 166:
            v += y if o == 161 else z
        elif 162 <= o <= 165:
            y = signed(p[i : i + o - 161])
            i += o - 161
            v += y
        elif 167 <= o <= 170:
            z = signed(p[i : i + o - 166])
            i += o - 166
            v += z
        elif 171 <= o <= 234:
            f = o - 171
        elif 235 <= o <= 238:
            f = int.from_bytes(p[i : i + o - 234], "big")
            i += o - 234
        elif 239 <= o <= 242:  # \special (a missing glyph's warning): nothing drawn
            l = int.from_bytes(p[i : i + o - 238], "big")
            i += o - 238 + l
        else:
            sys.exit(f"DVI command {o} in a virtual font packet")
    return out


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


def existing(names, out_path):
    """glyph name -> code point of the file at out_path, if it was built for exactly the glyphs `names`"""
    if not os.path.exists(out_path):
        return None
    font = TTFont(out_path)
    if font.getGlyphOrder() != [".notdef"] + names:
        return None
    return {n: u for u, n in font.getBestCmap().items()}


def build(pfb_path, names, out_path):
    """The glyphs `names` of a Type 1 font as a WOFF2 font; returns glyph name -> code point"""
    t1 = parse(pfb_path)
    glyphs = t1.getGlyphSet()
    names = [n for n in dict.fromkeys(names) if n in glyphs and n != ".notdef"]
    kept = existing(names, out_path)
    if kept is not None:
        return kept
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


def build_vf(tfm, files, entries, effects, out_path):
    """A virtual font's characters as a WOFF2 font, 1000 units to its size; returns character code -> code point"""
    fonts, packets = read_vf(files[f"{tfm}.vf"])
    widths = {}

    def width(name, c):
        if name not in widths:
            widths[name] = tfm_widths(files[f"{name}.tfm"])
        return widths[name][c]

    own = tfm_widths(files[f"{tfm}.tfm"])
    glyphs, unicodes = {}, {}
    for code, packet in sorted(packets.items()):
        drawn = run_packet(packet, fonts, width)
        pen = T2CharStringPen(round(own.get(code, 0) * 1000 / (1 << 20)), None)
        for item in drawn:
            if item[0] == "rule":
                _, h, v, w, ht = item
                x0, y0, x1, y1 = (round(t * 1000 / (1 << 20)) for t in (h, -v, h + w, -v + ht))
                pen.moveTo((x0, y0)), pen.lineTo((x1, y0)), pen.lineTo((x1, y1)), pen.lineTo((x0, y1)), pen.closePath()
                continue
            _, name, scale, c, h, v = item
            if name not in entries:
                sys.exit(f"{tfm}: its font {name} has no pdftex.map entry")
            pfb, enc = entries[name]
            t1 = parse(files[pfb])
            vector = read_enc(files[enc]) if enc else t1.font["Encoding"]
            slant, extend = effects[name]
            k = scale / (1 << 20)
            t1.getGlyphSet()[vector[c]].draw(TransformPen(pen, (k * extend, 0, k * slant, k, h * 1000 / (1 << 20), -v * 1000 / (1 << 20))))
            if len(drawn) == 1:
                unicodes[code] = unicode_of(vector[c])
        glyphs[code] = pen.getCharString()
    names = {code: f"c{code}" for code in glyphs}
    order = [".notdef"] + [names[c] for c in sorted(glyphs)]
    kept = existing(order[1:], out_path)
    cmap, used, pua = {}, set(), PUA
    for code in sorted(glyphs):
        u = unicodes.get(code)
        if u is None or u in used or u < 0x21 or 0x7F <= u < 0xA1 or u in (0xAD,):
            while pua in used:
                pua += 1
            u = pua
        used.add(u)
        cmap[u] = names[code]
    if kept is None:
        empty = T2CharStringPen(0, None)
        charstrings = {".notdef": empty.getCharString(), **{names[c]: g for c, g in glyphs.items()}}
        family = "l0-" + tfm
        fb = FontBuilder(1000, isTTF=False)
        fb.setupGlyphOrder(order)
        fb.setupCharacterMap(cmap)
        fb.setupCFF(family, {"FullName": family}, charstrings, {})
        fb.setupHorizontalMetrics({n: (0, 0) for n in order})
        fb.setupHorizontalHeader(ascent=800, descent=-200)
        fb.setupNameTable({"familyName": family, "styleName": "Regular"})
        fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=1000, usWinDescent=300)
        fb.setupPost()
        fb.font.flavor = "woff2"
        fb.save(out_path)
        kept = {n: u for u, n in cmap.items()}
    return {code: kept[names[code]] for code in glyphs}


def main():
    files = find_files()
    entries = read_map()
    effects = read_effects()
    tfms = sorted(f[:-5] for f in os.listdir(METRICS) if f.endswith(".json") and f != "index.json")
    # the character names each Type 1 file must have, over every TFM drawn with it
    plans = {}
    os.makedirs(OUT, exist_ok=True)
    fonts, vectors = {}, []
    for tfm in tfms:
        if tfm not in entries and f"{tfm}.vf" in files:
            codes = build_vf(tfm, files, entries, effects, f"{OUT}/{tfm}.woff2")
            v = [codes.get(c, 0) for c in range(256)]
            if v not in vectors:
                vectors.append(v)
            fonts[tfm] = [tfm, vectors.index(v)]
            print(f"{tfm}: {len(codes)} glyphs, {os.path.getsize(f'{OUT}/{tfm}.woff2')} bytes (virtual font)")
            continue
        if tfm not in entries:
            sys.exit(f"{tfm}: no pdftex.map entry")
        pfb, enc = entries[tfm]
        t1 = parse(files[pfb])
        vector = read_enc(files[enc]) if enc else t1.font["Encoding"]
        if not isinstance(vector, list):
            sys.exit(f"{tfm}: {pfb} has the standard encoding")
        plans.setdefault(pfb, {})[tfm] = vector
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
