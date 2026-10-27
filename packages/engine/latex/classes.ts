// \documentclass: the class and its options, and the class's parameters from
// the committed data (data/classes, through the installed data source).

import { xnOverD } from "../layout/arith"
import type { ClassOptionData, FontRef, SizeCommand } from "../layout/classdata"
import { loadFont, QUAD } from "../layout/font"
import { times } from "../layout/dimen"
import { glue } from "../layout/nodes"
import { classFile, dataFont, familyFile, mathFontsFile } from "./data"
import { Unsupported } from "./unsupported"

export function classData(cls: string, option = "10pt", extras: string[] = []): ClassOptionData {
  const d = classFile(cls)
  const o = d.options[option]
  if (!o) throw new Error(`no data for ${cls} [${option}]`)
  // the paper and side options: the last of each kind wins, as in the class's option processing
  const paper = [...extras].reverse().find((x) => PAPERS.includes(x)) ?? "letterpaper"
  const side = [...extras].reverse().find((x) => x === "oneside" || x === "twoside") ?? (cls === "book" ? "twoside" : "oneside")
  const v = o.variants?.[`${paper},${side}`]
  if (!v) return o
  return withTextHeight({ ...o, dimens: { ...o.dimens, ...v.dimens }, ints: { ...o.ints, ...v.ints } })
}

/** The float rooms \@floatplacement and \@flsettextmin take from \textheight: <fraction>\@colht, x_n_over_d (§ 455). */
export function withTextHeight(k: ClassOptionData): ClassOptionData {
  const h = k.dimens.textheight, f = (n: string) => Math.trunc((h * k.ints[n]) / 65536) // the fractions are below 1
  return { ...k, dimens: { ...k.dimens, toproom: f("topfraction"), botroom: f("bottomfraction"), textmin: f("textfraction"), fpmin: f("floatpagefraction") } }
}

const PAPERS = ["letterpaper", "a4paper", "a5paper", "b5paper", "legalpaper", "executivepaper"]
/** Class options that change nothing on the page for the classes laid out */
const NEUTRAL = ["final", "onecolumn", "notitlepage", "openany", "10pt", "11pt", "12pt"]

/** \documentclass[…]{cls} → class, size option (default 10pt), the paper and side options, and the options not modeled. */
export function documentClass(src: string): { cls: string; option: string; extras: string[]; unknown: string[] } {
  const m = src.match(/\\documentclass\s*(?:\[([^\]]*)\])?\s*\{(\w+)\}/)
  if (!m) throw new Error("no \\documentclass")
  const opts = (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  const option = [...opts].reverse().find((o) => /^1[012]pt$/.test(o)) ?? "10pt"
  const extras = opts.filter((o) => PAPERS.includes(o) || o === "oneside" || o === "twoside")
  const unknown = opts.filter((o) => !extras.includes(o) && !NEUTRAL.includes(o) && !(o === "openany" && m[2] !== "book"))
  return { cls: m[2], option, extras, unknown }
}

/** The class with \usepackage[T1]{fontenc}: every size's roman and bold are the EC fonts (math is unchanged). */
export function withT1(k: ClassOptionData, cls: string): ClassOptionData {
  const sizes = Object.fromEntries(Object.entries(k.sizes).map(([n, s]) => [n, { ...s, font: s.t1.font, bold: s.t1.bold }])) as ClassOptionData["sizes"]
  let glues = k.glue
  if (cls === "letter") {
    // letter.cls's \@listI (\topsep and \itemsep .4em) and \@listiii (.2em) are in em of the font at the list,
    // an EC font now: \@listii, iv–vi inherit them
    const quad = (f: { name: string; at: number }) => loadFont(dataFont(f.name), f.at).params[QUAD]
    glues = { ...glues }
    for (const key of Object.keys(glues)) {
      const m = key.match(/^list(\d)(topsep|itemsep)(?:@(\w+))?$/)
      if (!m) continue
      const n = (m[3] ?? "normalsize") as SizeCommand, f = Number(m[1]) <= 2 ? 26214 : 13107, g = glues[key]
      // only the em values: a size command's own \@listi is in pt
      if (g.stretch || g.shrink || g.width !== xnOverD(quad(k.sizes[n].font), f, 65536)) continue
      glues[key] = glue(xnOverD(quad(sizes[n].font), f, 65536))
    }
  }
  return { ...k, sizes, glue: glues, ints: { ...k.ints, T1: 1 } }
}

/** The fonts the preamble's font packages select (#340): the families \rmdefault, \sfdefault and \ttdefault name, and
 *  the package that set the math fonts (\SetSymbolFont, \SetMathAlphabet), null for fontmath.ltx's */
export interface FontSetup { rm: string; sf: string; tt: string; math: string | null; /** helvet.sty's scaled=: \Hv@scale */ phvScale: string | null }
export const CM_FONTS: FontSetup = { rm: "cmr", sf: "cmss", tt: "cmtt", math: null, phvScale: null }

/** NFSS's font for "encoding/series/shape" of a family at a font size in sp (\fontsize{size}\selectfont) */
export function familyFont(family: string, key: string, size: number): FontRef & { hyphenchar: number; declared: boolean } {
  const r = familyFile(family).sizes[String(size)]?.[key]
  if (!r) throw new Unsupported(`${key.replace("/", `/${family}/`)} at ${size / 65536}pt`)
  return r
}

/** The class with the font packages' fonts: at every size, each family's fonts where the FontAttrs families cmr, cmss
 *  and cmtt (\rmdefault, \sfdefault, \ttdefault) select, the roman's as the size's fonts, and the package's math fonts. */
export function withFonts(k: ClassOptionData, setup: FontSetup): ClassOptionData {
  const slots = ([["cmr", setup.rm], ["cmss", setup.sf], ["cmtt", setup.tt]] as const).filter(([slot, family]) => slot !== family)
  if (!slots.length && !setup.math) return k
  const math = setup.math ? mathFontsFile(setup.math) : null
  const sizes = Object.fromEntries(Object.entries(k.sizes).map(([n, s]) => {
    const fonts = { ...s.fonts }
    for (const [slot, family] of slots) {
      for (const key of Object.keys(s.fonts).filter((x) => x.split("/")[1] === slot)) {
        const [enc, , ser, shape] = key.split("/")
        const r = familyFont(family, `${enc}/${ser}/${shape}`, s.size)
        // (the .fd's s*[\Hv@scale]: \@tempdimb\f@size\p@, then \@tempdimb\Hv@scale\@tempdimb)
        fonts[key] = family === "phv" && setup.phvScale ? { ...r, at: times(setup.phvScale, r.at) } : r
      }
    }
    const ref = (key: string): FontRef => ({ name: fonts[key].name, at: fonts[key].at })
    const m = math?.sizes[`${s.size}:${s.scriptSize}:${s.scriptScriptSize}`]
    if (math && !m) throw new Unsupported(`${setup.math}'s math fonts at ${s.size / 65536}pt`)
    const text = setup.rm === "cmr" ? {} : { font: ref("OT1/cmr/m/n"), bold: ref("OT1/cmr/bx/n"), companion: ref("TS1/cmr/m/n"), t1: { font: ref("T1/cmr/m/n"), bold: ref("T1/cmr/bx/n") } }
    return [n, { ...s, fonts, ...text, ...(m ? { math: m.math, mathAms: m.mathAms, alphabets: m.alphabets } : {}) }]
  })) as ClassOptionData["sizes"]
  return { ...k, sizes, families: { rm: setup.rm, sf: setup.sf, tt: setup.tt } }
}
