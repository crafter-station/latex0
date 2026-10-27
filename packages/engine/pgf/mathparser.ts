// \pgfmathparse (pgfmathparser.code.tex) as pgf runs it: a token-by-token state machine over the
// expanded expression with an operand stack of strings and an operator stack, each operator applied
// when one of lower or equal precedence arrives (\pgfmath@operation@@process). Operands stay the strings
// pgf pushes: a number as typed (`1.50`), a dimension as \pgf@sys@tonumber prints it, a function's
// \pgfmathresult; every function and operator reads them back with `#1pt`. An expression of digits and
// periods alone is returned as typed (the "fast lane"). Units, scientific notation, + − * / ^, unary
// signs, parentheses, function calls, comma lists, comparisons, logic, ?:, the postfix r and ! are modeled;
// arrays, quotes, registers and the other bases throw Unsupported.

import { Unsupported } from "../latex/unsupported"
import { TexArith, toNumber } from "./fixed"
import { FUNCTIONS as BASIC, scientific, texArgs, type PgfFunction, type PgfMathCtx } from "./mathfunctions"
import { TRIGONOMETRIC } from "./mathtrig"

const FUNCTIONS: Record<string, PgfFunction> = { ...BASIC, ...TRIGONOMETRIC }

/** the font's em and ex (\pgfmath@selectfont: the current font) */
export interface PgfUnits { em: number; ex: number }

export interface PgfMathResult {
  /** \pgfmathresult */
  result: string
  /** \ifpgfmathunitsdeclared: a unit or a dimension appeared */
  unitsDeclared: boolean
  /** TeX's error messages, in order, as the log shows them after "! " (without the final period) */
  errors: string[]
}

/** \pgfmathdeclareoperator: name, arity, kinds (a later declaration of the same character adds one) and precedence */
interface Op { name: string; arity: number; prefix?: boolean; postfix?: boolean; precedence: number }
const OPS: Record<string, Op> = {
  "+": { name: "add", arity: 2, precedence: 500 },
  "-": { name: "subtract", arity: 2, precedence: 500 },
  "*": { name: "multiply", arity: 2, precedence: 700 },
  "/": { name: "divide", arity: 2, precedence: 700 },
  "^": { name: "pow", arity: 2, precedence: 900 },
  "<": { name: "less", arity: 2, prefix: true, precedence: 250 },
  "==": { name: "equal", arity: 2, precedence: 250 },
  ">=": { name: "notless", arity: 2, precedence: 250 },
  "<=": { name: "notgreater", arity: 2, precedence: 250 },
  "&&": { name: "and", arity: 2, precedence: 200 },
  "||": { name: "or", arity: 2, precedence: 200 },
  "!=": { name: "notequal", arity: 2, precedence: 250 },
  ">": { name: "greater", arity: 2, precedence: 250 },
  "!": { name: "factorial", arity: 1, prefix: true, postfix: true, precedence: 800 },
  "?": { name: "ifthenelse", arity: 3, precedence: 100 },
  ":": { name: "@@collect", arity: 2, precedence: 101 },
  r: { name: "deg", arity: 1, postfix: true, precedence: 600 },
  ",": { name: "@collect", arity: 2, precedence: 10 },
  "[": { name: "@startindex", arity: 2, prefix: true, precedence: 7 },
  "]": { name: "@endindex", arity: 0, postfix: true, precedence: 6 },
  "(": { name: "@startgroup", arity: 1, prefix: true, precedence: 5 },
  ")": { name: "@endgroup", arity: 0, postfix: true, precedence: 4 },
  '"': { name: "", arity: 1, prefix: true, precedence: 1 },
  "@": { name: "", arity: 0, postfix: true, precedence: 0 },
}
/** the two-character operators (comparisons and logic) */
const DOUBLE = new Set(["==", ">=", "<=", "&&", "||", "!="])
/** the operators modeled */
const MODELED = new Set(["+", "-", "*", "/", "^", "<", ">", "!", "?", ":", "r", ",", "(", ")", "@", ...DOUBLE])
/** \pgfmath@tokens@make{specials}: operators that are never pushed */
const SPECIALS = new Set(["@", ")", "]"])
/** \pgfmath@tokens@make{group}: an opening operator on the stack met by its closing one */
const GROUPS = new Set(["()", "[]"])
/** \pgfmath@tokens@make{unit} (TeX's units, and pdfTeX's nc, nd, px) */
const UNITS = new Set(["bp", "cc", "cm", "dd", "em", "ex", "in", "mm", "pc", "pt", "sp", "nc", "nd", "px"])

