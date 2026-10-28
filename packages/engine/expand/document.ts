// Macro expansion for whole documents (#46, #344): the document's own definitions
// (\newcommand and its relatives, \def, \let…, \newenvironment) run through the
// token-level expander, and every use of them is replaced by its expansion.
// Everything else is copied from the source unchanged, so what the renderer reads
// differs from the source only where TeX would have expanded a user macro. A
// definition of a command LaTeX defines is an error here (the engine does not
// read it), and so is a robust command of the document's in a moving argument
// (LaTeX writes it to a file unexpanded).
//
// Verbatim material (verbatim, lstlisting, minted environments and \verb) is
// never tokenized. The text keeps TeX's tokens: after a macro whose last token
// is a control word, the spaces TeX skips are skipped too, and one line end when
// the next line is not blank; a control word is kept apart from a letter or a
// space that comes to follow it, two spaces stay two, a space at a line's start
// stays one, a line a definition leaves empty stays a space ({} in text; in
// math, where {} is a noad and spaces are nothing, % keeps the line from being
// left empty), \par is %, a blank line. The document's environments
// (\begin{name} … \end{name}) are expanded where they stand, their group kept
// only where it would make a difference (environments()). An error (fuel
// exhausted, a bad definition) leaves the rest of the source unexpanded and is
// reported.

import { ExpansionError, Expander } from "./expander"
import { LEFT_BRACE, LETTER, MAC_PARAM, MATH_SHIFT, OTHER_CHAR, RIGHT_BRACE, SPACER, Tokenizer, type Tok } from "./tokens"

export interface DocumentExpansion {
  /** the source with definitions removed and macro uses expanded */
  text: string
  /** what went wrong, if anything: the text after the first error is left as it was */
  errors: string[]
}

export interface DocumentOptions {
  /** commands the renderer knows, so \providecommand leaves them alone */
  known?: (name: string) => boolean
  /** commands LaTeX defines (the kernel, the class, the packages): the document cannot redefine them here */
  defined?: (name: string) => boolean
  /** xspace.sty loaded: \xspace (expander.ts) */
  xspace?: boolean
  fuel?: number
}

/** the commands whose arguments LaTeX writes to a file (\addcontentsline, \markboth …): how many of them, in braces */
const MOVING: Record<string, number> = { part: 1, chapter: 1, section: 1, subsection: 1, subsubsection: 1, paragraph: 1, subparagraph: 1, caption: 1, addcontentsline: 3, markboth: 2, markright: 1 }

/** amsmath's and LaTeX's math environments: math mode in them */
const MATH_ENVIRONMENT = /^(?:equation|align|gather|multline|flalign|alignat|eqnarray|displaymath|math)\*?$/

/** environments whose end sets \@endpe (\@endparenv: lists, trivlists), so that \@doendpe acts after them */
const ENDPE = /^(?:itemize|enumerate|description|list|trivlist|center|flushleft|flushright|quote|quotation|verse|verbatim\*?|thebibliography|abstract)$/
/** environments whose end does not */
const NO_ENDPE = /^(?:equation|align|gather|multline|flalign|alignat|eqnarray|displaymath|math|tabular|tabularx|array|figure|table|minipage|tikzpicture|subfigure|subtable)\*?$|^(?:[pbBvV]?matrix|smallmatrix|cases|split|aligned|gathered|alignedat)$/

/** text that ends with a control word (not \\\\ and letters) */
const CONTROL_WORD_END = /(^|[^\\])(\\\\)*\\[A-Za-z]+$/

/** the name of an environment's marker tokens: MARK<n begins the n-th, MARK>n ends it */
const MARK = "\u0000env"
/** a marker in the output: \u0001n\u0002 where the n-th environment begins, \u0003n\u0002 where it ends */
const marker = (cs: string) => `${cs[MARK.length] === "<" ? "\u0001" : "\u0003"}${cs.slice(MARK.length + 1)}\u0002`

/** the document's environments: those open (by name, from \begin), those ended in order, and whether each began in math */
interface Environments { open: { name: string; id: number }[]; done: number[]; math: boolean[] }

/**
 * Commands that make no local assignment (and the \the… and \text… families, the renderer's placeholders): an
 * environment whose material at its own level holds only these, text, groups, math and other environments, typesets
 * the same without its group
 */
