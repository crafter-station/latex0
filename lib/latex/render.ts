// Text-mode (document) renderer. Walks the AST once, grouping inline content
// into paragraphs and emitting block elements for sections, lists, tables,
// figures, environments and display math. Math is delegated to math.ts.

import { renderMathList, renderMathString } from "./math"
import { SYMBOLS, ESCAPES, mapAlphabet, TEXT_ACCENTS } from "./symbols"
import { renderTikzcd } from "./tikzcd"
import type { CommandNode, EnvironmentNode, Node } from "./types"
import { escapeHtml, GRAPHICS_ENVS, graphicsPlaceholder } from "./util"

export interface RenderOptions {
  /** Map of image path -> resolvable URL (for \includegraphics). */
  images?: Record<string, string>
}

const SECTION_LEVEL: Record<string, number> = {
  section: 1,
  subsection: 2,
  subsubsection: 3,
}

const FONT_TAG: Record<string, [string, string]> = {
  textbf: ["<strong>", "</strong>"],
  textit: ["<em>", "</em>"],
  textsl: ['<span class="l0-it">', "</span>"],
  emph: ["<em>", "</em>"],
  underline: ["<u>", "</u>"],
  uline: ["<u>", "</u>"],
  sout: ["<s>", "</s>"],
  texttt: ['<code class="l0-tt">', "</code>"],
  textsf: ['<span class="l0-sf">', "</span>"],
  textrm: ['<span class="l0-rm">', "</span>"],
  textsc: ['<span class="l0-sc">', "</span>"],
  textmd: ["<span>", "</span>"],
  textup: ["<span>", "</span>"],
  textnormal: ["<span>", "</span>"],
  mathbf: ["<strong>", "</strong>"],
}

class Renderer {
  private images: Record<string, string>
  private counters = [0, 0, 0] // section / subsection / subsubsection
  private eqCounter = 0
  private figCounter = 0
  private tableCounter = 0
  private bibCounter = 0
  private labels: Record<string, string> = {}
  private cites: Record<string, string> = {}
  private lastNumber = ""
  private currentFloat: "figure" | "table" | null = null
  private currentFloatNum = ""
  private title = ""
  private author = ""
  private date = ""

  constructor(opts: RenderOptions, seed?: { labels: Record<string, string>; cites: Record<string, string> }) {
    this.images = opts.images ?? {}
    if (seed) {
      this.labels = { ...seed.labels }
      this.cites = { ...seed.cites }
    }
  }

  /** Reference maps after a render pass — used to seed the resolving pass. */
  getRefs() {
    return { labels: this.labels, cites: this.cites }
  }

  render(ast: Node[]): string {
    // Pull metadata out of the preamble.
    for (const node of ast) {
      if (node.kind === "command") {
        if (node.name === "title") this.title = this.renderInlineList(node.args[0] ?? [])
        else if (node.name === "author") this.author = this.renderInlineList(node.args[0] ?? [])
        else if (node.name === "date") this.date = this.renderInlineList(node.args[0] ?? [])
      }
    }
    // Render the document environment body if present; else the whole stream.
    const doc = findDocument(ast)
    const body = doc ? doc.body : ast
    return this.renderBlocks(body)
  }

  private renderBlocks(nodes: Node[]): string {
    let html = ""
    let para = ""
    const flush = () => {
      const trimmed = para.trim()
      if (trimmed) html += `<p>${trimmed}</p>`
      para = ""
    }
    for (const node of nodes) {
      if (node.kind === "parbreak") {
        flush()
      } else if (this.isBlock(node)) {
        flush()
        html += this.renderBlock(node)
      } else {
        para += this.renderInline(node)
      }
    }
    flush()
    return html
  }

  private isBlock(node: Node): boolean {
    if (node.kind === "environment") return true
    if (node.kind === "math") return node.display
    if (node.kind === "command") {
      const n = node.name
      return (
        n in SECTION_LEVEL ||
        n === "part" ||
        n === "chapter" ||
        n === "maketitle" ||
        n === "tableofcontents" ||
        n === "hrule" ||
        n === "newpage" ||
        n === "clearpage"
      )
    }
    return false
  }

  private renderBlock(node: Node): string {
    if (node.kind === "math") {
      return `<div class="l0-display">${renderMathList(node.body)}</div>`
    }
    if (node.kind === "environment") return this.renderEnvironment(node)
    if (node.kind === "command") return this.renderBlockCommand(node)
    return ""
  }

