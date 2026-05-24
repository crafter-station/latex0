// Math-mode renderer. Produces dependency-free HTML laid out with CSS
// (see styles.ts): fractions, roots, scripts, accents, operators, delimiters.

import { SYMBOLS, OPERATORS, mapAlphabet } from "./symbols"
import type { Node } from "./types"
import { escapeHtml, GRAPHICS_ENVS, graphicsPlaceholder } from "./util"

const ACCENTS: Record<string, string> = {
  hat: "^",
  widehat: "^",
  bar: "‾",
  overline: "‾",
  vec: "→",
  tilde: "~",
  widetilde: "~",
  dot: "˙",
  ddot: "¨",
  check: "ˇ",
  acute: "´",
  grave: "`",
}

const FONT_CLASS: Record<string, string> = {
  mathbf: "l0-bf",
  boldsymbol: "l0-bf",
  mathrm: "l0-rm",
  mathsf: "l0-sf",
  mathtt: "l0-tt",
  mathit: "l0-it",
}

/** Render a sequence of math nodes to an HTML fragment. */
export function renderMathList(nodes: Node[]): string {
  let out = ""
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.kind === "sup" || node.kind === "sub") {
      const tag = node.kind === "sup" ? "sup" : "sub"
      out += `<${tag} class="l0-${tag}">${renderMathNode(node.body)}</${tag}>`
    } else {
      out += renderMathNode(node)
    }
  }
  return out
}

function renderMathNode(node: Node): string {
  switch (node.kind) {
    case "text":
      return renderMathText(node.value)

    case "group":
      return renderMathList(node.body)

    case "math": // nested \( inside text that bubbled here — flatten
      return renderMathList(node.body)

    case "sup":
      return `<sup class="l0-sup">${renderMathNode(node.body)}</sup>`
    case "sub":
      return `<sub class="l0-sub">${renderMathNode(node.body)}</sub>`

    case "linebreak":
      return "<br/>"
    case "align":
      return "" // column breaks are handled by environment renderers
    case "parbreak":
      return " "

    case "command":
      return renderMathCommand(node.name, node.args, node.optional)

    case "environment":
      return renderMathEnvironment(node)

    default:
      return ""
  }
}

function renderMathCommand(name: string, args: Node[][], optional?: Node[]): string {
  // fractions
  if (name === "frac" || name === "dfrac" || name === "tfrac") {
    const num = renderMathList(args[0] ?? [])
    const den = renderMathList(args[1] ?? [])
    return `<span class="l0-frac"><span class="l0-num">${num}</span><span class="l0-den">${den}</span></span>`
  }
  if (name === "binom") {
    const top = renderMathList(args[0] ?? [])
    const bot = renderMathList(args[1] ?? [])
    return `<span class="l0-paren">(</span><span class="l0-binom"><span>${top}</span><span>${bot}</span></span><span class="l0-paren">)</span>`
  }

  // roots
  if (name === "sqrt") {
    const idx = optional ? `<span class="l0-root-idx">${renderMathList(optional)}</span>` : ""
    const body = renderMathList(args[0] ?? [])
    return `${idx}<span class="l0-sqrt"><span class="l0-sqrt-sign">√</span><span class="l0-sqrt-body">${body}</span></span>`
  }

  // accents
  if (name in ACCENTS) {
    const body = renderMathList(args[0] ?? [])
    return `<span class="l0-accent"><span class="l0-accent-mark">${ACCENTS[name]}</span>${body}</span>`
  }

  // alphabet maps
  if (name === "mathbb") return `<span class="l0-rm">${escapeHtml(mapAlphabet(flatten(args[0]), "bb"))}</span>`
  if (name === "mathcal") return `<span class="l0-rm">${escapeHtml(mapAlphabet(flatten(args[0]), "cal"))}</span>`

  // font wrappers
  if (name in FONT_CLASS) {
    return `<span class="${FONT_CLASS[name]}">${renderMathList(args[0] ?? [])}</span>`
  }

  // upright text inside math
  if (name === "text" || name === "textrm" || name === "mbox") {
    return `<span class="l0-text">${escapeHtml(flatten(args[0]))}</span>`
  }
  if (name === "operatorname") {
    return `<span class="l0-op">${escapeHtml(flatten(args[0]))}</span>`
  }

  // named operators: \sin \log \lim ...
  if (OPERATORS.has(name)) {
    return `<span class="l0-op">${name}</span>`
  }

  // scaled delimiters: render the delimiter that follows as ordinary text
  if (name === "left" || name === "right" || name === "middle") return ""
  if (name === "big" || name === "Big" || name === "bigg" || name === "Bigg") return ""

  // spacing
  if (name === "," || name === ":" || name === ";" || name === " " || name === "quad") return "<span class=\"l0-space\"></span>"
  if (name === "qquad") return "<span class=\"l0-space l0-space2\"></span>"
  if (name === "!") return ""
  if (name === "\\") return "<br/>"

  // spacing / box commands: consume args, print nothing (or just the content)
  if (name === "vspace" || name === "hspace" || name === "vskip" || name === "hskip" || name === "kern" || name === "rule") return ""
  if (name === "raisebox" || name === "scalebox") return renderMathList(args[args.length - 1] ?? [])
  if (name === "parbox") return renderMathList(args[1] ?? [])

  // equation bookkeeping commands render nothing in the math body
  if (name === "label" || name === "nonumber" || name === "notag" || name === "tag" || name === "qedhere") return ""
  if (name === "nolimits" || name === "limits" || name === "displaystyle" || name === "textstyle" || name === "scriptstyle") return ""

  // symbol table
  const sym = SYMBOLS[name]
  if (sym !== undefined) return escapeHtml(sym)

  // escaped delimiters and literals: \{ \} \| \% \& \# \$ \_
  if (name === "{") return "{"
  if (name === "}") return "}"
  if (name === "|") return "∥"
  if (name === "%" || name === "&" || name === "#" || name === "$" || name === "_") {
    return escapeHtml(name)
  }

  // unknown control sequence — show it so problems are visible, not silent
  return `<span class="l0-unknown">\\${escapeHtml(name)}</span>`
}

