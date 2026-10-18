// The document source before it is read into blocks: verbatim material
// (listings, \lstinline) taken out first, the document's own macros expanded,
// then tabulars and minipages taken out, each replaced by a placeholder
// (\lstplaceholder{n}, \LXlstinline{n}, \LXurl{n}, \LXhref{n}, \LXtabular{n}, \LXminipage{n}) that the
// layout replaces with the laid-out material where it stands.

import { expandDocument } from "../expand/document"
import { isKnownCommand } from "../parser"
import { Unsupported } from "./unsupported"

/** an lstlisting environment's [options] and lines */
export interface Listing { options: string; lines: string[]; inline?: true }
/** a tabular environment as typed (taken out of the source after expansion: \LXtabular{n}) */
export interface TabularSource { pos: "t" | "b" | "c"; spec: string; body: string }
/** a minipage environment as typed (taken out of the source after expansion: \LXminipage{n}) */
export interface MinipageSource { pos: "t" | "b" | "c"; height: string | null; width: string; body: string }
/** commands that take no argument: a { after one opens a group */
export const NO_ARGUMENT = new Set(["item", "par", "noindent", "indent", "centering", "raggedright", "raggedleft", "hfill", "hfil", "quad", "qquad", "smallskip", "medskip", "bigskip", "newline", "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge", "bfseries", "mdseries", "itshape", "slshape", "scshape", "upshape", "rmfamily", "sffamily", "ttfamily", "em", "normalfont"])

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

/** a URL as typed (verbatim), and whether it is a link (\url and \href with hyperref; not \nolinkurl) */
export interface UrlSource { address: string; link: boolean }

/** \includegraphics[options]{file} as typed */
export interface GraphicSource { options: string; file: string }

export interface DocumentSource { src: string; listings: Listing[]; tabulars: TabularSource[]; minipages: MinipageSource[]; /** \url, \nolinkurl and \href addresses */ urls: UrlSource[]
  /** \includegraphics, by number (\LXgraphic{n}) */
  graphics: GraphicSource[]
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
  // \includegraphics[options]{file}: \LXgraphic{n}, laid out where it stands
  const graphics: GraphicSource[] = []
  source = source.replace(/\\includegraphics(?![A-Za-z])\s*(?:\[((?:[^\]{}]|\{[^{}]*\})*)\])?\s*\{([^{}\n]*)\}/g, (all: string, options: string | undefined, file: string, offset: number, text: string) => {
    if (/(^|[^\\])%/.test(text.slice(text.lastIndexOf("\n", offset) + 1, offset))) return all
    graphics.push({ options: options ?? "", file: file.trim() })
    return `\\LXgraphic{${graphics.length - 1}}`
  })
  if (/\\includegraphics(?![A-Za-z])/.test(uncommented())) throw new Unsupported("an \\includegraphics not read")
  // \url{address} or \url<c>address<c> (and hyperref's \nolinkurl), read verbatim with url.sty's catcodes:
  // \LXurl{n}; \href{address}{text}'s address likewise: \LXhref{n}{text}
  const urls: UrlSource[] = []
  const commentedAt = (text: string, at: number) => /(^|[^\\])%/.test(text.slice(text.lastIndexOf("\n", at) + 1, at))
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
  const expanded = expandDocument(source, { known: isKnownCommand })
  if (expanded.errors.length) throw new Unsupported(`macro expansion: ${expanded.errors[0]}`)
  // tabulars: \LXtabular{n}, laid out where they stand (paragraphs, floats)
  const tabulars: TabularSource[] = []
  const commented = (t: string, at: number) => /(^|[^\\])%/.test(t.slice(t.lastIndexOf("\n", at) + 1, at))
  const src0 = expanded.text.replace(/\\begin\{tabular\}\s*(?:\[([tbc])\])?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}([^]*?)\\end\{tabular\}/g, (all: string, pos: string | undefined, spec: string, body: string, offset: number, text: string) => {
    if (commented(text, offset)) return all
    if (/\\begin\{tabular\}/.test(body)) throw new Unsupported("a tabular in a tabular")
    tabulars.push({ pos: (pos ?? "c") as "c", spec, body })
    return `\\LXtabular{${tabulars.length - 1}}`
  })
  if ([...src0.matchAll(/\\(?:begin|end)\{tabular\*?\}/g)].some((m) => !commented(src0, m.index!))) throw new Unsupported("a tabular not read")
  // minipages: \LXminipage{n}, laid out where they stand
  const minipages: MinipageSource[] = []
  const src = src0.replace(/\\begin\{minipage\}\s*(?:\[([tbc])\])?\s*(?:\[([^\]]*)\]\s*(?:\[([tbcs])\])?)?\s*\{((?:[^{}]|\{[^{}]*\})*)\}([^]*?)\\end\{minipage\}/g, (all: string, pos: string | undefined, height: string | undefined, _inner: string | undefined, width: string, body: string, offset: number, text: string) => {
    if (commented(text, offset)) return all
    if (/\\begin\{minipage\}/.test(body)) throw new Unsupported("a minipage in a minipage")
    minipages.push({ pos: (pos ?? "c") as "c", height: height ?? null, width, body })
    return `\\LXminipage{${minipages.length - 1}}`
  })
  if ([...src.matchAll(/\\(?:begin|end)\{minipage\}/g)].some((m) => !commented(src, m.index!))) throw new Unsupported("a minipage not read")
  return { src, listings, tabulars, minipages, urls, graphics, files }
}

/** How many groups are open at the end of `src` (braces not escaped). */
export const depthOf = (src: string) => { let d = 0; for (const m of src.matchAll(/\\.|[{}]/g)) d += m[0] === "{" ? 1 : m[0] === "}" ? -1 : 0; return d }

/** a paragraph that a tabular (or a minipage) starts: it starts in \begin{tabular}'s group (\leavevmode), where \everypar's assignments stay */
export const tabularStart = (text: string) => /^\s*\\LX(?:tabular|minipage)\{/.test(text)