const isDigit = (t: string) => t.length === 1 && t >= "0" && t <= "9"
const isFunctional = (t: string) => t.length === 1 && (t === "_" || (t >= "a" && t <= "z") || (t >= "A" && t <= "Z"))
/** the parser's end marker `@@@@` (catcode 11, unlike a typed @) and \pgfmath@parse@stop */
const AT = "\u0001", STOP = "\u0000"

type State = (() => State) | null

class Parser implements PgfMathCtx {
  readonly a: TexArith
  private readonly toks: string[]
  private pos = 0
  private readonly pending: string[] = []
  private readonly operands: string[] = []
  private readonly ops: string[] = []
  private token = ""
  private tokenNext = ""
  private number = ""
  private octal = false
  private func = ""
  result = ""
  unitsDeclared = false

  constructor(private readonly expression: string, toks: string[], units: PgfUnits) {
    this.a = new TexArith(units)
    this.toks = [...toks, AT, AT, AT, AT, STOP]
  }

  error(message: string) {
    // \pgfmath@error goes through \PackageError; the message and TeX's own errors interleave in time
    this.a.errors.push(`Package PGF Math Error: ${message} (in '${this.expression}')`)
  }

  run(): string {
    let state: State = this.operand
    while (state) state = state.call(this)
    return this.result
  }

  /** the next token; with `skip`, spaces first gobbled (\pgfmath@parse@ifbgroup) */
  private read(skip: boolean): string {
    for (;;) {
      const t = this.pending.length ? this.pending.shift()! : this.toks[this.pos++]
      if (t === undefined || t === STOP) throw new Unsupported("pgfmath: expression ended early")
      if (t === "{") throw new Unsupported("pgfmath: braces")
      if (t === " " && skip) continue
      return t
    }
  }
  private peek(): string { return this.pending.length ? this.pending[0] : this.toks[this.pos] }
  /** a token put back in front of the input (`\expandafter\next\pgfmath@token`) */
  private unread(t: string) { this.pending.unshift(t) }
  private push(v: string) { this.result = v; this.operands.push(v) }
  private pop(): string {
    const v = this.operands.pop()
    if (v === undefined) throw new Unsupported("pgfmath: missing operand")
    return v
  }

  /** \pgfmath@parse@@operand: unary signs, prefix operators, a function name or a number */
  private operand(): State {
    const t = this.read(true)
    if (t === "+") return this.operand
    if (t === "-") { this.ops.push("neg"); return this.operand }
    if (OPS[t]?.prefix) {
      // \pgfmath@parse@prefix@operator: a prefix ! pushes the function not
      if (t === "!") { this.ops.push("not"); return this.operand }
      if (t !== "(") throw new Unsupported(`pgfmath: prefix ${t}`)
      this.ops.push(t)
      return this.operand
    }
    if (isFunctional(t)) { this.func = t; return this.functionFirst }
    this.number = ""
    this.octal = t === "0"
    this.tokenNext = t
    return this.numberRead
  }

  /** \pgfmath@parse@number: one token of lookahead */
  private numberRead(): State {
    const t = this.read(true)
    this.token = this.tokenNext
    this.tokenNext = t
    return this.numberStep
  }

  /** \pgfmath@parse@@number */
  private numberStep(): State {
    const t = this.token
    if (isDigit(t) || t === ".") {
      this.number += t
      if (t === ".") this.octal = false
      return this.numberRead
    }
    if (UNITS.has(t + this.tokenNext)) {
      this.unitsDeclared = true
      this.push(toNumber(this.a.dimen(this.number + t + this.tokenNext)))
      return this.operator2
    }
    if (t === "e" || t === "E") return this.exponent
    if (/^0[xXbB]$/.test(this.number + t)) throw new Unsupported("pgfmath: hexadecimal and binary numbers")
    if (t + this.tokenNext === "mu") throw new Unsupported("pgfmath: math units")
    if (this.number === "") throw new Unsupported(`pgfmath: "${t}" where a number belongs`)
    this.push(this.octal && this.number !== "0" ? fromOctal(this.number) : this.number)
    return this.operator3
  }

