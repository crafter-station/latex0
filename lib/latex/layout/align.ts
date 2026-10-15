// Horizontal alignments (\halign): "TeX: The Program" §§ 768–812, for
// alignments without \span, \omit or \noalign. Each cell is packed at its
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

/**
 * Align `rows` (each a list of cells, each cell a horizontal list) with
 * `tabskip[j]` before column j and `tabskip[n]` after the last; `spec` is the
 * \halign to/spread. Returns the row boxes, top to bottom.
 */
export function halign(rows: Node[][][], tabskip: GlueNode[], spec: PackSpec): BoxNode[] {
  const ncols = tabskip.length - 1
  if (rows.some((r) => r.length > ncols)) throw new Error("Extra alignment tab has been changed to \\cr")
  // fin_col: unset boxes at natural width; the column width is the widest (null_flag stays -infinity)
  const widths: (number | null)[] = Array.from({ length: ncols }, () => null)
  const unset = rows.map((r) => r.map((cell, j) => {
    const u = hpack(cell)
    if (widths[j] === null || u.width > widths[j]!) widths[j] = u.width
    return { box: u, ...totals(cell) }
  }))
  // § 801: a column no entry reached is zero wide, and so is the tabskip after it
  const skips = tabskip.slice()
  widths.forEach((w, j) => { if (w === null) { widths[j] = 0; skips[j + 1] = { ...skips[j + 1], width: 0, stretch: 0, shrink: 0, stretchOrder: NORMAL, shrinkOrder: NORMAL } } })
  // § 804: the prototype row
  const proto: Node[] = [skips[0]]
  widths.forEach((w, j) => proto.push(emptyBox("hlist", w!), skips[j + 1]))
  const p = hpack(proto, spec)
  // fin_row: each row is packed natural (its height and depth), then set from the prototype (§ 808)
  return unset.map((cells) => {
    const list: Node[] = [skips[0]]
    cells.forEach((c, j) => list.push(c.box, skips[j + 1]))
    const row = hpack(list)
    cells.forEach((c, j) => {
      // § 810: the cell becomes an hlist of its column's width with its row's height and depth
      const r = c.box, t = widths[j]!
      r.height = row.height; r.depth = row.depth
      if (t === r.width) { r.glueSign = SIGN_NORMAL; r.glueOrder = NORMAL; r.glueSet = 0 }
      else if (t > r.width) { r.glueSign = STRETCHING; r.glueOrder = c.stretchOrder; r.glueSet = c.stretch === 0 ? 0 : (t - r.width) / c.stretch }
      else {
        r.glueOrder = c.shrinkOrder; r.glueSign = SHRINKING
        r.glueSet = c.shrink === 0 ? 0 : c.shrinkOrder === NORMAL && r.width - t > c.shrink ? 1 : (r.width - t) / c.shrink
      }
      r.width = t
    })
    row.width = p.width; row.glueOrder = p.glueOrder; row.glueSign = p.glueSign; row.glueSet = p.glueSet; row.shift = 0
    return row
  })
}
