// Macro expansion for whole documents (#46): the document's own definitions
// (\newcommand and its relatives, \def, \let…) run through the token-level
// expander, and every use of them is replaced by its expansion. Everything
// else is copied from the source unchanged, so what the renderer reads differs
// from the source only where TeX would have expanded a user macro.
//
// Verbatim material (verbatim, lstlisting, minted environments and \verb) is
// never tokenized. After a macro whose last token is a control word, the
// spaces TeX skips are skipped too, and one line end when the next line is not
// blank. A definition alone on its line becomes {} (its line end still makes
// a space, where an empty line would end the paragraph), and a control word
// is kept apart from a letter that comes to follow it. An error (fuel
// exhausted, a bad definition) leaves the rest of the source unexpanded and is
// reported.

import { ExpansionError, Expander } from "./expander"
import { LEFT_BRACE, LETTER, MAC_PARAM, OTHER_CHAR, RIGHT_BRACE, SPACER, Tokenizer, type Tok } from "./tokens"

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
  fuel?: number
}

/** the commands whose arguments LaTeX writes to a file (\\addcontentsline, \\markboth …): how many of them, in braces */
const MOVING: Record<string, number> = { part: 1, chapter: 1, section: 1, subsection: 1, subsubsection: 1, paragraph: 1, subparagraph: 1, caption: 1, addcontentsline: 3, markboth: 2, markright: 1 }

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
  const ex = new Expander(tracked, { latex: true, known: opts.known, defined: opts.defined, fuel: opts.fuel ?? 1_000_000 })

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
  const done = () => { emit(text.slice(cursor)); return { text: restore(out.join("")), errors } }
  // a letter or other character \let to a control sequence (\let\foo=a): as TeX typesets it, the character
  const implicit = (t: Tok): Tok | null => {
    if (t.cs === undefined) return null
    const m = ex.meaning(t)
    return m.kind === "char" && (m.cat === LETTER || m.cat === OTHER_CHAR) ? { cat: m.cat, c: m.c } : null
  }
  // the moving arguments (MOVING) the output goes through: the expander is told when it is in one
  let depth = 0 // braces open
  const mv = { args: 0, open: -1, bracket: -1 } // arguments to come; the depth of the one open, in braces or brackets
  const track = (x: Tok) => {
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
  for (;;) {
    let t: Tok | null
    try { t = ex.read() } catch (e) { errors.push((e as Error).message); break }
    if (!t) return done()
    const start = t.pos ?? reader.offset
    const define = ex.isDefinition(t)
    const char = implicit(t)
    if (!define && !char && !ex.isExpandable(t)) {
      // copied from the source; braces and \begingroup…\endgroup still scope definitions
      try { if (t.cat === LEFT_BRACE || t.cat === RIGHT_BRACE || t.cs === "begingroup" || t.cs === "endgroup") ex.perform(t) } catch { /* unbalanced: the source decides */ }
      track(t)
      continue
    }
    const before = text.slice(cursor, start)
    const result: Tok[] = []
    try {
      if (define) ex.perform(t); else if (char) { track(char); result.push(char) } else ex.expand(t)
      while (ex.pending) {
        let x = ex.getXToken()
        if (!x) break
        if (ex.isDefinition(x)) { ex.perform(x); continue }
        x = implicit(x) ?? x
        if (x.cat === LEFT_BRACE || x.cat === RIGHT_BRACE) { try { ex.perform(x) } catch { /* unbalanced */ } }
        track(x)
        result.push(x)
      }
    } catch (e) {
      if (!(e instanceof ExpansionError)) throw e
      errors.push(e.message)
      return done()
    }
    cursor = reader.offset
    // spaces TeX skips after a control word: on this line, and the line end unless a blank line follows
    const last = taken.last
    if (last && last.cs !== undefined && !last.active && (/^[A-Za-z]/.test(last.cs) || last.cs === " ")) {
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
    let replacement = serialize(result, text[cursor])
    // nothing left on a line that had something: {} keeps its line end a space, not a blank line; at a line's start, {}
    // keeps a space that follows (a definition's, the expansion's) from the spaces TeX skips there
    const lineStart = /(^|\n)[ \t]*$/.test(tail)
    if (!replacement.trim() && lineStart && /^[ \t]*\n/.test(text.slice(cursor))) replacement = "{}"
    else if (lineStart && /^[ \t]/.test(replacement || text.slice(cursor))) replacement = "{}" + replacement
    emit(replacement)
    if (size > MAX_OUTPUT) { errors.push("expansion output too large"); return done() }
  }
  return done()
}

/** Tokens back to source text the renderer reads the same way TeX would. */
function serialize(toks: Tok[], following: string | undefined): string {
  let s = ""
  toks.forEach((t, i) => {
    if (t.cs !== undefined) {
      if (t.active) { s += t.cs; return }
      if (t.cs === "par") { s += "\n\n"; return }
      s += "\\" + t.cs
      // a control word needs a space before a letter that follows it
      const nx = toks[i + 1]
      const letter = nx ? nx.cs === undefined && nx.cat === LETTER : !!following && /[A-Za-z]/.test(following)
      if (/^[A-Za-z]+$/.test(t.cs) && letter) s += " "
      return
    }
    if (t.cat === SPACER) s += " "
    else if (t.cat === MAC_PARAM) s += "#"
    else s += String.fromCharCode(t.c)
  })
  return s
}
