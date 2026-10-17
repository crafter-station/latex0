// Horizontal alignments (\halign): "TeX: The Program" §§ 768–812. Without
// spans (halignSpans has them) each cell is packed at its
// natural width (fin_col, § 796); a column is as wide as its widest cell; the
// preamble's tabskip glue and column widths are packaged into a prototype row
// (§ 804); and every row and cell is then set from it (§§ 805–810): a row takes
// the prototype's width and glue setting, a cell its column's width and its
// row's height and depth.

import { FIL, FILL, FILLL, NORMAL, SHRINKING, SIGN_NORMAL, STRETCHING, emptyBox, type BoxNode, type GlueNode, type GlueOrder, type Node } from "./nodes"
import { hpack, type PackSpec } from "./pack"

/** The stretch and shrink totals hpack sees, by order (§ 657). */
function totals(list: Node[]) {
  const stretch = [0, 0, 0, 0], shrink = [0, 0, 0, 0]
  for (const n of list) if (n.kind === "glue") { stretch[n.stretchOrder] += n.stretch; shrink[n.shrinkOrder] += n.shrink }
  const order = (t: number[]): GlueOrder => (t[FILLL] ? FILLL : t[FILL] ? FILL : t[FIL] ? FIL : NORMAL)
  const so = order(stretch), ho = order(shrink)
  return { stretchOrder: so, stretch: stretch[so], shrinkOrder: ho, shrink: shrink[ho] }
}

/** A cell of an alignment: its horizontal list and how many columns it covers (\span, LaTeX's \multicolumn) */
export interface AlignCell { nodes: Node[]; span: number }

/**
 * Align `rows` (each a list of cells, each cell a horizontal list) with
 * `tabskip[j]` before column j and `tabskip[n]` after the last; `spec` is the
 * \halign to/spread. Returns the row boxes, top to bottom.
 */
export function halign(rows: Node[][][], tabskip: GlueNode[], spec: PackSpec): BoxNode[] {
  return halignSpans(rows.map((r) => r.map((nodes) => ({ nodes, span: 1 }))), tabskip, spec)
}

/** \halign with spanned cells: a span's width goes to its last column (§§ 798, 801–803), and its box is set to
 *  the whole span but keeps its first column's width, with tabskip glue and an empty box for each column it covers (§ 810) */
export function halignSpans(rows: AlignCell[][], tabskip: GlueNode[], spec: PackSpec): BoxNode[] {
  const ncols = tabskip.length - 1
  // fin_col: unset boxes at natural width; a column is as wide as its widest single cell (null_flag stays -infinity)
  const widths: (number | null)[] = Array.from({ length: ncols }, () => null)
  const spans: { extra: number; w: number }[][] = Array.from({ length: ncols }, () => []) // by first column
  const unset = rows.map((r) => {
    let j = 0
    return r.map((cell) => {
      const u = hpack(cell.nodes)
      if (j + cell.span > ncols) throw new Error("Extra alignment tab has been changed to \\cr")
      if (cell.span === 1) { if (widths[j] === null || u.width > widths[j]!) widths[j] = u.width }
      else { // § 798: the widest span of this many columns from here
        const e = spans[j].find((x) => x.extra === cell.span - 1)
        if (!e) spans[j].push({ extra: cell.span - 1, w: u.width }); else if (u.width > e.w) e.w = u.width
      }
      const out = { box: u, col: j, span: cell.span, ...totals(cell.nodes) }
      j += cell.span
      return out
    })
  })
  // §§ 801–803: column by column, a column never reached is zero wide with the tabskip after it; each span starting
  // here gives up this column and its tabskip, ending at the next column (its width at least what is left) or moving on
  const skips = tabskip.slice()
  for (let q = 0; q < ncols; q++) {
    if (widths[q] === null) { widths[q] = 0; skips[q + 1] = { ...skips[q + 1], width: 0, stretch: 0, shrink: 0, stretchOrder: NORMAL, shrinkOrder: NORMAL } }
    const t = widths[q]! + skips[q + 1].width
    for (const sp of spans[q]) {
      const w = sp.w - t
      if (sp.extra === 1) { if (widths[q + 1] === null || w > widths[q + 1]!) widths[q + 1] = w }
      else {
        const e = spans[q + 1].find((x) => x.extra === sp.extra - 1)
        if (!e) spans[q + 1].push({ extra: sp.extra - 1, w }); else if (w > e.w) e.w = w
      }
    }
  }
  // § 804: the prototype row
  const proto: Node[] = [skips[0]]
  widths.forEach((w, j) => proto.push(emptyBox("hlist", w!), skips[j + 1]))
  const p = hpack(proto, spec)
  /** a tabskip's width in the prototype as set (§ 810) */
  const setSkip = (g: GlueNode) => {
    let w = g.width
    if (p.glueSign === STRETCHING && g.stretchOrder === p.glueOrder) w += Math.round(p.glueSet * g.stretch)
    else if (p.glueSign === SHRINKING && g.shrinkOrder === p.glueOrder) w -= Math.round(p.glueSet * g.shrink)
    return w
  }
  // fin_row: each row is packed natural (its height and depth), then set from the prototype (§ 808)
  return unset.map((cells) => {
    const list: Node[] = [skips[0]]
    cells.forEach((c) => list.push(c.box, skips[c.col + c.span]))
    const row = hpack(list)
    const out: Node[] = [skips[0]]
    cells.forEach((c) => {
      // § 810: the cell becomes an hlist of its column's width with its row's height and depth
      const r = c.box, w = widths[c.col]!
      let t = w
      const after: Node[] = []
      for (let k = 1; k < c.span; k++) {
        t += setSkip(skips[c.col + k]) + widths[c.col + k]!
        after.push(skips[c.col + k], emptyBox("hlist", widths[c.col + k]!))
      }
      r.height = row.height; r.depth = row.depth
      if (t === r.width) { r.glueSign = SIGN_NORMAL; r.glueOrder = NORMAL; r.glueSet = 0 }
      else if (t > r.width) { r.glueSign = STRETCHING; r.glueOrder = c.stretchOrder; r.glueSet = c.stretch === 0 ? 0 : (t - r.width) / c.stretch }
      else {
        r.glueOrder = c.shrinkOrder; r.glueSign = SHRINKING
        r.glueSet = c.shrink === 0 ? 0 : c.shrinkOrder === NORMAL && r.width - t > c.shrink ? 1 : (r.width - t) / c.shrink
      }
      r.width = w
      out.push(r, ...after, skips[c.col + c.span])
    })
    row.list = out
    row.width = p.width; row.glueOrder = p.glueOrder; row.glueSign = p.glueSign; row.glueSet = p.glueSet; row.shift = 0
    return row
  })
}
