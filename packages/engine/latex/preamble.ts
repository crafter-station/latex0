// The preamble: the class and its options, the packages loaded and what the
// preamble sets (lengths, counters, theorems, colors, \lstset, title data,
// \pagestyle), read line by line. A line not modeled throws Unsupported. The
// body comes back with each theorem environment as \begin{LXtheorem}{name}.

import type { ClassOptionData } from "../layout/classdata"
import { parseGlue, type GlueSpec } from "../layout/dimen"
import { loadFont, QUAD, X_HEIGHT } from "../layout/font"
import { classData, documentClass, withT1 } from "./classes"
import { dataFont } from "./data"
import { fancyCommand, fancyDefaults, type FancyHdr } from "./fancyhdr"
import { geometry } from "./geometry"
import { lstOptions, LST_DEFAULTS, type LstOptions } from "./listings"
import { Unsupported } from "./unsupported"

export type ThmStyle = "plain" | "definition" | "remark"
/** \newtheorem{name}…: its title and style, the counter it steps (null: starred) and the counter that one is within */
export interface TheoremDef { title: string; style: ThmStyle; counter: string | null; within: string | null }

export interface Preamble {
  cls: string
  option: string
  /** the class's parameters, after fontenc, geometry and \setlength */
  k: ClassOptionData
  /** the class's \textwidth and \medskipamount as it loads (letter.cls reads them then) */
  classTextwidth: number
  medskipamount: number
  /** \lstset's options */
  lstBase: LstOptions
  usesListings: boolean
  /** url.sty (hyperref loads it too) */
  usesUrl: boolean
  usesXcolor: boolean
  usesAmsthm: boolean
  amsmath: boolean
  enumitem: boolean
  /** hyperref, with the dvips driver */
  hyper: boolean
  /** \usepackage[T1]{fontenc} */
  t1: boolean
  /** booktabs loaded (after fontenc's T1 or not): its em and ex are the font's then */
  booktabsT1: boolean | null
  thmDefs: Map<string, TheoremDef>
  /** \definecolor{name}{model}{spec} */
  colorDefs: [string, string, string][]
  pagestyle: string
  /** who defined \chaptermark and \sectionmark last: \ps@headings (book runs it when loaded; a later \pagestyle
   *  keeps them) or fancyhdr as it loads (\f@nch@initialise) */
  markDefs: "headings" | "fancyhdr" | null
  /** fancyhdr's fields and rules, when it is loaded */
  fancy: FancyHdr | null
  title: { title?: string; author?: string; date?: string }
  /** letter's \signature, \address and \name */
  letterInfo: { signature?: string; address?: string; name?: string }
  /** \newcounter{name}[within], and the theorems' counters */
  newCounters: [string, string | null][]
  /** between \begin{document} and \end{document} */
  body: string
}

