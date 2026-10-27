// The preamble: the class and its options, the packages loaded and what the
// preamble sets (lengths, counters, theorems, colors, \lstset, title data,
// \pagestyle), read line by line. A line not modeled throws Unsupported. The
// body comes back with each theorem environment as \begin{LXtheorem}{name}.

import type { ClassOptionData } from "../layout/classdata"
import { parseDimen, parseGlue, type GlueSpec } from "../layout/dimen"
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
import { CAPTION_LISTS, captionDefaults, copyKeys, setCaptionKeys, type CaptionSetup } from "./captionsetup"
import type { CrefNameDef, CrefOptions } from "./cleveref"
import { Unsupported } from "./unsupported"
import { SI_DEFAULTS, siOptions, type SiOptions } from "./siunitx"
import { babelOptions, captions, isBabelLanguage, withBabel, type Babel, type Captions } from "./babel"

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
  /** array.sty's \newcolumntype{X}[n]{spec} definitions */
  columnTypes: Record<string, { n: number; spec: string }>
  /** multirow loaded: \multirow in tabular entries */
  usesMultirow: boolean
  /** siunitx loaded: \num, \si, \SI… (it loads array and, at \begin{document}, color) */
  usesSiunitx: boolean
  /** its options: \usepackage[…]{siunitx}, then each \sisetup{…} */
  siOptions: SiOptions
  /** caption.sty: its \caption (caption3.sty's \caption@@make) */
  usesCaption: boolean
  /** subcaption.sty (which loads caption): subfigure, subtable and their captions */
  usesSubcaption: boolean
  /** caption.sty's options: package options and \captionsetup in the preamble (with caption.sty loaded) */
  caption: CaptionSetup | null
  usesXcolor: boolean
  /** tikz (which loads xcolor and graphicx): the libraries loaded and the preamble's \tikzset and \tikzstyle, in order */
  tikz: { libraries: string[]; sets: string[] } | null
  usesAmsthm: boolean
  amsmath: boolean
  enumitem: boolean
  /** hyperref, with the dvips driver */
  hyper: boolean
  /** geometry loaded (its \\AtBeginDvi papersize under dvips), and whether landscape */
  geometry: { landscape: boolean } | null
  /** the graphics bundle's dvips.def loaded (graphicx, xcolor; siunitx loads color): its \\AtBeginDvi papersize */
  graphicsDriver: boolean
  /** hyperref's \@footnotetext, with its anchor (setspace's, loaded after it, takes its place) */
  hyperNotes: boolean
  /** nameref (hyperref loads it): \@currentlabelname set by headings, captions and theorems */
  nameref: boolean
  /** cleveref */
  cleveref: boolean
  /** cleveref's options, and \crefname and \Crefname in the preamble */
  crefOptions: CrefOptions
  crefNames: CrefNameDef[]
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
  /** babel: its languages, the main one, and whether it was loaded before hyperref (its \AtBeginDocument first) */
  babel: (Babel & { beforeHyperref: boolean }) | null
  /** \figurename, \contentsname …: the main language's captions (LaTeX's without babel) */
  names: Captions
  /** between \begin{document} and \end{document} */
  body: string
}