  private renderBlockCommand(node: CommandNode): string {
    const n = node.name
    if (n in SECTION_LEVEL) {
      const level = SECTION_LEVEL[n]
      const inner = this.renderInlineList(node.args[0] ?? [])
      const tag = `h${Math.min(level + 1, 6)}`
      if (node.star) {
        // starred form: no number, no counter bump
        return `<${tag} class="l0-h l0-h${level}">${inner}</${tag}>`
      }
      this.counters[level - 1]++
      for (let k = level; k < this.counters.length; k++) this.counters[k] = 0
      const num = this.counters.slice(0, level).join(".")
      this.lastNumber = num
      return `<${tag} class="l0-h l0-h${level}"><span class="l0-secnum">${num}</span> ${inner}</${tag}>`
    }
    if (n === "part" || n === "chapter") {
      const inner = this.renderInlineList(node.args[0] ?? [])
      return `<h1 class="l0-h l0-chapter">${inner}</h1>`
    }
    if (n === "maketitle") return this.renderTitle()
    if (n === "tableofcontents") return "" // omitted in MVP
    if (n === "hrule") return '<hr class="l0-hrule"/>'
    if (n === "newpage" || n === "clearpage") return '<div class="l0-pagebreak"></div>'
    return ""
  }

  private renderTitle(): string {
    if (!this.title && !this.author && !this.date) return ""
    const date = this.date || todayString()
    return (
      '<header class="l0-titleblock">' +
      (this.title ? `<h1 class="l0-doctitle">${this.title}</h1>` : "") +
      (this.author ? `<div class="l0-author">${this.author}</div>` : "") +
      `<div class="l0-date">${date}</div>` +
      "</header>"
    )
  }

  private renderEnvironment(env: EnvironmentNode): string {
    const name = env.name
    if (name === "tikzcd" && env.raw) return renderTikzcd(env.raw, renderMathString)
    if (GRAPHICS_ENVS.has(name)) return graphicsPlaceholder(name)
    switch (name) {
      case "document":
        return this.renderBlocks(env.body)
      case "itemize":
        return `<ul class="l0-list">${this.renderItems(env.body, false)}</ul>`
      case "enumerate":
        return `<ol class="l0-list">${this.renderItems(env.body, true)}</ol>`
      case "description":
        return `<dl class="l0-desc">${this.renderDescItems(env.body)}</dl>`
      case "minipage": {
        // {width} arg (e.g. 0.49\linewidth) -> a % so \hfill-separated boxes
        // can sit side by side. Rendered as inline-block.
        const w = minipageWidth(env.args[0])
        return `<div class="l0-minipage"${w ? ` style="width:${w}"` : ""}>${this.renderBlocks(env.body)}</div>`
      }
      case "center":
        return `<div class="l0-center">${this.renderBlocks(env.body)}</div>`
      case "flushleft":
        return `<div class="l0-left">${this.renderBlocks(env.body)}</div>`
      case "flushright":
        return `<div class="l0-right">${this.renderBlocks(env.body)}</div>`
      case "quote":
      case "quotation":
        return `<blockquote class="l0-quote">${this.renderBlocks(env.body)}</blockquote>`
      case "verbatim":
      case "verbatim*":
      case "lstlisting":
        return `<pre class="l0-verbatim">${escapeHtml((env.raw ?? flattenRaw(env.body)).replace(/^\n/, "").replace(/\n$/, ""))}</pre>`
      case "abstract":
        return `<div class="l0-abstract"><div class="l0-abstract-title">Abstract</div>${this.renderBlocks(env.body)}</div>`
      case "figure":
      case "figure*":
        return this.renderFloat(env, "figure")
      case "table":
      case "table*":
        return this.renderFloat(env, "table")
      case "thebibliography":
        return this.renderBibliography(env)
      case "tabular":
      case "tabularx":
      case "array":
        return this.renderTabular(env)
      case "equation":
      case "equation*":
      case "align":
      case "align*":
      case "gather":
      case "gather*":
      case "multline":
      case "multline*": {
        const numbered = !name.endsWith("*")
        this.collectLabels(env.body)
        let no = ""
        if (numbered) {
          this.eqCounter++
          this.lastNumber = String(this.eqCounter)
          this.registerLabels(env.body, this.lastNumber)
          no = `<span class="l0-eqno">(${this.eqCounter})</span>`
        }
        return `<div class="l0-display l0-eq">${renderMathList(env.body)}${no}</div>`
      }
      default:
        // theorem-like / unknown environments: render the body
        return `<div class="l0-env">${this.renderBlocks(env.body)}</div>`
    }
  }