export function readPreamble(src: string): Preamble {
  const { cls, option, extras, unknown } = documentClass(src)
  if (unknown.length) throw new Unsupported(`class option ${unknown.join(",")}`)
  if (!["article", "report", "book", "letter"].includes(cls)) throw new Unsupported(`class ${cls}`)
  let k = classData(cls, option, extras)
  // letter.cls sets \longindentation to .5\textwidth and \medskipamount to \parskip when it loads
  const classTextwidth = k.dimens.textwidth, medskipamount = k.glue.parskip.width
  // \begin{document} and \end{document} outside comments
  const at = (re: RegExp) => { for (const m of src.matchAll(re)) if (!/(^|[^\\])%/.test(src.slice(src.lastIndexOf("\n", m.index!) + 1, m.index))) return m.index!; return -1 }
  const begin = at(/\\begin\{document\}/g), end = at(/\\end\{document\}/g)
  let pre = src.slice(0, begin).replace(/(^|[^\\])%.*$/gm, "$1")
  // \lstset{…}, which may run over lines
  let lstBase: LstOptions = LST_DEFAULTS
  let usesListings = false, usesUrl = false, usesXcolor = false, usesAmsthm = false
  let booktabsT1: boolean | null = null // booktabs loaded (after fontenc's T1 or not): its em and ex are the font's then
  let thmStyle: ThmStyle = "plain"
  const thmDefs = new Map<string, TheoremDef>()
  const colorDefs: [string, string, string][] = [] // \definecolor
  for (let i = pre.indexOf("\\lstset{"); i >= 0; i = pre.indexOf("\\lstset{")) {
    let depth = 0, j = i + 7
    for (; j < pre.length; j++) { if (pre[j] === "{") depth++; else if (pre[j] === "}" && --depth === 0) break }
    lstBase = lstOptions(pre.slice(i + 8, j), lstBase)
    pre = pre.slice(0, i) + pre.slice(j + 1)
  }
  let pagestyle = cls === "book" ? "headings" : "plain"
  let amsmath = false
  let enumitem = false
  // \ps@headings defines \chaptermark and \sectionmark (book runs it when loaded); a later \pagestyle
  // keeps them, and only \@mkboth goes back to \@gobbletwo
  let markDefs: Preamble["markDefs"] = cls === "book" ? "headings" : null
  let fancy: FancyHdr | null = null
  let hyper = false // hyperref, with the dvips driver
  const title: { title?: string; author?: string; date?: string } = {}
  let t1 = false
  const geometryOptions: string[] = []
  const lengths: [string, string][] = [] // \setlength in the preamble
  const letterInfo: { signature?: string; address?: string; name?: string } = {}
  const newCounters: [string, string | null][] = []
  for (const line of pre.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^\\documentclass\b/.test(line)) continue
    if (line === "\\usepackage[utf8]{inputenc}") continue // UTF-8 is LaTeX's default input encoding
    if (line === "{}") continue // a definition the expander took out
    const sl = line.match(/^\\setlength\{\\(parindent|parskip|headheight)\}\{([^{}]*)\}$/)
    if (sl) { lengths.push([sl[1], sl[2]]); continue }
    const nc = line.match(/^\\newcounter\{([a-zA-Z]+)\}(?:\[([a-zA-Z]+)\])?$/)
    if (nc) { newCounters.push([nc[1], nc[2] ?? null]); continue }
    if (line === "\\usepackage[T1]{fontenc}") { t1 = true; continue }
    const geo = line.match(/^\\usepackage(?:\[([^\]]*)\])?\{geometry\}$/) ?? line.match(/^\\geometry\{(.*)\}$/)
    if (geo) { geometryOptions.push(geo[1] ?? ""); continue }
    const pk = line.match(/^\\usepackage\{([a-z,\s]+)\}$/)
    if (pk) {
      // packages whose loading alone changes nothing on the page (amssymb and amsfonts only declare
      // fonts, amsthm only environments, graphicx only \includegraphics)
      const names = pk[1].split(",").map((n) => n.trim())
      const unknown = names.filter((n) => !["amsmath", "amssymb", "amsfonts", "amsthm", "graphicx", "hyperref", "enumitem", "listings", "xcolor", "booktabs", "url", "fancyhdr"].includes(n))
      if (names.includes("booktabs")) booktabsT1 = t1
      if (names.includes("hyperref")) hyper = true
      if (names.includes("enumitem")) enumitem = true
      if (names.includes("listings")) usesListings = true
      if (names.includes("xcolor")) usesXcolor = true
      if (names.includes("amsthm")) usesAmsthm = true
      if (names.includes("url")) usesUrl = true
      if (unknown.length) throw new Unsupported(`preamble: ${line}`)
      if (names.includes("amsmath")) amsmath = true
      if (names.includes("fancyhdr")) {
        if (cls !== "article") throw new Unsupported(`fancyhdr with ${cls}`) // (its \chaptermark and \sectionmark there)
        fancy = fancyDefaults(!!k.ints.twoside); markDefs = "fancyhdr"
      }
      continue
    }
    // letter's \signature, \address and \name
    // amsthm: \theoremstyle{style}, \newtheorem{name}[shared]{Title}, \newtheorem{name}{Title}[within], \newtheorem*{name}{Title}
    const tst = line.match(/^\\theoremstyle\{(plain|definition|remark)\}$/)
    if (tst) { thmStyle = tst[1] as ThmStyle; continue }
    const nt = line.match(/^\\newtheorem(\*)?\{([A-Za-z]+)\}(?:\[([A-Za-z]+)\])?\{([^{}\\]*)\}(?:\[([A-Za-z]+)\])?$/)
    if (nt) {
      const [, star, name, shared, title, within] = nt
      if (star && (shared || within)) throw new Unsupported(`preamble: ${line}`)
      if (within && !["chapter", "section", "subsection"].includes(within)) throw new Unsupported(`\\newtheorem within ${within}`)
      if (shared && !thmDefs.get(shared)?.counter) throw new Unsupported(`\\newtheorem sharing ${shared}`)
      thmDefs.set(name, { title: title.trim(), style: thmStyle, counter: star ? null : shared ? thmDefs.get(shared)!.counter : name, within: shared ? thmDefs.get(shared)!.within : within ?? null })
      if (!star && !shared) newCounters.push([name, within ?? null])
      continue
    }
    const dc = line.match(/^\\definecolor\{([^{}]*)\}\{([^{}]*)\}\{([^{}]*)\}$/)
    if (dc) { colorDefs.push([dc[1], dc[2], dc[3]]); continue }
    const lt = cls === "letter" ? line.match(/^\\(signature|address|name)\{(.*)\}$/) : null
    if (lt) { letterInfo[lt[1] as keyof typeof letterInfo] = lt[2].trim(); continue }
    const t = line.match(/^\\(title|author|date)\{(.*)\}$/)
    if (t) { title[t[1] as keyof typeof title] = t[2].trim(); continue }
    if (fancy && fancyCommand(fancy, line)) continue
    const m = line.match(/^\\pagestyle\{(plain|empty|headings|fancy)\}$/)
    if (m && (m[1] !== "fancy" || fancy)) { pagestyle = m[1]; if (pagestyle === "headings") markDefs = "headings"; continue }
    throw new Unsupported(`preamble: ${line}`)
  }
  if (t1) k = withT1(k, cls)
  if (geometryOptions.length) {
    const f = loadFont(dataFont(k.sizes.normalsize.font.name), k.sizes.normalsize.font.at)
    k = geometry(k, geometryOptions, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
  }
  if (lengths.length) {
    const f = loadFont(dataFont(k.sizes.normalsize.font.name), k.sizes.normalsize.font.at)
    const units = { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
    for (const [name, value] of lengths) {
      let g: GlueSpec
      try { g = parseGlue(value, units) } catch { throw new Unsupported(`\\setlength{\\${name}}{${value}}`) }
      if (name === "parindent") k = { ...k, dimens: { ...k.dimens, parindent: g.width } }
      else if (name === "headheight") k = { ...k, dimens: { ...k.dimens, headheight: g.width } }
      else k = { ...k, glue: { ...k.glue, parskip: g } }
    }
  }
  if (pagestyle === "fancy" && geometryOptions.length) throw new Unsupported("fancyhdr with geometry") // (\headwidth is \textwidth when \ps@fancy first runs)
  if (thmDefs.size && !usesAmsthm) throw new Unsupported("\\newtheorem without amsthm")
  let body = src.slice(begin + 16, end)
  // a theorem environment: \begin{LXtheorem}{name}
  for (const name of thmDefs.keys()) body = body.replace(new RegExp(`\\\\begin\\{${name}\\}`, "g"), `\\begin{LXtheorem}{${name}}`).replace(new RegExp(`\\\\end\\{${name}\\}`, "g"), "\\end{LXtheorem}")
  if (!usesAmsthm && /\\begin\{proof\}/.test(body)) throw new Unsupported("proof without amsthm")
  return { cls, option, k, classTextwidth, medskipamount, lstBase, usesListings, usesUrl, usesXcolor, usesAmsthm, amsmath, enumitem, hyper, t1, booktabsT1, thmDefs, colorDefs, pagestyle, markDefs, fancy, title, letterInfo, newCounters, body }
}
