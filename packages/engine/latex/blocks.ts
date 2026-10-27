// The document body read into blocks: paragraphs, headings, list-like
// environments (with their items and nested environments), floats, listings,
// the bibliography, letters and front-matter commands. Text that would need
// commands the layout does not handle yet throws Unsupported here.

import type { Node } from "../layout/nodes"
import { BODY_DECLARATIONS, squeeze, TEXT_SYMBOLS } from "./paragraph"
import { Unsupported } from "./unsupported"
import { SI_COMMANDS } from "./siunitx"
import { TEXT_LETTERS, withoutTextCommands } from "./encodings"
import { COUNTER_COMMANDS } from "./counters"

export type Block =
  | { kind: "par"; text: string; noindent: boolean; /** the floats that start in it (\LXfloat{n}: the n-th) */ floats?: Extract<Block, { kind: "float" }>[]; /** \unskips before its \par: \@trivlist's one when a list follows in it */ unskip?: number
      /** right after an amsthm environment (no blank line): an earlier \@doendpe may still be in force */ afterThm?: boolean }
  | ListBlock
  | { kind: "heading"; level: 0 | 1 | 2 | 3 | 4 | 5; star: boolean; title: string; /** the title's source, when it differs (\tableofcontents) */ source?: string; /** nodes after the title text (its \@mkboth marks) */ end?: Node[]
      /** a blank line (\par) right before it */ blank?: boolean }
  | { kind: "maketitle" }
  /** \begin{titlepage}: its body, read in vertical mode (vmode.ts) */
  | { kind: "titlepage"; body: string }
  | { kind: "float"; env: "figure" | "table" | "algorithm"; fps: string | null; body: string; inPar: boolean; /** a blank line (\par) before it */ blank: boolean }
  | { kind: "toc" }
  /** \appendix */
  | { kind: "appendix" }
  /** \listoffigures, \listoftables */
  | { kind: "lof"; file: "lof" | "lot" }
  | { kind: "matter"; which: "front" | "main" | "back" }
  /** \begin{letter}{to}: \opening, the blocks of its body, \closing, and the \par tokens after it */
  | { kind: "letter"; to: string; opening: string; blocks: Block[]; closing: string; pars: number }
  /** \begin{thebibliography}: its heading and \@mkboth, then the list */
  | { kind: "bib"; keys: string[] }
  /** \begin{lstlisting}[options]: the n-th listing taken out of the source before expansion */
  | { kind: "listing"; n: number }
  /** \newpage, \clearpage and \cleardoublepage (in a paragraph: its \par first) */
  | { kind: "newpage"; cmd: "newpage" | "clearpage" | "cleardoublepage" }
  /** \pagebreak[n] and \nopagebreak[n] in vertical mode: \penalty -\@getpen{n}, \penalty \@getpen{n} */
  | { kind: "pagebreak"; no: boolean; n: number }
  /** \thispagestyle{style} and \pagenumbering{style} in vertical mode */
  | { kind: "pagestyle"; cmd: "thispagestyle" | "pagenumbering"; style: string }

/** The list-like environments: \list ones and \trivlist ones (center, flushleft, flushright), and abstract. */
export const ENVS = ["itemize", "enumerate", "description", "quote", "quotation", "verse", "center", "flushleft", "flushright", "abstract", "thebibliography", "LXtheorem", "proof"] as const
export type EnvName = typeof ENVS[number]
export const ENV_ALT = ENVS.join("|")
/** An environment: its items (one, from \item\relax, for all but itemize, enumerate and description). */
export interface ListBlock {
  kind: "list"; env: EnvName; items: Item[]; inPar: boolean; blank: boolean; /** thebibliography's widest label */ widest?: string; /** thebibliography's \bibitem keys */ keys?: string[]; /** enumitem's [options] */ options?: string
  /** an amsthm theorem (\begin{name} became \begin{LXtheorem}{name}): its name and [note]; a proof's [title] */
  thm?: { name: string; note: string | null }; proofTitle?: string
  /** abstract: its body as typed */
  source?: string
}
/** An item's optional label and its parts: paragraphs (how each starts) and nested environments. */
export interface Item { label: string | null; parts: Part[] }
export type Part = { kind: "text"; text: string; start: "label" | "doendpe" | "par" | "cr"; /** nodes after the label, before the text */ nodes?: Node[]; /** \unskips before the \par that ends it */ unskip?: number; /** \\* and \\[skip] before it */ crStar?: boolean; crSkip?: string; /** a blank line ends it */ parEnd?: boolean } | ListBlock

