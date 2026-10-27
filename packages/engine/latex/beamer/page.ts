// A beamer page: LaTeX's \@outputpage (latex.ltx) with beamer's \ps@navigation
// (beamerbaseframecomponents.sty). Its \@oddhead puts, in a \vbox, the background
// canvas and the background hung from the head's baseline, then the left and right
// sidebars and the headline, then an \hfil that starts an empty paragraph (traced
// as TeX breaks it when the page is shipped). Its \@oddfoot is the footline. The
// templates are the default outer theme's (beamerouterthemedefault.sty), in the
// theme's colors: the canvas is a rule over the whole paper in its bg, each sidebar's
// canvas a rule in its bg (of the sidebar's zero width, a paragraph of its own), the
// left sidebar is empty, the right sidebar has the logo and the navigation
// symbols (navigation.ts); the headline and footline are footline.ts's. With hyperref, \AtBeginShipout puts pdfmark.def's
// \Hy@DistillerDestFix and beamer's own page anchor (\Hy@EveryPageAnchor, beamerbasenavigation.sty) before the page.

import type { ClassOptionData } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, filGlue, fillGlue, glue, kern, paramGlue, penalty, ssGlue, type BoxNode, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import type { ParagraphTrace } from "../../trace/decisions"
import { distillerDestFix, hyperDriver, pdfdest, spotAnchor } from "../hyperref"
import { appendToVlist, classParams, spec } from "../paragraph"
import { Unsupported } from "../unsupported"
import { setgroup } from "../xcolor"
import { sidebarRightTemplate } from "./sidebar"
import { emptyBackground, outerColors, useColor, type Theme } from "./theme"

const special = (text: string): Node => ({ kind: "whatsit", text: `\\special{${text}}` })
const push = (color: string) => special(`color push ${color}`)
const pop = () => special("color pop")
const zero = { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } as const
const ENV0 = { em: 0, ex: 0 }

/** hyperref's \hypersetup{pdfpagetransition=R} (each slide): \hyper@pagetransition's pdfmark (with pdfTeX, \pdfpageattr:
 *  no node) */
const TRANSITION = "ps:SDict begin [ {ThisPage}<</Trans << /S /R >> >> /PUT pdfmark end"
const transition = (): Node[] => (hyperDriver.pdftex ? [] : [special(TRANSITION)])

/** \usebeamertemplate***'s colors at the outer level: \usebeamercolor*[fg]{name}, normal text's fg then name's */
const templateColors = (t: Theme, name: string): string[] => [outerColors(t).fg, useColor(t, name, outerColors(t)).fg]

/** an empty template typeset with its beamer color (\usebeamertemplate***: both colors pushed) */
const emptyTemplate = (t: Theme, name: string): Node[] => [...templateColors(t, name).map(push), pop(), pop()]

/** the templates the page's head typesets, their paragraphs' traces to `traces`: the headline's and the sidebar
 *  theme's sidebar's lists */
export interface PageTemplates { headline: (traces: ParagraphTrace[]) => Node[]; sidebar: (traces: ParagraphTrace[]) => Node[] }

/** \wd, \ht and \dp set to 0pt */
function zeroed(b: BoxNode): BoxNode { b.width = 0; b.height = 0; b.depth = 0; return b }

/** \hbox{\lower\ht\hbox{\box…}} with its size zeroed: the box hung from the baseline */
function hung(b: BoxNode): BoxNode {
  const lowered = hpack([b]); lowered.shift = b.height
  return zeroed(hpack([lowered]))
}

/** \beamer@typesetheadorfoot: the template's list in a \vbox \paperwidth wide, from the paper's left edge to its right,
 *  then \hfil */
export function headOrFoot(k: ClassOptionData, template: Node[]): Node[] {
  return [hpack([glue(-k.dimens["Gm@lmargin"]), hpack([vpack(template)]), glue(-k.dimens["Gm@rmargin"])]), filGlue()]
}

/** a sidebar: \hskip to its place, its canvas (\usebeamercolor*{sidebar …} and the template, in a zeroed \vbox
 *  to\sidebarheight ending in \vss), its template in a \vbox to\sidebarheight ending in \vfil; hung from the baseline.
 *  The canvas template (beamerouterthemedefault.sty's), where the theme gives the sidebar a bg: \color{bg}\vrule
 *  height\sidebarheight width<the sidebar's width>, a paragraph (\hsize \textwidth, \@parboxrestore's \parindent and
 *  \rightskip), whose trace goes to `traces`. */
