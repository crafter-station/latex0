// The document source before it is read into blocks: verbatim material
// (listings, \lstinline) taken out first, the document's own macros expanded,
// then tabulars and minipages taken out, each replaced by a placeholder
// (\lstplaceholder{n}, \LXlstinline{n}, \LXurl{n}, \LXhref{n}, \LXtabular{n}, \LXminipage{n}) that the
// layout replaces with the laid-out material where it stands.

import { expandDocument } from "../expand/document"
import { ARTICLE, CLASSES, PACKAGES } from "../expand/defined"
import { isKnownCommand } from "../parser"
import { Unsupported } from "./unsupported"
import { SECTIONAL } from "./counters"
import { spanishText } from "./spanish"

/** an lstlisting environment's [options] and lines */
export interface Listing { options: string; lines: string[]; inline?: true }
/** a tabular environment as typed (taken out of the source after expansion: \LXtabular{n}) */
export interface TabularSource { pos: "t" | "b" | "c"; spec: string; body: string
  /** tabular*'s width (the \\halign to it), tabularx's */
  width?: string
  /** a tabularx */
  x?: true
  /** colortbl's \rowcolors{start}{odd}{even} in force (k: which one, its \rownum reset where it stands) */
  rowcolors?: { k: number; start: number; odd: string; even: string } }
/** a longtable environment as typed (taken out of the source after expansion: \LXlongtable{n}, a block of its own) */
export interface LongtableSource { pos: "l" | "c" | "r" | null; spec: string; body: string }
/** a minipage environment as typed (taken out of the source after expansion: \LXminipage{n}) */
export interface MinipageSource {
  /** (null: subcaption's subfigure or subtable with no position, b before the float's \caption and t after it) */
  pos: "t" | "b" | "c" | null; height: string | null; width: string; body: string
  /** the inner position (with a height): t, b, c or s; the position when not given */
  inner?: "t" | "b" | "c" | "s"
  /** subcaption's subfigure or subtable: a minipage whose \caption is a subcaption */
  sub?: "figure" | "table"
}
/** commands that take no argument: a { after one opens a group */
export const NO_ARGUMENT = new Set(["item", "par", "noindent", "nocorr", "indent", "centering", "raggedright", "raggedleft", "hfill", "hfil", "quad", "qquad", "enspace", "thinspace", "hrulefill", "dotfill", "smallskip", "medskip", "bigskip", "newline", "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge", "bfseries", "mdseries", "itshape", "slshape", "scshape", "upshape", "rmfamily", "sffamily", "ttfamily", "em", "normalfont"])

/** \( and \): LaTeX's robust \relax\ifmmode…\else$\fi, the same formula as $ (outside comments and \\) */
export function inlineMathParens(src: string): string {
  let out = ""
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === "%") { const j = src.indexOf("\n", i); out += j < 0 ? src.slice(i) : src.slice(i, j); i = j < 0 ? src.length : j - 1; continue }
    if (c !== "\\") { out += c; continue }
    const n = src[i + 1]
    if (n === "(" || n === ")") { out += "$"; i++; continue }
    out += c + (n ?? ""); i++
  }
  return out
}

/** a verbatim environment as typed: its lines (the last one what comes before \end{verbatim} on its line, the others
 *  without the spaces TeX drops at the end of a line), or \verb's text (\verb* and verbatim*: visible spaces) */
export interface VerbatimSource { star: boolean; lines: string[]; inline?: true }

/** a URL as typed (verbatim), and whether it is a link (\url and \href with hyperref; not \nolinkurl) */
export interface UrlSource { address: string; link: boolean }

/** \includegraphics[options]{file} as typed */
export interface GraphicSource { options: string; file: string }

export interface DocumentSource { src: string; listings: Listing[]; /** verbatim environments and \verb, by number (\LXverbatim{n}, \LXverb{n}) */ verbatims: VerbatimSource[]; tabulars: TabularSource[]; longtables: LongtableSource[]; minipages: MinipageSource[]; /** \url, \nolinkurl and \href addresses */ urls: UrlSource[]
  /** \includegraphics, by number (\LXgraphic{n}) */
  graphics: GraphicSource[]
  /** TikZ's pictures as typed (tikzpicture environments, \tikz), by number (\LXtikz{n}) */
  tikz: string[]
  /** the files a filecontents* environment before \documentclass writes: name → contents */
  files: Map<string, string> }

