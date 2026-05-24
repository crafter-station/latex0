// Arity-aware, environment-aware recursive-descent parser.
// Turns the flat token stream into a tree the renderer can walk in one pass.

import { Tok, type Node, type Token } from "./types"

// How many mandatory {..} arguments well-known commands consume. Anything not
// listed takes 0 (it renders as a standalone symbol/command). This table is the
// single place to grow command coverage.
const ARITY: Record<string, number> = {
  // sectioning
  part: 1,
  chapter: 1,
  section: 1,
  subsection: 1,
  subsubsection: 1,
  paragraph: 1,
  subparagraph: 1,
  // text formatting
  textbf: 1,
  textit: 1,
  textsl: 1,
  texttt: 1,
  textsf: 1,
  textrm: 1,
  textsc: 1,
  textmd: 1,
  textup: 1,
  textnormal: 1,
  emph: 1,
  underline: 1,
  uline: 1,
  sout: 1,
  // math wrappers usable in text
  mathbf: 1,
  mathit: 1,
  mathrm: 1,
  mathsf: 1,
  mathtt: 1,
  mathcal: 1,
  mathbb: 1,
  mathfrak: 1,
  boldsymbol: 1,
  // structures
  frac: 2,
  dfrac: 2,
  tfrac: 2,
  binom: 2,
  sqrt: 1,
  overline: 1,
  hat: 1,
  bar: 1,
  vec: 1,
  tilde: 1,
  dot: 1,
  ddot: 1,
  text: 1,
  operatorname: 1,
  // document metadata
  title: 1,
  author: 1,
  date: 1,
  // references / links
  label: 1,
  ref: 1,
  eqref: 1,
  pageref: 1,
  cite: 1,
  footnote: 1,
  caption: 1,
  url: 1,
  href: 2,
  includegraphics: 1,
  // misc
  documentclass: 1,
  usepackage: 1,
  begin: 1, // handled specially, but keep arity for safety
  end: 1,
  color: 1,
  textcolor: 2,
  // spacing / boxes — listed so their dimension args are consumed, not leaked
  vspace: 1,
  hspace: 1,
  rule: 2,
  vskip: 1,
  hskip: 1,
  kern: 1,
  raisebox: 2,
  scalebox: 1,
  parbox: 2,
}

// Commands that have a starred form (\section*, ...). The star suppresses
// numbering; without this the "*" leaks into the title and the section is
// still numbered.
const STARRABLE = new Set([
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
])

// Commands whose single optional [..] argument we want to capture.
const TAKES_OPTIONAL = new Set([
  "sqrt",
  "includegraphics",
  "documentclass",
  "usepackage",
  "item",
  "begin",
  "bibliography",
  "bibliographystyle",
  "rule",
  "raisebox",
])

// Environments whose body we capture verbatim from source (the general tokens
// would mangle their bespoke syntax: tikzcd arrows, verbatim code, ...).
const RAW_ENVS = new Set([
  "tikzcd",
  "tikzpicture",
  "circuitikz",
  "pgfpicture",
  "verbatim",
  "verbatim*",
  "lstlisting",
  "minted",
])

