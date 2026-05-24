// Text-mode (document) renderer. Walks the AST once, grouping inline content
// into paragraphs and emitting block elements for sections, lists, tables,
// figures, environments and display math. Math is delegated to math.ts.

import { renderMathList, renderMathString } from "./math"
import { SYMBOLS, ESCAPES, mapAlphabet } from "./symbols"
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
  private labels: Record<string, string> = {}
  private lastNumber = ""
  private title = ""
  private author = ""
  private date = ""

  constructor(opts: RenderOptions) {
    this.images = opts.images ?? {}
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
        return this.renderFigure(env)
      case "table":
      case "table*":
        return `<div class="l0-floatwrap">${this.renderBlocks(env.body)}</div>`
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

  private renderFigure(env: EnvironmentNode): string {
    const inner = this.renderBlocks(env.body)
    return `<figure class="l0-figure">${inner}</figure>`
  }

  private renderTabular(env: EnvironmentNode): string {
    const rows = splitTableRows(env.body)
    const html = rows
      .map((cells) => {
        const tds = cells
          .map((c) => `<td class="l0-td">${stripParagraph(this.renderBlocks(c))}</td>`)
          .join("")
        return `<tr class="l0-tr">${tds}</tr>`
      })
      .join("")
    return `<table class="l0-table"><tbody>${html}</tbody></table>`
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
    if (n === "cite") {
      return `<span class="l0-cite">[${escapeHtml(flattenRaw(node.args[0] ?? []))}]</span>`
    }
    if (n === "footnote") {
      return `<span class="l0-footnote">(${this.renderInlineList(node.args[0] ?? [])})</span>`
    }

    // images
    if (n === "includegraphics") {
      const path = flattenRaw(node.args[0] ?? [])
      const src = this.images[path] ?? this.images[path.replace(/^.*\//, "")] ?? path
      return `<img class="l0-img" src="${escapeHtml(src)}" alt="${escapeHtml(path)}"/>`
    }
    if (n === "caption") {
      const which = this.figCounter // best-effort; precise float numbering is out of MVP scope
      void which
      return `<figcaption class="l0-caption">${this.renderInlineList(node.args[0] ?? [])}</figcaption>`
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

/** Split a tabular body into rows (on \\) and cells (on &). */
function splitTableRows(body: Node[]): Node[][][] {
  const rows: Node[][][] = []
  let row: Node[][] = []
  let cell: Node[] = []
  let hasContent = false
  for (const n of body) {
    if (n.kind === "linebreak") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = []
      hasContent = false
    } else if (n.kind === "align") {
      row.push(cell)
      cell = []
    } else if (n.kind === "command" && (n.name === "hline" || n.name === "toprule" || n.name === "midrule" || n.name === "bottomrule")) {
      // rule commands: skip (CSS borders handle separation)
    } else {
      cell.push(n)
      if (!(n.kind === "parbreak") && !(n.kind === "text" && n.value.trim() === "")) {
        hasContent = true
      }
    }
  }
  // Only emit a trailing row if it actually carries content (a final \\ leaves
  // an empty cell/whitespace we don't want to render as a blank row).
  if (hasContent || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
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
  return new Renderer(opts).render(ast)
}
