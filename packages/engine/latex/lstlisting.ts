// listings in the document: an lstlisting environment (\lst@Init in display style: the skips, frame,
// line numbers and caption around the token lines) and \lstinline in text, from listings.ts's options,
// scanner and frames.

import { SIZE_COMMANDS, type SizeCommand } from "../layout/classdata"
import type { GlueSpec } from "../layout/dimen"
import { QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT } from "../layout/font"
import { parseDimen } from "../layout/dimen"
import { appendText } from "../layout/hmode"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, glue, kern, penalty, type BoxNode, type Node, filGlue, ssGlue } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { type Block } from "./blocks"
import type { Ctx } from "./context"
import { flushglue } from "./kernel"
import { Unsupported } from "./unsupported"
import { dimen, IGNORE_DEPTH, negate } from "./vlist"
import { anchor, labelName } from "./hyperref"
import { COLOR_CMD, colorPop, colorPush, setgroup, xcolor } from "./xcolor"
import { lstFrameBoxV, lstFrameH, lstFrameShapes, lstOptions, lstScan, type LstFrame, type LstOptions } from "./listings"
import { crefWrites, fontAt, fontDeclaration, labelWrite, paragraphInput, selectFont, type FontAttrs } from "./paragraph"
import { styleColors } from "./colors"

/**
 * A float (latex.ltx \@float, \@xfloat, \@caption, the class's \@makecaption, \end@float) from
 * vertical mode: its box is built now, and a marker stands for \penalty-\@Miv\vbox{}\penalty-\@Miii,
 * where the output routine will place it.
 */
/** listings' fonts from a size and font: a style's (font declarations and size commands), and the other encodings' */
export function lstFontsAt(cx: Ctx, size0: SizeCommand, attrs0: FontAttrs) {
  const { doc, run } = cx
  // a style: font declarations and size commands, from the font where the listing is
  const styleOf = (style: string) => {
    let size: SizeCommand = size0, a: FontAttrs = attrs0
    for (const m of style.replace(COLOR_CMD, "").matchAll(/\\([a-zA-Z]+)/g)) {
      if ((SIZE_COMMANDS as readonly string[]).includes(m[1])) { size = m[1] as SizeCommand; continue }
      const next = fontDeclaration(m[1], a, run.k, size, doc)
      if (!next) throw new Unsupported(`listings style \\${m[1]}`)
      a = next
    }
    return { size, a }
  }
  const fonts = {
    colors: (style: string) => styleColors(cx, style),
    font(style: string) { const { size, a } = styleOf(style); return { font: selectFont(run.k, size, a), tt: a.fam === "cmtt", bold: a.ser === "bx", italicShape: a.shape !== "n", size } },
    /** TS1 from the class's table; OML and OMS by omlcmm.fd and omscmsy.fd (bold: cmmib, cmbsy, 10pt from 10 up) */
    other(style: string, enc: "TS1" | "OML" | "OMS") {
      const { size, a } = styleOf(style)
      if (enc === "TS1") return selectFont(run.k, size, { ...a, enc: "TS1" })
      const at = run.k.sizes[size].font.at, pt = at / 65536
      // omlcmr.fd and omscmr.fd: cmr's bold to cmm/b and cmsy/b; no cmss family: \DeclareFontSubstitution's m series
      const bold = a.ser === "bx" && a.fam === "cmr"
      const step = pt < 6 ? 5 : pt < 7 ? 6 : pt < 8 ? 7 : pt < 9 ? 8 : pt < 10 ? 9 : enc === "OML" && !bold && pt >= 12 ? 12 : 10
      return fontAt((enc === "OML" ? (bold ? "cmmib" : "cmmi") : bold ? "cmbsy" : "cmsy") + step, at)
    },
  }
  return { styleOf, fonts }
}