  private renderItems(body: Node[], ordered: boolean): string {
    void ordered
    const items = splitItems(body)
    return items
      .map((it) => {
        const inner = this.renderBlocks(it.nodes)
        const content = stripParagraph(inner)
        const label = it.label ? ` data-label="${escapeHtml(it.label)}"` : ""
        return `<li class="l0-item"${label}>${content}</li>`
      })
      .join("")
  }

  private renderDescItems(body: Node[]): string {
    const items = splitItems(body)
    return items
      .map((it) => {
        const term = it.label ? `<dt class="l0-dt">${escapeHtml(it.label)}</dt>` : ""
        return `${term}<dd class="l0-dd">${stripParagraph(this.renderBlocks(it.nodes))}</dd>`
      })
      .join("")
  }

  private renderFloat(env: EnvironmentNode, type: "figure" | "table"): string {
    // Set the float context so a nested \caption knows its kind and number.
    const prevFloat = this.currentFloat
    const prevNum = this.currentFloatNum
    const num = type === "figure" ? ++this.figCounter : ++this.tableCounter
    this.currentFloat = type
    this.currentFloatNum = String(num)
    this.lastNumber = String(num) // \label inside resolves to the float number
    const inner = this.renderBlocks(env.body)
    this.currentFloat = prevFloat
    this.currentFloatNum = prevNum
    const tag = type === "figure" ? "figure" : "div"
    return `<${tag} class="l0-figure">${inner}</${tag}>`
  }

  private renderBibliography(env: EnvironmentNode): string {
    const items: { num: number; nodes: Node[] }[] = []
    for (const n of env.body) {
      if (n.kind === "command" && n.name === "bibitem") {
        const key = flattenRaw(n.args[0] ?? [])
        const num = ++this.bibCounter
        this.cites[key] = String(num)
        items.push({ num, nodes: [] })
      } else if (items.length) {
        items[items.length - 1].nodes.push(n)
      }
    }
    const body = items
      .map((it) => `<li class="l0-bibitem" value="${it.num}">${stripParagraph(this.renderBlocks(it.nodes))}</li>`)
      .join("")
    return `<div class="l0-bibliography"><h2 class="l0-h l0-h1">References</h2><ol class="l0-biblist">${body}</ol></div>`
  }

  private renderTabular(env: EnvironmentNode): string {
    const spec = parseColSpec(flattenSpec(env.args[0]))
    const { rows, bottomRule } = splitTableRows(env.body)

    const trs = rows
      .map((row, ri) => {
        const isLast = ri === rows.length - 1
        let col = 0
        const tds = row.cells
          .map((cellNodes) => {
            const mc = asMulticolumn(cellNodes)
            const span = mc ? mc.span : 1
            // borders from the column spec + horizontal rules
            const borders: string[] = []
            if (spec.rules[col]) borders.push("border-left:1px solid currentColor")
            if (spec.rules[col + span]) borders.push("border-right:1px solid currentColor")
            if (row.top) borders.push("border-top:1px solid currentColor")
            if (isLast && bottomRule) borders.push("border-bottom:1px solid currentColor")
            const align = mc ? mc.align : spec.aligns[col] ?? "l"
            borders.push(`text-align:${ALIGN[align] ?? "left"}`)
            const content = stripParagraph(
              this.renderBlocks(mc ? mc.content : cellNodes)
            )
            col += span
            const spanAttr = span > 1 ? ` colspan="${span}"` : ""
            return `<td class="l0-td"${spanAttr} style="${borders.join(";")}">${content}</td>`
          })
          .join("")
        return `<tr class="l0-tr">${tds}</tr>`
      })
      .join("")
    return `<table class="l0-table"><tbody>${trs}</tbody></table>`
  }

  // ---- inline ----

  private renderInlineList(nodes: Node[]): string {
    let out = ""
    for (const n of nodes) out += this.renderInline(n)
    return out
  }