const NO_ASSIGNMENT = new Set(("par noindent indent relax emph underline footnote footnotemark label ref pageref eqref autoref nameref cref Cref " +
  "cite citep citet hfill hfil quad qquad enspace thinspace vspace hspace vfill smallskip medskip bigskip newline linebreak " +
  "newpage clearpage pagebreak nopagebreak mbox fbox makebox framebox parbox raisebox colorbox fcolorbox rule hrule hrulefill dotfill " +
  "null ldots dots today LaTeX TeX setcounter addtocounter stepcounter arabic roman Roman alph Alph value lstplaceholder").split(" "))
const noAssignment = (name: string) => NO_ASSIGNMENT.has(name) || /^(?:the|text|LX)[A-Za-z]+$/.test(name)

/** an environment's material typesets the same without its group: groups, math and environments in it taken out, what
 *  remains has no command that assigns (NO_ASSIGNMENT) */
function transparent(material: string): boolean {
  // (each taken out leaves a space: a control word before it stays one)
  // (a control symbol is read as one: \\ before letters, \$, \{ are no command, math or group; \[ and \] a display)
  let t = material.replace(/\\([A-Za-z]+|[^])/g, (m, x: string) => (x === "[" ? "\u0007" : x === "]" ? "\u0008" : x.length > 1 || /[A-Za-z]/.test(x) ? m : " "))
    .replace(/\u0007[^]*?\u0008/g, " ").replace(/\$\$[^$]*\$\$|\$[^$]*\$/g, " ")
  for (let prev = ""; prev !== t; ) {
    prev = t
    t = t.replace(/\\begin\{([^{}]*)\}(?:(?!\\begin\{\1\})[^])*?\\end\{\1\}/g, " ").replace(/\{[^{}]*\}/g, " ")
  }
  return [...t.matchAll(/\\([A-Za-z]+)/g)].every((m) => noAssignment(m[1]))
}

const VERBATIM = /\\begin\{(verbatim\*?|Verbatim|lstlisting|minted)\}[^]*?\\end\{\1\}|\\verb\*?([^a-zA-Z\s*])[^\n]*?\2/g
const MAX_OUTPUT = 5_000_000

/** A placeholder control word for protected text: letters only, so it tokenizes as one control sequence. */
const placeholder = (i: number) => "\\latexzeroprotected" + i.toString(26).split("").map((d) => String.fromCharCode(97 + parseInt(d, 26))).join("") + " "