export function readPreamble(src: string): Preamble {
  const { cls, option, extras, unknown: classUnknown } = documentClass(src)
  // (languages are global options babel reads)
  const usesBabel = /^[^%\n]*\\usepackage\s*(?:\[[^\]]*\])?\{[^}]*\bbabel\b/m.test(src.slice(0, src.indexOf("\\begin{document}")))
  const unknown = classUnknown.filter((o) => !(usesBabel && isBabelLanguage(o)))
  if (unknown.length) throw new Unsupported(`class option ${unknown.join(",")}`)
  let babel: Preamble["babel"] = null
  const loadBabel = (own: string[], beforeHyperref: boolean) => {
    if (babel) throw new Unsupported("babel loaded twice") // (LaTeX: Option clash, or nothing)
    babel = { ...babelOptions(own, classUnknown.filter(isBabelLanguage)), beforeHyperref }
  }
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
  // \tikzset{…} and \tikzstyle…, which may run over lines: on one
  pre = pre.replace(/\\tikzset\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g, (m) => m.replace(/\s*\n\s*/g, " "))
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
  let hyperNotes = true
  let nameref = false // (hyperref loads it)
  let cleveref = false
  const crefOptions: CrefOptions = { sort: true, compress: true, capitalise: false, abbrev: true, nameinlink: false }
  const crefNames: CrefNameDef[] = []
  let titlesec: TitleFormats | null = null
  let natbib: ReturnType<typeof natbibOptions> | null = null
  let setspace: SetSpace | null = null
  const algorithm: AlgorithmPackages = { algorithm: false, algpseudocode: false, noend: false }
  const bibstyles: string[] = [] // the .aux's \bibstyle lines, in order
  const title: { title?: string; author?: string; date?: string } = {}
  let t1 = false
  const geometryOptions: string[] = []
  let geometryStretch = "" // setspace's \baselinestretch when geometry last computed the layout (heightrounded, lines=)
  const lengths: [string, string, boolean][] = [] // \setlength in the preamble (and whether T1 was selected by then: its em and ex)
  let usesArray = false
  let usesSiunitx = false
  let usesGraphicx = false
  let tikz: Preamble["tikz"] = null
  let siOpts = SI_DEFAULTS
  let usesCaption = false
  let usesSubcaption = false
  // caption.sty's and subcaption's options and \captionsetup, in order: keys set at once (null: a list) and whether T1
  // was selected by then (the em and ex of their lengths)
  const captionOps: { list: string | null; src: string; t1: boolean }[] = []
  const loadCaption = (opts: string | null) => {
    if (usesCaption && opts !== null) throw new Unsupported("caption loaded twice with options") // (LaTeX: Option clash)
    usesCaption = true
    if (opts !== null) captionOps.push({ list: null, src: opts, t1 })
  }
  const loadSubcaption = (opts: string | null) => {
    if (usesSubcaption) { if (opts !== null) throw new Unsupported("subcaption loaded twice with options"); return }
    if (!usesCaption) loadCaption(null)
    usesSubcaption = true
    // \caption@ExecuteOptions{subcaption}{font+=smaller,…}, then its options, each as \captionsetup[sub]
    captionOps.push({ list: "sub", src: "font+=smaller,labelformat=parens,labelsep=space,skip=6pt,list=0,hypcap=0", t1 })
    if (opts !== null) captionOps.push({ list: "sub", src: opts, t1 })
  }
  // \captionsetup and caption's options over more than one line: on one
  pre = pre.replace(/\\usepackage\[[^\]]*\]\{(?:sub)?caption\}/g, (m) => m.replace(/\s*\n\s*/g, " "))
  const chars = pre.split("")
  for (const m of pre.matchAll(/\\captionsetup\b[^{]*\{/g)) { // (spaces for newlines: the indices stay)
    for (let j = m.index! + m[0].length, depth = 1; j < chars.length && depth; j++) {
      if (chars[j] === "{") depth++; else if (chars[j] === "}") depth--; else if (chars[j] === "\n") chars[j] = " "
    }
  }
  // \title, \author and \date over more than one line: on one (a line's end is a space; a blank line, \par, is an error)
  for (const m of pre.matchAll(/\\(?:title|author|date)\s*\{/g)) {
    for (let j = m.index! + m[0].length, depth = 1; j < chars.length && depth; j++) {
      if (chars[j] === "\\") j++
      else if (chars[j] === "{") depth++; else if (chars[j] === "}") depth--
      else if (chars[j] === "\n") { if (/^\n[ \t]*\n/.test(pre.slice(j))) throw new Unsupported(`a blank line in ${m[0]}…}`); chars[j] = " " }
    }
  }
  pre = chars.join("")
  const columnTypes: Preamble["columnTypes"] = {}
  const letterInfo: { signature?: string; address?: string; name?: string } = {}
  const newCounters: [string, string | null][] = []
  const operators: [string, string, boolean][] = [] // \DeclareMathOperator(*){\cmd}{name}
  for (const line of pre.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^\\documentclass\b/.test(line)) continue
    if (line === "\\usepackage[utf8]{inputenc}") continue // UTF-8 is LaTeX's default input encoding
    if (line === "{}") continue // a definition the expander took out
    const sl = line.match(/^\\setlength\{\\(parindent|parskip|headheight|extrarowheight)\}\{([^{}]*)\}$/)
    if (sl) {
      if (sl[1] === "extrarowheight" && !usesArray) throw new Unsupported(`preamble: ${line}`) // (array.sty defines it)
      lengths.push([sl[1], sl[2], t1]); continue
    }
    const ncol = line.match(/^\\newcolumntype\{?([A-Za-z])\}?\s*(?:\[(\d)\])?\s*\{(.*)\}$/)
    if (ncol) {
      if (!usesArray || "clrmbpw".includes(ncol[1]) || ncol[1] in columnTypes || !balanced(ncol[3])) throw new Unsupported(`preamble: ${line}`)
      columnTypes[ncol[1]] = { n: Number(ncol[2] ?? 0), spec: ncol[3] }; continue
    }
    const nc = line.match(/^\\newcounter\{([a-zA-Z]+)\}(?:\[([a-zA-Z]+)\])?$/)
    if (nc) { newCounters.push([nc[1], nc[2] ?? null]); continue }
    if (line === "\\usepackage[T1]{fontenc}") { t1 = true; continue }
    const geo = line.match(/^\\usepackage(?:\[([^\]]*)\])?\{geometry\}$/) ?? line.match(/^\\geometry\{(.*)\}$/)
    if (geo) { geometryOptions.push(geo[1] ?? ""); geometryStretch = setspace?.stretch ?? ""; continue }
    const nb = line.match(/^\\usepackage(?:\[([^\]]*)\])?\{natbib\}$/)
    if (nb) { natbib = natbibOptions(nb[1] ?? ""); continue }
    const ss = line.match(/^\\usepackage(?:\[([^\]]*)\])?\{setspace\}$/)
    if (ss) { setspace = setspaceOptions(ss[1] ?? "", option); if (hyper) hyperNotes = false; if (algorithm.algorithm) algorithm.singleHere = true; continue }
    if (setspace && setspaceCommand(setspace, line, option)) continue
    // in the preamble, \bibliographystyle writes its \bibstyle at \begin{document} (\AtBeginDocument)
    const bs = line.match(/^\\bibliographystyle\{([^{}]*)\}$/)
    if (bs) { bibstyles.push(bs[1].trim()); continue }
    const ap = line.match(/^\\usepackage\[(noend|end)\]\{algpseudocode\}$/)
    if (ap) {
      if (algorithm.algpseudocode) throw new Unsupported("algpseudocode loaded twice") // (LaTeX: Option clash)
      algorithm.algpseudocode = true; algorithm.noend = ap[1] === "noend"; continue
    }
    const bab = line.match(/^\\usepackage\[([^\]]*)\]\{babel\}$/)
    if (bab) { loadBabel(bab[1].split(",").map((o) => o.trim()).filter(Boolean), !hyper); continue }
    const cpo = line.match(/^\\usepackage\[([^\]]*)\]\{(caption|subcaption)\}$/)
    if (cpo) { if (cpo[2] === "caption") loadCaption(cpo[1]); else loadSubcaption(cpo[1]); continue }
    // \captionsetup{keys} at once, \captionsetup[type]{keys} into the type's list
    const cs = line.match(/^\\captionsetup\s*(?:\[([a-z]+)\])?\s*\{(.*)\}$/)
    if (cs) {
      if (!usesCaption || cs[1] !== undefined && !CAPTION_LISTS.includes(cs[1])) throw new Unsupported(`preamble: ${line}`)
      captionOps.push({ list: cs[1] ?? null, src: cs[2], t1 }); continue
    }
    const sx = line.match(/^\\usepackage\[(.*)\]\{siunitx\}$/) ?? line.match(/^\\sisetup\s*\{(.*)\}$/)
    if (sx) {
      if (line.startsWith("\\sisetup") !== usesSiunitx) throw new Unsupported(`preamble: ${line}`) // (siunitx loaded once, before \sisetup)
      siOpts = siOptions(sx[1], siOpts); usesSiunitx = true; usesArray = true; continue // (siunitx loads array)
    }
    // cleveref's options (english, its default language): sorting and compressing, capitalise, noabbrev, nameinlink
    const cro = line.match(/^\\usepackage\[([^\]]*)\]\{cleveref\}$/)
    if (cro) {
      if (cleveref) throw new Unsupported("cleveref loaded twice")
      for (const o of cro[1].split(",").map((x) => x.trim()).filter(Boolean)) {
        if (o === "sort") Object.assign(crefOptions, { sort: true, compress: false })
        else if (o === "compress") Object.assign(crefOptions, { sort: false, compress: true })
        else if (o === "sort&compress") Object.assign(crefOptions, { sort: true, compress: true })
        else if (o === "nosort") Object.assign(crefOptions, { sort: false, compress: false })
        else if (o === "capitalise" || o === "capitalize") crefOptions.capitalise = true
        else if (o === "noabbrev") crefOptions.abbrev = false
        else if (o === "nameinlink") crefOptions.nameinlink = true
        else if (o !== "english") throw new Unsupported(`cleveref option ${o}`)
      }
      cleveref = true; continue
    }
    const crn = line.match(/^\\(crefname|Crefname)\{([A-Za-z]+)\}\{([^{}\\]*)\}\{([^{}\\]*)\}$/)
    if (crn) {
      if (!cleveref) throw new Unsupported(`preamble: ${line}`)
      crefNames.push([crn[1] === "crefname" ? "cref" : "Cref", crn[2], crn[3], crn[4]]); continue
    }
    const pk = line.match(/^\\usepackage\{([a-z,\s]+)\}$/)
    if (pk) {
      // packages whose loading alone changes nothing on the page (amssymb and amsfonts only declare
      // fonts, amsthm only environments, graphicx only \includegraphics)
      const names = pk[1].split(",").map((n) => n.trim())
      const unknown = names.filter((n) => !["amsmath", "amssymb", "amsfonts", "amsthm", "graphicx", "hyperref", "enumitem", "listings", "xcolor", "booktabs", "url", "fancyhdr", "cleveref", "titlesec", "algorithm", "algpseudocode", "multirow", "array", "siunitx", "caption", "subcaption", "nameref", "tikz", "babel"].includes(n))
      if (names.includes("booktabs")) booktabsT1 = t1
      // (float.sty after hyperref: its \caption replaces hyperref's, and hyperref saw no float.sty to patch)
      if (names.includes("algorithm") && (hyper || names.includes("hyperref") && names.indexOf("hyperref") < names.indexOf("algorithm"))) algorithm.afterHyperref = true
      if (names.includes("hyperref")) {
        // (hyperref's titlesec patches: \ttl@Hy@saveanchor's anchors, \ttl@Hy@steplink's for starred titles)
        if (titlesec || names.indexOf("titlesec") >= 0 && names.indexOf("titlesec") < names.indexOf("hyperref")) throw new Unsupported("hyperref after titlesec")
        hyper = true
      }
      if (names.includes("nameref")) nameref = true
      if (names.includes("babel")) loadBabel([], !(hyper && (!names.includes("hyperref") || names.indexOf("hyperref") < names.indexOf("babel"))))
      if (names.includes("enumitem")) enumitem = true
      if (names.includes("listings")) usesListings = true
      if (names.includes("xcolor")) usesXcolor = true
      if (names.includes("graphicx")) usesGraphicx = true
      // tikz loads pgf, which loads graphicx and xcolor
      if (names.includes("tikz")) { tikz ??= { libraries: [], sets: [] }; usesXcolor = usesGraphicx = true }
      if (names.includes("amsthm")) usesAmsthm = true
      if (names.includes("url")) usesUrl = true
      if (names.includes("multirow")) usesMultirow = true
      if (names.includes("array")) usesArray = true
      if (names.includes("siunitx")) {
        if (usesSiunitx) throw new Unsupported(`preamble: ${line}`)
        usesSiunitx = true; usesArray = true // (siunitx loads array)
      }
      for (const n of names) { if (n === "caption") loadCaption(null); else if (n === "subcaption") loadSubcaption(null) } // (subcaption loads caption)
      if (names.includes("algorithm")) algorithm.algorithm = true
      if (names.includes("algpseudocode")) algorithm.algpseudocode = true
      if (unknown.length) throw new Unsupported(`preamble: ${line}`)
      // cleveref patches amsmath's and amsthm's commands (loaded later, they would undo it) and hyperref's
      if (cleveref && names.some((n) => ["amsmath", "amsthm", "hyperref"].includes(n))) throw new Unsupported(`${line} after cleveref`)
      if (names.includes("cleveref")) {
        if (names.some((n) => ["amsmath", "amsthm", "hyperref"].includes(n) && names.indexOf(n) > names.indexOf("cleveref"))) throw new Unsupported(`${line} after cleveref`)
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
    // TikZ's libraries whose loading changes nothing on the page but what the engine models (tikz/options.ts),
    // and style definitions
    const tl = line.match(/^\\usetikzlibrary\s*\{([^{}]*)\}$/)
    if (tl && tikz) {
      const libs = tl[1].split(",").map((x) => x.trim()).filter(Boolean)
      if (libs.some((x) => !["positioning", "arrows.meta", "calc"].includes(x))) throw new Unsupported(`preamble: ${line}`)
      tikz.libraries.push(...libs); continue
    }
    if (tikz && /^\\tikz(?:set\s*\{.*\}|style\b.*)$/.test(line)) { tikz.sets.push(line); continue }
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
  const kOT1 = k
  if (t1) k = withT1(k, cls)
  const geo = { landscape: false }
  if (geometryOptions.length) {
    const f = loadFont(dataFont(k.sizes.normalsize.font.name), k.sizes.normalsize.font.at)
    const bs = geometryStretch ? { ...k.glue, baselineskip: { ...k.glue.baselineskip, width: times(geometryStretch, k.glue.baselineskip.width) } } : k.glue
    k = { ...geometry({ ...k, glue: bs }, geometryOptions, { em: f.params[QUAD], ex: f.params[X_HEIGHT] }, geo), glue: k.glue }
  }
  if (lengths.length) {
    for (const [name, value, enc] of lengths) {
      const font = (enc ? k : kOT1).sizes.normalsize.font, f = loadFont(dataFont(font.name), font.at)
      const units = { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
      let g: GlueSpec
      try { g = parseGlue(value, units) } catch { throw new Unsupported(`\\setlength{\\${name}}{${value}}`) }
      if (name === "extrarowheight") k = { ...k, array: { extrarowheight: g.width } }
      else if (name === "parindent") k = { ...k, dimens: { ...k.dimens, parindent: g.width } }
      else if (name === "headheight") k = { ...k, dimens: { ...k.dimens, headheight: g.width } }
      else k = { ...k, glue: { ...k.glue, parskip: g } }
    }
  }
  if (usesArray && !k.array) k = { ...k, array: { extrarowheight: 0 } }
  let caption: CaptionSetup | null = null
  if (usesCaption) {
    caption = { keys: captionDefaults(!!k.ints.twoside), lists: {} }
    for (const op of captionOps) {
      // a length as \setlength reads it there: in the font then, \textwidth the class's (not geometry's, which sets it later)
      const font = (op.t1 ? k : kOT1).sizes.normalsize.font, f = loadFont(dataFont(font.name), font.at)
      const internal = (name: string) => name === "textwidth" && !geometryOptions.length ? { level: "dimen" as const, value: classTextwidth } : undefined
      const dim = (v: string) => parseDimen(v, { em: f.params[QUAD], ex: f.params[X_HEIGHT], internal })
      if (op.list === null) { setCaptionKeys(caption.keys, op.src, "preamble", dim); continue }
      setCaptionKeys(copyKeys(caption.keys), op.src, "list", () => 0, op.list.endsWith("table") ? "table" : "figure") // (\caption@checkoptions)
      ;(caption.lists[op.list] ??= []).push(op.src)
    }
  }
  if (setspace) k = withSetspace(k, setspace)
  const bb = babel as Preamble["babel"]
  if (bb) k = withBabel(k, bb)
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
  // (titlesec's and cleveref's own \@currentlabelname and \label with nameref's patches, untried without hyperref)
  if (nameref && !hyper && (titlesec || cleveref)) throw new Unsupported(`nameref with ${titlesec ? "titlesec" : "cleveref"}`)
  return { cls, option, k, classTextwidth, medskipamount, lstBase, usesListings, usesUrl, usesMultirow, usesSiunitx, siOptions: siOpts, usesCaption, usesSubcaption, caption, columnTypes, usesXcolor, tikz, usesAmsthm, amsmath, enumitem, hyper, geometry: geometryOptions.length ? geo : null, graphicsDriver: usesGraphicx || usesXcolor || usesSiunitx, hyperNotes, nameref: nameref || hyper, cleveref, crefOptions, crefNames, titlesec, natbib: natbib && { first: natbib.style, later: natbibStyle(natbib, bibstyles) }, t1, booktabsT1, thmDefs, colorDefs, pagestyle, markDefs, fancy, title, letterInfo, newCounters, algorithm, babel: bb, names: captions(bb), body }
}

/** braces balanced in s */
function balanced(s: string): boolean {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue }
    if (s[i] === "{") depth++
    else if (s[i] === "}" && --depth < 0) return false
  }
  return depth === 0
}
