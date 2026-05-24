// Commutative-diagram renderer: tikz-cd source -> SVG.
//
// tikz-cd lays objects in a matrix (rows split by \\, columns by &) and
// connects them with \arrow[<dir>, "<label>"...] where <dir> is a string of
// r/l/u/d steps. We re-parse the raw environment body (the general LaTeX parser
// mangles the bracket/quote syntax), place objects on a grid, and draw clipped
// arrows with foreignObject math labels.

// The math renderer is injected (callers pass it) so this module imports
// nothing from the renderers — avoiding a tikzcd <-> math import cycle.
type MathOf = (src: string) => string

interface Arrow {
  dRow: number
  dCol: number
  label: string
  swap: boolean // label on the other side
  dashed: boolean
  bend: number // degrees; +left / -right; 0 = straight
  valid: boolean
}

interface Cell {
  object: string // raw math for the node
  arrows: Arrow[]
}

// layout constants (px)
const COL_GAP = 132
const ROW_GAP = 104
const PAD = 32
const NODE_HALF_H = 15
const CHAR_W = 8.5 // rough advance for node-width estimation
const GAP = 7 // clearance between an arrow end and its node box

/** Split on a separator at brace/bracket depth 0, ignoring quoted spans. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = false
  let cur = ""
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"') {
      quote = !quote
      cur += ch
      continue
    }
    if (!quote) {
      if (ch === "{" || ch === "[") depth++
      else if (ch === "}" || ch === "]") depth--
      if (depth === 0 && s.startsWith(sep, i)) {
        out.push(cur)
        cur = ""
        i += sep.length - 1
        continue
      }
    }
    cur += ch
  }
  out.push(cur)
  return out
}

function parseArrow(opts: string): Arrow {
  const a: Arrow = { dRow: 0, dCol: 0, label: "", swap: false, dashed: false, bend: 0, valid: false }
  for (const raw of splitTop(opts, ",")) {
    const p = raw.trim()
    if (!p) continue
    if (/^[rldu]+$/.test(p)) {
      for (const ch of p) {
        if (ch === "r") a.dCol++
        else if (ch === "l") a.dCol--
        else if (ch === "d") a.dRow++
        else if (ch === "u") a.dRow--
      }
      a.valid = true
    } else if (p[0] === '"') {
      const m = p.match(/^"((?:[^"\\]|\\.)*)"\s*(')?/)
      if (m) {
        if (!a.label) a.label = m[1]
        if (m[2] === "'") a.swap = true
      }
    } else if (p === "'" || p === "swap") {
      a.swap = true
    } else if (p === "dashed" || p === "dotted") {
      a.dashed = true
    } else if (/^bend\s+left/.test(p)) {
      const m = p.match(/=\s*(\d+)/)
      a.bend = m ? +m[1] : 28
    } else if (/^bend\s+right/.test(p)) {
      const m = p.match(/=\s*(\d+)/)
      a.bend = -(m ? +m[1] : 28)
    }
  }
  return a
}

/** Pull \arrow[...] / \ar[...] specs out of a cell; the rest is the object. */
function parseCell(cell: string): Cell {
  const arrows: Arrow[] = []
  let object = ""
  let i = 0
  while (i < cell.length) {
    const isArrow = cell.startsWith("\\arrow", i)
    const isAr = !isArrow && cell.startsWith("\\ar", i)
    if (isArrow || isAr) {
      let j = i + (isArrow ? 6 : 3)
      while (j < cell.length && /\s/.test(cell[j])) j++
      if (cell[j] === "[") {
        let depth = 0
        let k = j
        for (; k < cell.length; k++) {
          if (cell[k] === "[") depth++
          else if (cell[k] === "]") {
            depth--
            if (depth === 0) {
              k++
              break
            }
          }
        }
        arrows.push(parseArrow(cell.slice(j + 1, k - 1)))
        i = k
        continue
      }
    }
    object += cell[i]
    i++
  }
  return { object: object.trim(), arrows }
}

/** Visible width estimate from the rendered HTML (tags stripped). */
function estimateHalfWidth(html: string): number {
  const text = html.replace(/<[^>]+>/g, "")
  return Math.max(13, (text.length * CHAR_W) / 2 + 5)
}

/** Clip a ray from a box centre toward (tx,ty) to the box boundary + gap. */
function clip(cx: number, cy: number, hw: number, hh: number, tx: number, ty: number) {
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const sx = dx !== 0 ? (hw + GAP) / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? (hh + GAP) / Math.abs(dy) : Infinity
  const t = Math.min(sx, sy)
  return { x: cx + dx * t, y: cy + dy * t }
}

