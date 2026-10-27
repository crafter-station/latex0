// pgf's arrow specifications (pgfcorearrows.code.tex) as \pgfsetarrows turns them into tip sequences:
// `<start>-<end>` split at the first `-`, each side parsed by \pgfarrows@parser (272–433) into
// \pgf@start@tip@sequence and \pgf@end@tip@sequence. A name is a meta arrow tip (drawing code: the sequence
// gets \pgf@arrow@handle{name}{}), a shorthand (`means`: \pgf@arrow@handle@shorthand@empty{\pgf@ar@means@name},
// expanded only when the tip is drawn), or else its first token is taken as a single-character shorthand
// and the rest parsed again; start tips go through \pgf@ar@start@<name> (`<` is `>` reversed) and are
// prepended. Arrow options (`[…]`) are not modeled. The tips are the core's and arrows.meta's.

import { Unsupported } from "../latex/unsupported"
import { find, meaning, spdef, type Tok, type Toks } from "./tokens"

/** an element of a tip sequence */
export type Tip =
  /** \pgf@arrow@handle{name}{} */
  | { kind: "tip"; name: string }
  /** \pgf@arrow@handle@shorthand@empty{\pgf@ar@means@name} */
  | { kind: "means"; name: string }
  /** \pgf@arrow@handle@dot */
  | { kind: "dot" }

export interface ArrowDb {
  /** names with drawing code (\pgf@ar@code@name) */
  code: ReadonlySet<string>
  /** shorthands (\pgf@ar@means@name; their own sequences are read when a tip is drawn) */
  means: ReadonlySet<string>
  /** \pgf@ar@start@name: the name a start tip uses */
  start: ReadonlyMap<string, string>
}

const tip = (name: string): Tip => ({ kind: "tip", name })
const means = (name: string): Tip => ({ kind: "means", name })

/** the core's tips (pgfcorearrows.code.tex 1050–1243): \pgfarrowsdeclare names a tip for both ends */
const CORE_CODE = [".", "_", "stealth", "to", "to reversed", "latex", "@bar", "space"]
/** arrows.meta's tips with drawing code, and its shorthands (pgflibraryarrows.meta.code.tex 130–1601) */
const META_CODE = [
  "Straight Barb", "Hooks", "Arc Barb", "Tee Barb", "Classical TikZ Rightarrow", "Computer Modern Rightarrow", "Implies", "Latex",
  "Stealth", "Kite", "Square", "Circle", "Round Cap", "Butt Cap", "Triangle Cap", "Fast Triangle", "Fast Round", "Rays",
]
const META_MEANS = ["LaTeX", "Triangle", "Rectangle", "Ellipse", "Diamond", "Turned Square", "Bracket", "Parenthesis"]

/** the tips known after \usepackage{tikz} (and \usetikzlibrary{arrows.meta}) */
export function arrowDb(meta: boolean): ArrowDb {
  const code = new Set([...CORE_CODE, ...(meta ? META_CODE : [])])
  // > (To), < (> reversed), To, | (Bar), Bar, the reversed old tips, and TikZ's >| (tikz.code.tex 1196)
  const m = new Set([">", "<", "To", "|", "Bar", "stealth reversed", "latex reversed", ">|", ...(meta ? META_MEANS : [])])
  const start = new Map<string, string>([...code, ...m].map((n) => [n, n]))
  // `<->`, `>-<` (1071–1075, tikz.code.tex 1196) and `|<->|`: a start `<` is the end `>`, a start `>` the end `<`, a start `|<` the end `>|`
  start.set("<", ">")
  start.set(">", "<")
  start.delete(">|")
  start.set("|<", ">|")
  return { code, means: m, start }
}

/** the tokens of a specification side as one string (names are plain text) */
function text(t: Toks): string {
  if (t.some((x) => x.length > 1)) throw new Unsupported(`pgf: arrow tip "${meaning(t, false)}"`)
  return t.join("")
}

/**
 * \pgfsetarrowsstart / \pgfsetarrowsend{spec}: the tip sequence. A shorthand's own sequence is looked up
 * only when the tip is drawn.
 */
export function tipSequence(spec: Toks, db: ArrowDb, start: boolean): Tip[] {
  // \pgf@arrows@direct@name@<end>@<spec>: the empty spec, and the brackets
  if (spec.length === 0) return []
  if (spec.includes("[") || spec.includes("]")) throw new Unsupported(`pgf: arrow options "${meaning(spec, false)}"`)
  // blanks alone: \pgfarrows@initial@parser takes the closing [] for options, and the parser runs away
  if (spec.every((t) => t === " ")) throw new Unsupported("pgf: an arrow specification of blanks")
  const seq: Tip[] = []
  // start tips are prepended (\pgf@arrows@append@to@tips with \ifpgf@arrows@translate)
  const add = (t: Tip) => (start ? seq.unshift(t) : seq.push(t))
  const known = (name: string): Tip | null => {
    if (db.code.has(name)) return name === "." ? { kind: "dot" } : tip(name)
    if (db.means.has(name)) return means(name)
    return null
  }
  let rest: Tok[] = [...spec]
  while (rest.length) {
    // \pgfarrows@parser#1[ and \pgfkeys@spdef
    const name = text(spdef(rest))
    if (name === "") break
    if (name === ".") { add({ kind: "dot" }); break }
    const whole = known(start ? db.start.get(name) ?? "undefined" : name)
    if (whole) { add(whole); break }
    // \pgf@arrows@single@char@parser: the first token (an undelimited argument: blanks skipped, a group unbraced)
    let i = 0
    while (rest[i] === " ") i++
    const first = rest[i]
    if (first === "{") throw new Unsupported(`pgf: arrow tip group in "${meaning(spec, false)}"`)
    rest = rest.slice(i + 1)
    if (first === ".") { add({ kind: "dot" }); continue }
    const one = known(start ? db.start.get(first) ?? "undefined" : first)
    if (!one) throw new Unsupported(`pgf: unknown arrow tip kind '${name}'`)
    add(one)
  }
  return seq
}

/** \pgfsetarrows{start-end} (1016–1021): the two sequences */
export function setArrows(spec: Toks, db: ArrowDb): { start: Tip[]; end: Tip[] } {
  let i = 0
  while (spec[i] === " ") i++
  // \pgfutil@ifnextchar[: options for the scope's arrows
  if (spec[i] === "[") throw new Unsupported(`pgf: arrow options "${meaning(spec, false)}"`)
  const dash = find(spec, ["-"])
  if (dash < 0) throw new Unsupported(`pgf: arrow specification "${meaning(spec, false)}" without -`)
  return { start: tipSequence(spec.slice(0, dash), db, true), end: tipSequence(spec.slice(dash + 1), db, false) }
}

/** the sequence as \meaning shows it */
export function tipsMeaning(seq: readonly Tip[]): string {
  return seq.map((t) => t.kind === "dot" ? "\\pgf@arrow@handle@dot " : t.kind === "tip" ? `\\pgf@arrow@handle {${t.name}}{}` : `\\pgf@arrow@handle@shorthand@empty {\\pgf@ar@means@${t.name} }`).join("")
}
