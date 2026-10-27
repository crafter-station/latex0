// beamer's beamercolorbox environment (beamerbasecolor.sty), rectangular: its body
// in a \vbox \hsize the box's width, after \@arrayparboxrestore, with the left and
// right skips and the separations its options set, inside an \hbox in the beamer
// color's fg; where the color has a bg, that \hbox in a \colorbox{bg} (\fboxsep
// zero) widened by colsep*; then, wider than \textwidth, squeezed into the text
// margins. A rounded box (rounded=true, with shadow=true its shadow) is rounded.ts's.

import type { ClassOptionData } from "../../layout/classdata"
import { parseDimen, parseGlue, type GlueSpec, type ScanEnv } from "../../layout/dimen"
import { glue, kern, paramGlue, ssGlue, type BoxNode, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import { Unsupported } from "../unsupported"
import { dimen, VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { selectFont } from "../paragraph"
import { SANS, type FrameCtx } from "./frame"
import { roundedBox, shadowValue } from "./rounded"
import { emptyBackground, useColor, type ColorState, type Theme } from "./theme"

/** \setkeys{beamercolbox}'s results: the width, the height and depth when set, the left and right skips, sep, colsep
 *  and colsep* */
export interface ColorboxOptions { wd: number; ht?: number; dp?: number; leftskip: GlueSpec; rightskip: GlueSpec; sep: number; colsep: number; colseps: number
  /** colsep* at the box's end, where the body changed the font its ex is in (it is kept as written) */
  colsepsEnd?: number
  /** rounded=true (rounded.ts), and its shadow=true */
  rounded?: boolean; shadow?: boolean }

/** What the body of a box is set with: \hsize, \leftskip and \rightskip, and the \vbox's list so far */
export interface ColorboxBody { hsize: number; leftskip: GlueSpec; rightskip: GlueSpec; v: VerticalList }

const FILL1: GlueSpec = { width: 0, stretch: 65536, stretchOrder: 2, shrink: 0, shrinkOrder: 0 }
/** a glue's width advanced by a dimension (\advance\leftskip by a dimen: the stretch and shrink stay) */
const advance = (g: GlueSpec, w: number): GlueSpec => ({ ...g, width: g.width + w })

/** The lengths an option may name: \textwidth and \linewidth (the frame's), the paper's */
export function lengthEnv(k: ClassOptionData, em: number, ex: number): ScanEnv {
  const d = k.dimens
  const named: Record<string, number> = { textwidth: d.textwidth, linewidth: d.textwidth, columnwidth: d.textwidth, paperwidth: d.paperwidth, paperheight: d.paperheight, textheight: d.textheight }
  return { em, ex, internal: (name) => (name in named ? { level: "dimen", value: named[name] } : undefined) }
}

/** The options as written ([wd=…,sep=…,left]): the keys' defaults, then each key in turn. `env` scans the lengths. */
export function colorboxOptions(written: string, k: ClassOptionData, env: ScanEnv): ColorboxOptions {
  const o: ColorboxOptions = { wd: k.dimens.textwidth, leftskip: dimen(0), rightskip: { ...FILL1, stretchOrder: 1 }, sep: 0, colsep: 0, colseps: 0 }
  const len = (s: string) => parseDimen(s, env)
  // left, center and right take a width, 0pt by default (#1 plus1fill)
  const fill = (s: string | undefined) => ({ ...FILL1, width: s === undefined ? 0 : len(s) })
  for (const item of splitKeys(written)) {
    const eq = item.indexOf("=")
    const key = (eq < 0 ? item : item.slice(0, eq)).trim()
    const value = eq < 0 ? undefined : item.slice(eq + 1).trim().replace(/^\{([\s\S]*)\}$/, "$1")
    const need = () => { if (value === undefined) throw new Unsupported(`beamercolorbox's ${key} without a value`); return value }
    if (key === "wd") o.wd = len(need())
    else if (key === "ht") o.ht = len(need())
    else if (key === "dp") o.dp = len(need())
    else if (key === "leftskip") o.leftskip = parseGlue(need(), env)
    else if (key === "rightskip") o.rightskip = parseGlue(need(), env)
    else if (key === "left") { o.leftskip = dimen(0); o.rightskip = fill(value) }
    else if (key === "center") { o.leftskip = fill(value); o.rightskip = fill(value) }
    else if (key === "right") { o.leftskip = fill(value); o.rightskip = dimen(0) }
    else if (key === "sep") o.sep = len(need())
    else if (key === "colsep") o.colsep = len(need())
    else if (key === "colsep*") o.colseps = len(need())
    else if (key === "rounded" && (value === "true" || value === "false")) o.rounded = value === "true"
    else if (key === "shadow") o.shadow = shadowValue(value ?? "true")
    else if (key === "ignorebg" && value === "false") continue
    else throw new Unsupported(`beamercolorbox option ${item.trim()}`)
  }
  return o
}

/** keyval's list: items split at commas outside braces, empty ones dropped */
function splitKeys(s: string): string[] {
  const out: string[] = []
  let depth = 0, from = 0
  for (let i = 0; i <= s.length; i++) {
    if (i === s.length || (s[i] === "," && depth === 0)) { if (s.slice(from, i).trim()) out.push(s.slice(from, i)); from = i + 1 }
    else if (s[i] === "{") depth++
    else if (s[i] === "}") depth--
  }
  return out
}

/**
 * The box for the beamer color `name`, where `at` is in force: `body` fills the \vbox (\hsize, \leftskip and \rightskip
 * as the options set them; sep, and colsep where there is a background, added to both skips). In the \vbox: colsep
 * and colsep* (with a background), sep, the body, then the same skips in reverse order. What `body` returns goes after
 * the \vbox (the pops of colors set in it, which its group's end puts there).
 */
export function beamercolorbox(k: ClassOptionData, t: Theme, name: string, o: ColorboxOptions, at: ColorState, body: (b: ColorboxBody) => Node[] | void, cx?: FrameCtx): BoxNode {
  const bg = !emptyBackground(t, name)
  const inner = useColor(t, name, at)
  const v = new VerticalList(k)
  v.nodes = []
  v.prevDepth = null // a \vbox begins with \prevdepth -1000pt
  let leftskip = o.leftskip, rightskip = o.rightskip
  if (o.sep > 0) { leftskip = advance(leftskip, o.sep); rightskip = advance(rightskip, o.sep) }
  if (bg) {
    if (o.colsep > 0) { leftskip = advance(leftskip, o.colsep); rightskip = advance(rightskip, o.colsep); v.vskip(dimen(o.colsep)) }
    if (o.colseps > 0) v.vskip(dimen(o.colseps))
  }
  if (o.sep > 0) v.vskip(dimen(o.sep))
  const after = body({ hsize: o.wd, leftskip, rightskip, v }) ?? []
  if (o.sep > 0) v.vskip(dimen(o.sep))
  if (bg) {
    if (o.colsep > 0) v.vskip(dimen(o.colsep))
    if (o.colseps > 0) v.vskip(dimen(o.colsepsEnd ?? o.colseps))
  }
  // \hbox{\usebeamercolor[fg]{name}\vbox{…}}, its \ht and \dp then set (its \wd too, which its lines, \hsize wide, are)
  let box = hpack([colorPush(inner.fg), vpack(v.nodes), ...after, colorPop()])
  if (o.ht !== undefined) box.height = o.ht
  if (o.dp !== undefined) box.depth = o.dp
  if (o.rounded) {
    // in beamerboxesrounded[lower=name,upper=normal text,width=wd]{} where the color has a bg; otherwise, wider than
    // \textwidth, centred in it (\hbox to\textwidth{\hss…\hss})
    if (!cx) throw new Unsupported("beamer: a rounded beamercolorbox here")
    if (bg) return roundedBox(cx, at, selectFont(k, "normalsize", SANS), { upper: "normal text", lower: name, width: o.wd, shadow: o.shadow ?? false, head: null, body: (v) => { v.nodes.push(box) } })
    return box.width > k.dimens.textwidth ? hpack([ssGlue(), box, ssGlue()], { exactly: k.dimens.textwidth }) : box
  }
  if (bg) box = background(box, inner.bg, at.fg, o.colseps)
  // \hbox to\textwidth{\hskip0pt minus\beamer@leftmargin\box…\hskip0pt minus\beamer@rightmargin}
  if (box.width > k.dimens.textwidth) box = hpack([glue(0, 0, 0, k.dimens["beamer@leftmargin"]), box, glue(0, 0, 0, k.dimens["beamer@rightmargin"])], { exactly: k.dimens.textwidth })
  return box
}

/**
 * \hbox{\hskip-colsep* \fboxsep\z@\colorbox{bg}{\hskip colsep* box\hskip colsep*}\hskip-colsep*}: xcolor's \colorbox
 * measures its content first (\kern\fboxsep, the content in the color in force `current`, \kern\fboxsep), then in
 * \color{bg} puts \color@block (a rule that size in an \hbox to 0pt, in the color again) and the content
 */
function background(box: BoxNode, bg: string, current: string, colseps: number): BoxNode {
  const inner: Node[] = [kern(0, true), colorPush(current), glue(colseps), box, glue(colseps)]
  resetColor(inner)
  const content = hpack([...inner, kern(0, true)])
  const block = hpack([{ kind: "rule", width: content.width, height: content.height, depth: content.depth }, ssGlue()], { exactly: 0 })
  return hpack([glue(-colseps || 0), colorPush(bg), colorPush(bg), block, colorPop(), content, colorPop(), glue(-colseps || 0)])
}

/** beamer's \reset@color (beamerbasecolor.sty), the pop at the end of a color's group: a skip that ends the list (\lastskip
 *  not 0pt) is taken off before it (\unskip) and put back after it (\hskip or \vskip\lastskip: plain glue) */
export function resetColor(list: Node[]) {
  const last = list.at(-1)
  if (last?.kind !== "glue" || !(last.width || last.stretch || last.shrink)) { list.push(colorPop()); return }
  list.pop()
  list.push(colorPop(), glue(last.width, last.stretch, last.stretchOrder, last.shrink, last.shrinkOrder))
}

/** \par in the box: a paragraph's lines after \parskip (zero), which new_graf adds only to a list that is not empty */
export function boxParagraph(v: VerticalList, lines: Node[], baselineskip: GlueSpec) {
  if (v.nodes.length) v.nodes.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
  v.lines(lines, baselineskip)
}
