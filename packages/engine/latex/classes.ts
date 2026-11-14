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
  const o0 = d.options[option]
  if (!o0) throw new Error(`no data for ${cls} [${option}]`)
  const o = { ...o0, cls }
  // the paper, side and column options: the last of each kind wins, as in the class's option processing
  const paper = [...extras].reverse().find((x) => PAPERS.includes(x)) ?? (isKoma(cls) ? "a4paper" : "letterpaper")
  const side = [...extras].reverse().find((x) => x === "oneside" || x === "twoside") ?? (cls === "book" ? "twoside" : "oneside")
  const twocolumn = [...extras].reverse().find((x) => x === "onecolumn" || x === "twocolumn") === "twocolumn"
  const v = o.variants?.[`${paper},${side}${twocolumn ? ",twocolumn" : ""}`]
  if (twocolumn && !v) throw new Unsupported(`class option twocolumn for ${cls}`)
  // KOMA-Script's parskip= (the last one)
  const ps = [...extras].reverse().find((x) => x.startsWith("parskip="))
  const p = ps && ps !== "parskip=false" ? o.options?.[ps] : null
  if (ps && ps !== "parskip=false" && !p) throw new Unsupported(`class option ${ps}`)
  const o1 = p ? { ...o, dimens: { ...o.dimens, ...p.dimens }, glue: { ...o.glue, ...p.glue } } : o
  if (!v) return o1
  return withTextHeight({ ...o1, dimens: { ...o1.dimens, ...v.dimens }, ints: { ...o1.ints, ...v.ints, ...(twocolumn ? { twocolumn: 1 } : {}) } })
}

/** The float rooms \@floatplacement and \@flsettextmin take from \textheight: <fraction>\@colht, x_n_over_d (§ 455). */
export function withTextHeight(k: ClassOptionData): ClassOptionData {
  const h = k.dimens.textheight, f = (n: string) => Math.trunc((h * k.ints[n]) / 65536) // the fractions are below 1
  return { ...k, dimens: { ...k.dimens, toproom: f("topfraction"), botroom: f("bottomfraction"), textmin: f("textfraction"), fpmin: f("floatpagefraction") } }
}

/** the classes with chapters (the counters within \c@chapter) */
export const hasChapters = (cls: string) => cls === "report" || cls === "book"

/** KOMA-Script's classes laid out: scrartcl (fontsize=11pt and paper=a4 by default) */
export const isKoma = (cls: string) => cls === "scrartcl"
/** a KOMA-Script key=value option as the standard option it means, else as written */
function komaOption(o: string): string {
  const m = o.replace(/\s+/g, "").match(/^([a-z]+)=(.*)$/)
  if (!m) return o
  const [, key, value] = m
  if (key === "fontsize" && /^1[012]pt$/.test(value)) return value
  if (key === "paper" && ["a4", "a5", "b5", "letter", "legal", "executive"].includes(value)) return `${value}paper`
  if ((key === "twoside" || key === "twocolumn") && ["true", "on", "yes", "false", "off", "no"].includes(value)) return ["true", "on", "yes"].includes(value) ? key : key === "twoside" ? "oneside" : "onecolumn"
  return o
}

const PAPERS = ["letterpaper", "a4paper", "a5paper", "b5paper", "legalpaper", "executivepaper"]
/** Class options that change nothing on the page for the classes laid out */
const NEUTRAL = ["final", "notitlepage", "openany", "10pt", "11pt", "12pt"]

