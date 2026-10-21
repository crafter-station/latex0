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
import { times, setspaceCommand, setspaceOptions, withSetspace, type SetSpace } from "./setspace"
import { natbibOptions, natbibStyle, type NatStyle } from "./natbib"
import type { AlgorithmPackages } from "./algorithm"
import { titleformat, titlesecDefaults, type TitleFormats } from "./titlesec"
import { Unsupported } from "./unsupported"

export type ThmStyle = "plain" | "definition" | "remark"
/** \newtheorem{name}…: its title and style, the counter it steps (null: starred) and the counter that one is within */
export interface TheoremDef { title: string; style: ThmStyle; counter: string | null; within: string | null; /** declared after cleveref loaded: its \@othm, \@xnthm or \@ynthm names the type after the title */ crefNamed?: boolean }

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
  /** multirow loaded: \multirow in tabular entries */
  usesMultirow: boolean
  usesXcolor: boolean
  usesAmsthm: boolean
  amsmath: boolean
  enumitem: boolean
  /** hyperref, with the dvips driver */
  hyper: boolean
  /** cleveref */
  cleveref: boolean
  /** titlesec: each level's format */
  titlesec: TitleFormats | null
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
  /** natbib: its citation punctuation on the first run (no .aux yet) and on later ones (the .aux's \bibstyle) */
  natbib: { first: NatStyle; later: NatStyle } | null
  /** algorithm.sty, algpseudocode (and its noend option) */
  algorithm: AlgorithmPackages
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
  let usesListings = false, usesUrl = false, usesMultirow = false, usesXcolor = false, usesAmsthm = false
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
  let cleveref = false
  let titlesec: TitleFormats | null = null
  let natbib: ReturnType<typeof natbibOptions> | null = null
  let setspace: SetSpace | null = null
  const algorithm: AlgorithmPackages = { algorithm: false, algpseudocode: false, noend: false }
  const bibstyles: string[] = [] // the .aux's \bibstyle lines, in order
  const title: { title?: string; author?: string; date?: string } = {}
  let t1 = false
  const geometryOptions: string[] = []
  let geometryStretch = "" // setspace's \baselinestretch when geometry last computed the layout (heightrounded, lines=)
  const lengths: [string, string][] = [] // \setlength in the preamble
  const letterInfo: { signature?: string; address?: string; name?: string } = {}
  const newCounters: [string, string | null][] = []
  const operators: [string, string, boolean][] = [] // \DeclareMathOperator(*){\cmd}{name}
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
    if (geo) { geometryOptions.push(geo[1] ?? ""); geometryStretch = setspace?.stretch ?? ""; continue }
    const nb = line.match(/^\\usepackage(?:\[([^\]]*)\])?\{natbib\}$/)
    if (nb) { natbib = natbibOptions(nb[1] ?? ""); continue }
    const ss = line.match(/^\\usepackage(?:\[([^\]]*)\])?\{setspace\}$/)
    if (ss) { setspace = setspaceOptions(ss[1] ?? "", option); continue }
    if (setspace && setspaceCommand(setspace, line, option)) continue
    // in the preamble, \bibliographystyle writes its \bibstyle at \begin{document} (\AtBeginDocument)
    const bs = line.match(/^\\bibliographystyle\{([^{}]*)\}$/)
    if (bs) { bibstyles.push(bs[1].trim()); continue }
    const ap = line.match(/^\\usepackage\[(noend|end)\]\{algpseudocode\}$/)
    if (ap) {
      if (algorithm.algpseudocode) throw new Unsupported("algpseudocode loaded twice") // (LaTeX: Option clash)
      algorithm.algpseudocode = true; algorithm.noend = ap[1] === "noend"; continue
    }
    const pk = line.match(/^\\usepackage\{([a-z,\s]+)\}$/)
    if (pk) {
      // packages whose loading alone changes nothing on the page (amssymb and amsfonts only declare
      // fonts, amsthm only environments, graphicx only \includegraphics)
      const names = pk[1].split(",").map((n) => n.trim())
      const unknown = names.filter((n) => !["amsmath", "amssymb", "amsfonts", "amsthm", "graphicx", "hyperref", "enumitem", "listings", "xcolor", "booktabs", "url", "fancyhdr", "cleveref", "titlesec", "algorithm", "algpseudocode", "multirow"].includes(n))
      if (names.includes("booktabs")) booktabsT1 = t1
      if (names.includes("hyperref")) {
        // (hyperref's titlesec patches: \ttl@Hy@saveanchor's anchors, \ttl@Hy@steplink's for starred titles)
        if (titlesec || names.indexOf("titlesec") >= 0 && names.indexOf("titlesec") < names.indexOf("hyperref")) throw new Unsupported("hyperref after titlesec")
        hyper = true
      }
      if (names.includes("enumitem")) enumitem = true
      if (names.includes("listings")) usesListings = true
      if (names.includes("xcolor")) usesXcolor = true
      if (names.includes("amsthm")) usesAmsthm = true
      if (names.includes("url")) usesUrl = true
      if (names.includes("multirow")) usesMultirow = true
      if (names.includes("algorithm")) algorithm.algorithm = true
      if (names.includes("algpseudocode")) algorithm.algpseudocode = true
      if (unknown.length) throw new Unsupported(`preamble: ${line}`)
      // cleveref patches amsmath's and amsthm's commands (loaded later, they would undo it) and hyperref's
      if (cleveref && names.some((n) => ["amsmath", "amsthm", "hyperref"].includes(n))) throw new Unsupported(`${line} after cleveref`)
      if (names.includes("cleveref")) {
        if (hyper) throw new Unsupported("cleveref with hyperref")
        if (names.some((n) => ["amsmath", "amsthm"].includes(n) && names.indexOf(n) > names.indexOf("cleveref"))) throw new Unsupported(`${line} after cleveref`)
        cleveref = true
      }
      if (names.includes("amsmath")) amsmath = true
      if (names.includes("titlesec")) {
        if (cls !== "article") throw new Unsupported(`titlesec with ${cls}`)
        titlesec = titlesecDefaults()
      }
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
      thmDefs.set(name, { title: title.trim(), style: thmStyle, counter: star ? null : shared ? thmDefs.get(shared)!.counter : name, within: shared ? thmDefs.get(shared)!.within : within ?? null, ...(cleveref ? { crefNamed: true } : {}) })
      if (!star && !shared) newCounters.push([name, within ?? null])
      continue
    }
    // amsopn's \DeclareMathOperator{\cmd}{name}: \cmd is \qopname\newmcodes@ o{name}, as \operatorname{name} (m, \operatorname*, with *)
    const op = line.match(/^\\DeclareMathOperator(\*)?\s*\{\\([A-Za-z]+)\}\s*\{([^{}]*)\}$/)
    if (op) {
      if (!amsmath) throw new Unsupported("\\DeclareMathOperator without amsmath")
      operators.push([op[2], op[3], !!op[1]]); continue
    }
    const dc = line.match(/^\\definecolor\{([^{}]*)\}\{([^{}]*)\}\{([^{}]*)\}$/)
    if (dc) { colorDefs.push([dc[1], dc[2], dc[3]]); continue }
    const lt = cls === "letter" ? line.match(/^\\(signature|address|name)\{(.*)\}$/) : null
    if (lt) { letterInfo[lt[1] as keyof typeof letterInfo] = lt[2].trim(); continue }
    const t = line.match(/^\\(title|author|date)\{(.*)\}$/)
    if (t) { title[t[1] as keyof typeof title] = t[2].trim(); continue }
    if (fancy && fancyCommand(fancy, line)) continue
    if (titlesec && titleformat(titlesec, line)) continue
    const m = line.match(/^\\pagestyle\{(plain|empty|headings|fancy)\}$/)
    if (m && (m[1] !== "fancy" || fancy)) { pagestyle = m[1]; if (pagestyle === "headings") markDefs = "headings"; continue }
    throw new Unsupported(`preamble: ${line}`)
  }
  if (t1) k = withT1(k, cls)
  if (geometryOptions.length) {
    const f = loadFont(dataFont(k.sizes.normalsize.font.name), k.sizes.normalsize.font.at)
    const bs = geometryStretch ? { ...k.glue, baselineskip: { ...k.glue.baselineskip, width: times(geometryStretch, k.glue.baselineskip.width) } } : k.glue
    k = { ...geometry({ ...k, glue: bs }, geometryOptions, { em: f.params[QUAD], ex: f.params[X_HEIGHT] }), glue: k.glue }
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
  if (setspace) k = withSetspace(k, setspace)
  if (pagestyle === "fancy" && geometryOptions.length) throw new Unsupported("fancyhdr with geometry") // (\headwidth is \textwidth when \ps@fancy first runs)
  if (thmDefs.size && !usesAmsthm) throw new Unsupported("\\newtheorem without amsthm")
  let body = src.slice(begin + 16, end)
  // \bibliographystyle and \bibliography between paragraphs: an \immediate\write to the .aux, and with no .bbl
  // nothing to \input; the .aux's \bibstyle lines are read back at \begin{document}
  body = body.replace(/(^|\n[ \t]*\n)((?:[ \t]*\\bibliography(?:style)?\{[^{}]*\}[ \t]*(?:\n|$))+)/g, (_, before: string, cmds: string) => {
    for (const m of cmds.matchAll(/\\bibliographystyle\{([^{}]*)\}/g)) bibstyles.push(m[1].trim())
    return before + cmds.replace(/[^\n]/g, "")
  })
  if (/\\bibliography(?:style)?\b/.test(body)) throw new Unsupported("\\bibliography in a paragraph")
  if (setspace && /\\(?:singlespacing|onehalfspacing|doublespacing|setstretch|begin\{(?:spacing|singlespace\*?|onehalfspace|doublespace)\})/.test(body)) throw new Unsupported("setspace's spacing in the document")
  if (natbib && /\\begin\{thebibliography\}/.test(body)) throw new Unsupported("thebibliography with natbib")
  for (const [cmd, name, star] of operators) body = body.replace(new RegExp(`\\\\${cmd}(?![A-Za-z])`, "g"), () => `\\operatorname${star ? "*" : ""}{${name}}`)
  // a theorem environment: \begin{LXtheorem}{name}
  for (const name of thmDefs.keys()) body = body.replace(new RegExp(`\\\\begin\\{${name}\\}`, "g"), `\\begin{LXtheorem}{${name}}`).replace(new RegExp(`\\\\end\\{${name}\\}`, "g"), "\\end{LXtheorem}")
  if (!usesAmsthm && /\\begin\{proof\}/.test(body)) throw new Unsupported("proof without amsthm")
  if (/\\begin\{algorithmic\}/.test(body.replace(/\\begin\{algorithm\}[^]*?\\end\{algorithm\}/g, ""))) throw new Unsupported("algorithmic outside an algorithm float")
  return { cls, option, k, classTextwidth, medskipamount, lstBase, usesListings, usesUrl, usesMultirow, usesXcolor, usesAmsthm, amsmath, enumitem, hyper, cleveref, titlesec, natbib: natbib && { first: natbib.style, later: natbibStyle(natbib, bibstyles) }, t1, booktabsT1, thmDefs, colorDefs, pagestyle, markDefs, fancy, title, letterInfo, newCounters, algorithm, body }
}
