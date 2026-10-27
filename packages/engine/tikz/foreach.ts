// pgffor's \foreach (pgffor.code.tex, line numbers cite it) as a picture's command: its variables, options, list
// and body read as \pgffor@vars, \pgffor@normal@list and \pgffor@collectbody read them, then the body run once a
// value with the variables defined (a macro is its text: the engine puts the value's tokens where the variable
// stands), each time in a group (\pgffor@default@begingroup), the whole loop in one (\pgffor@atbeginforeach).
// Lists of values and `a,...,b` or `a,b,...,c` ranges of numbers (TeX's dimension arithmetic, the value printed
// without ".0") and of letters; several variables `\x/\y` (a value's missing parts repeat its last); the options
// count= and evaluate= (its old syntax). Anything else throws Unsupported.

import { printScaled } from "../layout/arith"
import { Unsupported } from "../latex/unsupported"
import { TexArith } from "../pgf/fixed"
import { pgfmathParse, type PgfUnits } from "../pgf/mathparser"
import { arg, find, groupEnd, isCs, str, tokenize, type Tok, type Toks } from "./tokens"

/** a parsed \foreach: what each iteration defines, and the body */
export interface Foreach {
  /** each iteration's variables (macro name → its text) */
  iterations: Map<string, Tok[]>[]
  body: Tok[]
}

/** the input \foreach reads from: tokens and a position */
interface Reader { t: Tok[]; i: number }

const skip = (r: Reader) => { while (r.t[r.i] === " ") r.i++ }

/** a brace group at the reader (unbraced), or Unsupported */
function group(r: Reader, what: string): Tok[] {
  skip(r)
  if (r.t[r.i] !== "{") throw new Unsupported(`pgffor: ${what} not in braces`)
  const e = groupEnd(r.t, r.i)
  if (e < 0) throw new Unsupported("pgffor: unbalanced braces")
  const out = r.t.slice(r.i + 1, e)
  r.i = e + 1
  return out
}

/** \pgffor@collectbody (98–102): a nested \foreach (with its body), a group, or up to `;` */
function collectBody(r: Reader): Tok[] {
  skip(r)
  if (r.t[r.i] === "\\foreach") {
    // \pgffor@collectforeach\foreach#1in, then the list
    const j = find(r.t, ["i", "n"], r.i + 1)
    if (j < 0) throw new Unsupported("pgffor: in expected")
    const head = r.t.slice(r.i, j + 2)
    r.i = j + 2
    const list = group(r, "the list")
    return [...head, "{", ...list, "}", ...collectBody(r)]
  }
  if (r.t[r.i] === "{") return group(r, "the body")
  const j = find(r.t, [";"], r.i)
  if (j < 0) throw new Unsupported("pgffor: ; expected after the body")
  const out = r.t.slice(r.i, j + 1)
  r.i = j + 1
  return out
}

/**
 * the tokens with each variable replaced by its value; a nested \foreach's own variables (and count= and evaluate=
 * names) are its own in its options, list (read as it is, not expanded) and body
 */
export function substitute(t: Toks, vars: Map<string, Tok[]>): Tok[] {
  const out: Tok[] = []
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "\\foreach") { out.push(...(vars.get(t[i]) ?? [t[i]])); continue }
    const j = find(t, ["i", "n"], i + 1)
    if (j < 0) { out.push(t[i]); continue }
    const header = t.slice(i + 1, j)
    const inner = new Map(vars)
    let depth = 0
    header.forEach((x, k) => {
      if (x === "[") depth++
      else if (x === "]") depth--
      else if (isCs(x) && (depth === 0 || /(?:count=\s*|as\s*)$/.test(str(header.slice(0, k))))) inner.delete(x)
    })
    const r = { t: [...t], i: j + 2 }
    const list = group(r, "the list")
    const body = collectBody(r)
    out.push("\\foreach", ...substitute(header, inner), "i", "n", "{", ...substitute(list, inner), "}", "{", ...substitute(body, inner), "}")
    i = r.i - 1
  }
  return out
}

/**
 * \foreach (after its token) at `r`: the variables, options, list and body (\pgffor@vars … \pgffor@collectbody),
 * and the values each iteration defines (\pgffor@iterate, \pgffor@handlevalue, \pgffor@handledots)
 */