export function listing(cx: Ctx, b: Extract<Block, { kind: "listing" }>, runInHead: ((em?: number, parindent?: number) => Node[]) | null = null) {
  const { amsmath, cls, hyper, lstBase, medskipamount, t1, usesListings } = cx.pre
  const { counters, decisions, doc, esphackNobreaks, lastNode, listings, refs, romanFont, run, v } = cx
  if (!usesListings) throw new Unsupported("lstlisting without \\usepackage{listings}")
  // right after a heading the listing's \everypar replaces \@afterheading's (which then never runs: \if@nobreak
  // stays true and \clubpenalty as it was), unless a top frame's paragraph runs it first
  if (t1) throw new Unsupported("listings with T1")
  const o = lstOptions(listings[b.n].options, lstBase)
  const { styleOf, fonts } = lstFontsAt(cx, "normalsize", { enc: "OT1", fam: "cmr", ser: "m", shape: "n" })
  const base = styleOf(o.basicstyle), baseFont = selectFont(run.k, base.size, base.a)
  // \lst@width: basewidth (0.6em, 0.45em for flexible columns) in the listing's font
  const width = parseDimen(o.columns === "fixed" ? "0.6em" : "0.45em", { em: baseFont.params[QUAD], ex: baseFont.params[X_HEIGHT] })
  const sz = run.k.sizes[base.size], hsize = run.k.dimens.columnwidth
  const units = { em: baseFont.params[QUAD], ex: baseFont.params[X_HEIGHT] }
  const dim = (key: keyof LstOptions) => { try { return parseDimen(o[key] as string, units) } catch { throw new Unsupported(`${key}=${o[key]}`) } }
  const xleft = dim("xleftmargin"), lw = hsize - xleft - dim("xrightmargin")
  const events = lstScan({ width, lines: listings[b.n].lines, options: o, fonts, carry: run.lstCarry, breaks: { indent: dim("breakindent"), lineWidth: lw, left: xleft } })
  const smallskip = glue(196608, 65536, 0, 65536, 0), medskip = cls === "letter" ? dimen(medskipamount) : glue(393216, 131072, 0, 131072, 0)
  const vspace = (g: GlueSpec) => { v.vskip(g); v.vskip(dimen(0)) } // \vspace in vertical mode
  // \lst@Init: \par\penalty-50\relax\vspace\lst@aboveskip, \normalbaselines, \lst@MakeCaption t
  v.par()
  const clubOutside = v.club
  v.nodes.push(penalty(-50))
  vspace(medskip)
  // caption.sty's \lst@MakeCaption: its options' \@esphack, \nobreak in vertical mode under \if@nobreak or \if@noskipsec
  const capEsphack = () => { if (cx.pre.usesCaption && (v.nobreak || run.noskipsec)) v.nodes.push(penalty(10000)) }
  if (cx.pre.usesCaption && hyper) throw new Unsupported("a listing with caption.sty and hyperref")
  capEsphack()
  v.nodes.push(penalty(0)) // \allowbreak
  // \@currentHref after it: \refstepcounter{lstlisting} (a caption) or \lst@HRefStepCounter (\lst@neglisting
  // goes down), then each line's \refstepcounter{lstnumber}
  let captioned = 0
  // hyperref: \hyper@refstepcounter's anchor (\baselineskip H.A) where the counter steps
  const lstAnchor = (name: string) => { if (hyper) v.nodes.push(...anchor(name, run.k.sizes.normalsize.baselineskip.width, "v", lastNode())) }
  if (o.caption !== null) {
    if (cls !== "article") throw new Unsupported("a listing caption outside article")
    if (cx.pre.usesCaption) throw new Unsupported("a listing caption with caption.sty")
    const text = o.caption.replace(/\s+/g, " ").trim()
    if (/[\\{}$%&#^_~]/.test(text)) throw new Unsupported(`listing caption "${text}"`)
    const n = captioned = ++run.listingCount // \refstepcounter{lstlisting}
    refs.href = counters.href("lstlisting", n)
    lstAnchor(refs.href)
    if (o.label !== null) {
      if (!/^[A-Za-z0-9:._-]+$/.test(o.label)) throw new Unsupported(`listing label ${o.label}`)
      v.nodes.push(labelWrite(refs, o.label, String(n), counters.href("lstlisting", n), cx.pre.nameref ? labelName(text) : refs.name)) // nameref: the caption (its \lst@MakeCaption)
      v.nodes.push(...esphackNobreaks(v.nobreak))
      // cleveref's second write, \crefalias{lstlisting}{listing} (a counter within nothing in article)
      const cref = crefWrites(refs, o.label, false, { type: "listing", arabic: n, prefix: "", label: String(n) })
      if (cref.length) v.nodes.push(...cref, ...esphackNobreaks(v.nobreak))
    }
    v.nodes.push({ kind: "whatsit", text: `\\write1{\\@writefile{lol}{\\protect \\contentsline {lstlisting}{\\protect \\numberline {${n}}${text}}{\\thepage }{${hyper ? refs.href : ""}}\\protected@file@percent }}` })
    if (v.nobreak) v.nodes.push(penalty(10000)) // \protected@write's \nobreak
    // in a group: \par\@parboxrestore\normalsize\normalfont, \@makecaption with \vskip as \nobreak\vskip…\nobreak
    v.nodes.push(penalty(10000)); v.vskip(smallskip); v.nodes.push(penalty(10000))
    const l: Node[] = [], state = { spaceFactor: 1000 }
    appendText(l, "Listing", romanFont, state, false)
    l.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0)) // ~
    appendText(l, `${n}: ${text}`, romanFont, state, false)
    const cap = hpack(setgroup(l)) // \sbox
    if (cap.width > hsize) throw new Unsupported("a listing caption wider than the line")
    v.box(hpack([filGlue(), cap, filGlue()], { exactly: hsize }), run.k.sizes.normalsize.baselineskip)
    v.nodes.push(penalty(10000)); v.vskip(smallskip); v.nodes.push(penalty(10000))
  } else if (o.label !== null) throw new Unsupported("a listing label without a caption")
  // \lst@HRefStepCounter (\theHlstlisting: the chapter's, then the number); its \@currentHref is global
  else { run.negListing--; lstAnchor(counters.href("lstlisting", run.negListing)); if (hyper) refs.href = counters.href("lstlisting", run.negListing) }
  // the lineshape and frames aspects: \linewidth less xleftmargin and xrightmargin, \@totalleftmargin plus
  // xleftmargin, \lst@parshape (\parshape 1 for every paragraph); the frame's dimensions in the listing's font
  const parShape: [number, number][] = [[xleft, lw]]
  // breaklines: \pretolerance\@M, \rightskip\@flushglue, \parshape 2 with \lst@breakshape for the lines after the first
  const breaks = o.breaklines ? { pretolerance: 10000, rightSkip: flushglue("rightskip") } : {}
  const shapes = lstFrameShapes(o.frame)
  // (the Init hook: fillcolor from backgroundcolor, rulesepcolor from fillcolor)
  const bkg = styleColors(cx, o.backgroundcolor), fill = o.fillcolor ? styleColors(cx, o.fillcolor) : bkg, rulesep = o.rulesepcolor ? styleColors(cx, o.rulesepcolor) : fill
  const fr: LstFrame = {
    tshape: shapes.t, bshape: shapes.b, lshape: shapes.l, rshape: shapes.r, rule: dim("framerule"), sep: dim("framesep"), rulesep: dim("rulesep"), xleft: dim("framexleftmargin"), xright: dim("framexrightmargin"),
    colors: { rule: styleColors(cx, o.rulecolor), bkg, fill, rulesep },
  }
  const frame = () => lstFrameBoxV(fr, lw, sz.strut.height, sz.strut.depth)
  let lineskip = run.k.glue.lineskip, lineskiplimit = run.k.dimens.lineskiplimit
  const frameParagraph = (box: BoxNode, end: Node[] = [], top = false) => {
    // the \everypar in force: a heading's, which resets \clubpenalty in the paragraph after its own
    const start: Node[] = [box]
    if (runInHead && top) { // a run-in heading's: \global\@noskipsecfalse, \clubpenalty\@M, the heading in place
      start.unshift(...runInHead(baseFont.params[QUAD], o.breaklines ? 0 : run.k.dimens.parindent)); runInHead = null; run.noskipsec = false; v.club = 10000 // (breaklines: \parindent\z@)
    } else if (v.nobreak) { v.nobreak = false; v.club = 10000 } // \@nobreakfalse\clubpenalty\@M (no indent box to take off)
    else if (v.afterheadingEverypar) { v.club = run.k.ints.clubpenalty; v.afterheadingEverypar = false }
    const p = paragraphInput("", run.k, "normalsize", doc, { start, parShape, ...breaks, amsmath, clubPenalty: v.club, end })
    const lb = lineBreak(p.list, p.params)
    decisions.push(...p.notes, lb.trace)
    v.paragraph(lb.vlist, dimen(0), sz.baselineskip, lineskip, lineskiplimit)
  }
  // \lst@frameInit's top: \par\lst@parshape, \vskip\@tempdima\vskip\lineskip if \@tempdima = \ht - \baselineskip is
  // negative (\prevdepth would count only from 256pt), \noindent\box\z@\par; then \lineskiplimit\maxdimen \lineskip\z@
  // \lsthk@Init: basicstyle (its \color pushes on the vertical list), … \lst@frameInit
  const basicColors = styleColors(cx, o.basicstyle)
  for (const c of basicColors) v.nodes.push(colorPush(c))
  const top = lstFrameH(fr, lw, "T")
  if (top) {
    const t = top.height - sz.baselineskip.width
    if (t < 0) { v.vskip(dimen(t)); v.vskip(run.k.glue.lineskip) }
    frameParagraph(top, [], true)
    lineskip = dimen(0); lineskiplimit = 1073741823
  }
  // line numbers: \everypar's \refstepcounter{lstnumber} and \lst@SkipOrPrintLabel (every \lst@stepnumber-th from
  // \lst@firstnumber), \lst@PlaceNumber: \llap{\normalfont numberstyle n \kern numbersep} (right: \rlap after \linewidth)
  // (the Init hook reads firstnumber=auto's \lst@lineno before InitVars resets it: the last listing's)
  const F = o.firstnumber ?? 1, S = o.stepnumber, F0 = o.firstnumber ?? run.lstLineno
  let lstnumber = F - 1, numberFirst = o.numberfirstline
  let skip = S > 0 ? F0 - Math.trunc(F0 / S) * S : 0
  if (S > 0 && skip > 0) skip -= S
  const sizes = [...o.basicstyle.matchAll(/\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large)(?![a-zA-Z])/g)].map((m) => m[0]).join("")
  const numberStyle = styleOf(sizes + o.numberstyle), numberFont = selectFont(run.k, numberStyle.size, numberStyle.a)
  // (on the right the \kern comes before \lst@numberstyle: em and ex of \normalfont at the basic style's size)
  const sepFont = o.numbers === "right" ? selectFont(run.k, styleOf(sizes).size, { enc: "OT1", fam: "cmr", ser: "m", shape: "n" }) : numberFont
  let numbersep = 0
  try { numbersep = parseDimen(o.numbersep, { em: sepFont.params[QUAD], ex: sepFont.params[X_HEIGHT] }) } catch { throw new Unsupported(`numbersep=${o.numbersep}`) }
  const number = (empty: boolean): Node[] => {
    lstnumber++
    // hyperref: the \refstepcounter{lstnumber} anchor, in horizontal mode after the frame box
    const a = hyper ? anchor(`lstnumber.${captioned || run.negListing}.${lstnumber}`, sz.baselineskip.width, "h", undefined) : []
    if (o.numbers === "none" || S === 0) return a
    if (empty && !o.numberblanklines && skip === 0) skip -= S // \lsthk@OnEmptyLine
    let place = false
    if (skip === 0) { skip -= S; place = true; numberFirst = false } else if (numberFirst) { place = true; numberFirst = false }
    skip++
    if (!place) return a
    const digits: Node[] = []
    appendText(digits, String(lstnumber), numberFont, { spaceFactor: 1000 }, false)
    const hss = ssGlue()
    // numberstyle's \color: pushed in the box, popped after it (\aftergroup at the box's end)
    const nc = styleColors(cx, o.numberstyle), push = nc.map((c) => colorPush(c)), pops = nc.map(() => colorPop())
    return [...a, o.numbers === "left" ? hpack([hss, ...push, ...digits, kern(numbersep, true)], { exactly: 0 }) : hpack([kern(lw, true), kern(numbersep, true), ...push, ...digits, hss], { exactly: 0 }), ...pops]
  }
  // each line: \par\noindent (\everypar: \lst@parshape, the frame box, the number) \hbox{}, its boxes
  let line: Node[] | null = null, lineCount = 0
  const breakLine = (start: Node[], shape?: [number, number]) => {
    const p = paragraphInput("", run.k, "normalsize", doc, { start, parShape: shape ? [...parShape, shape] : parShape, ...breaks, amsmath, clubPenalty: v.club }) // (the listing's \everypar leaves \clubpenalty)
    const lb = lineBreak(p.list, p.params)
    decisions.push(...p.notes, lb.trace)
    return lb.vlist
  }
  let shape: [number, number] | undefined
  const endLine = () => { if (line) v.paragraph(breakLine(line, shape), dimen(0), sz.baselineskip, lineskip, lineskiplimit); line = null }
  for (const e of events) {
    // empty lines at the end are paragraphs in a \vbox that is thrown away, while the last line's is still open
    if ("newline" in e && e.discarded) { breakLine([frame(), ...number(!!e.empty), emptyBox("hlist", 0)], e.shape); lineCount++ }
    else if ("newline" in e) { endLine(); line = [frame(), ...number(!!e.empty), emptyBox("hlist", 0)]; shape = e.shape; lineCount++ }
    else if ("disc" in e) line!.push({ kind: "disc", pre: [], post: [hpack([ssGlue(), frame(), kern(e.indent, true), kern(-xleft, true)], { exactly: 0 })], replaceCount: 0 })
    else line!.push(e.node)
  }
  endLine()
  if (lineCount) refs.href = `lstnumber.${captioned || run.negListing}.${lstnumber}` // \theHlstnumber
  run.lstLineno = listings[b.n].lines.length
  // \lst@DeInit: \par\removelastskip, \par\penalty-50\vspace\lst@belowskip; \lst@doendpe
  const last = v.lastSkip
  if (last.width !== 0) v.vskip(negate(last))
  // \lst@frameExit: \everypar{}\par\lst@parshape\nointerlineskip\noindent\box\z@ (ended by the \par below)
  const bottom = lstFrameH(fr, lw, "B")
  // \lst@DeInit's \normalcolor: in the bottom frame's paragraph, which the \par below ends
  if (bottom) { v.prevDepth = IGNORE_DEPTH; frameParagraph(bottom, xcolor.on ? [colorPush()] : []) }
  else if (xcolor.on) v.nodes.push(colorPush())
  capEsphack() // (\lst@MakeCaption b, after them)
  v.nodes.push(penalty(-50))
  vspace(medskip)
  if (xcolor.on) v.nodes.push(colorPop()) // the group's end
  for (const _ of basicColors) v.nodes.push(colorPop())
  v.club = clubOutside // (\clubpenalty set in the listing's group ends with it)
  v.endpePar = v.doendpe = v.endpeEverypar = true
  v.afterheadingEverypar = false // \lst@doendpe's \everypar replaces it
  v.nobreak = false // \end{lstlisting}: \@nobreakfalse
}