  private renderInline(node: Node): string {
    switch (node.kind) {
      case "text":
        return escapeHtml(applyLigatures(node.value.replace(/\s+/g, " ")))
      case "group":
        return this.renderInlineList(node.body)
      case "math":
        return node.display
          ? `<div class="l0-display">${renderMathList(node.body)}</div>`
          : `<span class="l0-math">${renderMathList(node.body)}</span>`
      case "linebreak":
        return "<br/>"
      case "parbreak":
        return " "
      case "sup":
        return `<sup>${this.renderInline(node.body)}</sup>`
      case "sub":
        return `<sub>${this.renderInline(node.body)}</sub>`
      case "command":
        return this.renderInlineCommand(node)
      default:
        return ""
    }
  }

  private renderInlineCommand(node: CommandNode): string {
    const n = node.name

    // escaped single characters: \% \& \_ \$ \{ \} \# \, etc.
    if (n.length === 1 && n in ESCAPES) return escapeHtml(ESCAPES[n])

    // text accents: base glyph + combining diacritic (\'e -> é, \c{c} -> ç)
    if (n in TEXT_ACCENTS) {
      return this.renderInlineList(node.args[0] ?? []) + TEXT_ACCENTS[n]
    }

    // font / formatting wrappers
    const tag = FONT_TAG[n]
    if (tag) return `${tag[0]}${this.renderInlineList(node.args[0] ?? [])}${tag[1]}`

    if (n === "mathbb") return `<span class="l0-rm">${escapeHtml(mapAlphabet(flattenRaw(node.args[0] ?? []), "bb"))}</span>`
    if (n === "mathcal") return `<span class="l0-rm">${escapeHtml(mapAlphabet(flattenRaw(node.args[0] ?? []), "cal"))}</span>`

    // links — URLs are scheme-checked: untrusted documents must not be able to
    // smuggle javascript:/data: handlers through \href / \url.
    if (n === "url") {
      const u = flattenRaw(node.args[0] ?? [])
      return `<a class="l0-link" href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u)}</a>`
    }
    if (n === "href") {
      const u = flattenRaw(node.args[0] ?? [])
      const text = this.renderInlineList(node.args[1] ?? [])
      return `<a class="l0-link" href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    }

    // references
    if (n === "ref" || n === "pageref") {
      const key = flattenRaw(node.args[0] ?? [])
      return `<span class="l0-ref">${this.labels[key] ?? "??"}</span>`
    }
    if (n === "eqref") {
      const key = flattenRaw(node.args[0] ?? [])
      return `<span class="l0-ref">(${this.labels[key] ?? "??"})</span>`
    }
    if (n === "label") {
      this.labels[flattenRaw(node.args[0] ?? [])] = this.lastNumber
      return ""
    }
    if (n === "cite" || n === "citep" || n === "citet") {
      const keys = flattenRaw(node.args[0] ?? []).split(",").map((k) => k.trim()).filter(Boolean)
      const nums = keys.map((k) => this.cites[k] ?? "?").join(", ")
      return `<span class="l0-cite">[${nums}]</span>`
    }
    if (n === "footnote") {
      return `<span class="l0-footnote">(${this.renderInlineList(node.args[0] ?? [])})</span>`
    }

    // images
    if (n === "includegraphics") {
      const path = flattenRaw(node.args[0] ?? [])
      const base = path.replace(/^.*\//, "")
      const resolved = this.images[path] ?? this.images[base]
      const style = imgStyle(flattenRaw(node.optional ?? []))
      const styleAttr = style ? ` style="${escapeHtml(style)}"` : ""
      // No resolvable URL: show a tidy placeholder rather than emitting an
      // <img> whose broken `alt` would dump the raw filename into the page.
      if (!resolved) return imgFallback(base, style)
      // Resolvable but the load can still fail at runtime — swap the broken
      // <img> for the same placeholder instead of leaking the path via `alt`.
      const onerror = escapeHtml(`this.outerHTML=${JSON.stringify(imgFallback(base, style))}`)
      return `<img class="l0-img"${styleAttr} src="${escapeHtml(resolved)}" alt="" onerror="${onerror}"/>`
    }
    if (n === "caption") {
      const kind = this.currentFloat === "table" ? "Table" : "Figure"
      const num = this.currentFloatNum || "?"
      this.lastNumber = num // a \label after \caption resolves to the float number
      const body = this.renderInlineList(node.args[0] ?? [])
      return `<figcaption class="l0-caption"><span class="l0-caption-label">${kind}&nbsp;${num}:</span> ${body}</figcaption>`
    }

    // color
    if (n === "textcolor") {
      const color = flattenRaw(node.args[0] ?? [])
      return `<span style="color:${cssColor(color)}">${this.renderInlineList(node.args[1] ?? [])}</span>`
    }

    // spacing / boxes — consume the dimension args without printing them
    if (n === "vspace" || n === "vskip") return ""
    if (n === "hspace" || n === "hskip" || n === "kern") return '<span class="l0-space"></span>'
    if (n === "rule") return "" // a typographic rule; not drawn in MVP
    // boxes: render only the content (last) argument
    if (
      n === "raisebox" || n === "scalebox" || n === "resizebox" || n === "parbox" ||
      n === "fbox" || n === "mbox" || n === "framebox" || n === "makebox"
    ) {
      return this.renderInlineList(node.args[node.args.length - 1] ?? [])
    }

    // logos / dates / spacing
    if (n === "LaTeX") return '<span class="l0-latex">L<sup>a</sup>T<sub>e</sub>X</span>'
    if (n === "TeX") return '<span class="l0-latex">T<sub>e</sub>X</span>'
    if (n === "today") return escapeHtml(todayString())
    if (n === "quad") return '<span class="l0-space"></span>'
    if (n === "qquad") return '<span class="l0-space l0-space2"></span>'
    if (n === "newline" || n === "\\") return "<br/>"
    if (n === "ldots" || n === "dots") return "…"

    // generic symbol (e.g. \S, \P, \pounds, \copyright in text)
    const sym = SYMBOLS[n]
    if (sym !== undefined) return escapeHtml(sym)

    // unknown: don't lose content — render any arguments inline
    if (node.args.length) return node.args.map((a) => this.renderInlineList(a)).join("")
    return ""
  }

  // ---- label pre-registration for equations ----

  private collectLabels(_body: Node[]): void {
    /* reserved for a future two-pass; single pass handled in registerLabels */
  }

  private registerLabels(body: Node[], num: string): void {
    for (const n of body) {
      if (n.kind === "command" && n.name === "label") {
        this.labels[flattenRaw(n.args[0] ?? [])] = num
      } else if (n.kind === "group") {
        this.registerLabels(n.body, num)
      }
    }
  }
}

// ---- module-level helpers ----

function findDocument(ast: Node[]): EnvironmentNode | null {
  for (const n of ast) {
    if (n.kind === "environment" && n.name === "document") return n
  }
  return null
}

interface Item {
  label?: string
  nodes: Node[]
}

/** Split an environment body on \item commands. */
function splitItems(body: Node[]): Item[] {
  const items: Item[] = []
  let current: Item | null = null
  for (const n of body) {
    if (n.kind === "command" && n.name === "item") {
      current = { nodes: [] }
      const opt = n.optional
      if (opt && opt.length) current.label = flattenRaw(opt)
      items.push(current)
    } else if (current) {
      current.nodes.push(n)
    }
    // content before the first \item is dropped (matches LaTeX behaviour)
  }
  return items
}

const ALIGN: Record<string, string> = { l: "left", c: "center", r: "right" }
const RULE_CMDS = new Set(["hline", "toprule", "midrule", "bottomrule", "cline"])

interface TableRow {
  cells: Node[][]
  top: boolean // horizontal rule above this row
}

/**
 * Split a tabular body into rows (on \\) and cells (on &), tracking horizontal
 * rules (\hline, booktabs rules) as a "rule above" flag per row plus a trailing
 * bottom-rule flag.
 */
function splitTableRows(body: Node[]): { rows: TableRow[]; bottomRule: boolean } {
  const rows: TableRow[] = []
  let row: Node[][] = []
  let cell: Node[] = []
  let hasContent = false
  let pendingRule = false

  const flushRow = () => {
    row.push(cell)
    rows.push({ cells: row, top: pendingRule })
    row = []
    cell = []
    hasContent = false
    pendingRule = false
  }

  for (const n of body) {
    if (n.kind === "linebreak") {
      flushRow()
    } else if (n.kind === "align") {
      row.push(cell)
      cell = []
    } else if (n.kind === "command" && RULE_CMDS.has(n.name)) {
      if (!hasContent && !row.length) pendingRule = true // rule before this row
    } else {
      cell.push(n)
      if (!(n.kind === "parbreak") && !(n.kind === "text" && n.value.trim() === "")) {
        hasContent = true
      }
    }
  }
  // Final row without a trailing \\; a trailing \hline becomes the bottom rule.
  let bottomRule = false
  if (hasContent || row.length || cell.length > 0) {
    if (hasContent || cell.some((c) => !(c.kind === "text" && c.value.trim() === ""))) flushRow()
  }
  if (pendingRule) bottomRule = true
  return { rows, bottomRule }
}

/** Parse a tabular column spec like {|l|c|r|} or {*{4}{c}}. */
function parseColSpec(s: string): { aligns: string[]; rules: boolean[] } {
  const aligns: string[] = []
  const rules: boolean[] = []
  let pending = false
  const skipBrace = (str: string, i: number): number => {
    if (str[i] !== "{") return i
    let d = 0
    for (let j = i; j < str.length; j++) {
      if (str[j] === "{") d++
      else if (str[j] === "}" && --d === 0) return j
    }
    return str.length
  }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === "|") pending = true
    else if (ch === "l" || ch === "c" || ch === "r") {
      rules.push(pending)
      aligns.push(ch)
      pending = false
    } else if (ch === "p" || ch === "m" || ch === "b") {
      rules.push(pending)
      aligns.push("l")
      pending = false
      i = skipBrace(s, i + 1)
    } else if (ch === "@" || ch === "!" || ch === ">" || ch === "<") {
      i = skipBrace(s, i + 1)
    } else if (ch === "*") {
      // *{n}{cols}
      const nEnd = skipBrace(s, i + 1)
      const n = parseInt(s.slice(i + 2, nEnd), 10) || 0
      const colsEnd = skipBrace(s, nEnd + 1)
      const sub = parseColSpec(s.slice(nEnd + 2, colsEnd))
      for (let k = 0; k < n; k++) {
        for (let c = 0; c < sub.aligns.length; c++) {
          rules.push(c === 0 ? pending || sub.rules[0] : sub.rules[c])
          aligns.push(sub.aligns[c])
        }
        pending = sub.rules[sub.rules.length - 1] ?? false
      }
      i = colsEnd
    }
  }
  rules.push(pending) // rule after the last column
  return { aligns, rules }
}

/** If a cell is a single \multicolumn{n}{spec}{content}, describe it. */
function asMulticolumn(
  cellNodes: Node[]
): { span: number; align: string; content: Node[] } | null {
  const real = cellNodes.filter(
    (n) => !(n.kind === "text" && n.value.trim() === "")
  )
  if (real.length !== 1) return null
  const n = real[0]
  if (n.kind !== "command" || n.name !== "multicolumn") return null
  const span = parseInt(flattenRaw(n.args[0] ?? []), 10) || 1
  const align = parseColSpec(flattenSpec(n.args[1] ?? [])).aligns[0] ?? "l"
  return { span, align, content: n.args[2] ?? [] }
}

/** Flatten a column spec preserving brace structure (for *{n}{c}, p{w}). */
function flattenSpec(nodes?: Node[]): string {
  if (!nodes) return ""
  let out = ""
  for (const n of nodes) {
    if (n.kind === "text") out += n.value
    else if (n.kind === "group") out += "{" + flattenSpec(n.body) + "}"
    else if (n.kind === "command") out += "\\" + n.name
  }
  return out
}

/** Render a paragraph-stripped fragment: unwrap a lone <p>..</p>. */
function stripParagraph(html: string): string {
  const m = html.match(/^<p>([\s\S]*)<\/p>$/)
  if (m && !m[1].includes("<p>")) return m[1]
  return html
}

/** Flatten nodes to literal text (for paths, keys, labels). */
function flattenRaw(nodes?: Node[]): string {
  if (!nodes) return ""
  let out = ""
  for (const n of nodes) {
    if (n.kind === "text") out += n.value
    else if (n.kind === "group") out += flattenRaw(n.body)
    else if (n.kind === "command") out += SYMBOLS[n.name] ?? ""
  }
  return out
}

/**
 * TeX text ligatures: `` '' -> curly quotes, -- en-dash, --- em-dash.
 * Order matters (longest first). Applied only to text-mode runs — never to
 * math (primes) or verbatim.
 */
function applyLigatures(s: string): string {
  if (s.indexOf("-") < 0 && s.indexOf("`") < 0 && s.indexOf("'") < 0) return s
  return s
    .replace(/---/g, "—") // —
    .replace(/--/g, "–") // –
    .replace(/``/g, "“") // “
    .replace(/''/g, "”") // ”
    .replace(/`/g, "‘") // ‘
    .replace(/'/g, "’") // ’
}

/**
 * Translate an \includegraphics key-value option list into a CSS `style`.
 * Handles the common sizing keys: `width`, `height`, `scale`. A length given
 * as a fraction of \textwidth/\linewidth/\columnwidth becomes a percentage;
 * CSS-native units (cm, mm, in, pt, pc, px, em, ex) pass through unchanged.
 */
function imgStyle(optional: string): string {
  const out: string[] = []
  for (const part of optional.split(",")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    const val = part.slice(eq + 1).trim()
    if (key === "scale") {
      const f = parseFloat(val)
      if (Number.isFinite(f) && f > 0) out.push(`transform:scale(${f})`)
      continue
    }
    if (key !== "width" && key !== "height") continue
    const css = imgDim(val)
    if (css) out.push(`${key}:${css}`)
  }
  return out.join(";")
}

/**
 * One \includegraphics length to a CSS length, or "" if unrecognized. The
 * lexer drops the backslash from control words, so a fraction of \textwidth
 * arrives here as e.g. "0.8textwidth" — hence the optional backslash.
 */
function imgDim(v: string): string {
  const frac = v.match(/^(\d*\.?\d+)\s*\\?(?:text|line|column)width$/i)
  if (frac) {
    const f = parseFloat(frac[1])
    return Number.isFinite(f) ? `${(f * 100).toFixed(2).replace(/\.?0+$/, "")}%` : ""
  }
  if (/^\\?(?:text|line|column)width$/i.test(v)) return "100%"
  if (/^\d*\.?\d+(cm|mm|in|pt|pc|px|em|ex)$/i.test(v)) return v
  return ""
}

/** Neat, sized placeholder for a missing/broken image (no raw path leak). */
function imgFallback(name: string, style: string): string {
  const styleAttr = style ? ` style="${escapeHtml(style)}"` : ""
  return `<span class="l0-img-missing"${styleAttr}><span class="l0-img-missing-icon">⬜</span><span class="l0-img-missing-name">${escapeHtml(name || "image")}</span></span>`
}

/** Width for a minipage: a leading fraction of \linewidth/\textwidth -> %. */
function minipageWidth(arg?: Node[]): string {
  if (!arg) return ""
  const raw = flattenRaw(arg)
  const m = raw.match(/(\d*\.?\d+)/)
  if (m) {
    const f = parseFloat(m[1])
    if (f > 0 && f <= 1) return `${(f * 100).toFixed(1)}%`
  }
  return ""
}

function cssColor(name: string): string {
  // Only accept a CSS color keyword or a bare hex value; anything else is
  // dropped so it can't break out of the style attribute. LaTeX named colors
  // map mostly 1:1 to CSS keywords.
  if (/^[a-zA-Z]+$/.test(name)) return name
  if (/^[0-9a-fA-F]{3,8}$/.test(name)) return `#${name}`
  return "inherit"
}

const SAFE_SCHEME = /^(https?:|mailto:|ftp:|tel:|#|\/|\.)/i

/** Allow only safe URL schemes; encode and escape for attribute context. */
function safeUrl(u: string): string {
  const trimmed = u.trim()
  if (!SAFE_SCHEME.test(trimmed) && /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return "#" // an explicit but disallowed scheme (javascript:, data:, ...)
  }
  return escapeHtml(encodeURI(trimmed))
}

function todayString(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export function renderAst(ast: Node[], opts: RenderOptions = {}): string {
  // Two passes: the first assigns numbers to every \label/\bibitem; the second
  // renders with those maps pre-seeded so forward \ref/\cite resolve. Rendering
  // is sub-millisecond, so doing it twice is free.
  const first = new Renderer(opts)
  first.render(ast)
  return new Renderer(opts, first.getRefs()).render(ast)
}
