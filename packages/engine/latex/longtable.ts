// longtable.sty (v4.24, 2025-10-13): \begin{longtable}[pos]{cols} as a block of its own. The body is set in chunks, each
// an \halign to \hsize (\LTleft and \LTright the tabskip glue around the columns) in a \vbox whose last row, the save row
// (\LT@save@row: \omit\kern width in each column), keeps the columns as wide as earlier chunks made them; the
// sections before \endfirsthead, \endhead, \endfoot and \endlastfoot are chunks of their own, kept as boxes, and the
// body is cut into chunks every \LTchunksize rows. The first body chunk's end runs \LT@start (\LTpre, a page break when
// the head, the foot and the first row do not fit, \vsize less the foot's height, the head, \nobreak, \output{\LT@output});
// each chunk is \unvbox'ed on the main vertical list, where the page builder breaks it and \LT@output puts the foot at
// the bottom of each page and the head at the top of the next (output.ts). The save row's widths, with the chunk that
// made each, go to the .aux file (\gdef\LT@i{\LT@entry{chunk}{width}…}) for the next run.

import type { GlueSpec } from "../layout/dimen"
import { SPACE, SPACE_SHRINK, SPACE_STRETCH } from "../layout/font"
import { FILL, filGlue, glue, kern, penalty, ssGlue, type BoxNode, type Node } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { vertBreak } from "../layout/pagebuilder"
import { tabularEnv } from "./boxes"
import type { Ctx } from "./context"
import { appendText, sourceText, withoutTextCommands } from "./encodings"
import type { LatexOutput, OutputHook } from "./output"
import { appendToVlist, classParams, SKIP_AMOUNTS } from "./paragraph"
import { preamble, tabularLines, tabularList, vtop, type TabCell, type TabLine } from "./tabular"
import { Unsupported } from "./unsupported"
import { plain } from "./vlist"
import { setgroup } from "./xcolor"
import type { PageState } from "../layout/pagebuilder"

/** a save row's column: the chunk whose rows made it this wide, and the width (\LT@entry{chunk}{width}) */
export type LtEntry = [number, number]

const MAX_DIMEN = 0o7777777777
const ZERO: GlueSpec = { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }
const FILL_GLUE: GlueSpec = { width: 0, stretch: 65536, stretchOrder: FILL, shrink: 0, shrinkOrder: 0 }
/** \LTcapwidth: 4in */
const CAPWIDTH = 18945146

/** the body's sections, each ending at \endfirsthead, \endhead, \endfoot or \endlastfoot (outside groups), and the rest */
function sections(body: string): { text: string; end: "firsthead" | "head" | "foot" | "lastfoot" | null }[] {
  const out: { text: string; end: "firsthead" | "head" | "foot" | "lastfoot" | null }[] = []
  let depth = 0, at = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === "%") { while (i < body.length && body[i] !== "\n") i++; continue }
    if (c === "{") depth++
    else if (c === "}") depth--
    else if (c === "\\") {
      const m = body.slice(i).match(/^\\end(firsthead|head|foot|lastfoot)(?![A-Za-z])/)
      if (m && depth === 0) { out.push({ text: body.slice(at, i), end: m[1] as "head" }); i += m[0].length - 1; at = i + 1; continue }
      i++
    }
  }
  out.push({ text: body.slice(at), end: null })
  return out
}

/**
 * longtable number n where it stands (a block): \par, \refstepcounter{table}, the chunks, \LT@start at the first body
 * chunk's end, then \penalty-30000 (\LT@output puts the last page's material back with \LT@lastfoot), \vsize and
 * \output back, \penalty\z@, \addvspace\LTpost
 */