export function renderTikzcd(rawBody: string, math: MathOf): string {
  // strip leading whole-diagram options: \begin{tikzcd}[column sep=...]
  let body = rawBody.trim()
  if (body[0] === "[") {
    let depth = 0
    let k = 0
    for (; k < body.length; k++) {
      if (body[k] === "[") depth++
      else if (body[k] === "]") {
        depth--
        if (depth === 0) {
          k++
          break
        }
      }
    }
    body = body.slice(k).trim()
  }

  // matrix of cells
  const rowStrings = splitTop(body, "\\\\")
  const grid: Cell[][] = []
  for (let r = 0; r < rowStrings.length; r++) {
    let rowStr = rowStrings[r].trim()
    if (!rowStr && r === rowStrings.length - 1) continue // trailing \\
    // strip per-row spacing option \\[2mm]
    if (rowStr[0] === "[") rowStr = rowStr.replace(/^\[[^\]]*\]/, "").trim()
    grid.push(splitTop(rowStr, "&").map((c) => parseCell(c)))
  }
  if (!grid.length) return ""
  const cols = Math.max(...grid.map((row) => row.length))

  const cx = (col: number) => PAD + col * COL_GAP
  const cy = (row: number) => PAD + row * ROW_GAP

  // node geometry, indexed [row][col]
  const objHtml: string[][] = []
  const halfW: number[][] = []
  for (let r = 0; r < grid.length; r++) {
    objHtml[r] = []
    halfW[r] = []
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c]
      const html = cell && cell.object ? math(cell.object) : ""
      objHtml[r][c] = html
      halfW[r][c] = html ? estimateHalfWidth(html) : 8
    }
  }

  const width = PAD * 2 + (cols - 1) * COL_GAP
  const height = PAD * 2 + (grid.length - 1) * ROW_GAP

  const nodes: string[] = []
  const edges: string[] = []
  const labels: string[] = []

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      const cell = grid[r][c]
      if (!cell) continue

      // object node
      if (objHtml[r][c]) {
        const hw = halfW[r][c]
        const w = hw * 2
        const h = NODE_HALF_H * 2
        nodes.push(
          `<foreignObject x="${(cx(c) - hw).toFixed(1)}" y="${(cy(r) - NODE_HALF_H).toFixed(1)}" width="${w.toFixed(1)}" height="${h}" overflow="visible">` +
            `<div xmlns="http://www.w3.org/1999/xhtml" class="l0-cd-node">${objHtml[r][c]}</div>` +
            `</foreignObject>`
        )
      }

      // arrows out of this cell
      for (const arr of cell.arrows) {
        if (!arr.valid) continue
        const tr = r + arr.dRow
        const tc = c + arr.dCol
        if (tr < 0 || tr >= grid.length || tc < 0 || tc >= cols) continue

        const sHw = halfW[r][c]
        const tHw = halfW[tr]?.[tc] ?? 8
        const p1 = clip(cx(c), cy(r), sHw, NODE_HALF_H, cx(tc), cy(tr))
        const p2 = clip(cx(tc), cy(tr), tHw, NODE_HALF_H, cx(c), cy(r))

        const mx = (p1.x + p2.x) / 2
        const my = (p1.y + p2.y) / 2
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const len = Math.hypot(dx, dy) || 1
        // unit perpendicular (left of direction)
        const px = -dy / len
        const py = dx / len

        const dash = arr.dashed ? ' stroke-dasharray="5 4"' : ""
        if (arr.bend) {
          const off = arr.bend * 1.4
          const ctrlX = mx + px * off
          const ctrlY = my + py * off
          edges.push(
            `<path d="M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" fill="none" stroke="currentColor" stroke-width="1.1" marker-end="url(#l0cdhead)"${dash}/>`
          )
        } else {
          edges.push(
            `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="currentColor" stroke-width="1.1" marker-end="url(#l0cdhead)"${dash}/>`
          )
        }

        // label: offset perpendicular, side chosen by `swap`
        if (arr.label) {
          const bendShift = arr.bend ? arr.bend * 0.7 : 0
          const side = arr.swap ? -1 : 1
          const dist = 11 + Math.abs(bendShift) / 2
          const lx = mx + px * (dist * side + bendShift)
          const ly = my + py * (dist * side + bendShift)
          const lhtml = math(arr.label)
          const lw = estimateHalfWidth(lhtml) * 2 + 6
          labels.push(
            `<foreignObject x="${(lx - lw / 2).toFixed(1)}" y="${(ly - 11).toFixed(1)}" width="${lw.toFixed(1)}" height="22" overflow="visible">` +
              `<div xmlns="http://www.w3.org/1999/xhtml" class="l0-cd-label">${lhtml}</div>` +
              `</foreignObject>`
          )
        }
      }
    }
  }

  return (
    `<svg class="l0-cd" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="commutative diagram">` +
    `<defs><marker id="l0cdhead" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">` +
    `<path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="currentColor" stroke-width="1.3"/></marker></defs>` +
    edges.join("") +
    nodes.join("") +
    labels.join("") +
    `</svg>`
  )
}
