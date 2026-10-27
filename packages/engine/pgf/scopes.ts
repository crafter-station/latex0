// pgf's pictures and scopes (pgfcorescopes.code.tex, line numbers cite it), with the picture box the default
// \pgfsys@typesetpicturebox makes of them (pgfsys.code.tex 1570–1586; neither dvips nor pdfTeX replaces it).
// A picture is `\hbox to0pt{<driver's begin> <scope> {<colour, line width> \box<main layer>} <discard>
// <scope end> <driver's end>\hss}`, the main layer `\hbox to0pt{<what the picture's commands typeset>\hss}`;
// its bounding box gives the box's size, moved so that the box starts at the box's left edge and the
// baseline lies at the bounding box's bottom (or at \pgfsetbaseline's coordinate).

import { glue, kern, ssGlue, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { Unsupported } from "../latex/unsupported"
import type { PgfDriver } from "./drivers"
import { pgfSetColor, pgfSetLineWidth } from "./graphicstate"
import { resetPathSizes } from "./paths"
import { setLength } from "./points"
import { EMPTY_EXTENT, emptyExtent, type PgfState } from "./state"
import { pgfTransformReset } from "./transformations"

/** the lists a picture's boxes collect: \pgfpic's and the main layer's, with the list the picture is in */
interface Lists { outer: Node[]; pic: Node[] }
const open = new WeakMap<PgfState, Lists>()

/**
 * \begin{pgfpicture} (\pgfpicture, \pgf@picture 206–249). `color` is the current colour as xcolor's driver
 * text (\pgfsetcolor{.}); `bbox`, the old syntax's {minx}{miny}{maxx}{maxy} (\pgf@oldpicture 219–225): the
 * bounding box, which nothing in the picture enlarges.
 */
export function beginPgfPicture(s: PgfState, d: PgfDriver, color: string, bbox?: [string, string, string, string]) {
  if (s.inPicture) throw new Unsupported("pgf: a picture inside a picture")
  s.begingroup() // \begin
  s.begingroup()
  s.inPicture = true
  s.picture = emptyExtent()
  s.setLocal({ relevant: true })
  resetPathSizes(s)
  if (bbox) {
    const [minX, minY, maxX, maxY] = bbox.map((x) => setLength(x, s))
    s.picture = { minX, maxX, minY, maxY }
    s.setLocal({ relevant: false })
  }
  // \setbox\pgfpic\hbox to0pt\bgroup
  const lists: Lists = { outer: s.out, pic: [] }
  open.set(s, lists)
  s.out = lists.pic
  s.begingroup()
  s.begingroup()
  d.beginPicture()
  d.beginscope()
  s.begingroup()
  pgfSetColor(d, color)
  pgfSetLineWidth(s, d, "0.4pt")
  pgfTransformReset(s)
  s.softPath = []
  s.begingroup()
  // \setbox\pgf@layerbox@main\hbox to0pt\bgroup\begingroup
  s.out = []
  s.begingroup()
  s.begingroup()
}

/** a point's coordinate as \pgfpoint takes it: a register's value, or the expression given */
const coordinate = (s: PgfState, expression: string | null, register: number) => (expression === null ? register : setLength(expression, s))

/** \end{pgfpicture} (\endpgfpicture 250–297, \pgfsys@typesetpicturebox) */
export function endPgfPicture(s: PgfState, d: PgfDriver) {
  const lists = open.get(s)
  if (!lists || !s.inPicture) throw new Unsupported("pgf: \\end{pgfpicture} without a picture")
  const p = s.picture
  if (p.maxX === -EMPTY_EXTENT) s.picture = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  const { minX, maxX, minY, maxY } = s.picture
  const baseline = coordinate(s, s.local.baseline, minY)
  const trimLeft = -(coordinate(s, s.local.trimLeft, minX) - minX)
  const trimRight = coordinate(s, s.local.trimRight, maxX) - maxX
  s.endgroup()
  const layer = hpack([...s.out, ssGlue()], { exactly: 0 })
  s.endgroup()
  s.out = lists.pic
  s.out.push(layer) // \pgf@insertlayers
  s.endgroup()
  d.discardpath()
  s.endgroup()
  d.endscope()
  d.endPicture()
  s.endgroup()
  const pic = hpack([...lists.pic, ssGlue()], { exactly: 0 })
  s.endgroup()
  s.out = lists.outer
  open.delete(s)
  // \pgfsys@typesetpicturebox\pgfpic; what TeX reads there past max_dimen is its "Dimension too large" (not modeled)
  for (const v of [maxX - minX, maxY - minY, baseline - minY, trimLeft, trimRight]) if (Math.abs(v) >= 0o10000000000) throw new Unsupported("pgf: a picture too large")
  const box = hpack([glue(-minX), { ...pic, shift: minY }])
  box.height = maxY - minY
  box.width = maxX - minX
  box.depth = 0
  if (trimLeft !== 0) s.out.push(kern(trimLeft, true))
  s.out.push({ ...box, shift: baseline - minY })
  if (trimRight !== 0) s.out.push(kern(trimRight, true))
  s.inPicture = false
  s.endgroup()
  s.endgroup() // \end
}

/** \pgfsetbaseline{#1} (373–380): the baseline at y = #1 (at the picture's end), or `default` (its bottom) */
export function pgfSetBaseline(s: PgfState, y: string) { s.setLocal({ baseline: y === "default" ? null : y }) }
/**
 * \pgfsettrimleft{#1} (402–409): the box starts at x = #1, or `default` (the picture's left; the end of line
 * after `\pgfsettrimleft{\pgf@picminx}` is a space)
 */
export function pgfSetTrimLeft(s: PgfState, x: string) {
  s.setLocal({ trimLeft: x === "default" ? null : x })
  if (x === "default") s.space()
}
/** \pgfsettrimright{#1} (421–428) */
export function pgfSetTrimRight(s: PgfState, x: string) { s.setLocal({ trimRight: x === "default" ? null : x }) }

/** \begin{pgfscope} (\pgfscope 48–55): a graphic scope and a group; the soft path emptied, the path's extent reset */
export function beginPgfScope(s: PgfState, d: PgfDriver) {
  s.begingroup() // \begin
  s.softPath = []
  d.beginscope()
  resetPathSizes(s)
  s.scopes.push(s.lineWidth)
  s.begingroup()
}

/** \end{pgfscope} (\endpgfscope 56–61): the line width back (globally) */
export function endPgfScope(s: PgfState, d: PgfDriver) {
  s.endgroup()
  const w = s.scopes.pop()
  if (w === undefined) throw new Unsupported("pgf: \\end{pgfscope} without a scope")
  s.lineWidth = w
  d.endscope()
  s.endgroup() // \end
}