/** Where the \end matching an environment's \begin is (environments nest), and where it ends. */
export function listEnd(body: string, from: number, env: string): { at: number; next: number } {
  const re = new RegExp(`\\\\(begin|end)\\{(${ENV_ALT})\\}`, "g")
  re.lastIndex = from
  let depth = 1
  for (let m: RegExpExecArray | null; (m = re.exec(body)); ) {
    depth += m[1] === "begin" ? 1 : -1
    if (depth === 0) { if (m[2] !== env) throw new Unsupported(`\\end{${m[2]}} for \\begin{${env}}`); return { at: m.index, next: re.lastIndex } }
  }
  throw new Unsupported(`\\begin{${env}} without its \\end`)
}

/** An environment's body: its items at this level, each split into paragraphs and nested environments. */
export function parseList(env: EnvName, inner: string, inPar: boolean, blank: boolean): ListBlock {
  const listy = env === "itemize" || env === "enumerate" || env === "description" || env === "thebibliography"
  // enumitem's \begin{itemize}[options]
  const opts = env === "itemize" || env === "enumerate" || env === "description" ? inner.match(/^\s*\[([^\]]*)\]/) : null
  if (opts) inner = inner.slice(opts[0].length)
  // amsthm: \begin{LXtheorem}{name}[note], \begin{proof}[title]
  let thm: ListBlock["thm"], proofTitle: string | undefined
  if (env === "LXtheorem") {
    const m = inner.match(/^\{([A-Za-z]+)\}(?:\s*\[([^\]]*)\])?/)!
    thm = { name: m[1], note: m[2] ?? null }; inner = inner.slice(m[0].length)
  } else if (env === "proof") {
    const m = inner.match(/^\s*\[([^\]]*)\]/)
    if (m) { proofTitle = m[1]; inner = inner.slice(m[0].length) }
  }
  const crs = env === "center" || env === "flushleft" || env === "flushright" || env === "verse" // \\ is \@centercr
  // \item at this level only
  const cuts: number[] = []
  const re = new RegExp(`\\\\item\\b|\\\\begin\\{(${ENV_ALT})\\}`, "g")
  for (let m: RegExpExecArray | null; (m = re.exec(inner)); ) {
    if (m[1]) { re.lastIndex = listEnd(inner, re.lastIndex, m[1]).next; continue }
    cuts.push(m.index)
  }
  if (!listy && cuts.length) throw new Unsupported(`\\item in ${env}`)
  if (listy && inner.slice(0, cuts[0] ?? inner.length).trim()) throw new Unsupported("text before the first \\item")
  const bodies = listy ? cuts.map((c, i) => inner.slice(c + 5, cuts[i + 1] ?? inner.length)) : [inner]
  const items = bodies.map((x, bi) => {
    const opt = listy ? x.match(/^\s*\[([^\]]*)\]/) : null // \item[label]
    if (opt && /[\\{}$%&#^_~[]/.test(withoutTextCommands(opt[1]))) throw new Unsupported(`\\item[${opt[1]}]`)
    if (opt) x = x.slice(opt[0].length)
    const parts: Part[] = []
    // text: paragraphs at blank lines and, where \\ is \@centercr, at \\
    // what ends the last paragraph of a stretch of text: \@item's \unskip\unskip\par, \endtrivlist's and
    // \@trivlist's \unskip\par; a blank line or \@centercr's \par after its \unskip
    const text = (t: string, afterEnv: boolean, endUnskip: number) => {
      const paras = t.split(/\n[ \t]*\n/)
      paras.forEach((para0, pi) => {
        const para = pi < paras.length - 1 ? para0 + " " : para0 // the line end before a blank line is a space
        // (a \\ in a display is the display's)
        const shown: string[] = []
        const lines = para.replace(new RegExp(DISPLAY.source, "g"), (m) => `\u0000${shown.push(m) - 1}\u0000`).split(/\\\\/).map((l) => l.replace(/\u0000(\d+)\u0000/g, (_, n) => shown[Number(n)]))
        if (lines.length > 1 && !crs) throw new Unsupported(`\\\\ in ${env}`)
        lines.forEach((line, li) => {
          // \@centercr: \par, \nobreak for \\*, \addvspace{-\parskip}, \vskip for \\[skip]
          let crStar = false, crSkip: string | undefined
          const opt = li > 0 ? line.match(/^\s*(\*)?\s*(?:\[([^\]]*)\])?/) : null
          if (opt?.[0]) { crStar = !!opt[1]; crSkip = opt[2]; line = line.slice(opt[0].length) }
          const tx = squeeze(line)
          const cr = { ...(crStar ? { crStar } : {}), ...(crSkip !== undefined ? { crSkip } : {}) }
          if (!tx && li > 0 && parts.length) { parts.push({ kind: "text", text: "", start: "cr", ...cr }); return } // a \\ ending the text
          if (!tx) return
          const start = !parts.length ? "label" : li > 0 ? "cr" : pi === 0 && afterEnv ? "doendpe" : "par"
          const unskip = li < lines.length - 1 ? 1 : pi < paras.length - 1 ? 0 : endUnskip
          parts.push({ kind: "text", text: tx, start, unskip, ...(start === "cr" ? cr : {}) })
        })
      })
      const lp = parts[parts.length - 1]
      if (paras.length > 1 && !paras[paras.length - 1].trim() && lp?.kind === "text") lp.parEnd = true
    }
    const nested = new RegExp(`\\\\begin\\{(${ENV_ALT})\\}`, "g")
    let at = 0
    // after a nested environment, \@doendpe (amsthm's say \@endpefalse: the next paragraph is indented)
    let endpe = false
    for (let m: RegExpExecArray | null; (m = nested.exec(x)); ) {
      const before = x.slice(at, m.index)
      text(before, endpe, 1)
      if (!parts.length) throw new Unsupported(`an environment right at the start of ${listy ? "an \\item" : env}`)
      // in a paragraph unless a blank line or a \\ (\@centercr's \par) ended it
      // (amsthm's \proof starts with \par)
      const inP = m[1] !== "proof" && /\S[ \t]*\n?[ \t]*$/.test(before) && !/\n[ \t]*\n[ \t]*$/.test(before) && before.trim() !== "" && !/\\\\\s*$/.test(before)
      const end = listEnd(x, nested.lastIndex, m[1])
      parts.push(parseList(m[1] as EnvName, x.slice(nested.lastIndex, end.at), inP, /\n[ \t]*\n\s*$/.test(before)))
      at = nested.lastIndex = end.next
      endpe = m[1] !== "proof" && m[1] !== "LXtheorem"
    }
    text(x.slice(at), endpe, listy && bi < bodies.length - 1 ? 2 : 1)
    if (!parts.length) parts.push({ kind: "text", text: "", start: "label" })
    return { label: opt ? opt[1] : null, parts }
  })
  return { kind: "list", env, items, inPar, blank, ...(env === "abstract" ? { source: inner } : {}), ...(opts ? { options: opts[1] } : {}), ...(thm ? { thm } : {}), ...(proofTitle !== undefined ? { proofTitle } : {}) }
}

