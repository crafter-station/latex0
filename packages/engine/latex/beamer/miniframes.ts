// The miniframes outer theme (beamerouterthememiniframes.sty), not compressed, its subsection line on:
// the headline is, in vertical mode, the upper separation line's box (beamercolorbox[colsep=1.5pt], empty),
// section in head/foot's box holding \insertnavigation{\paperwidth} (beamerbasenavigation.sty: the
// sections of the last run's .nav across the paper, each frame of a section a mini frame raised above
// the line by its subsection, a pgf circle linked to the frame), the middle separation line's, the
// subsection's head in subsection in head/foot's box, and the lower separation line's. The footline is
// the theme's footline option's: the author and institute, then the title (Berlin, Dresden, Ilmenau), or
// the title and institute (Szeged), between the upper and lower separation lines. The tree outer
// theme's headline is stacked the same way.

import type { ClassOptionData, SizeCommand } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT, type Font } from "../../layout/font"
import { spaceGlue } from "../../layout/hmode"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, filGlue, fillGlue, glue, kern, paramGlue, type BoxNode, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import { pgfPathCircle, pgfUsePath } from "../../pgf/paths"
import { pgfPoint } from "../../pgf/points"
import type { ParagraphTrace } from "../../trace/decisions"
import { sloppy } from "../kernel"
import { classParams, selectFont, spec } from "../paragraph"
import { dimen } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { beamercolorbox, boxParagraph, colorboxOptions, lengthEnv } from "./colorbox"
import { headFootBox, headFootK, headLink, mixer, plain, shortBox, titleText, type FootlineAt } from "./footline"
import { SANS } from "./frame"
import type { TitleInfo } from "./preamble"
import { navigationLink } from "./sections"
import { fontSize, useColor, type ColorState, type Theme } from "./theme"

const CM = (x: string) => parseDimen(x, { em: 0, ex: 0 })

/** boxes in the head or foot line's \vbox, in vertical mode: \offinterlineskip's \lineskip (0pt) between them */
function stack(list: Node[], boxes: BoxNode[]) {
  boxes.forEach((b, i) => { if (i) list.push(paramGlue("lineskip", glue(0))); list.push(b) })
}

/** an empty beamercolorbox[colsep=1.5pt] (a separation line: a rule colsep high each side where it has a bg) */
const separation = (k: ClassOptionData, t: Theme, size: SizeCommand, colors: ColorState, decisions: ParagraphTrace[], name: string, options = "colsep=1.5pt") =>
  headFootBox(k, t, size, size, colors, decisions, options, name, () => ({ list: [] }))

/**
 * A mini frame (beamerouterthemedefault.sty's templates), where `c` is in force: \begin{pgfpicture}{0pt}{0pt}{0.1cm}
 * {0.1cm} \pgfpathcircle{\pgfpoint{0.05cm}{0.05cm}}{0.05cm} \pgfusepath{fill,stroke} (the current frame's; the others'
 * only stroked) \end{pgfpicture}
 */
function miniFrame(pgf: FootlineAt["pgf"], f: Font, c: string, fill: boolean): Node[] {
  const { s, d } = pgf
  return pgf.picture(f, c, ["0pt", "0pt", "0.1cm", "0.1cm"], () => {
    s.space()
    pgfPathCircle(s, () => pgfPoint(s, "0.05cm", "0.05cm"), "0.05cm")
    s.space()
    pgfUsePath(s, d, fill ? ["fill", "stroke"] : ["stroke"])
    return 0
  })
}

/**
 * \insertnavigation{width} in section in head/foot's font `f` and colors `c`: \vbox{\hbox to width{\hskip.3cm, a
 * \beamer@sectionbox of \kern1sp (\ht 1.875ex, \dp .75ex), \hskip-1.875ex plus-1fill, \dohead, the last section box,
 * \hfil\hskip.3cm}}. Each \sectionentry puts the section box before it (padded to the last mini frame's offset
 * where it is narrower) and \hskip1.875ex plus1fill, and makes its own: the short title linked to the section's page,
 * shaded (fg!50!bg) but the current section's. Each \slideentry of a section puts \hbox to0pt{\raise
 * (-offset-size)·ypos-.05cm\hbox{\kern size·xpos-size+1pt\hbox{the mini frame linked to the frame (\beamer@link)}}
 * \hskip-10cm plus1fil}: xpos the slide's number in its subsection, ypos its subsection (one more once a frame of the
 * section is in no subsection). The mini frame size is .14cm, the offset -.01cm.
 */