  /** \pgfmath@parse@exponent: `\pgfmath@count` scans an integer from the token after the e on */
  private exponent(): State {
    this.unread(this.tokenNext)
    let negative = false, t = this.read(true)
    for (; t === "+" || t === "-"; t = this.read(true)) if (t === "-") negative = !negative
    if (!isDigit(t)) throw new Unsupported("pgfmath: exponent without digits")
    let value = 0, big = false
    for (; isDigit(t); t = this.read(false)) {
      const d = t.charCodeAt(0) - 48
      if (value > 214748364 || (value === 214748364 && d > 7)) big = true
      else value = value * 10 + d
    }
    if (big) { this.a.errors.push("Number too big"); value = 2147483647 }
    if (t !== " ") this.unread(t) // scan_int's optional space
    this.push(scientific(this, this.number, negative ? -value : value))
    return this.operator2
  }

  /** \pgfmath@parse@function: the first letter's successors, spaces before them skipped */
  private functionFirst(): State { return this.functionBody(this.read(true)) }

  /** \pgfmath@parse@function@: a space ends the name (and stays) */
  private functionNext(): State {
    if (this.peek() === " ") { this.token = ""; return this.functionEnd }
    return this.functionBody(this.read(false))
  }

  /** \pgfmath@parse@@@function: letters, digits and _ make the name */
  private functionBody(t: string): State {
    if (isFunctional(t) || isDigit(t)) { this.func += t; return this.functionNext }
    this.token = t
    return this.functionEnd
  }

  /** \pgfmath@parse@@@@function: a constant is evaluated now, any other function pushed */
  private functionEnd(): State {
    const f = FUNCTIONS[this.func]
    if (!f || this.func.startsWith("@")) throw new Unsupported(`pgfmath: function ${this.func}`)
    if (this.token !== "") this.unread(this.token)
    if (f.arity === 0) {
      this.push(f.fn(this, []))
      return this.operator2
    }
    this.ops.push(this.func)
    return this.operand
  }

  /** \pgfmath@parse@operator: the held token is the operator */
  private operator1(): State {
    const t = this.read(true)
    this.token = this.tokenNext
    this.tokenNext = t
    return this.operator3
  }

  /** \pgfmath@parse@@operator: two fresh tokens */
  private operator2(): State {
    this.token = this.read(true)
    this.tokenNext = this.read(true)
    return this.operator3
  }

  /** \pgfmath@parse@@@operator */
  private operator3(): State {
    const t = this.token
    if (DOUBLE.has(t + this.tokenNext)) {
      // a double character operator is always followed by an operand
      this.process(t + this.tokenNext)
      return this.operand
    }
    const op = OPS[t === AT ? "@" : t]
    if (!op || !MODELED.has(t === AT ? "@" : t)) throw new Unsupported(`pgfmath: operator ${t}`)
    this.process(t === AT ? "@" : t)
    if (t === AT) return null // \pgfmath@parse@end
    if (op.postfix && this.tokenNext !== "[") return this.operator1
    this.unread(this.tokenNext)
    return this.operand
  }

  private precedence(top: string): number {
    return OPS[top]?.precedence ?? (top === "neg" ? 500 : 1000) // \pgfmath@operation@neg@precedence; functions 1000
  }

  /** \pgfmath@operation@process: apply what binds at least as tightly, then push the operator */
  private process(op: string) {
    while (this.ops.length) {
      const top = this.ops[this.ops.length - 1]
      if (this.precedence(op) > this.precedence(top)) break
      if (OPS[top]) this.applyOperator()
      else this.applyFunction()
      this.push(this.result)
      if (GROUPS.has(top + op)) break
    }
    if (!SPECIALS.has(op)) this.ops.push(op)
  }

  /** \pgfmath@operator@@@process */
  private applyOperator() {
    const op = OPS[this.ops.pop()!]
    const a = this.pop()
    if (op.arity === 1) this.result = this.call(op.name, [a])
    else if (op.arity === 2) {
      const b = this.pop()
      this.result = this.call(op.name, [b, a])
    } else {
      // ?: the condition, then the collected {then}{else} spread as two more arguments
      const b = this.pop()
      const rest = texArgs(a)
      if (rest.length !== 2) throw new Unsupported(`pgfmath: ${op.name} needs 3 arguments`)
      this.result = this.call(op.name, [b, ...rest])
    }
  }