export function expandDocument(src: string, opts: DocumentOptions = {}): DocumentExpansion {
  // protect verbatim regions
  const saved: string[] = []
  const text = src.replace(VERBATIM, (m) => { saved.push(m); return placeholder(saved.length - 1) })
  const restore = (s: string) => (saved.length ? s.replace(/\\latexzeroprotected([a-z]+) /g, (_, k: string) => saved[parseInt([...k].map((c) => (c.charCodeAt(0) - 97).toString(26)).join(""), 26)]) : s)

  const reader = new Tokenizer(text)
  const taken: { last: Tok | null } = { last: null } // the last token taken from the source
  const tracked = { next: () => (taken.last = reader.next()) } as unknown as Tokenizer
  const ex = new Expander(tracked, { latex: true, known: opts.known, defined: opts.defined, xspace: opts.xspace, fuel: opts.fuel ?? 1_000_000 })

  const out: string[] = []
  const errors: string[] = []
  let cursor = 0
  let size = 0
  let tail = "" // the end of the output so far
  const emit = (str: string) => {
    if (!str) return
    if (/\\[A-Za-z]+$/.test(tail) && /^[A-Za-z]/.test(str)) str = " " + str // keep a control word apart from a letter
    out.push(str); size += str.length
    tail = (tail + str).slice(-64)
  }
  const done = () => { emit(text.slice(cursor)); return { text: restore(environments(out.join(""), envs)), errors } }
  // a letter or other character \let to a control sequence (\let\foo=a): as TeX typesets it, the character
  const implicit = (t: Tok): Tok | null => {
    if (t.cs === undefined) return null
    const m = ex.meaning(t)
    return m.kind === "char" && (m.cat === LETTER || m.cat === OTHER_CHAR) ? { cat: m.cat, c: m.c } : null
  }
  // math mode in the output ($…$, $$…$$, \[…\], a math environment): there spaces are nothing and {} is a noad
  let math = false
  let display = false, dollar = false // $$; the token before was a $
  const mathShift = (x: Tok) => {
    if (x.cat === MATH_SHIFT) {
      if (!math) math = true
      else if (display) { if (dollar) math = display = false } // (the second $ of $$ ends it)
      else if (dollar) display = true // $$ starts a display
      else math = false
    } else if (x.cs === "[" || x.cs === "]") { math = display = x.cs === "[" }
    dollar = x.cat === MATH_SHIFT
  }
  // the moving arguments (MOVING) the output goes through: the expander is told when it is in one
  let depth = 0 // braces open
  const mv = { args: 0, open: -1, bracket: -1 } // arguments to come; the depth of the one open, in braces or brackets
  const track = (x: Tok) => {
    mathShift(x)
    if (x.cs !== undefined && !x.active && Object.hasOwn(MOVING, x.cs)) { mv.args = MOVING[x.cs]; return }
    if (x.cat === LEFT_BRACE) depth++
    if (mv.open >= 0 || mv.bracket >= 0) {
      if (x.cat === RIGHT_BRACE && depth === mv.open) { mv.open = -1; mv.args-- }
      else if (x.cat === OTHER_CHAR && x.c === 93 && depth === mv.bracket) { mv.bracket = -1; mv.args = 0 } // (the short title is written, not the long one)
    } else if (mv.args > 0 && x.cat !== SPACER) {
      if (x.cat === LEFT_BRACE) mv.open = depth
      else if (x.cat === OTHER_CHAR && x.c === 91) mv.bracket = depth // (a short title)
      else mv.args = 0 // (\section* writes nothing)
    }
    if (x.cat === RIGHT_BRACE) depth--
    ex.moving = mv.open >= 0 || mv.bracket >= 0
  }
  // the document's environments (\newenvironment, or any macro of its own: \begin{name} is \begingroup\name): \begin
  // and \end become markers, and the group stays where it would make a difference (environments() below)
  const envs: Environments = { open: [], done: [], math: [] }
  /** after \begin or \end: the environment's name in braces when it is the document's (a math environment's sets the
   *  mode); the tokens read are put back unless it is */
  const envName = (cmd: "begin" | "end"): string | null => {
    const read: Tok[] = []
    const next = () => { const x = ex.read(); if (x) read.push(x); return x }
    let x = next()
    let name: string | null = x?.cat === LEFT_BRACE ? "" : null
    for (x = name === null ? null : next(); name !== null && x?.cat !== RIGHT_BRACE; x = next()) name = x && x.cs === undefined && x.cat !== LEFT_BRACE ? name + String.fromCharCode(x.c) : null
    if (name !== null && ex.meaningOf(name).kind === "macro") return name
    ex.backInput(read)
    if (name !== null && MATH_ENVIRONMENT.test(name)) math = display = cmd === "begin"
    return null
  }
  /** \begin{name} or \end{name} of the document's environment: what it does; `mark` takes a marker */
  const environment = (cmd: "begin" | "end", name: string, mark: (x: Tok) => void) => {
    if (cmd === "begin") {
      ex.perform({ cs: "begingroup" })
      envs.open.push({ name, id: envs.math.length })
      mark({ cs: `${MARK}<${envs.math.length}` })
      envs.math.push(math)
      ex.backInput([{ cs: name }])
      return
    }
    // \end{name}: \endname, then (\@checkend) the environment it ends, \endgroup
    ex.backInput([...(ex.meaningOf(`end${name}`).kind === "macro" ? [{ cs: `end${name}` }] : []), { cs: `${MARK}>${name}` }])
  }
  /** the end of \end{name}: the environment it ends, its marker */
  const ended = (name: string): Tok => {
    const top = envs.open.pop()
    if (top?.name !== name) throw new ExpansionError(`\\end{${name}} ${top ? `ends \\begin{${top.name}}` : "without its \\begin"}`)
    ex.perform({ cs: "endgroup" })
    envs.done.push(top.id)
    return { cs: `${MARK}>${top.id}` }
  }
  const envCommand = (x: Tok): "begin" | "end" | null =>
    x.cs !== undefined && !x.active && (x.cs === "begin" || x.cs === "end") ? x.cs : null
  for (;;) {
    let t: Tok | null
    try { t = ex.read() } catch (e) { errors.push((e as Error).message); break }
    if (!t) {
      if (envs.open.length) errors.push(`\\begin{${envs.open[envs.open.length - 1].name}} without its \\end`)
      return done()
    }
    const start = t.pos ?? reader.offset
    const mathBefore = math
    const define = ex.isDefinition(t)
    const char = implicit(t)
    const cmd = envCommand(t)
    let env: string | null = null
    try { env = cmd && envName(cmd) } catch (e) { errors.push((e as Error).message); return done() }
    if (!define && !char && !env && !ex.isExpandable(t)) {
      // copied from the source; braces and \begingroup…\endgroup still scope definitions
      try { if (t.cat === LEFT_BRACE || t.cat === RIGHT_BRACE || t.cs === "begingroup" || t.cs === "endgroup") ex.perform(t) } catch { /* unbalanced: the source decides */ }
      track(t)
      continue
    }
    const before = text.slice(cursor, start)
    const result: Tok[] = []
    const inMath: boolean[] = [] // (each token of the result: in math mode)
    const mark = (x: Tok) => { result.push(x); inMath.push(math) }
    const push = (x: Tok) => { track(x); mark(x) }
    let assigned = define // (a definition is a command: no ligature or kern across it)
    try {
      if (define) ex.perform(t); else if (char) push(char); else if (env) environment(cmd!, env, mark); else ex.expand(t)
      // (what the expansion left, and the arguments it reads: not the source after it, which stays as it is)
      while (ex.pending) {
        let x = ex.read()!
        if (ex.isExpandable(x)) { ex.expand(x); continue }
        if (ex.isDefinition(x)) { ex.perform(x); assigned = true; continue }
        if (x.cs?.startsWith(`${MARK}>`)) { mark(ended(x.cs.slice(MARK.length + 1))); continue }
        const c = envCommand(x)
        const name = c && envName(c)
        if (name) { environment(c!, name, mark); continue }
        x = implicit(x) ?? x
        if (x.cat === LEFT_BRACE || x.cat === RIGHT_BRACE) { try { ex.perform(x) } catch { /* unbalanced */ } }
        push(x)
      }
    } catch (e) {
      if (!(e instanceof ExpansionError)) throw e
      errors.push(e.message)
      return done()
    }
    cursor = reader.offset
    // spaces TeX skips after a control word or a space (\xspace's look ahead reads one): on this line, and the line end
    // unless a blank line follows
    const last = taken.last
    const skipped = !!last && (last.cat === SPACER || last.cs !== undefined && !last.active && (/^[A-Za-z]/.test(last.cs) || last.cs === " "))
    if (skipped) {
      let j = cursor
      while (text[j] === " " || text[j] === "\t") j++
      if (text[j] === "\n") {
        let k = j + 1
        while (text[k] === " " || text[k] === "\t") k++
        if (text[k] !== "\n" && k < text.length) j = k
      }
      cursor = j
    }
    emit(before)
    // (whitespace left after a control word is a blank line's: TeX skipped its first line end)
    let replacement = serialize(result, inMath, skipped && /\s/.test(text[cursor] ?? "") ? undefined : text[cursor], math)
    // spaces that were tokens apart stay apart: where whitespace meets whitespace (a space of the expansion, of the source
    // around it, a line end), {} keeps the second from being read with the first, or skipped at a line's start; in math,
    // spaces are nothing, but a line left empty would end the paragraph: % takes its end
    const following = text.slice(cursor, cursor + 2)
    if (!mathBefore && (/(^|\s)$/.test(tail) || CONTROL_WORD_END.test(tail)) && /^\s/.test(replacement)) replacement = "{}" + replacement
    if (!math && !skipped && /\s$/.test(replacement || tail) && /^\s/.test(following)) replacement += "{}"
    else if (math && !replacement.trim() && /\n[ \t]*$/.test(tail) && /^[ \t]*\n/.test(text.slice(cursor))) replacement = "%"
    else if (!math && !replacement && assigned && /\S$/.test(tail) && /^\S/.test(following)) replacement = "{}"
    emit(replacement)
    if (size > MAX_OUTPUT) { errors.push("expansion output too large"); return done() }
  }
  return done()
}