/**
 * \lstinline number n where it stands (DocState.lstinline): \leavevmode\bgroup\lstset{flexiblecolumns,options},
 * \lsthk@TextStyle (no skips, frame or margins, an empty \everypar and \lst@NewLine), \lst@Init and \lst@DeInit
 * with no \par: the token boxes go into the paragraph
 */
export function lstinlineAt(cx: Ctx, n: number, size: SizeCommand, attrs: FontAttrs): Node[] {
  const { lstBase, t1, usesListings } = cx.pre
  const { listings, run } = cx
  if (!usesListings) throw new Unsupported("\\lstinline without \\usepackage{listings}")
  if (t1) throw new Unsupported("listings with T1")
  const o = lstOptions(listings[n].options, lstOptions("flexiblecolumns", lstBase))
  const { styleOf, fonts } = lstFontsAt(cx, size, attrs)
  const base = styleOf(o.basicstyle), baseFont = selectFont(run.k, base.size, base.a)
  const width = parseDimen(o.columns === "fixed" ? "0.6em" : "0.45em", { em: baseFont.params[QUAD], ex: baseFont.params[X_HEIGHT] })
  if (run.lstCarry.gobbledws) throw new Unsupported("\\lstinline after gobbled whitespace")
  if (o.breaklines) throw new Unsupported("\\lstinline with breaklines")
  const events = lstScan({ width, lines: listings[n].lines, options: o, fonts, textStyle: true, carry: run.lstCarry })
  run.lstLineno = 1 // InitVars, and no end of line
  const nodes = events.map((e) => { if ("node" in e) return e.node; throw new Unsupported("\\lstinline with a line break") })
  const basicColors = styleColors(cx, o.basicstyle) // basicstyle in \lst@Init: its pushes before the tokens
  nodes.unshift(...basicColors.map((c) => colorPush(c)))
  if (xcolor.on) nodes.push(colorPush()) // \lst@DeInit's \normalcolor; then the group's end pops them all
  nodes.push(...basicColors.map(() => colorPop()), ...(xcolor.on ? [colorPop()] : []))
  return nodes
}
