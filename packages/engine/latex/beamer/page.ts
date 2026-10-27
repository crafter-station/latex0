// A beamer page: LaTeX's \@outputpage (latex.ltx) with beamer's \ps@navigation
// (beamerbaseframecomponents.sty). Its \@oddhead puts, in a \vbox, the background
// canvas and the background hung from the head's baseline, then the left and right
// sidebars and the headline, then an \hfil that starts an empty paragraph (traced
// as TeX breaks it when the page is shipped). Its \@oddfoot is the footline. The
// templates are the default theme's (beamerouterthemedefault.sty, the default color
// theme): the canvas is a white rule over the whole paper, the headline, footline
// and left sidebar are empty, the right sidebar has the logo and the (switched off)
// navigation symbols. With hyperref, \AtBeginShipout puts beamer's own page anchor
// (\Hy@EveryPageAnchor, beamerbasenavigation.sty) before the page.

import type { ClassOptionData } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, filGlue, fillGlue, glue, kern, paramGlue, ssGlue, type BoxNode, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import type { ParagraphTrace } from "../../trace/decisions"
import { spotAnchor } from "../hyperref"
import { appendToVlist, classParams, spec } from "../paragraph"
import { setgroup } from "../xcolor"

const special = (text: string): Node => ({ kind: "whatsit", text: `\\special{${text}}` })
const push = (color: string) => special(`color push ${color}`)
const pop = () => special("color pop")
const zero = { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } as const
const ENV0 = { em: 0, ex: 0 }

/** the default color theme's colors as the driver gets them: normal text (black on white), the logo's
 *  (structure.fg!75!black) and the navigation symbols' (structure.fg!40!bg) */
const BLACK = "gray 0", WHITE = "gray 1", LOGO = "rgb 0.15 0.15 0.525", NAVIGATION = "rgb 0.68 0.68 0.88"
/** hyperref's \hypersetup{pdfpagetransition=R} (each slide): \hyper@pagetransition's pdfmark */
const TRANSITION = "ps:SDict begin [ {ThisPage}<</Trans << /S /R >> >> /PUT pdfmark end"

/** an empty template typeset with its beamer color (\usebeamertemplate***: the color pushed twice) */
const emptyTemplate = (): Node[] => [push(BLACK), push(BLACK), pop(), pop()]

/** \wd, \ht and \dp set to 0pt */
function zeroed(b: BoxNode): BoxNode { b.width = 0; b.height = 0; b.depth = 0; return b }

/** \hbox{\lower\ht\hbox{\box…}} with its size zeroed: the box hung from the baseline */
function hung(b: BoxNode): BoxNode {
  const lowered = hpack([b]); lowered.shift = b.height
  return zeroed(hpack([lowered]))
}

/** \beamer@typesetheadorfoot: the template in a \vbox \paperwidth wide, from the paper's left edge to its right, then \hfil */
function headOrFoot(k: ClassOptionData): Node[] {
  return [hpack([glue(-k.dimens["Gm@lmargin"]), hpack([vpack(emptyTemplate())]), glue(-k.dimens["Gm@rmargin"])]), filGlue()]
}

/** a sidebar: \hskip to its place, its canvas (\usebeamercolor*{sidebar …} in a zeroed \vbox to\sidebarheight), its
 *  template in a \vbox to\sidebarheight ending in \vfil; hung from the baseline */
function sidebar(k: ClassOptionData, skips: Node[], template: Node[]): BoxNode {
  const h = k.dimens.sidebarheight
  const canvas = zeroed(hpack([vpack([push(BLACK), ssGlue()], { exactly: h }), pop()]))
  return hung(hpack([...skips, canvas, vpack(template, { exactly: h })]))
}

/** the default sidebar right template: \vfill, \llap{\insertlogo\hskip0.1cm}, \vskip2pt, \llap{navigation symbols
 *  \hskip0.1cm}, \vskip2pt, in the sidebar font (\Tiny: 5pt lines) */
function rightSidebarTemplate(k: ClassOptionData): Node[] {
  const cm = parseDimen("0.1cm", ENV0), pt2 = parseDimen("2pt", ENV0)
  const llap = (nodes: Node[]) => hpack([ssGlue(), ...nodes, glue(cm)], { exactly: 0 })
  const list: Node[] = [push(BLACK), push(BLACK), fillGlue()]
  let prevDepth = appendToVlist(list, llap([push(LOGO), pop()]), null, zero, zero, 0)
  list.push(glue(pt2))
  const tiny = { ...zero, width: parseDimen("5pt", ENV0) }
  prevDepth = appendToVlist(list, llap([push(BLACK), push(NAVIGATION), pop(), pop()]), prevDepth, tiny, k.glue.lineskip, k.dimens.lineskiplimit)
  list.push(pop(), pop(), glue(pt2), filGlue())
  return list
}

