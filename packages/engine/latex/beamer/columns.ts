// beamer's columns environment and its column environment and \column command
// (beamerbaseframecomponents.sty). columns is an actionenv (overlays.ts) that ends the
// paragraph and puts, in vertical mode, \hbox to\textwidth{\hskip-\beamer@leftmargin
// \nobreak\hbox to(\textwidth plus both margins){\hbox{}\hfill the columns}\nobreak
// \hskip-\beamer@rightmargin}; with onlytextwidth, \hbox to\textwidth{the columns\unskip}.
// Each column is an actionenv holding a minipage[c|t|b]{width} (latex.ltx \@iiiminipage,
// \@iiiparbox: $\vcenter{…}$, a \vtop or a \vbox) begun with \leavevmode\raggedright,
// then \hfill. Inside the minipage \hsize, \textwidth and \linewidth are its width.

import type { ClassOptionData } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT } from "../../layout/font"
import { emptyBox, fillGlue, glue, penalty, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import { mathEnv, selectFont } from "../paragraph"
import { vtop } from "../tabular"
import { Unsupported } from "../unsupported"
import { VerticalList } from "../vlist"
import { coverBegin, coverEnd } from "./overlays"
import { bracedArg, begunParagraph, frameContent, SANS, type FrameCtx } from "./frame"
import { lengthEnv } from "./colorbox"

/** a column as written: its placement (the columns' when it gives none), width and material */
interface ColumnSource { align: "c" | "t" | "b"; width: string; body: string }

/** \beamer@colmode from the keys c, t and b (T, height and totalwidth throw Unsupported) */
function align(options: string, current: "c" | "t" | "b"): "c" | "t" | "b" {
  let a = current
  for (const o of options.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (o === "c" || o === "t" || o === "b") a = o
    else if (o !== "onlytextwidth") throw new Unsupported(`beamer: the columns option ${o}`)
  }
  return a
}

/** The columns as written: \begin{column}[options]{width}…\end{column} or \column[options]{width}… (up to the next) */
function columnsOf(body: string, mode: "c" | "t" | "b"): ColumnSource[] {
  const out: ColumnSource[] = []
  let i = 0
  const options = () => {
    const o = body.slice(i).match(/^\s*\[([^\]]*)\]/)
    if (!o) return mode
    i += o[0].length
    if (o[1].includes("onlytextwidth")) throw new Unsupported("beamer: a column's option onlytextwidth")
    return align(o[1], mode)
  }
  const width = () => {
    const a = bracedArg(body, i)
    if (!a) throw new Unsupported("beamer: a column without its width")
    i = a.end
    return a.arg
  }
  for (;;) {
    while (/\s/.test(body[i] ?? "")) i++
    if (i >= body.length) break
    if (body.startsWith("\\begin{column}", i)) {
      i += 14
      if (/^\s*</.test(body.slice(i))) throw new Unsupported("beamer: a column's overlay specification")
      const a = options(), w = width()
      const end = body.indexOf("\\end{column}", i)
      if (end < 0) throw new Unsupported("beamer: a column not ended")
      out.push({ align: a, width: w, body: body.slice(i, end) })
      i = end + 12
    } else if (/^\\column(?![A-Za-z])/.test(body.slice(i))) {
      i += 7
      if (/^\s*</.test(body.slice(i))) throw new Unsupported("beamer: a column's overlay specification")
      const a = options(), w = width()
      const next = body.slice(i).search(/\\column(?![A-Za-z])|\\begin\{column\}/)
      const end = next < 0 ? body.length : i + next
      out.push({ align: a, width: w, body: body.slice(i, end) })
      i = end
    } else throw new Unsupported(`beamer: material between columns: ${body.slice(i, i + 30)}`)
  }
  if (!out.length) throw new Unsupported("beamer: columns without a column")
  return out
}