export const HEADINGS = { chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 } as const

/** A displayed formula in a paragraph: \[…\], $$…$$, or an equation, equation* or displaymath environment. */
export interface Display { kind: "bracket" | "dollars" | "equation" | "equation*" | "displaymath" | "align" | "align*" | "gather" | "gather*" | "multline" | "multline*"; src: string }
export const DISPLAY = /(?<!\\)\\\[([^]*?)\\\]|\$\$([^]*?)\$\$|\\begin\{(equation\*?|displaymath|align\*?|gather\*?|multline\*?)\}([^]*?)\\end\{\3\}/
/** A paragraph's text split at its displays: text, display, text, …, text. */
export function displaySegments(text: string): (string | Display)[] {
  const out: (string | Display)[] = []
  const re = new RegExp(DISPLAY.source, "g")
  let at = 0
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    out.push(text.slice(at, m.index))
    out.push(m[1] !== undefined ? { kind: "bracket", src: m[1] } : m[2] !== undefined ? { kind: "dollars", src: m[2] } : { kind: m[3] as Display["kind"], src: m[4] })
    at = m.index + m[0].length
  }
  out.push(text.slice(at))
  return out
}

/** Whether the text before an environment leaves TeX in a paragraph: text right before it, not
 *  only \label commands, which do not start one */