export function prepareSource(source: string): DocumentSource {
  // filecontents* environments before \documentclass: the files they write (the graphics' bounding boxes)
  const files = new Map<string, string>()
  const head = Math.max(0, source.indexOf("\\documentclass"))
  source = source.slice(0, head).replace(/\\begin\{filecontents\*\}(?:\[[^\]]*\])?\{([^{}]+)\}\n([^]*?)\\end\{filecontents\*\}[ \t]*\n?/g, (_, name: string, body: string) => {
    files.set(name.trim(), body)
    return ""
  }) + source.slice(head)
  if (/\\begin\{filecontents/.test(source)) throw new Unsupported("a filecontents environment not read")
  // the document's own macros expanded first, as the renderer does (expand:doc checks this keeps TeX's output)
  // listings' environments are read verbatim: each becomes \lstplaceholder{n}
  const listings: Listing[] = []
  source = source.replace(/^([^%\n]*?)\\begin\{lstlisting\}(?:\[((?:[^\]{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\])?([^\n]*)\n([^]*?)^[ \t]*\\end\{lstlisting\}/gm, (_, before: string, options: string | undefined, rest: string, body: string) => {
    if (rest.trim()) throw new Unsupported("text after \\begin{lstlisting} on its line")
    listings.push({ options: options ?? "", lines: body.split("\n").map((l) => l.replace(/ +$/, "")) }) // the last: what comes before \end; TeX drops the spaces that end a line
    return `${before}\\lstplaceholder{${listings.length - 1}}`
  })
  const uncommented = () => source.replace(/(^|[^\\])%.*$/gm, "$1")
  if (/\\(begin|end)\{lstlisting\}/.test(uncommented())) throw new Unsupported("an lstlisting environment not on lines of its own")
  // \lstinline[options]{code} or \lstinline[options]<c>code<c>, read verbatim: \LXlstinline{n} (n after the listings)
  // Inside a command's argument (\emph{…}, \footnote{…}) TeX has already made tokens of it: spaces in a row are one
  const inArgument = (at: number) => {
    const stack: boolean[] = []
    for (let i = 0; i < at; i++) {
      const c = source[i]
      if (c === "\\") { i++; continue }
      if (c === "%") { while (i < at && source[i] !== "\n") i++; continue }
      // (an argument after a command and its earlier arguments: \textcolor{c}{…})
      // (not \lstinline's own argument; no space after an earlier argument)
      // (not after a command that takes no argument, \item or \small, or after \color's one: a group)
      if (c === "{") {
        const m = source.slice(Math.max(0, i - 200), i).match(/\\(?!lstinline(?![A-Za-z]))([A-Za-z]+)\*?\s*((?:\[[^\]]*\]|\{[^{}]*\})*)$/)
        stack.push(!!m && !NO_ARGUMENT.has(m[1]) && !(m[1] === "color" && /\}$/.test(m[2])))
      }
      else if (c === "}") stack.pop()
    }
    return stack.includes(true)
  }
  source = source.replace(/\\lstinline(?![A-Za-z])(?:\[((?:[^\]{}]|\{[^{}]*\})*)\])?(?:\{([^{}\n]*)\}|([^A-Za-z\s{\[])([^\n]*?)\3)/g, (_, options: string | undefined, braced: string | undefined, _d: string, delimited: string | undefined, offset: number) => {
    // (a braced argument is read verbatim too, up to the first })
    let code = braced ?? delimited ?? ""
    if (inArgument(offset)) {
      if (/[\\{}#%]/.test(code)) throw new Unsupported(`\\lstinline in an argument: ${code}`)
      code = code.replace(/ +/g, " ")
    }
    listings.push({ options: options ?? "", lines: [code], inline: true })
    return `\\LXlstinline{${listings.length - 1}}`
  })
  if (/\\lstinline(?![A-Za-z])/.test(uncommented())) throw new Unsupported("an \\lstinline not read")
  const commentedAt = (text: string, at: number) => /(^|[^\\])%/.test(text.slice(text.lastIndexOf("\n", at) + 1, at))
  // verbatim environments and \verb, read verbatim: \LXverbatim{n} and \LXverb{n}
  const verbatims: VerbatimSource[] = []
  source = source.replace(/^([^%\n]*?)\\begin\{(verbatim\*?)\}([^\n]*)\n([^]*?)\\end\{\2\}/gm, (_, before: string, env: string, rest: string, body: string) => {
    if (rest) throw new Unsupported(`text after \\begin{${env}} on its line`)
    const lines = body.split("\n")
    verbatims.push({ star: env.endsWith("*"), lines: lines.map((l, i) => (i < lines.length - 1 ? l.replace(/ +$/, "") : l)) })
    return `${before}\\LXverbatim{${verbatims.length - 1}}`
  })
  if (/\\(begin|end)\{verbatim\*?\}/.test(uncommented())) throw new Unsupported("a verbatim environment not read")
  // (\verb's delimiter right after it: \@sverb skips spaces; in an argument TeX has made tokens of it already)
  {
    let out = "", at = 0
    const re = /\\verb(?![A-Za-z])(\*?)([^A-Za-z\s*])/g
    for (let m = re.exec(source); m; m = re.exec(source)) {
      if (m.index < at || source[m.index - 1] === "\\" || commentedAt(source, m.index)) continue
      const from = m.index + m[0].length, end = source.indexOf(m[2], from)
      if (end < 0 || source.slice(from, end).includes("\n")) throw new Unsupported("\\verb ended by the end of the line")
      if (inArgument(m.index)) throw new Unsupported("\\verb in an argument")
      verbatims.push({ star: !!m[1], lines: [source.slice(from, end)], inline: true })
      out += source.slice(at, m.index) + `\\LXverb{${verbatims.length - 1}}`
      at = end + 1
      re.lastIndex = at
    }
    source = out + source.slice(at)
  }
  if (/\\verb(?![A-Za-z])/.test(uncommented())) throw new Unsupported("a \\verb not read")
  // \includegraphics[options]{file}: \LXgraphic{n}, laid out where it stands
  const graphics: GraphicSource[] = []
  source = source.replace(/\\includegraphics(?![A-Za-z])\s*(?:\[((?:[^\]{}]|\{[^{}]*\})*)\])?\s*\{([^{}\n]*)\}/g, (all: string, options: string | undefined, file: string, offset: number, text: string) => {
    if (/(^|[^\\])%/.test(text.slice(text.lastIndexOf("\n", offset) + 1, offset))) return all
    graphics.push({ options: options ?? "", file: file.trim() })
    return `\\LXgraphic{${graphics.length - 1}}`
  })
  if (/\\includegraphics(?![A-Za-z])/.test(uncommented())) throw new Unsupported("an \\includegraphics not read")
  // TikZ's pictures: \LXtikz{n}, laid out where they stand (the picture's source read by tikz/path.ts)
  const tikz: string[] = []
  source = takeTikz(source, tikz)
  // \url{address} or \url<c>address<c> (and hyperref's \nolinkurl), read verbatim with url.sty's catcodes:
  // \LXurl{n}; \href{address}{text}'s address likewise: \LXhref{n}{text}
  const urls: UrlSource[] = []
  // (in an argument, TeX has made tokens of it already: spaces, %, # and \ are no longer what url.sty reads)
  const verbatim = (address: string, at: number) => { if (inArgument(at) && /[\\{}#%~ ]/.test(address)) throw new Unsupported(`a URL in an argument: ${address}`) }
  source = source.replace(/\\(url|nolinkurl)(?![A-Za-z])\s*(?:\{([^{}\n]*)\}|([^A-Za-z\s{])([^\n]*?)\3)/g, (all: string, cmd: string, braced: string | undefined, _d: string, delimited: string | undefined, offset: number, text: string) => {
    if (commentedAt(text, offset)) return all
    const address = braced ?? delimited ?? ""
    verbatim(address, offset)
    urls.push({ address, link: cmd === "url" })
    return `\\LXurl{${urls.length - 1}}`
  })
  source = source.replace(/\\href(?![A-Za-z])\s*\{([^{}\n]*)\}/g, (all: string, address: string, offset: number, text: string) => {
    if (commentedAt(text, offset)) return all
    verbatim(address, offset)
    urls.push({ address, link: true })
    return `\\LXhref{${urls.length - 1}}`
  })
  if (/\\(?:url|nolinkurl|href)(?![A-Za-z])/.test(uncommented())) throw new Unsupported("a URL not read")
  source = inlineMathParens(source)
  // fancyhdr's \headrulewidth and \footrulewidth are macros its rules read: \renewcommand'd, \LXfancyrule{name}{width}
  source = source.replace(/\\renewcommand\s*(?:\{\\(headrulewidth|footrulewidth)\}|\\(headrulewidth|footrulewidth)(?![A-Za-z]))\s*\{([^{}]*)\}/g, (all: string, a: string | undefined, b: string | undefined, width: string, offset: number, text: string) =>
    commentedAt(text, offset) ? all : `\\LXfancyrule{${a ?? b}}{${width}}`)
  // tabularx's \tabularxcolumn, \renewcommand'd: \LXtabularxcolumn{spec}
  source = source.replace(/\\renewcommand\*?\s*(?:\{\\tabularxcolumn\}|\\tabularxcolumn(?![A-Za-z]))\s*\[1\]\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g, (all: string, spec: string, offset: number, text: string) =>
    commentedAt(text, offset) ? all : `\\LXtabularxcolumn{${spec}}`)
  source = counterFormats(source)
  const expanded = expandDocument(source, { known: isKnownCommand, defined: latexCommands(source), xspace: packagesOf(source).includes("xspace") })
  if (expanded.errors.length) throw new Unsupported(`macro expansion: ${expanded.errors[0]}`)
  // tabulars: \LXtabular{n}, laid out where they stand (paragraphs, floats)
  const tabulars: TabularSource[] = []
  const commented = (t: string, at: number) => /(^|[^\\])%/.test(t.slice(t.lastIndexOf("\n", at) + 1, at))
  // (tabular* first: its {width} before [pos]{cols})
  const take = (t: string, env: "tabular" | "tabular\\*" | "tabularx") => t.replace(new RegExp(`\\\\begin\\{${env}\\}${env === "tabular" ? "" : "\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}"}\\s*(?:\\[([tbc])\\])?\\s*\\{((?:[^{}]|\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\})*)\\}([^]*?)\\\\end\\{${env}\\}`, "g"), (all: string, ...m: unknown[]) => {
    const [width, pos, spec, body, offset, text] = (env === "tabular" ? [undefined, ...m] : m) as [string | undefined, string | undefined, string, string, number, string]
    if (commented(text, offset)) return all
    if (/\\begin\{tabular[*x]?\}|\\LXtabular\{/.test(body)) throw new Unsupported("a tabular in a tabular")
    tabulars.push({ pos: (pos ?? "c") as "c", spec, body, ...(width !== undefined ? { width } : {}), ...(env === "tabularx" ? { x: true as const } : {}) })
    return `\\LXtabular{${tabulars.length - 1}}`
  })
  const src0 = take(take(take(expanded.text, "tabularx"), "tabular\\*"), "tabular")
  if ([...src0.matchAll(/\\(?:begin|end)\{tabular[*x]?\}/g)].some((m) => !commented(src0, m.index!))) throw new Unsupported("a tabular not read")
  // longtables: \LXlongtable{n}, blocks of their own
  const longtables: LongtableSource[] = []
  let src1 = src0.replace(/\\begin\{longtable\}\s*(?:\[([lcr])\])?\s*\{((?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*)\}([^]*?)\\end\{longtable\}/g, (all: string, pos: string | undefined, spec: string, body: string, offset: number, text: string) => {
    if (commented(text, offset)) return all
    longtables.push({ pos: (pos ?? null) as LongtableSource["pos"], spec, body })
    return `\\LXlongtable{${longtables.length - 1}}`
  })
  if ([...src1.matchAll(/\\(?:begin|end)\{longtable\}/g)].some((m) => !commented(src1, m.index!))) throw new Unsupported("a longtable not read")
  rowcolors(src1, tabulars)
  src1 = src1.replace(/\\rowcolors\s*\{\s*\d+\s*\}\s*\{[^{}]*\}\s*\{[^{}]*\}[ \t]*(?:\n(?![ \t]*\n)[ \t]*)?/g, "") // (then \ignorespaces)
  if (/\\rowcolors(?![A-Za-z])/.test(src1.replace(/(^|[^\\])%.*$/gm, "$1"))) throw new Unsupported("\\rowcolors here")
  // minipages: \LXminipage{n}, laid out where they stand
  const minipages: MinipageSource[] = []
  // (and subcaption's subfigure and subtable, minipages too)
  const src = src1.replace(/\\begin\{(minipage|subfigure|subtable)\}\s*(?:\[([tbc])\])?\s*(?:\[([^\]]*)\]\s*(?:\[([tbcs])\])?)?\s*\{((?:[^{}]|\{[^{}]*\})*)\}([^]*?)\\end\{\1\}/g, (all: string, env: string, pos: string | undefined, height: string | undefined, inner: string | undefined, width: string, body: string, offset: number, text: string) => {
    if (commented(text, offset)) return all
    if (/\\begin\{(?:minipage|subfigure|subtable)\}/.test(body)) throw new Unsupported(`a minipage in a ${env}`)
    const sub = env === "minipage" ? undefined : env === "subfigure" ? "figure" : "table"
    minipages.push({ pos: (pos ?? (sub ? null : "c")) as MinipageSource["pos"], height: height ?? null, width, body, ...(inner ? { inner: inner as "s" } : {}), ...(sub ? { sub } : {}) })
    return `\\LXminipage{${minipages.length - 1}}`
  })
  if ([...src.matchAll(/\\(?:begin|end)\{(?:minipage|subfigure|subtable)\}/g)].some((m) => !commented(src, m.index!))) throw new Unsupported("a minipage not read")
  return { src, listings, verbatims, tabulars, longtables, minipages, urls, graphics, tikz, files }
}

/**
 * colortbl's \rowcolors{start}{odd}{even}: \CT@everycr's \@rowc@lors, local to the group or environment it stands in,
 * for the tabulars after it there (\rowcolors* and its [commands] are not laid out yet)
 */
function rowcolors(src: string, tabulars: TabularSource[]) {
  let k = 0
  for (const m of src.matchAll(/\\rowcolors(\*?)\s*(\[[^\]]*\])?\s*\{\s*(\d+)\s*\}\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g)) {
    if (/(^|[^\\])%/.test(src.slice(src.lastIndexOf("\n", m.index!) + 1, m.index!))) continue
    if (m[1] || m[2]) throw new Unsupported(m[0])
    const rc = { k: k++, start: Number(m[3]), odd: m[4].trim(), even: m[5].trim() }
    let depth = 0
    for (const t of src.slice(m.index! + m[0].length).matchAll(/\\begin\{[^{}]*\}|\\end\{[^{}]*\}|\\LXtabular\{(\d+)\}|\\LXlongtable\{|\\[{}%]|\\.|[{}]|%[^\n]*/g)) {
      if (t[0] === "{" || t[0].startsWith("\\begin{")) depth++
      else if (t[0] === "}" || t[0].startsWith("\\end{")) { if (--depth < 0) break }
      else if (t[1] !== undefined) tabulars[Number(t[1])].rowcolors = rc
      else if (t[0] === "\\LXlongtable{") throw new Unsupported("\\rowcolors before a longtable")
    }
  }
}

const words = (s: string | undefined) => (s ? s.split(" ") : [])
/** the preamble, without its comments */
const preambleOf = (source: string) => source.slice(0, Math.max(0, source.indexOf("\\begin{document}"))).replace(/(^|[^\\])%.*$/gm, "$1")
/** the packages the preamble loads */
const packagesOf = (source: string) => [...preambleOf(source).matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)].flatMap((m) => m[1].split(",").map((p) => p.trim()))
const ARTICLE_NAMES = new Set(words(ARTICLE))

/**
 * The commands LaTeX defines for the document, which its own definitions cannot change here (expand/defined.ts):
 * article's, its class's, its packages' (a class or package not there is not read by the engine: the preamble says
 * so), and the \the<c> of its counters (\newcounter{c}, \newtheorem{c}), which the engine reads (\ref)
 */
function latexCommands(source: string): (name: string) => boolean {
  const own = new Set<string>()
  const cls = preambleOf(source).match(/\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/)?.[1].trim()
  if (cls && cls !== "article") for (const n of words(CLASSES[cls])) own.add(n)
  for (const p of packagesOf(source)) for (const n of words(PACKAGES[p])) own.add(n)
  for (const m of source.matchAll(/\\(?:newcounter|newtheorem)\s*\{([A-Za-z]+)\}/g)) own.add(`the${m[1]}`)
  return (name) => ARTICLE_NAMES.has(name) || own.has(name)
}

/**
 * The preamble's \renewcommand (or \def) of a \the<counter> the engine keeps (the sectioning counters, equation, figure,
 * table, the document's \newcounter and \newtheorem ones): \LXthe{counter}{body}, which preamble.ts reads and the
 * counters evaluate where LaTeX expands it (counters.ts)
 */
function counterFormats(source: string): string {
  const begin = source.indexOf("\\begin{document}")
  if (begin < 0) return source
  const counters = new Set<string>([...SECTIONAL, "equation", "figure", "table"])
  for (const m of preambleOf(source).matchAll(/\\(?:newcounter|newtheorem)\s*\{([A-Za-z]+)\}/g)) counters.add(m[1])
  return source.slice(0, begin).replace(/\\(?:renewcommand\*?\s*(?:\{\\the([A-Za-z]+)\}|\\the([A-Za-z]+)(?![A-Za-z]))|def\s*\\the([A-Za-z]+)(?![A-Za-z]))\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g, (all: string, a: string | undefined, b: string | undefined, c: string | undefined, body: string) => {
    const name = a ?? b ?? c!
    return counters.has(name) ? `\\LXthe{${name}}{${body}}` : all // (a % before it still makes it a comment)
  }) + source.slice(begin)
}

/** the end of the group opened at `i` in `s` (\{ and \} escaped), or -1 */
function groupEndAt(s: string, i: number): number {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue }
    if (s[j] === "{") depth++
    else if (s[j] === "}" && --depth === 0) return j
  }
  return -1
}

/**
 * tikzpicture environments and \tikz (`\tikz[options]{…}`, or `\tikz[options]` and one path command up to its
 * `;`) outside comments, each replaced by \LXtikz{n}
 */
function takeTikz(source: string, out: string[]): string {
  let result = ""
  let i = 0
  const re = /\\begin\{tikzpicture\}|\\tikz(?![A-Za-z])|%/g
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (m.index < i) continue
    if (m.index > 0 && source[m.index - 1] === "\\") continue
    if (m[0] === "%") { const e = source.indexOf("\n", m.index); re.lastIndex = e < 0 ? source.length : e; continue }
    let end: number
    if (m[0] === "\\begin{tikzpicture}") {
      const e = source.indexOf("\\end{tikzpicture}", m.index)
      if (e < 0) throw new Unsupported("a tikzpicture without its end")
      end = e + "\\end{tikzpicture}".length
    } else {
      let j = m.index + 5
      while (/\s/.test(source[j] ?? "")) j++
      if (source[j] === "[") {
        const c = source.indexOf("]", j)
        if (c < 0) throw new Unsupported("\\tikz[ without ]")
        j = c + 1
        while (/\s/.test(source[j] ?? "")) j++
      }
      if (source[j] === "{") {
        end = groupEndAt(source, j) + 1
        if (end === 0) throw new Unsupported("\\tikz{ without }")
      } else {
        const semi = source.indexOf(";", j)
        if (semi < 0) throw new Unsupported("\\tikz without ;")
        end = semi + 1
      }
    }
    const pic = source.slice(m.index, end)
    if (/\\begin\{tikzpicture\}/.test(pic.slice(1))) throw new Unsupported("a tikzpicture in a tikzpicture")
    out.push(pic)
    result += source.slice(i, m.index) + `\\LXtikz{${out.length - 1}}`
    i = end
    re.lastIndex = end
  }
  return result + source.slice(i)
}

/** How many groups are open at the end of `src` (braces not escaped). */
export const depthOf = (src: string) => { let d = 0; for (const m of src.matchAll(/\\.|[{}]/g)) d += m[0] === "{" ? 1 : m[0] === "}" ? -1 : 0; return d }

/** a paragraph that a tabular (or a minipage, or spanish.ldf's quoting, <<) starts: it starts in \begin{tabular}'s group
 *  (\leavevmode), where \everypar's assignments stay */
export const tabularStart = (text: string) => /^\s*\\LX(?:tabular|minipage)\{/.test(text) || spanishText.on && /^\s*<\s*</.test(text)
/** a paragraph that starts in a group ({…}, not an empty one): its \everypar runs there */
export const groupStart = (text: string) => /^\s*\{(?!\})/.test(text)