function navigation(k: ClassOptionData, t: Theme, pgf: FootlineAt["pgf"], at: FootlineAt, size: SizeCommand, c: ColorState, width: number): BoxNode {
  const f = selectFont(k, size, SANS)
  const ex = (x: string) => parseDimen(x, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
  const boxsize = CM(".14cm"), offset = CM("-0.01cm")
  // (\usebeamerfont{mini frame}: no theme sets that font, and the picture's lengths are in cm)
  const miniFont = f
  const now = at.heads.counters
  const sized = (b: BoxNode) => { b.height = ex("1.875ex"); b.depth = ex(".75ex"); return b }
  let box = sized(hpack([kern(1, true)]))
  let minDim = 0
  // \beamer@section@set@min@width
  const setMin = () => { if (!(box.width > minDim)) { box = hpack([box, filGlue()], { exactly: minDim }); minDim = 0 } }
  const items: Node[] = [glue(CM(".3cm")), glue(-ex("1.875ex"), -65536, 2)]
  let xpos = 0, ypos = 1, yoffset = 0
  for (const h of at.nav) {
    if (h.kind === "section") {
      xpos = 0; ypos = 1; yoffset = 0
      setMin()
      items.push(box, glue(ex("1.875ex"), 65536, 2))
      const title = h.section === now.section ? titleText(h.short, f) : [colorPush(mixer(c).spec("fg!50!bg")), ...titleText(h.short, f), colorPop()]
      box = sized(hpack([colorPush(c.fg), ...navigationLink(title, c.fg, h.page), colorPop()]))
    } else if (h.kind === "slide" && h.section > 0 && h.slide > 0) {
      if (h.subsection === 0) yoffset = 1
      xpos = h.slide; ypos = h.subsection + yoffset
      const raise = (-offset - boxsize) * ypos - CM(".05cm")
      minDim = boxsize * xpos - boxsize + 65536
      // \usebeamerfont{mini frame}: in the current subsection \usebeamercolor[fg]{mini frame}, the current frame filled;
      // elsewhere \usebeamercolor{mini frame} and \color{fg!50!bg}
      const mini = useColor(t, "mini frame", c)
      const current = h.section === now.section && h.subsection === now.subsection
      const color = current ? mini.fg : mixer(mini).spec("fg!50!bg")
      const content = [colorPush(color), ...miniFrame(pgf, miniFont, color, current && h.slide === now.slide), colorPop()]
      // \beamer@link(first/last): the frame's last page from its first up to the one before the last
      const page = at.page >= h.first && at.page < h.last ? h.last : h.first
      const raised = hpack([kern(minDim, true), hpack(navigationLink(content, c.fg, page))])
      raised.shift = -raise
      items.push(hpack([raised, glue(-CM("10cm"), 65536, 1)], { exactly: 0 }))
    }
  }
  setMin()
  items.push(box, filGlue(), glue(CM(".3cm")))
  return vpack([colorPush(c.fg), hpack(items, { exactly: width }), colorPop()])
}

/** The miniframes headline's boxes, in the headline's font, onto `list` */
export function miniframesHeadline(k: ClassOptionData, t: Theme, at: FootlineAt, colors: ColorState, list: Node[], decisions: ParagraphTrace[]) {
  const size = fontSize(t, k, "headline", "normalsize"), hk = headFootK(k)
  const f = selectFont(k, size, SANS)
  const ex = (x: string) => parseDimen(x, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
  const boxes = [separation(k, t, size, colors, decisions, "upper separation line head")]
  // section in head/foot's box: \leavevmode (an empty paragraph), \vskip2.5ex, \vskip-\baselineskip, the navigation,
  // \vskip1.125ex
  boxes.push(beamercolorbox(hk, t, "section in head/foot", colorboxOptions("", hk, lengthEnv(hk, f.params[QUAD], f.params[X_HEIGHT])), colors, (b) => {
    const { vlist, trace } = lineBreak([emptyBox("hlist", 0)], { ...classParams(k), hsize: b.hsize, leftSkip: spec("leftskip", b.leftskip), rightSkip: spec("rightskip", b.rightskip), ...sloppy(f.params[QUAD]) })
    decisions.push(trace)
    const bs = k.sizes[size].baselineskip
    boxParagraph(b.v, vlist, bs)
    b.v.vskip(dimen(ex("2.5ex")))
    b.v.vskip(dimen(-bs.width))
    b.v.box(navigation(k, t, at.pgf, at, fontSize(t, k, "section in head/foot", size), useColor(t, "section in head/foot", colors), k.dimens.paperwidth), bs)
    b.v.vskip(dimen(ex("1.125ex")))
  }))
  boxes.push(separation(k, t, size, colors, decisions, "middle separation line head"))
  boxes.push(headFootBox(k, t, size, size, colors, decisions, "ht=2.5ex,dp=1.125ex,leftskip=.3cm,rightskip=.3cm plus1fil", "subsection in head/foot", (_f, inner) => {
    const sf = selectFont(k, fontSize(t, k, "subsection in head/foot", size), SANS)
    return { list: [...headLink(at.heads.subsection, sf, inner.fg), spaceGlue(sf, 1000)] }
  }))
  boxes.push(separation(k, t, size, colors, decisions, "lower separation line head"))
  stack(list, boxes)
}

/** The miniframes footline (by the theme's footline option), in the footline's font, onto `list` */
export function miniframesFootline(k: ClassOptionData, t: Theme, info: TitleInfo, at: FootlineAt, colors: ColorState, list: Node[], decisions: ParagraphTrace[]) {
  const size = fontSize(t, k, "footline", "normalsize")
  const font = (name: string) => selectFont(k, fontSize(t, k, name, size), SANS)
  const line = "ht=2.5ex,dp=1.125ex,leftskip=.3cm,rightskip=.3cm plus1fil"
  // {\usebeamerfont{…}\usebeamercolor[fg]{…}…}: a color pushed in a group, popped at its end
  const institute = (inner: ColorState) => [colorPush(useColor(t, "institute in head/foot", inner).fg), shortBox(plain(info.short.institute), font("institute in head/foot"))]
  const title = (inner: ColorState) => navigationLink([shortBox(plain(info.short.title), font("title in head/foot"))], inner.fg, at.page === 1 ? at.lastPage : 1)
  // (the page number template, empty, in its fg)
  const pageNumber = (inner: ColorState) => colorPush(useColor(t, "page number in head/foot", inner).fg)
  const boxes = [separation(k, t, size, colors, decisions, "upper separation line foot")]
  if (t.footline === "authorinstitutetitle") {
    boxes.push(headFootBox(k, t, size, size, colors, decisions, line, "author in head/foot", (_f, inner) =>
      ({ list: [shortBox(plain(info.short.author.replace(/\s*\\and(?![A-Za-z])\s*/g, ", ")), font("author in head/foot")), fillGlue(), ...institute(inner), colorPop()] })))
    boxes.push(headFootBox(k, t, size, size, colors, decisions, line, "title in head/foot", (_f, inner) =>
      ({ list: [...title(inner), fillGlue(), pageNumber(inner), colorPop()] })))
  } else {
    boxes.push(headFootBox(k, t, size, size, colors, decisions, line, "title in head/foot", (_f, inner) =>
      ({ list: [...title(inner), fillGlue(), ...institute(inner), pageNumber(inner), colorPop(), colorPop()] })))
  }
  boxes.push(separation(k, t, size, colors, decisions, "lower separation line foot"))
  stack(list, boxes)
}

/**
 * The tree outer theme's headline (beamerouterthemetree.sty), with hooks: the upper separation line's box, then three
 * boxes [wd=\paperwidth,ht=2.5ex,dp=1.125ex,leftskip=.3cm,rightskip=.3cm plus1fil], each in its own font: the short title,
 * the section's head, the subsection's head; a head wider than 1pt after a hook (\hskip2pt, 9.4pt for the subsection,
 * \raise1.9pt\hbox{\vrule width0.4pt height1.875ex\vrule width 5pt height0.4pt}\hskip1pt); then the lower separation
 * line's box
 */
export function treeHeadline(k: ClassOptionData, t: Theme, at: FootlineAt, info: TitleInfo, colors: ColorState, list: Node[], decisions: ParagraphTrace[]) {
  const size = fontSize(t, k, "headline", "normalsize")
  const row = "wd=\\paperwidth,ht=2.5ex,dp=1.125ex,leftskip=.3cm,rightskip=.3cm plus1fil"
  const sized = (name: string) => fontSize(t, k, name, size)
  const hooked = (name: string, indent: string, head: FootlineAt["heads"]["section"]) =>
    headFootBox(k, t, sized(name), sized(name), colors, decisions, row, name, (f, inner) => {
      const link = headLink(head, f, inner.fg)
      const pt = (x: string) => parseDimen(x, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
      const hook: Node[] = []
      if (hpack(link).width > 65536) {
        const h = hpack([{ kind: "rule", width: pt("0.4pt"), height: pt("1.875ex"), depth: null }, { kind: "rule", width: pt("5pt"), height: pt("0.4pt"), depth: null }])
        h.shift = -pt("1.9pt")
        hook.push(glue(pt(indent)), h, glue(pt("1pt")))
      }
      return { list: [...hook, ...link, spaceGlue(f, 1000)] }
    })
  stack(list, [
    separation(k, t, size, colors, decisions, "upper separation line head", "wd=\\paperwidth,colsep=1.5pt"),
    headFootBox(k, t, sized("title in head/foot"), sized("title in head/foot"), colors, decisions, row, "title in head/foot", (f, inner) =>
      ({ list: [...navigationLink([shortBox(plain(info.short.title), f)], inner.fg, at.page === 1 ? at.lastPage : 1), spaceGlue(f, 1000)] })),
    hooked("section in head/foot", "2pt", at.heads.section),
    hooked("subsection in head/foot", "9.4pt", at.heads.subsection),
    separation(k, t, size, colors, decisions, "lower separation line head", "wd=\\paperwidth,colsep=1.5pt"),
  ])
}