export function inParagraph(before: string): boolean {
  const last = before.split(/\n[ \t]*\n/).pop()!
  // (nor a \par, perhaps at the end of a group: {\large … \par})
  return /\S[ \t]*\n?[ \t]*$/.test(before) && !/\n[ \t]*\n[ \t]*$/.test(before) && before.trim() !== "" && !/^(?:\s*\\label\{[^{}]*\})+\s*$/.test(last) && !/\\par(?![A-Za-z])[\s}]*$/.test(before)
}

/** The commands a paragraph lays out (paragraph.ts), less \the<counter> and the text symbols */
const TEXT_COMMANDS = [
  "footnote", "noindent", "textbf", "textmd", "textit", "textsl", "textsc", "textup", "textrm", "textsf",
  "texttt", "textnormal", "emph", "setcounter", "addtocounter", "stepcounter", "refstepcounter", "arabic",
  "roman", "Roman", "alph", "Alph", "value", "label", "ref", "subref", "eqref", "pageref", "autoref", "nameref", "Nameref", "cite", "cref", "Cref", "cpageref", "Cpageref", "crefrange", "Crefrange", "cpagerefrange", "Cpagerefrange", "citep", "citet", "citealt", "citealp", "citeauthor", "citeyear", "citeyearpar",
  "Citep", "Citet", "Citealt", "Citealp", "Citeauthor", "LXlstinline",
  "LXurl", "LXfloat", "LXgraphic", "LXtikz", "LXhref", "LXtabular", "LXminipage", "underline", "textcolor", "color", "LXcolorpushed", "hfill",
  "hfil", "quad", "qquad", "vspace", "hrule", "tiny", "scriptsize", "footnotesize", "small", "normalsize",
  "large", "Large", "LARGE", "huge", "Huge", ...BODY_DECLARATIONS, "centering", "raggedright", "raggedleft", "par", "vfill", "bigskip", "medskip", "smallskip", "null", "u", "v", "H", "r", "c", "k", ...Object.keys(TEXT_LETTERS),
  "selectlanguage", "foreignlanguage", "LXotherlanguage", "LXotherlanguagestar", "LXendotherlanguage", "LXendotherlanguagestar",
  "rule", "hspace", "hrulefill", "dotfill", "enspace", "thinspace", "pagebreak", "nopagebreak", "mbox", "makebox", "fbox", "framebox", "raisebox", "parbox",
]
/** siunitx's commands with their options and arguments, which the paragraph reads (siunitx.ts) */
const SI_USE = new RegExp(`\\\\(?:${Object.keys(SI_COMMANDS).join("|")})(?![A-Za-z])\\s*(?:\\[(?:[^\\]{}]|\\{[^{}]*\\})*\\])?(?:\\s*\\{(?:[^{}]|\\{[^{}]*\\})*\\})*`, "g")
/** \rule and \hspace with their arguments, and the boxes' length arguments (which may name registers: \textwidth, \width) */
const LENGTH_USE = /\\(?:rule\s*(?:\[[^\]{}]*\])?\s*\{[^{}]*\}\s*\{[^{}]*\}|hspace\s*\*?\s*\{[^{}]*\}|(?:makebox|framebox)(?=\s*\[)|raisebox\s*\{[^{}]*\}|parbox(?:\s*\[[^\]{}]*\])*\s*\{[^{}]*\})(?:\s*\[[^\]{}]*\])*/g
/** A command in text that is none of them (not an assignment like \parindent=…) */
const UNKNOWN_COMMAND = new RegExp(`\\\\(?!(?:${[...TEXT_COMMANDS, ...Object.keys(TEXT_SYMBOLS)].join("|")}|the[a-zA-Z]+)\\b)[a-zA-Z]+(?!\\s*=)`)

/** how many groups the text leaves open (\{ and \} do not count) */
function braceDepth(t: string): number {
  let d = 0
  for (let i = 0; i < t.length; i++) { if (t[i] === "\\") i++; else if (t[i] === "{") d++; else if (t[i] === "}") d-- }
  return d
}