/**
 * The document's environments in the output: each pair of markers becomes nothing where the environment typesets the
 * same without its group (transparent(), and no \@doendpe of a list before it in its paragraph, whose \par and \everypar
 * the group would keep), else the group: {…}, or \begingroup…\endgroup in math, where {…} would be a noad. Where a
 * marker becomes nothing, what TeX read apart stays apart: a control word and a letter or a space after it, a space or
 * a line end at a line's start (TeX skips those).
 */
function environments(s: string, envs: Environments): string {
  if (!envs.done.length) return s
  const open = (id: number) => `\u0001${id}\u0002`, close = (id: number) => `\u0003${id}\u0002`
  const strip = (x: string) => x.replace(/[\u0001\u0003]\d+\u0002/g, "")
  const kept = new Set<number>()
  let w = s // (each one decided, innermost first: an environment kept in it is a group)
  for (const id of envs.done) {
    const a = w.indexOf(open(id)), b = w.indexOf(close(id))
    const before = strip(w.slice(0, a)), material = strip(w.slice(a + open(id).length, b))
    // an \@doendpe still in force (an environment that ends a list ended in this paragraph): a \par in the group would
    // leave its \par to the next one, unless the environment ends with a list of its own, which sets it again
    const lists = [...before.slice(lastPar(before)).matchAll(/\\end\{([^{}]*)\}/g)].some((m) => !NO_ENDPE.test(m[1]))
    const doendpe = !envs.math[id] && lists && !ENDPE.test(material.match(/\\end\{([^{}]*)\}\s*$/)?.[1] ?? "")
    const keep = doendpe || !transparent(material)
    if (keep) kept.add(id)
    w = w.replace(open(id), keep ? "{" : "").replace(close(id), keep ? "}" : "")
  }
  // the markers: the group, or a join (\u0004, \u0005 in math) that keeps apart what TeX read apart: a control word and a
  // letter or a space, whitespace and whitespace (but after a blank line, in vertical mode, a space is nothing; in math
  // spaces are nothing, and % keeps a line from being left empty), two characters (no ligature or kern across)
  const parts = s.replace(/([\u0001\u0003])(\d+)\u0002/g, (_, m: string, n: string) => {
    const id = Number(n), math = envs.math[id]
    if (!kept.has(id)) return math ? "\u0005" : "\u0004"
    return m === "\u0001" ? (math ? "\\begingroup " : "{") : math ? "\\endgroup " : "}"
  }).split(/([\u0004\u0005])/)
  let r = parts[0]
  for (let i = 1; i < parts.length; i += 2) {
    const math = parts[i] === "\u0005", prev = r.slice(-64), next = parts.slice(i + 1, i + 9).join("").replace(/[\u0004\u0005]/g, "").slice(0, 64)
    if (CONTROL_WORD_END.test(prev)) r += /^[A-Za-z]/.test(next) ? " " : !math && /^\s/.test(next) ? "{}" : ""
    else if (math) r += /\n[ \t]*$/.test(prev) && /^[ \t]*\n/.test(next) ? "%" : ""
    else if (/(^|\s)$/.test(prev) && /^\s/.test(next) && !/\n[ \t]*\n[ \t]*$/.test(prev)) r += "{}"
    else if (/\S$/.test(prev) && /^\S/.test(next)) r += "{}" // (\begin and \end end a ligature and kern run)
    r += parts[i + 1]
  }
  return r
}