/** The columns environment at the start of `text` in the frame's list `v`; returns the text after it */
export function frameColumns(cx: FrameCtx, v: VerticalList, text: string): string {
  let i = "\\begin{columns}".length
  if (/^\s*</.test(text.slice(i))) throw new Unsupported("beamer: columns with an overlay specification")
  let options = ""
  const o = text.slice(i).match(/^\s*\[([^\]]*)\]/)
  if (o) { options = o[1]; i += o[0].length }
  const end = text.indexOf("\\end{columns}", i)
  if (end < 0) throw new Unsupported("beamer: columns not ended")
  const body = text.slice(i, end)
  if (body.includes("\\begin{columns}")) throw new Unsupported("beamer: columns in columns")
  // actionenv's begin (in the paragraph the columns end, or here), then \par
  if (cx.blockBegun !== undefined) cx.blockBegun = undefined
  else smuggleV(v, coverBegin(true))
  cx.endpe = false
  const { k } = cx
  const d = k.dimens
  const onlyTextwidth = options.split(",").some((x) => x.trim() === "onlytextwidth")
  // \ifbeamer@centered c, else t; then the options
  const mode = align(options, cx.centered ? "c" : "t")
  const normal = selectFont(k, "normalsize", SANS)
  const env = lengthEnv(k, normal.params[QUAD], normal.params[X_HEIGHT])
  // the entry code: \hbox{}\hfill (none with onlytextwidth)
  const list: Node[] = onlyTextwidth ? [] : [emptyBox("hlist", 0), fillGlue()]
  for (const c of columnsOf(body, mode)) {
    let width: number
    try { width = parseDimen(c.width, env) } catch { throw new Unsupported(`beamer: a column {${c.width}}`) }
    smuggleH(list, coverBegin(true))
    list.push(...minipage(cx, c, width))
    // \end{minipage}\hfill\end{actionenv}
    list.push(fillGlue())
    smuggleH(list, coverEnd(true))
  }
  const box = onlyTextwidth
    ? hpack(unskip(list), { exactly: d.textwidth })
    : hpack([glue(-d["beamer@leftmargin"]), penalty(10000), hpack(list, { exactly: d.textwidth + d["beamer@leftmargin"] + d["beamer@rightmargin"] }), penalty(10000), glue(-d["beamer@rightmargin"])], { exactly: d.textwidth })
  v.box(box, k.sizes.normalsize.baselineskip)
  // columns' \end{actionenv} (right after the box: no skip to smuggle past)
  v.nodes.push(...coverEnd(true))
  return text.slice(end + "\\end{columns}".length)
}

/** \unskip: a glue that ends the list taken off */
function unskip(list: Node[]): Node[] {
  if (list.at(-1)?.kind === "glue") list.pop()
  return list
}

/** \beamer@smuggle (overlays.ts) in an \hbox's list or a vertical list: a skip that ends it, other than 0pt, taken off
 *  before the nodes and put back after them */
function smuggleH(list: Node[], nodes: Node[]) {
  const last = list.at(-1)
  if (last?.kind === "glue" && (last.width || last.stretch || last.shrink)) { list.pop(); list.push(...nodes, last) }
  else list.push(...nodes)
}
const smuggleV = (v: VerticalList, nodes: Node[]) => smuggleH(v.nodes, nodes)

/**
 * The column's minipage: \vbox{\hsize width, \textwidth and \columnwidth too, \@parboxrestore, \leavevmode\raggedright,
 * the material, \par\unskip}, then by its placement $\vcenter{…}$ (\mathsurround zero), a \vtop or the \vbox
 */
function minipage(cx: FrameCtx, c: ColumnSource, width: number): Node[] {
  const k: ClassOptionData = { ...cx.k, dimens: { ...cx.k.dimens, textwidth: width, columnwidth: width } }
  const inner: FrameCtx = { ...cx, k }
  const v = new VerticalList(k)
  v.nodes = []
  v.prevDepth = null // a \vbox begins with \prevdepth -1000pt
  // \leavevmode: the first paragraph begun (in an empty list, new_graf adds no \parskip, nor LaTeX's)
  const rest = begunParagraph(inner, v, c.body)
  if (v.nodes[0]?.kind === "glue" && v.nodes[0].param === "parskip" && v.nodes[1]?.kind === "glue" && v.nodes[1].param === "parskip") v.nodes.splice(0, 2)
  frameContent(inner, v, rest)
  cx.endpe = false
  const list = unskip(v.nodes)
  if (c.align === "t") return [vtop(list)]
  const box = vpack(list)
  if (c.align === "b") return [box]
  // \vcenter: make_vcenter (§ 736), about the axis
  const delta = box.height + box.depth
  box.height = mathEnv(cx.k, "normalsize", true).fonts[0][2]!.params[22] + (delta % 2 ? Math.trunc((delta + 1) / 2) : delta / 2)
  box.depth = delta - box.height
  return [{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }]
}