function sidebar(k: ClassOptionData, t: Theme, name: "sidebar left" | "sidebar right", skips: Node[], template: () => Node[], traces: ParagraphTrace[]): BoxNode {
  const h = k.dimens.sidebarheight
  // (\usebeamercolor*{name}: normal text's fg set, name's colors only defined)
  const canvas: Node[] = [push(outerColors(t).fg)]
  const pops = [pop()]
  if (!emptyBackground(t, name)) {
    const width = k.dimens[name === "sidebar left" ? "beamer@leftsidebar" : "beamer@rightsidebar"]
    const { vlist, trace } = lineBreak([emptyBox("hlist", 0), { kind: "rule", width, height: h, depth: null }], { ...classParams(k), rightSkip: spec("rightskip", zero) })
    traces.push(trace)
    // new_graf: \parskip, then LaTeX's zero \parskip
    canvas.push(push(useColor(t, name, outerColors(t)).bg), paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)), ...vlist)
    pops.push(pop())
  }
  return hung(hpack([...skips, zeroed(hpack([vpack([...canvas, ssGlue()], { exactly: h }), ...pops])), vpack(template(), { exactly: h })]))
}

/** the default sidebar right template: \vfill, \llap{\insertlogo\hskip0.1cm}, \vskip2pt, \llap{navigation symbols
 *  \hskip0.1cm}, \vskip2pt, in the sidebar font (\Tiny: 5pt lines; \@outputpage's zero \lineskip and \lineskiplimit);
 *  `symbols`: the navigation symbols template's list (navigation.ts) */
function rightSidebarTemplate(k: ClassOptionData, t: Theme, symbols: Node[]): Node[] {
  const cm = parseDimen("0.1cm", ENV0), pt2 = parseDimen("2pt", ENV0)
  const llap = (nodes: Node[]) => hpack([ssGlue(), ...nodes, glue(cm)], { exactly: 0 })
  const list: Node[] = [...templateColors(t, "sidebar right").map(push), fillGlue()]
  const at = useColor(t, "sidebar right", outerColors(t))
  let prevDepth = appendToVlist(list, llap([push(useColor(t, "logo", at).fg), pop()]), null, zero, zero, 0)
  list.push(glue(pt2))
  const tiny = { ...zero, width: parseDimen("5pt", ENV0) }
  prevDepth = appendToVlist(list, llap([...templateColors(t, "navigation symbols").map(push), ...symbols, pop(), pop()]), prevDepth, tiny, zero, 0)
  list.push(pop(), pop(), glue(pt2), filGlue())
  return list
}

/**
 * \@oddhead: the canvas and background, then the sidebars and the headline, in a \vbox with \@outputpage's zero
 * \baselineskip, \lineskip and \lineskiplimit, then the paragraph \hfil starts (\@parboxrestore: no indentation, no
 * \rightskip), which TeX breaks into one empty line
 */
function head(k: ClassOptionData, t: Theme, templates: PageTemplates, symbols: Node[]): { box: BoxNode; traces: ParagraphTrace[] } {
  const d = k.dimens
  // the canvas template: \color{bg}\vrule width\paperwidth height\paperheight, nothing when its bg is empty
  const bg = emptyBackground(t, "background canvas") ? [] : [push(useColor(t, "background canvas", outerColors(t)).bg), { kind: "rule", width: d.paperwidth, height: d.paperheight, depth: null } as Node, pop()]
  const canvas = hung(hpack([...templateColors(t, "background canvas").map(push), ...bg, pop(), pop(), ...transition()]))
  const background = hung(hpack(emptyTemplate(t, "background")))
  const traces: ParagraphTrace[] = []
  // (the sidebar theme's: its sidebar on the left, the navigation symbols alone on the right)
  const left = sidebar(k, t, "sidebar left", [glue(-d["Gm@lmargin"])], () => [...(t.sidebar === "left" ? templates.sidebar(traces) : emptyTemplate(t, "sidebar left")), filGlue()], traces)
  const right = sidebar(k, t, "sidebar right", [glue(d.textwidth), glue(d["beamer@rightmargin"])], () => [...(t.sidebar === "left" ? sidebarRightTemplate(t, symbols) : rightSidebarTemplate(k, t, symbols)), ...(t.sidebar === "left" ? [filGlue()] : [])], traces)
  const list: Node[] = []
  let prevDepth = appendToVlist(list, hpack([glue(-d["Gm@lmargin"]), canvas, background]), null, zero, zero, 0)
  prevDepth = appendToVlist(list, hpack([left, right, ...headOrFoot(k, templates.headline(traces))]), prevDepth, zero, zero, 0)
  const { vlist, trace } = lineBreak([emptyBox("hlist", 0)], { ...classParams(k), rightSkip: spec("rightskip", zero) })
  list.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0))) // new_graf, then LaTeX's zero \parskip
  for (const n of vlist) if (n.kind === "hlist") prevDepth = appendToVlist(list, n, prevDepth, zero, zero, 0); else list.push(n)
  return { box: vpack(list), traces: [...traces, trace] }
}