/** where the last \par at the end's level of `text` is (a blank line or \par; not one in a group that has ended, which
 *  ran a \par of the group's own), or 0 */
function lastPar(text: string): number {
  let closed = 0 // groups ended between there and the end
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i], escaped = text[i - 1] === "\\" && text[i - 2] !== "\\"
    if (c === "}" && !escaped) closed++
    else if (c === "{" && !escaped) closed = Math.max(0, closed - 1)
    else if (closed === 0 && (c === "\n" && /^\n[ \t]*\n/.test(text.slice(i, i + 64)) || c === "\\" && /^\\par(?![A-Za-z])/.test(text.slice(i, i + 5)))) return i
  }
  return 0
}

/** Tokens back to source text the renderer reads the same way TeX would; `inMath`: each token's mode, `math` the mode after
 *  them (a control word before a space keeps it with {}, which in math would be a noad: there the space is nothing) */
function serialize(toks: Tok[], inMath: boolean[], following: string | undefined, math: boolean): string {
  let s = ""
  toks.forEach((t, i) => {
    if (t.cs !== undefined) {
      if (t.cs.startsWith(MARK)) { s += marker(t.cs); return }
      if (t.active) { s += t.cs; return }
      if (t.cs === "par") { s += "%\n\n"; return } // (the % keeps the line end from being a space before it)
      s += "\\" + t.cs
      // a control word needs a space before a letter that follows it, and {} before a space
      const nx = toks[i + 1]
      const letter = nx ? nx.cs === undefined && nx.cat === LETTER : !!following && /[A-Za-z]/.test(following)
      const space = nx ? nx.cat === SPACER && !inMath[i] : !!following && /\s/.test(following) && !math
      if (/^[A-Za-z]+$/.test(t.cs) && letter) s += " "
      else if (/^[A-Za-z]+$/.test(t.cs) && space) s += "{}"
      return
    }
    if (t.cat === SPACER) s += toks[i - 1]?.cat === SPACER && !inMath[i] ? "{} " : " " // (two spaces in a row stay two)
    else if (t.cat === MAC_PARAM) s += "#"
    else s += String.fromCharCode(t.c)
  })
  return s
}