  /** \pgfmath@function@@@process: a list operand spread over a function of two or more arguments */
  private applyFunction() {
    const name = this.ops.pop()!
    const operand = this.pop()
    const { arity } = FUNCTIONS[name]
    if (typeof arity === "number" && arity > 1) {
      const args = texArgs(operand)
      if (args.length !== arity) throw new Unsupported(`pgfmath: ${name} needs ${arity} arguments`)
      this.result = FUNCTIONS[name].fn(this, args)
    } else this.result = FUNCTIONS[name].fn(this, [operand])
  }

  private call(name: string, args: string[]): string {
    if (name === "@startgroup") return args[0]
    if (name === "@collect") return collect(args[0], args[1])
    if (name === "@@collect") return `{${args[0]}}{${args[1]}}` // \pgfmath@@collect@: no stripping
    return FUNCTIONS[name].fn(this, args)
  }
}

/** \pgfmath@bgroup@strip: braces around the whole removed while there are; and whether a brace begins what is left */
function strip(x: string): { stripped: string; bgroup: boolean } {
  for (;;) {
    if (!x.startsWith("{")) return { stripped: x, bgroup: false }
    let depth = 0, j = 0
    for (; j < x.length; j++) {
      if (x[j] === "{") depth++
      else if (x[j] === "}" && --depth === 0) break
    }
    if (j !== x.length - 1) return { stripped: x, bgroup: true }
    x = x.slice(1, -1)
  }
}

/** \pgfmath@collect@: `a,b` as the list {a}{b}, a list on the left extended */
function collect(a: string, b: string): string {
  const s = strip(a)
  return (s.bgroup && s.stripped === a ? s.stripped : `{${s.stripped}}`) + `{${strip(b).stripped}}`
}

/** \pgfmathbasetobase{…}{8}{10} for a number with a leading 0 */
function fromOctal(digits: string): string {
  if (!/^[0-7]+$/.test(digits)) throw new Unsupported("pgfmath: octal number with 8 or 9")
  const v = parseInt(digits, 8)
  if (v > 0x7fffffff) throw new Unsupported("pgfmath: octal number too big")
  return String(v)
}

/** the expression as TeX's tokens after \edef: characters, a run of blanks one space */
function tokens(expression: string): string[] {
  const out: string[] = []
  for (const c of expression) {
    if (!/^[0-9A-Za-z.+\-*/^()_,!<>=?:&|"\[\] \n\t{}]$/.test(c)) throw new Unsupported(`pgfmath: character "${c}"`)
    const t = c === "\n" || c === "\t" ? " " : c
    if (t === " " && out[out.length - 1] === " ") continue
    out.push(t)
  }
  return out
}

/** \pgfmathparse{expression} */
export function pgfmathParse(expression: string, units: PgfUnits): PgfMathResult {
  const toks = tokens(expression)
  const expanded = toks.join("")
  // \pgfmathparse@trynumber@loop: digits and periods only (no space, no brace): returned as is
  if (toks.every((t) => isDigit(t) || t === ".")) return { result: expanded, unitsDeclared: false, errors: [] }
  const p = new Parser(expanded, toks, units)
  const result = p.run()
  return { result, unitsDeclared: p.unitsDeclared, errors: p.a.errors }
}

/** \pgfmathsetmacro: the macro is \pgfmathresult */
export const pgfmathSetMacro = (expression: string, units: PgfUnits): PgfMathResult => pgfmathParse(expression, units)

/**
 * \pgfmathsetlength (pgfmathcalc.code.tex): the register set to \pgfmathresult pt; an expression beginning
 * with + is assigned by TeX directly.
 */
export function pgfmathSetLength(expression: string, units: PgfUnits): { value: number; errors: string[] } {
  if (expression.startsWith("+")) {
    const a = new TexArith(units)
    return { value: a.dimen(expression), errors: a.errors }
  }
  const r = pgfmathParse(expression, units)
  const a = new TexArith(units)
  const value = a.dimen(`${r.result}pt`)
  return { value, errors: [...r.errors, ...a.errors] }
}