// matrices / cases / aligned environments inside math
function renderMathEnvironment(node: Node & { kind: "environment" }): string {
  const name = node.name
  if (GRAPHICS_ENVS.has(name)) return graphicsPlaceholder(name)
  const rows = splitRows(node.body)

  if (name === "cases") {
    const body = rows
      .map((r) => `<span class="l0-row">${r.map((c) => renderMathList(c)).join('<span class="l0-cell-gap"></span>')}</span>`)
      .join("")
    return `<span class="l0-cases"><span class="l0-brace">{</span><span class="l0-cases-body">${body}</span></span>`
  }

  if (
    name === "matrix" || name === "pmatrix" || name === "bmatrix" ||
    name === "Bmatrix" || name === "vmatrix" || name === "Vmatrix" ||
    name === "smallmatrix" || name === "array" || name === "aligned" ||
    name === "align" || name === "align*" || name === "gathered"
  ) {
    const opens: Record<string, string> = { pmatrix: "(", bmatrix: "[", Bmatrix: "{", vmatrix: "|", Vmatrix: "‖" }
    const closes: Record<string, string> = { pmatrix: ")", bmatrix: "]", Bmatrix: "}", vmatrix: "|", Vmatrix: "‖" }
    const open = opens[name] ?? ""
    const close = closes[name] ?? ""
    const grid = rows
      .map((r) => `<span class="l0-mrow">${r.map((c) => `<span class="l0-mcell">${renderMathList(c)}</span>`).join("")}</span>`)
      .join("")
    const lhs = open ? `<span class="l0-delim">${open}</span>` : ""
    const rhs = close ? `<span class="l0-delim">${close}</span>` : ""
    return `<span class="l0-matrix-wrap">${lhs}<span class="l0-matrix">${grid}</span>${rhs}</span>`
  }

  // fallback: render the body inline
  return renderMathList(node.body)
}

/** Split an environment body into rows (on \\) and cells (on &). */
function splitRows(body: Node[]): Node[][][] {
  const rows: Node[][][] = []
  let row: Node[][] = []
  let cell: Node[] = []
  for (const n of body) {
    if (n.kind === "linebreak") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = []
    } else if (n.kind === "align") {
      row.push(cell)
      cell = []
    } else {
      cell.push(n)
    }
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** Render math text: letters italic, digits/operators upright. */
function renderMathText(value: string): string {
  let out = ""
  let i = 0
  const len = value.length
  while (i < len) {
    const c = value.charCodeAt(i)
    const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    if (isLetter) {
      let j = i
      while (j < len) {
        const cc = value.charCodeAt(j)
        if (!((cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122))) break
        j++
      }
      out += `<span class="l0-var">${escapeHtml(value.slice(i, j))}</span>`
      i = j
    } else if (c === 32 || c === 9 || c === 10 || c === 13) {
      i++ // collapse all whitespace in math
    } else if (c === 39) {
      // ' -> prime (and '' -> double prime, etc.)
      let j = i
      while (j < len && value.charCodeAt(j) === 39) j++
      const n = j - i
      const mark = n === 1 ? "′" : n === 2 ? "″" : n === 3 ? "‴" : "′".repeat(n)
      out += `<sup class="l0-sup">${mark}</sup>`
      i = j
    } else {
      let j = i
      while (j < len) {
        const cc = value.charCodeAt(j)
        const ws = cc === 32 || cc === 9 || cc === 10 || cc === 13
        if (((cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122)) || ws) break
        j++
      }
      out += escapeHtml(value.slice(i, j))
      i = j
    }
  }
  return out
}

/** Flatten nodes to plain text (for arguments that must be literal). */
function flatten(nodes?: Node[]): string {
  if (!nodes) return ""
  let out = ""
  for (const n of nodes) {
    if (n.kind === "text") out += n.value
    else if (n.kind === "group") out += flatten(n.body)
    else if (n.kind === "command") out += SYMBOLS[n.name] ?? n.name
  }
  return out
}
