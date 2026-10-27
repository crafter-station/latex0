// beamer's footnotes in a frame (beamerbaseframecomponents.sty, the default inner
// theme's footnote template): \footnote steps \c@footnote (which each slide of a frame
// starts where the frame does) and puts \nobreak and the mark, \@makefnmark: \hbox{
// \@textsuperscript{{\usebeamercolor[fg]{footnote mark}N}}} at \sf@size. The text goes,
// as \footnote is read, into \beamer@footins: \footnotesize, \@parboxrestore, then in
// \uncover's specials the footnote template (normal text's and footnote's colors,
// \noindent\raggedright, \hbox to 1.8em{\hfil mark}, \rule\z@\footnotesep, the text,
// \@finalstrut\strutbox). The frame's box ends, after its bottom skip, with footnote's
// colors, \footnoterule and that box unboxed.

import type { SizeCommand } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { loadFont, QUAD, X_HEIGHT } from "../../layout/font"
import { appendText } from "../../layout/hmode"
import { filGlue, kern, penalty, type BoxNode, type Node } from "../../layout/nodes"
import { hpack } from "../../layout/pack"
import { ORD, TEXT, mlistToHlist } from "../../mathlayout/mlist"
import { dataFont } from "../data"
import { mathEnv, selectFont } from "../paragraph"
import { times } from "../setspace"
import { Unsupported } from "../unsupported"
import { VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { bracedArg, SANS, setParagraph, type FrameCtx } from "./frame"
import { coverBegin, coverEnd } from "./overlays"
import { outerColors, useColor } from "./theme"

/** \@makefnmark at a size: \hbox{$^{\mbox{\fontsize\sf@size\z@\selectfont{color N}}}$}, \mathsurround zero, N in the
 *  sans serif font at the script size (math family 0's script font) in footnote mark's color */
function mark(cx: FrameCtx, n: number, size: SizeCommand): BoxNode {
  const { k, theme } = cx
  const f = beamerFontEmpty(cx, "footnote mark")
  if (!f) throw new Unsupported("beamer: a footnote mark font")
  const ref = k.sizes[size].math.script[0]
  const digits: Node[] = []
  appendText(digits, String(n), loadFont(dataFont(ref.name), ref.at), { spaceFactor: 1000 }, false)
  const mbox = hpack([colorPush(useColor(theme, "footnote mark", outerColors(theme)).fg), ...digits, colorPop()])
  const formula = mlistToHlist([{ noad: ORD, nucleus: null, sup: { kind: "box", box: mbox }, sub: null }], mathEnv(k, size, true), TEXT, false)
  return hpack([{ kind: "math", on: true, width: 0 }, ...formula, { kind: "math", on: false, width: 0 }])
}

/** whether the theme leaves the beamer font empty (it sets nothing) */
const beamerFontEmpty = (cx: FrameCtx, name: string): boolean => {
  const f = cx.theme.data.fonts[name]
  return !!f && !Object.keys(f).length
}

/**
 * The \footnote's in a paragraph's text at `size`, typeset as they are read (their paragraphs' traces go first): each
 * becomes an \LXsmuggle{i} for \nobreak and its mark (\@footnotemark keeps the space factor; a space before it stays,
 * which a smuggle would move: that throws Unsupported), its text goes to the frame's footnotes.
 */
export function readFootnotes(cx: FrameCtx, text: string, size: SizeCommand): string {
  let out = ""
  for (let rest = text; ;) {
    const m = rest.match(/\\footnote(?![A-Za-z])/)
    if (!m) return out + rest
    if (cx.inMinipage) throw new Unsupported("beamer: a footnote in a minipage")
    const before = rest.slice(0, m.index)
    if (/\s$/.test(before) || (!before && /\s$/.test(out)) || (!before && !out)) throw new Unsupported("beamer: a footnote after a space or starting a paragraph")
    const after = rest.slice(m.index! + m[0].length)
    if (/^\s*[[<]/.test(after)) throw new Unsupported("beamer: \\footnote's options")
    const a = bracedArg(after, 0)
    if (!a) throw new Unsupported("beamer: \\footnote without its text")
    const n = ++cx.footnotes.n
    cx.smuggled.push([penalty(10000), mark(cx, n, size)])
    out += `${before}\\LXsmuggle{${cx.smuggled.length - 1}}`
    footnoteText(cx, n, a.arg)
    rest = after.slice(a.end)
  }
}

/** The footnote's text in \beamer@footins: \uncover's specials around the template, in its colors, a paragraph of its
 *  own (no interline glue before its first line: the box is unboxed, \prevdepth as the \vbox began) */
function footnoteText(cx: FrameCtx, n: number, text: string) {
  const { k, theme } = cx
  if (!beamerFontEmpty(cx, "footnote")) throw new Unsupported("beamer: a footnote font")
  const size: SizeCommand = "footnotesize"
  const font = selectFont(k, size, SANS)
  const v = new VerticalList(k)
  v.nodes = []
  v.prevDepth = null
  v.nodes.push(...coverBegin(true))
  // \usebeamertemplate***{footnote}: normal text's fg and footnote's
  const outer = outerColors(theme)
  v.nodes.push(colorPush(outer.fg), colorPush(useColor(theme, "footnote", outer).fg))
  // \parindent 1em\noindent\raggedright \hbox to 1.8em{\hfil mark}\rule\z@\footnotesep\ignorespaces text \@finalstrut
  // \strutbox (\unskip, \nobreak, \vrule width0 height0 depth\dp\strutbox), in \@parboxrestore's \sloppy
  const em = parseDimen("1.8em", { em: font.params[QUAD], ex: font.params[X_HEIGHT] })
  const start: Node[] = [hpack([filGlue(), mark(cx, n, size)], { exactly: em }), hpack([{ kind: "rule", width: 0, height: k.dimens.footnotesep, depth: 0 }])]
  const end: Node[] = [penalty(10000), { kind: "rule", width: 0, height: 0, depth: k.sizes[size].strut.depth }]
  const lines = setParagraph(cx, text.trim(), { size, indent: false, start, end, sloppy: font.params[QUAD] })
  v.paragraph(lines, { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }, k.sizes[size].baselineskip)
  v.nodes.push(colorPop(), colorPop(), ...coverEnd(true))
  cx.footins.push(...v.nodes)
}

/** The frame's footnotes after its bottom skip: \usebeamercolor*[fg]{footnote}, \footnoterule (\kern-3pt \hrule
 *  width .4\columnwidth \kern2.6pt), \beamer@footins unboxed, the colors' pops */
export function footnoteArea(cx: FrameCtx): Node[] {
  if (!cx.footins.length) return []
  const { k, theme } = cx
  const outer = outerColors(theme), env = { em: 0, ex: 0 }
  return [colorPush(outer.fg), colorPush(useColor(theme, "footnote", outer).fg), kern(-parseDimen("3pt", env), true),
    { kind: "rule", width: times(".4", k.dimens.columnwidth), height: parseDimen("0.4pt", env), depth: 0 }, kern(parseDimen("2.6pt", env), true),
    ...cx.footins, colorPop(), colorPop()]
}