export function parse(tokens: Token[], src = ""): Node[] {
  let pos = 0

  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  /** Parse a balanced {..} group, returning its body nodes. */
  function parseGroup(): Node[] {
    // assumes current token is OpenBrace
    next() // consume {
    const body: Node[] = []
    while (peek().kind !== Tok.CloseBrace && peek().kind !== Tok.EOF) {
      const node = parseNode(false)
      if (node) body.push(node)
    }
    if (peek().kind === Tok.CloseBrace) next() // consume }
    return body
  }

  /** Parse an optional [..] argument if the next token starts one. */
  function parseOptional(): Node[] | undefined {
    const t = peek()
    if (t.kind !== Tok.Text || t.value[0] !== "[") return undefined
    // The "[" lives inside a Text token. Scan forward collecting raw text up to
    // the matching "]" — optional args are simple (no nesting) in practice.
    let raw = ""
    // shave the leading "["
    const first = t.value.slice(1)
    const close = first.indexOf("]")
    if (close >= 0) {
      raw = first.slice(0, close)
      // put the remainder back as a text token
      const rest = first.slice(close + 1)
      next()
      if (rest) tokens.splice(pos, 0, { kind: Tok.Text, value: rest, pos: t.pos })
      return raw ? [{ kind: "text", value: raw }] : []
    }
    // "]" not in this token — consume tokens until we find it (rare path).
    next()
    raw = first
    while (peek().kind !== Tok.EOF) {
      const tk = peek()
      if (tk.kind === Tok.Text && tk.value.includes("]")) {
        const idx = tk.value.indexOf("]")
        raw += tk.value.slice(0, idx)
        const rest = tk.value.slice(idx + 1)
        next()
        if (rest) tokens.splice(pos, 0, { kind: Tok.Text, value: rest, pos: tk.pos })
        break
      }
      raw += tk.value
      next()
    }
    return raw ? [{ kind: "text", value: raw }] : []
  }

  /** Read one mandatory argument: a {group} or a single following token. */
  function parseArg(): Node[] {
    if (peek().kind === Tok.OpenBrace) return parseGroup()
    const node = parseNode(false)
    return node ? [node] : []
  }

  /**
   * Read the operand of ^ or _. Unlike a normal arg this binds to a *single
   * atom*: one {group}, one command, or just the first character of the next
   * text run (the rest is pushed back). This makes `x^2 + y` work.
   */
  function parseScriptArg(): Node {
    const t = peek()
    if (t.kind === Tok.OpenBrace) return { kind: "group", body: parseGroup() }
    if (t.kind === Tok.Command) return parseCommand(t) ?? { kind: "text", value: "" }
    if (t.kind === Tok.Text) {
      if (t.value.length <= 1) {
        next()
        return { kind: "text", value: t.value }
      }
      const first = t.value[0]
      tokens[pos] = { ...t, value: t.value.slice(1) } // leave the remainder in place
      return { kind: "text", value: first }
    }
    const node = parseNode(false)
    return node ?? { kind: "text", value: "" }
  }

  /** Parse \begin{env} ... \end{env}. Assumes `begin` command consumed. */
  function parseEnvironment(): Node {
    // environment name lives in a {group} that is a single text token
    const nameGroup = parseGroup()
    const name = (nameGroup[0] as { value?: string } | undefined)?.value?.trim() ?? ""

    // Raw environments: skip tokens to the matching \end{name} and slice the
    // original source between, so bespoke syntax survives untouched.
    if (RAW_ENVS.has(name) && src) {
      const startPos = peek().pos
      let endPos = src.length
      while (peek().kind !== Tok.EOF) {
        const t = peek()
        if (t.kind === Tok.Command && t.value === "end") {
          next() // consume \end
          const ng = peek().kind === Tok.OpenBrace ? parseGroup() : []
          const ename = (ng[0] as { value?: string } | undefined)?.value?.trim() ?? ""
          if (ename === name) {
            endPos = t.pos
            break
          }
          continue // a nested \end{other}; keep scanning
        }
        next()
      }
      return { kind: "environment", name, args: [], body: [], raw: src.slice(startPos, endPos) }
    }

    const optional = parseOptional()
    // tabular/array take a mandatory column-spec arg
    const args: Node[][] = []
    if (name === "tabular" || name === "array" || name === "tabularx") {
      args.push(parseArg())
    }

    const body: Node[] = []
    while (peek().kind !== Tok.EOF) {
      const t = peek()
      if (t.kind === Tok.Command && t.value === "end") {
        next() // consume \end
        parseGroup() // consume {name}
        break
      }
      const node = parseNode(true)
      if (node) body.push(node)
    }

    return { kind: "environment", name, optional, args, body }
  }

  /**
   * Parse one node. `inEnv` lets `&` and `\\` surface as structural nodes
   * (they only matter inside tabular/align, but are harmless elsewhere).
   */
  function parseNode(inEnv: boolean): Node | null {
    const t = peek()
    switch (t.kind) {
      case Tok.Text:
        next()
        return { kind: "text", value: t.value }

      case Tok.OpenBrace:
        return { kind: "group", body: parseGroup() }

      case Tok.CloseBrace:
        // stray close brace — skip
        next()
        return null

      case Tok.Dollar: {
        const display = t.n === 2
        next()
        return parseMathUntilDollar(display)
      }

      case Tok.Amp:
        next()
        return { kind: "align" }

      case Tok.Sup:
      case Tok.Sub: {
        next()
        return { kind: t.kind === Tok.Sup ? "sup" : "sub", body: parseScriptArg() }
      }

      case Tok.ParBreak:
        next()
        return { kind: "parbreak" }

      case Tok.Command:
        return parseCommand(t)

      case Tok.Comment:
        next()
        return null

      default:
        next()
        return null
    }
    void inEnv
  }

  function parseCommand(t: Token): Node | null {
    const name = t.value
    next() // consume command

    // structural control symbols
    if (name === "\\") return { kind: "linebreak" }
    if (name === "begin") return parseEnvironment()
    if (name === "[") return parseMathUntilClose(true, "]")
    if (name === "(") return parseMathUntilClose(false, ")")

    // starred form: \section*{...}
    let star = false
    if (STARRABLE.has(name)) {
      const t2 = peek()
      if (t2.kind === Tok.Text && t2.value[0] === "*") {
        star = true
        if (t2.value.length === 1) next()
        else tokens[pos] = { ...t2, value: t2.value.slice(1) }
      }
    }

    const optional = TAKES_OPTIONAL.has(name) ? parseOptional() : undefined
    const arity = ARITY[name] ?? 0
    const args: Node[][] = []
    for (let k = 0; k < arity; k++) args.push(parseArg())

    return { kind: "command", name, star, optional, args }
  }

  /** Math opened by `$`/`$$`; closes on the matching dollar. */
  function parseMathUntilDollar(display: boolean): Node {
    const body: Node[] = []
    while (peek().kind !== Tok.EOF) {
      const t = peek()
      if (t.kind === Tok.Dollar) {
        next()
        break
      }
      const node = parseNode(false)
      if (node) body.push(node)
    }
    return { kind: "math", display, body }
  }

  /** Math opened by \[ or \(; closes on \] or \). */
  function parseMathUntilClose(display: boolean, closer: string): Node {
    const body: Node[] = []
    while (peek().kind !== Tok.EOF) {
      const t = peek()
      if (t.kind === Tok.Command && t.value === closer) {
        next()
        break
      }
      const node = parseNode(false)
      if (node) body.push(node)
    }
    return { kind: "math", display, body }
  }

  const nodes: Node[] = []
  while (peek().kind !== Tok.EOF) {
    const node = parseNode(false)
    if (node) nodes.push(node)
  }
  return nodes
}
