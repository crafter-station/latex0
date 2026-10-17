// \documentclass: the class and its options, and the class's parameters from
// the committed data (data/classes, through the installed data source).

import { xnOverD } from "../layout/arith"
import type { ClassOptionData, SizeCommand } from "../layout/classdata"
import { loadFont, QUAD } from "../layout/font"
import { glue } from "../layout/nodes"
import { classFile, dataFont } from "./data"

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