export function readForeach(r: Reader, units: PgfUnits, outer: Map<string, Tok[]>): Foreach {
  const vars: string[] = []
  let count: { name: string; value: number } | null = null
  const evaluations: { name: string; expr: Tok[] }[] = []
  // \pgffor@vars (64–68)
  for (;;) {
    skip(r)
    const t = r.t[r.i]
    if (t === undefined) throw new Unsupported("pgffor: in expected")
    if (t === "i" && r.t[r.i + 1] === "n") { r.i += 2; break }
    if (t === "/") { r.i++; continue }
    if (t === "[") {
      const e = find(r.t, ["]"], r.i + 1)
      if (e < 0) throw new Unsupported("pgffor: ] expected")
      for (const o of splitTop(substitute(r.t.slice(r.i + 1, e), outer))) {
        const k = o.findIndex((x) => x === "=")
        const key = str(o.slice(0, k < 0 ? o.length : k)).trim(), v = k < 0 ? [] : trim(o.slice(k + 1))
        if (key === "count") {
          // \pgffor@count@parse: \def#1{int(from-1)}, then int(#1+1) before each iteration (kept by its remember code)
          const name = v[0]
          if (!name || !isCs(name)) throw new Unsupported("pgffor: count")
          const rest = trim(v.slice(1))
          const from = rest.length ? str(rest).replace(/^from\s*/, "") : "1"
          if (rest.length && !/^from/.test(str(rest))) throw new Unsupported("pgffor: count")
          count = { name, value: Number(parseInt(math(`int(${from}-1)`, units))) }
        } else if (key === "evaluate") {
          // the old syntax \x as \y using <expr> (\pgffor@assign@parse@old)
          if (v.includes("=") || v.includes(";")) throw new Unsupported("pgffor: evaluate with =")
          const as = findWord(v, "as"), using = findWord(v, "using")
          const source = v[0]
          const name = as < 0 ? source : trim(v.slice(as + 2, using < 0 ? v.length : using))[0]
          const expr = using < 0 ? [source] : trim(v.slice(using + 5))
          if (!isCs(source) || !name || !isCs(name)) throw new Unsupported("pgffor: evaluate")
          evaluations.push({ name, expr })
        } else if (key !== "parse" || str(v).trim() !== "false") throw new Unsupported(`pgffor: option ${key}`)
      }
      r.i = e + 1
      continue
    }
    if (!isCs(t)) throw new Unsupported(`pgffor: variable ${t}`)
    vars.push(t)
    r.i++
  }
  if (!vars.length) throw new Unsupported("pgffor: no variable")
  skip(r)
  if (r.t[r.i] !== "{") throw new Unsupported("pgffor: a list in a macro")
  const list = substitute(group(r, "the list"), outer)
  const body = collectBody(r)
  if (body.includes("\\breakforeach")) throw new Unsupported("pgffor: \\breakforeach")
  // (a plot's \foreach over the samples defines \x again: the variable's text would not reach it)
  if (find(body, [..."plot"]) >= 0 && (vars.includes("\\x") || find(body, [..."variable"]) >= 0)) throw new Unsupported("pgffor: a plot in a loop over its variable")
  const iterations: Map<string, Tok[]>[] = []
  const assign = (value: Tok[]) => {
    const m = new Map<string, Tok[]>()
    // \pgffor@multiassign (238–274): the value's parts at `/`, its last repeated
    if (vars.length === 1) m.set(vars[0], value)
    else {
      const parts = splitAll(value, "/")
      vars.forEach((v, k) => m.set(v, parts[Math.min(k, parts.length - 1)]))
    }
    // assign before code: count, then evaluate (in the order given)
    if (count) { count.value++; m.set(count.name, [...String(count.value)]) }
    for (const e of evaluations) {
      const env = new Map([...outer, ...m])
      m.set(e.name, [...math(str(substitute(e.expr, env)), units)])
    }
    iterations.push(m)
  }
  for (const v of sampleValues(list, units)) assign(v)
  return { iterations, body }
}

const trim = (t: Toks): Tok[] => {
  let a = 0, b = t.length
  while (t[a] === " ") a++
  while (b > a && t[b - 1] === " ") b--
  return t.slice(a, b)
}