/**
 * \@oddhead: the canvas and background, then the sidebars and the headline, in a \vbox with \@outputpage's zero
 * \baselineskip, \lineskip and \lineskiplimit, then the paragraph \hfil starts (\@parboxrestore: no indentation, no
 * \rightskip), which TeX breaks into one empty line
 */
function head(k: ClassOptionData): { box: BoxNode; trace: ParagraphTrace } {
  const d = k.dimens
  const canvas = hung(hpack([push(BLACK), push(BLACK), push(WHITE), { kind: "rule", width: d.paperwidth, height: d.paperheight, depth: null }, pop(), pop(), pop(), special(TRANSITION)]))
  const background = hung(hpack(emptyTemplate()))
  const left = sidebar(k, [glue(-d["Gm@lmargin"])], [...emptyTemplate(), filGlue()])
  const right = sidebar(k, [glue(d.textwidth), glue(d["beamer@rightmargin"])], rightSidebarTemplate(k))
  const list: Node[] = []
  let prevDepth = appendToVlist(list, hpack([glue(-d["Gm@lmargin"]), canvas, background]), null, zero, zero, 0)
  prevDepth = appendToVlist(list, hpack([left, right, ...headOrFoot(k)]), prevDepth, zero, zero, 0)
  const { vlist, trace } = lineBreak([emptyBox("hlist", 0)], { ...classParams(k), rightSkip: spec("rightskip", zero) })
  list.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0))) // new_graf, then LaTeX's zero \parskip
  for (const n of vlist) if (n.kind === "hlist") prevDepth = appendToVlist(list, n, prevDepth, zero, zero, 0); else list.push(n)
  return { box: vpack(list), trace }
}

/** \@oddfoot: \vbox{\offinterlineskip\hbox{the footline\hfil}\hbox{}}\hfil */
function foot(k: ClassOptionData): Node[] {
  const list: Node[] = []
  appendToVlist(list, hpack(headOrFoot(k).concat(filGlue())), null, zero, zero, 0)
  list.push(paramGlue("lineskip", glue(0)), emptyBox("hlist"))
  return [vpack(list), filGlue()]
}

/** \Hy@EveryPageAnchor: \vbox to 0pt{\kern\voffset \kern\topmargin \kern-1bp \hbox to 0pt{\kern\hoffset \kern\oddsidemargin
 *  \kern-1bp, the anchors Navigation<n> and page.<n>, \hss}\vss} */
function pageAnchor(k: ClassOptionData, page: number): BoxNode {
  const d = k.dimens, bp = 65781
  const marks = [...spotAnchor(`Navigation${page}`, "h", undefined), ...spotAnchor(`page.${page}`, "h", undefined)]
  const h = hpack([kern(d.hoffset, true), kern(d.oddsidemargin, true), kern(-bp, true), ...marks, ssGlue()], { exactly: 0 })
  return vpack([kern(d.voffset, true), kern(d.topmargin, true), kern(-bp, true), h, ssGlue()], { exactly: 0 })
}

/**
 * The page \@outputpage ships, its column `outputbox` (\@makecol's \@outputbox) between the head and the foot:
 * \vskip\topmargin, then moved right by \oddsidemargin a \vbox of the head in \vbox to\headheight{\vfil
 * \color@hbox\normalcolor\hb@xt@\textwidth{\@thehead}} (depth 0), \headsep, the column, the foot \footskip below,
 * with \baselineskip, \lineskip and \lineskiplimit zero until then. The head's paragraph comes back as `trace`.
 */
export function beamerPage(outputbox: BoxNode, page: number, k: ClassOptionData): { box: BoxNode; trace: ParagraphTrace } {
  const d = k.dimens
  const h = head(k)
  const headBox = vpack([filGlue(), hpack(setgroup([hpack([h.box], { exactly: d.textwidth })]))], { exactly: d.headheight })
  headBox.depth = 0
  const footBox = hpack(setgroup([hpack(foot(k), { exactly: d.textwidth })]))
  const inner: Node[] = [headBox, glue(d.headsep)]
  appendToVlist(inner, outputbox, headBox.depth, zero, zero, 0)
  appendToVlist(inner, footBox, outputbox.depth, { ...zero, width: d.footskip }, zero, 0)
  const body = vpack(inner)
  body.shift = d.oddsidemargin
  const shipped = vpack([special(TRANSITION), vpack([glue(d.topmargin), body])])
  return { box: vpack([pageAnchor(k, page), paramGlue("lineskip", glue(0)), shipped]), trace: h.trace }
}