export function longtable(cx: Ctx, n: number) {
  const { counters, pre, run, v } = cx
  const k = run.k
  const t = cx.longtables[n]
  if (!pre.longtable) throw new Unsupported("longtable without \\usepackage{longtable}")
  if (run.runIn || run.noskipsec) throw new Unsupported("a longtable right after a run-in heading")
  if (pre.hyper) throw new Unsupported("longtable with hyperref")
  if (k.ints.twocolumn) throw new Unsupported("longtable in two columns") // (longtable's error)
  v.par()
  v.nobreak = false // (\@nobreakfalse)
  const number = ++counters.table // (\@kernel@refstepcounter{\LTcaptype}, then \@currentHref table.\theHtable)
  cx.refs.href = counters.href("table", number)
  const hsize = k.dimens.columnwidth
  const env = tabularEnv(cx, "normalsize", cx.normalAttrs, undefined, { notes: cx.decisions, club: v.club, widow: k.ints.widowpenalty, finalHyph: classParams(k).finalHyphenDemerits, lineWidth: hsize })
  env.everyparStrut = true // (\LT@startpbox)
  const cols = preamble(t.spec, k.array && { types: pre.columnTypes, si: !!cx.doc.siunitx })
  const left = t.pos === "l" ? ZERO : FILL_GLUE, right = t.pos === "r" ? ZERO : FILL_GLUE
  /** \caption{text}\\ (\LT@makecaption): \multicolumn{\LT@cols}{c}{\hbox to\z@{\hss\parbox[t]\LTcapwidth{\reset@font
   *  \sbox\@tempboxa{\tablename~\thetable: text}\hbox to\hsize{\hfil\box\@tempboxa\hfil}\endgraf\vskip\baselineskip}\hss}},
   *  then \addcontentsline{lot}{table}{\protect\numberline{\thetable}{short}} in the cell */
  const caption = (text: string): TabCell | null => {
    const m = text.match(/^\s*\\caption(\*)?\s*(?:\[([^\]]*)\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*$/)
    if (!m) { if (/\\caption(?![A-Za-z])/.test(text)) throw new Unsupported(`a longtable \\caption here: ${text.trim().slice(0, 40)}`); return null }
    const clean = (s: string) => {
      const c = s.replace(/\s+/g, " ").trim()
      if (/[\\{}$%&#^_~]/.test(withoutTextCommands(c))) throw new Unsupported(`caption "${c}"`)
      return c
    }
    const star = !!m[1], body = clean(m[3]), short = m[2] === undefined ? body : clean(m[2])
    const font = cx.romanFont, l: Node[] = [], st = { spaceFactor: 1000 }
    if (!star) {
      appendText(l, sourceText(pre.names.tablename), font, st, false)
      l.push(penalty(10000), glue(font.params[SPACE], font.params[SPACE_STRETCH], 0, font.params[SPACE_SHRINK], 0)) // ~
      appendText(l, `${counters.the(number)}: ${sourceText(body)}`, font, st, false)
    } else appendText(l, sourceText(body), font, st, false)
    const box = hpack(setgroup(l))
    if (box.width > CAPWIDTH) throw new Unsupported("a longtable caption wider than \\LTcapwidth")
    const pb = vtop([hpack([filGlue(), box, filGlue()], { exactly: CAPWIDTH }), plain(k.sizes.normalsize.baselineskip)])
    return { span: cols.length, spec: "c", text: "", nodes: [hpack([ssGlue(), pb, ssGlue()], { exactly: 0 })], after: star || !short ? [] : [cx.tocFile.listLine("lot", counters.the(number), short, "", false)] }
  }
  const linesOf = (text: string): TabLine[] => tabularLines(text).map((l) => {
    if (!("cells" in l) || l.cells.length !== 1 || "span" in l.cells[0]) return l
    const c = caption(l.cells[0].text)
    return c ? { ...l, cells: [c] } : l
  })

  // the chunks: each section that ends at \end…head or \end…foot, then the body every \LTchunksize rows (a row is
  // what \\ ends); the chunk after one \LTchunksize ended starts with \prevdepth 0pt (\LT@setprevdepth)
  const chunks: { lines: TabLine[]; end: "firsthead" | "head" | "foot" | "lastfoot" | null; prevDepth: number | null }[] = []
  const parts = sections(t.body)
  for (const p of parts.slice(0, -1)) chunks.push({ lines: linesOf(p.text), end: p.end, prevDepth: null })
  const size = pre.longtable.chunksize
  let cur: TabLine[] = [], rows = 0, prevDepth: number | null = null
  for (const l of linesOf(parts[parts.length - 1].text)) {
    cur.push(l)
    if ("cells" in l && l.ended && ++rows === size) {
      if (l.star) throw new Unsupported("\\\\* where a longtable chunk ends")
      chunks.push({ lines: cur, end: null, prevDepth }); cur = []; rows = 0; prevDepth = 0
    }
  }
  chunks.push({ lines: cur, end: null, prevDepth })
  for (const c of chunks) if (c.end && c.lines.filter((l) => "cells" in l && l.ended).length >= size) throw new Unsupported("a longtable head or foot of \\LTchunksize rows")

  // \LT@make@row: the save row the run before wrote, if it has as many columns; else \LT@blank@row
  const written = cx.ltRows.prev?.get(n)
  let save: LtEntry[] = written && written.length === cols.length ? written : cols.map(() => [1, 0])
  const boxes: Record<"firsthead" | "head" | "foot" | "lastfoot", BoxNode | null> = { firsthead: null, head: null, foot: null, lastfoot: null }
  const body: Node[][] = []
  chunks.forEach((c, i) => {
    const chunk = i + 1 // (\c@LT@chunks)
    // (\endlongtable: \LT@entry@chop, entries of later chunks than this one become {1}{0pt})
    if (i === chunks.length - 1) save = save.map(([s, w]) => (s > chunk ? [1, 0] : [s, w]))
    const { list, widths } = tabularList(c.lines, cols, env, undefined, { hsize, left, right, save: save.map(([s, w]) => (s === chunk ? null : w)), prevDepth: c.prevDepth })
    // \LT@get@widths, \LT@def@row, \LT@max@sel: each column's width, with its chunk unless it stayed as wide
    save = widths.map((w, j) => [save[j][1] === w ? save[j][0] : chunk, w])
    if (c.end) boxes[c.end] = vpack(list)
    else body.push(list)
  })
  cx.ltRows.written.set(n, save)

  // \LT@start: \penalty\z@\vskip\LTpre; past the page goal already, \kern\pageshrink+1sp\penalty9999\kern-…; then a page
  // break if \pagetotal, the head, the foot and the first row's height and depth (\vsplit to \ht\@arstrutbox, at least the
  // strut's) pass \pagegoal, else \pageshrink 0pt; \@colroom\@colht; with a foot, \vsize, \@colroom and \pagegoal less
  // its height and \maxdepth 0pt; \MakeLinkTarget's \special{}; the head (\copy\LT@head, or \box\LT@firsthead), \nobreak, \output{\LT@output}
  const head = boxes.firsthead ?? boxes.head
  const strut = env.strut
  const first = body[0]
  const split = vertBreak(first, strut.height, MAX_DIMEN)
  const row = vpack(split.at === null ? first.slice() : first.slice(0, split.at))
  const ht = (b: BoxNode | null) => b?.height ?? 0
  const need = ht(head) + (head?.depth ?? 0) + ht(boxes.foot) + Math.max(strut.height, row.height) + Math.max(strut.depth, row.depth)
  const lt = { head: boxes.head, foot: boxes.foot, lastfoot: boxes.lastfoot }
  const start = (o: LatexOutput, page: PageState): Node[] => {
    o.colroom = o.colht
    if (lt.foot) {
      o.vsizeNow -= lt.foot.height; o.colroom -= lt.foot.height
      if (!page.empty) page.setGoal(page.goal - lt.foot.height)
      o.maxDepthNow = 0
    }
    o.lt = lt
    return [{ kind: "whatsit", text: "\\special{}" }] // (\MakeLinkTarget{\LTcaptype} in vertical mode)
  }
  const fits = (o: LatexOutput, page: PageState): Node[] => {
    if (page.total + need - page.goal > 0) return [filGlue(), penalty(-10000), hook(start)] // \vfil\break
    if (page.shrink > 0) page.setShrink(0)
    return start(o, page)
  }
  cx.refs.href = `target*.${++run.targets}` // (\MakeLinkTarget's, global)
  v.nodes.push(penalty(0), plain(SKIP_AMOUNTS.bigskip), hook((o, page) => {
    if (page.total < page.goal) return fits(o, page)
    const d = page.shrink + 1
    return [kern(d, true), penalty(9999), hook(fits), kern(-d, true)]
  }))
  if (head) v.prevDepth = appendToVlist(v.nodes, boxes.firsthead ?? structuredClone(head), v.prevDepth, ZERO, ZERO, k.dimens.lineskiplimit)
  v.nodes.push(penalty(10000))
  for (const l of body) v.nodes.push(...l)
  // \endlongtable: \penalty-\LT@end@pen; with a foot, \vsize, \@colroom and (a page started) \pagegoal back; \endgroup
  v.nodes.push(penalty(-30000), hook((o, page) => {
    if (lt.foot) {
      o.vsizeNow += lt.foot.height; o.colroom += lt.foot.height
      if (page.goal < MAX_DIMEN) page.setGoal(page.goal + lt.foot.height)
    }
    o.lt = null; o.maxDepthNow = null
    return []
  }), penalty(0))
  v.addvspace(SKIP_AMOUNTS.bigskip) // \LTpost (\bigskipamount)
}

const hook = (f: (o: LatexOutput, page: PageState) => Node[]): Node => ({ kind: "whatsit", text: "", hook: { state: f } satisfies OutputHook })