/** The body as paragraphs, lists and headings. A paragraph that runs into a list ends there (\@trivlist's \par). */
export function blocksOf(body: string): Block[] {
  // babel's otherlanguage and otherlanguage* (the end goes back to the language before: the paragraph knows it)
  body = body.replace(/\\begin\{otherlanguage(\*?)\}\s*\{([A-Za-z]+)\}/g, (_, star: string, lang: string) => `\\LXotherlanguage${star ? "star" : ""}{${lang}}`)
    .replace(/\\end\{otherlanguage(\*?)\}/g, (_, star: string) => `\\LXendotherlanguage${star ? "star" : ""}{}`)
  // comments: % takes the rest of the line and its end, and the next line's leading spaces go (TeX's state N);
  // a blank line after it stays one
  body = body.replace(/(^|[^\\])%[^\n]*\n[ \t]*(?=[^\s])/g, "$1").replace(/(^|[^\\])%.*$/gm, "$1")
  const out: Block[] = []
  const inline: Extract<Block, { kind: "float" }>[] = [] // the floats in paragraphs
  const re = /\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\b(\*?)\s*|\\begin\{(itemize|enumerate|description|quote|quotation|verse|center|flushleft|flushright|abstract|LXtheorem|proof)\}()|\\(maketitle)\b\s*|\\begin\{(figure|table|algorithm)\}\s*(?:\[([^\]]*)\])?([^]*?)\\end\{\6\}|\\(tableofcontents)\b\s*|\\(front|main|back)matter\b\s*|\\begin\{thebibliography\}\s*\{([^{}]*)\}|\\begin\{letter\}\s*\{((?:[^{}]|\{[^{}]*\})*)\}|\\lstplaceholder\{(\d+)\}|\\begin\{titlepage\}([^]*?)\\end\{titlepage\}|\\(newpage|clearpage|cleardoublepage)(?![A-Za-z])\s*|\\(no)?pagebreak(?![A-Za-z])\s*(?:\[([^\]]*)\])?\s*|\\(thispagestyle|pagenumbering)\s*\{([^{}]*)\}\s*|\\listof(figures|tables)(?![A-Za-z])\s*|\\(appendix)(?![A-Za-z])\s*/g
  let at = 0, endpe = false, thmEnd = false
  const text = (s: string) => {
    // blank lines separate paragraphs; text right after a list (no blank line) is not indented (\@doendpe)
    const parts = s.split(/\n[ \t]*\n/)
    parts.forEach((p, i) => {
      const t = squeeze(i < parts.length - 1 ? p + " " : p) // the line end before a blank line is a space
      if (t) out.push({ kind: "par", text: t, noindent: i === 0 && endpe, ...(i === 0 && thmEnd ? { afterThm: true } : {}), ...(/\\LXfloat\{/.test(t) ? { floats: inline } : {}) })
    })
    thmEnd = false
  }
  for (let m: RegExpExecArray | null; (m = re.exec(body)); ) {
    const before = body.slice(at, m.index)
    // \pagebreak and \nopagebreak in a paragraph stay in its text (a \vadjust there); \newpage ends it (\par)
    // (counter commands start no paragraph)
    const pageInPar = !!(m[15] || m[18] || /^\\(?:no)?pagebreak/.test(m[0])) && inParagraph(before.replace(COUNTER_COMMANDS, ""))
    if (/^\\(?:no)?pagebreak/.test(m[0]) && pageInPar) continue
    if ((m[15] || m[18]) && braceDepth(before) !== 0) throw new Unsupported(`\\${m[15] ?? m[18]} in a group`)
    if (m[18] && pageInPar) throw new Unsupported(`\\${m[18]} in a paragraph`)
    // (float.sty's [H] ends the paragraph: \float@endH's \vskip)
    if (m[6] && m[7] !== "H" && inParagraph(before)) { // the paragraph goes on: the float stands in it (its \vadjust), as \LXfloat{n}
      const ph = `\\LXfloat{${inline.length}}`
      inline.push({ kind: "float", env: m[6] as "figure" | "table" | "algorithm", fps: m[7] ?? null, body: m[8], inPar: true, blank: false })
      body = body.slice(0, m.index) + ph + body.slice(re.lastIndex)
      re.lastIndex = m.index + ph.length
      continue
    }
    text(before)
    if (m[5]) { out.push({ kind: "maketitle" }); at = re.lastIndex; endpe = false; continue }
    if (m[14] !== undefined) { out.push({ kind: "titlepage", body: m[14] }); at = re.lastIndex; endpe = false; continue }
    if (m[15]) { out.push({ kind: "newpage", cmd: m[15] as "newpage" }); at = re.lastIndex; endpe = false; continue }
    if (m[18]) { out.push({ kind: "pagestyle", cmd: m[18] as "thispagestyle", style: m[19].trim() }); at = re.lastIndex; continue }
    if (/^\\(?:no)?pagebreak/.test(m[0])) {
      const n = m[17] === undefined ? 4 : /^\s*[0-4]\s*$/.test(m[17]) ? Number(m[17]) : NaN
      if (Number.isNaN(n)) throw new Unsupported(`${m[0].trim()}`)
      out.push({ kind: "pagebreak", no: m[16] !== undefined, n }); at = re.lastIndex; continue
    }
    if (m[13] !== undefined) { out.push({ kind: "listing", n: Number(m[13]) }); at = re.lastIndex; endpe = true; continue } // \lst@doendpe
    if (m[9]) { out.push({ kind: "toc" }); at = re.lastIndex; endpe = false; continue }
    if (m[21]) { out.push({ kind: "appendix" }); at = re.lastIndex; endpe = false; continue }
    if (m[20]) { out.push({ kind: "lof", file: m[20] === "figures" ? "lof" : "lot" }); at = re.lastIndex; endpe = false; continue }
    if (m[10]) { out.push({ kind: "matter", which: m[10] as "front" | "main" | "back" }); at = re.lastIndex; endpe = false; continue }
    if (m[12] !== undefined) { // a letter: \opening{…} first, \closing{…} last
      const end = body.indexOf("\\end{letter}", re.lastIndex)
      if (end < 0) throw new Unsupported("\\begin{letter} without its \\end")
      const inner = body.slice(re.lastIndex, end)
      const op = inner.match(/^\s*\\opening\s*\{((?:[^{}]|\{[^{}]*\})*)\}/)
      const cl = inner.match(/\\closing\s*\{((?:[^{}]|\{[^{}]*\})*)\}(\s*)$/)
      if (!op || !cl) throw new Unsupported("a letter without \\opening first and \\closing last")
      out.push({ kind: "letter", to: m[12], opening: op[1], blocks: blocksOf(inner.slice(op[0].length, cl.index)), closing: cl[1], pars: (cl[2].match(/\n[ \t]*\n/g) ?? []).length })
      re.lastIndex = at = end + "\\end{letter}".length
      endpe = false
      continue
    }
    if (m[11] !== undefined) {
      // \bibitem{key} is \item[\@biblabel{n}] after \refstepcounter{enumiv} (and an immediate \bibcite)
      const end = body.indexOf("\\end{thebibliography}", re.lastIndex)
      if (end < 0) throw new Unsupported("\\begin{thebibliography} without its \\end")
      const inner = body.slice(re.lastIndex, end)
      if (/\\bibitem\s*\[/.test(inner)) throw new Unsupported("\\bibitem[label]")
      const bib = parseList("thebibliography", inner.replace(/\\bibitem\s*\{[^{}]*\}/g, "\\item "), false, true)
      bib.widest = m[11]
      bib.keys = [...inner.matchAll(/\\bibitem\s*\{([^{}]*)\}/g)].map((x) => x[1].trim())
      out.push({ kind: "bib", keys: bib.keys }, bib)
      re.lastIndex = at = end + "\\end{thebibliography}".length
      endpe = true
      continue
    }
    if (m[6]) {
      const inPar = inParagraph(before)
      out.push({ kind: "float", env: m[6] as "figure" | "table" | "algorithm", fps: m[7] ?? null, body: m[8], inPar, blank: /\n[ \t]*\n\s*$/.test(before) })
      at = re.lastIndex; endpe = false; continue
    }
    if (m[1]) { // a heading: its argument in braces
      if (body[re.lastIndex] !== "{") throw new Unsupported(`\\${m[1]} without a {title}${body[re.lastIndex] === "[" ? " (or with a short title)" : ""}`)
      let depth = 0, j = re.lastIndex
      for (; j < body.length; j++) { if (body[j] === "{") depth++; else if (body[j] === "}" && --depth === 0) break }
      const title = body.slice(re.lastIndex + 1, j).replace(/\s+/g, " ").trim()
      // (counter commands between the blank line and the heading start no paragraph)
      const blank = /\n[ \t]*\n\s*$/.test(before.replace(/(?:\\(?:setcounter|addtocounter|stepcounter|refstepcounter)\s*\{[^{}]*\}(?:\s*\{[^{}]*\})?\s*)+$/, ""))
      out.push({ kind: "heading", level: HEADINGS[m[1] as keyof typeof HEADINGS], star: m[2] === "*", title, ...(blank ? { blank: true } : {}) })
      re.lastIndex = j + 1
      at = j + 1
      endpe = false
      continue
    }
    const inPar = m[3] !== "proof" && inParagraph(before) // (amsthm's \proof starts with \par: its \trivlist always gets \partopsep)
    const end = listEnd(body, re.lastIndex, m[3])
    const prev = out[out.length - 1]
    if (inPar && prev?.kind === "par") prev.unskip = 1
    out.push(parseList(m[3] as EnvName, body.slice(re.lastIndex, end.at), inPar, /\n[ \t]*\n\s*$/.test(before)))
    re.lastIndex = end.next
    at = end.next
    endpe = m[3] !== "LXtheorem" && m[3] !== "proof" // (amsthm's ends say \@endpefalse)
    thmEnd = !endpe
  }
  text(body.slice(at))
  // text, inline math and footnotes only; other commands are not laid out yet
  const check = (t: string) => { const m = t.replace(/\\[#%&$]/g, "").replace(SI_USE, "").replace(LENGTH_USE, "").replace(/\$[^$]*\$/g, "").match(UNKNOWN_COMMAND); if (m) throw new Unsupported(`${m[0]} in "${t.slice(0, 40)}"`)
    if (/(?<!\{)\\color\b/.test(t)) throw new Unsupported(`\\color outside a group in "${t.slice(0, 40)}"`)
    if (/\\(?:label|ref|pageref|Nameref)\b(?!\{[A-Za-z0-9:._-]+\})|\\(?:autoref|nameref)\b(?!\*?\{[A-Za-z0-9:._-]+\})/.test(t)) throw new Unsupported(`a \\label or \\ref key in "${t.slice(0, 40)}"`)
    if (/\\footnote\{(?:[^{}]|\{[^{}]*\})*\\label\b/.test(t)) throw new Unsupported("\\label in a footnote")
  }
  for (const b of out) {
    if (b.kind === "par") displaySegments(b.text).filter((_, i) => i % 2 === 0).forEach((t) => check(t as string))
    else if (b.kind === "list") {
      const walk = (l: ListBlock): void => l.items.forEach((it) => it.parts.forEach((p) => {
        if (p.kind === "list") return walk(p)
        if (/^\s*\\label\b/.test(p.text) && !(l.env === "LXtheorem" && p === l.items[0].parts[0])) throw new Unsupported(`\\label in vertical mode in ${l.env}`)
        displaySegments(p.text).filter((_, i) => i % 2 === 0).forEach((t) => check(t as string))
      }))
      walk(b)
    }
    else if (b.kind === "maketitle" || b.kind === "titlepage" || b.kind === "float" || b.kind === "toc" || b.kind === "lof" || b.kind === "appendix" || b.kind === "matter" || b.kind === "bib" || b.kind === "letter" || b.kind === "listing" || b.kind === "newpage" || b.kind === "pagebreak" || b.kind === "pagestyle") continue
    else if (/[\\{}%&#^_~]/.test(withoutTextCommands(b.title).replace(/\$[^$\\]*\$/g, "").replace(/\\[#%&]|\\the[a-zA-Z]+\b|\\(?:arabic|roman|Roman|alph|Alph)\s*\{[a-zA-Z]+\}/g, ""))) throw new Unsupported(`heading "${b.title}"`)
  }
  return out
}