/** \documentclass[…]{cls} → class, size option (default 10pt), the paper and side options, and the options not modeled. */
export function documentClass(src: string): { cls: string; option: string; extras: string[]; unknown: string[] } {
  const m = src.match(/\\documentclass\s*(?:\[([^\]]*)\])?\s*\{(\w+)\}/)
  if (!m) throw new Error("no \\documentclass")
  // (KOMA-Script's options: fontsize=, paper=, twoside=, twocolumn= as the size, paper and side options)
  const opts = (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((o) => (isKoma(m[2]) ? komaOption(o) : o))
  const option = [...opts].reverse().find((o) => /^1[012]pt$/.test(o)) ?? (isKoma(m[2]) ? "11pt" : "10pt")
  const extras = opts.filter((o) => PAPERS.includes(o) || o === "oneside" || o === "twoside" || ((o === "onecolumn" || o === "twocolumn") && m[2] !== "letter") || (isKoma(m[2]) && /^parskip=/.test(o)))
  const unknown = opts.filter((o) => !extras.includes(o) && !NEUTRAL.includes(o) && !(o === "openany" && m[2] !== "book") && !(o === "onecolumn" && m[2] === "letter"))
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

/** KOMA-Script's \par@updaterelative at \begin{document}: \parindent (and parskip=half's or full's \parfillskip) are 1em of
 *  the document's font then, not of Computer Modern's as the data has them */
export function withKomaParsizes(k: ClassOptionData, base: ClassOptionData): ClassOptionData {
  const em = (kk: ClassOptionData) => { const r = kk.sizes.normalsize.font; return loadFont(dataFont(r.name), r.at).params[QUAD] }
  const was = em(base), now = em(k)
  if (was === now) return k
  const dimens = { ...k.dimens }, glue = { ...k.glue }
  if (dimens.parindent === was) dimens.parindent = now
  else if (dimens.parindent !== 0) throw new Unsupported("KOMA-Script's \\parindent in another font")
  if (glue.parfillskip.width === was) glue.parfillskip = { ...glue.parfillskip, width: now }
  else if (glue.parfillskip.width !== 0) throw new Unsupported("KOMA-Script's \\parfillskip in another font")
  return { ...k, dimens, glue }
}

/** The fonts the preamble's font packages select (#340): the families \rmdefault, \sfdefault and \ttdefault name, and
 *  the package that set the math fonts (\SetSymbolFont, \SetMathAlphabet), null for fontmath.ltx's */
export interface FontSetup { rm: string; sf: string; tt: string; math: string | null; /** helvet.sty's scaled=: \Hv@scale */ phvScale: string | null }
/**
 * The fonts with \familydefault one of \rmdefault, \sfdefault and \ttdefault: \normalfont (\usefont\encodingdefault
 * \familydefault\seriesdefault\shapedefault) selects that family, so it stands where the roman does (the FontAttrs
 * family cmr: the body's font, \reset@font, \textnormal, footnote marks); \rmfamily and \textrm, which would still
 * select \rmdefault, are not laid out then (document.ts).
 */
export const familyDefault = (f: FontSetup, family: "rm" | "sf" | "tt"): FontSetup => (family === "rm" ? f : { ...f, rm: f[family] })
export const CM_FONTS: FontSetup = { rm: "cmr", sf: "cmss", tt: "cmtt", math: null, phvScale: null }

/** NFSS's font for "encoding/series/shape" of a family at a font size in sp (\fontsize{size}\selectfont) */
export function familyFont(family: string, key: string, size: number): FontRef & { hyphenchar: number; declared: boolean } {
  const r = familyFile(family).sizes[String(size)]?.[key]
  if (!r) throw new Unsupported(`${key.replace("/", `/${family}/`)} at ${size / 65536}pt`)
  return r
}

/** Computer Modern's families, whose fonts the classes' data has (the FontAttrs families) */
const CM_FAMILIES = ["cmr", "cmss", "cmtt"]

/**
 * The font of a family the document's fonts name (ClassOptionData.families) for "encoding/series/shape" at a font size
 * in sp: a font package's (with helvet's scale, the .fd's s*[\Hv@scale]), or Computer Modern's sans or typewriter, at
 * the size command of that size (of any size option: the .fd files' font there, which no class changes).
 */
export function setupFont(k: ClassOptionData, family: string, key: string, size: number): FontRef {
  if (CM_FAMILIES.includes(family)) {
    const [enc, ser, shape] = key.split("/")
    for (const option of ["10pt", "11pt", "12pt"]) {
      const s = Object.values(classData("article", option).sizes).find((x) => x.size === size)
      if (s) { const r = s.fonts[`${enc}/${family}/${ser}/${shape}`]; return { name: r.name, at: r.at } }
    }
    throw new Unsupported(`${key.replace("/", `/${family}/`)} at ${size / 65536}pt`)
  }
  const r = familyFont(family, key, size)
  return { name: r.name, at: family === "phv" && k.families?.phvScale ? times(k.families.phvScale, r.at) : r.at }
}

/** The class with the font packages' fonts: at every size, each family's fonts where the FontAttrs families cmr, cmss
 *  and cmtt (\rmdefault, \sfdefault, \ttdefault) select, the roman's as the size's fonts, and the package's math fonts.
 *  With \familydefault another family's default, `rm` is that family (familyDefault): cmr is the family \normalfont selects. */
export function withFonts(k: ClassOptionData, setup: FontSetup): ClassOptionData {
  const slots = ([["cmr", setup.rm], ["cmss", setup.sf], ["cmtt", setup.tt]] as const).filter(([slot, family]) => slot !== family)
  if (!slots.length && !setup.math) return k
  const math = setup.math ? mathFontsFile(setup.math) : null
  const sizes = Object.fromEntries(Object.entries(k.sizes).map(([n, s]) => {
    const fonts = { ...s.fonts }
    for (const [slot, family] of slots) {
      for (const key of Object.keys(s.fonts).filter((x) => x.split("/")[1] === slot)) {
        const [enc, , ser, shape] = key.split("/")
        // (\familydefault naming Computer Modern's sans or typewriter: those of the class)
        const r = CM_FAMILIES.includes(family) ? s.fonts[`${enc}/${family}/${ser}/${shape}`] : familyFont(family, `${enc}/${ser}/${shape}`, s.size)
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
  return { ...k, sizes, families: { rm: setup.rm, sf: setup.sf, tt: setup.tt, phvScale: setup.phvScale } }
}