/** \@oddfoot: \vbox{\offinterlineskip\hbox{the footline\hfil}\hbox{}}\hfil (`footline`: the template's list) */
function foot(k: ClassOptionData, footline: Node[]): Node[] {
  const list: Node[] = []
  appendToVlist(list, hpack(headOrFoot(k, footline).concat(filGlue())), null, zero, zero, 0)
  list.push(paramGlue("lineskip", glue(0)), emptyBox("hlist"))
  return [vpack(list), filGlue()]
}

/** \Hy@EveryPageAnchor: \vbox to 0pt{\kern\voffset \kern\topmargin \kern-1bp \hbox to 0pt{\kern\hoffset \kern\oddsidemargin
 *  \kern-1bp, the anchors Navigation<n> and page.<n>, \hss}\vss} */
function pageAnchor(k: ClassOptionData, page: number): BoxNode {
  const d = k.dimens, bp = 65781
  // (hpdftex.def's \hyper@anchor: the \pdfdest, then \Hy@RestoreLastskip's \nobreak)
  const spot = (name: string) => (hyperDriver.pdftex ? [pdfdest(name), penalty(10000)] : spotAnchor(name, "h", undefined))
  const marks = [...spot(`Navigation${page}`), ...spot(`page.${page}`)]
  const h = hpack([kern(d.hoffset, true), kern(d.oddsidemargin, true), kern(-bp, true), ...marks, ssGlue()], { exactly: 0 })
  return vpack([kern(d.voffset, true), kern(d.topmargin, true), kern(-bp, true), h, ssGlue()], { exactly: 0 })
}

/**
 * The page \@outputpage ships, its column `outputbox` (\@makecol's \@outputbox) between the head and the foot:
 * \vskip\topmargin, then moved right by \oddsidemargin a \vbox of the head in \vbox to\headheight{\vfil
 * \color@hbox\normalcolor\hb@xt@\textwidth{\@thehead}} (depth 0), \headsep, the column, the foot \footskip below,
 * with \baselineskip, \lineskip and \lineskiplimit zero until then. The head's paragraph comes back as `trace`; the
 * footline's list (footline.ts), typeset after it, is `footline`; the navigation symbols' (navigation.ts), `symbols`.
 */
export function beamerPage(outputbox: BoxNode, page: number, k: ClassOptionData, t: Theme, templates: PageTemplates, footline: (() => Node[]), symbols: Node[]): { box: BoxNode; traces: ParagraphTrace[] } {
  const d = k.dimens
  const h = head(k, t, templates, symbols)
  const headBox = vpack([filGlue(), hpack(setgroup([hpack([h.box], { exactly: d.textwidth })]))], { exactly: d.headheight })
  headBox.depth = 0
  const footBox = hpack(setgroup([hpack(foot(k, footline()), { exactly: d.textwidth })]))
  const inner: Node[] = [headBox, glue(d.headsep)]
  appendToVlist(inner, outputbox, headBox.depth, zero, zero, 0)
  appendToVlist(inner, footBox, outputbox.depth, { ...zero, width: d.footskip }, zero, 0)
  const body = vpack(inner)
  body.shift = d.oddsidemargin
  const placed = vpack([glue(d.topmargin), body])
  const shipped = hyperDriver.pdftex ? placed : vpack([special(TRANSITION), placed])
  // (pdfmark.def's \Hy@DistillerDestFix: dvips only)
  return { box: vpack([...(hyperDriver.pdftex ? [] : [distillerDestFix()]), pageAnchor(k, page), paramGlue("lineskip", glue(0)), shipped]), traces: h.traces }
}