/** where a word (letters) stands at brace level 0, or -1 */
const findWord = (t: Toks, w: string) => find(t, [...w])

function splitAll(t: Toks, sep: string): Tok[][] {
  const out: Tok[][] = [[]]
  let depth = 0
  for (const x of t) {
    if (x === "{") depth++
    if (x === "}") depth--
    if (x === sep && depth === 0) out.push([])
    else out[out.length - 1].push(x)
  }
  return out
}

function splitTop(t: Toks): Tok[][] { return splitAll(t, ",").map(trim).filter((x) => x.length) }

/** pgfmath's result, or Unsupported */
function math(expr: string, units: PgfUnits): string {
  const r = pgfmathParse(expr, units)
  if (r.errors.length) throw new Unsupported(`pgffor: ${r.errors[0]}`)
  return r.result
}

/** the items of `list, \pgffor@stop,`: \pgffor@scanone#1, (blanks before an item skipped), \pgffor@scanround */
function values(list: Toks): Tok[][] {
  const t = [...list, ",", " "]
  const out: Tok[][] = []
  let i = 0
  for (;;) {
    while (t[i] === " ") i++
    if (i >= list.length + 1) return out
    let j: number
    if (t[i] === "(") {
      const c = find(t, [")"], i)
      j = find(t, [","], c)
    } else j = find(t, [","], i)
    if (j < 0) return out
    out.push(arg(t.slice(i, j)))
    i = j + 1
  }
}

/**
 * the values a list gives \foreach (\pgffor@scan, 155–158, over `list, \pgffor@stop,`: an item in parentheses up to the
 * comma after them; \pgffor@handledots for `...`, no context before or after the dots modeled)
 */
export function sampleValues(list: Toks, units: PgfUnits): Tok[][] {
  const items = values(list)
  const out: Tok[][] = []
  let last: Tok[] = [], prevlast: Tok[] = []
  for (let k = 0; k < items.length; k++) {
    const value = items[k]
    if (!containsDots(value)) { prevlast = last; last = value; out.push(value); continue }
    if (str(value).trim() !== "...") throw new Unsupported("pgffor: a range with context")
    if (k + 1 >= items.length) throw new Unsupported("pgffor: a range with no end")
    out.push(...range(last, prevlast, items[++k], units))
  }
  return out
}

/** \pgffor@dots@in@: `...` in the value */
const containsDots = (v: Toks) => str(v).includes("...")

/**
 * \pgffor@dotsscanend and \pgffor@loop (330–373): from the last value (and the one before it, which makes the
 * step; else ±1) to the end, as dimensions; letters by their codes
 */
function range(last: Toks, prevlast: Toks, end: Toks, units: PgfUnits): Tok[][] {
  const a = new TexArith(units)
  // \pgffor@dots@value@process: a single letter is its character code
  const code = (v: Toks): number | null => {
    const s = str(trim(v))
    return /^[A-Za-z]$/.test(s) ? s.charCodeAt(0) : null
  }
  const alpha = code(end) !== null
  const dim = (v: Toks) => {
    const c = code(v)
    if (c !== null) return c * 65536
    const s = str(v)
    if (!/^\s*-?[0-9.]+\s*$/.test(s)) throw new Unsupported(`pgffor: a range of "${s}"`)
    return a.dimen(`${s.trim()}pt`)
  }
  if (!last.length) throw new Unsupported("pgffor: a range with no start")
  const stop = dim(end), from = dim(last)
  const step = prevlast.length ? from - dim(prevlast) : stop > from ? 65536 : -65536
  if (a.errors.length) throw new Unsupported(`pgffor: ${a.errors[0]}`)
  const out: Tok[][] = []
  for (let iter = from + step; step < 0 ? iter >= stop : iter <= stop; iter += step) {
    if (step === 0) throw new Unsupported("pgffor: a range of step zero")
    let s = printScaled(iter)
    if (s.endsWith(".0")) s = s.slice(0, s.indexOf(".0"))
    if (alpha) {
      // \pgffor@makealphabetic: a–z from 97, A–Z from 65, else ?
      const n = Number(s)
      s = (n > 96 && n < 123) || (n > 64 && n < 91) ? String.fromCharCode(n) : "?"
    }
    out.push(tokenize(s))
  }
  return out
}
