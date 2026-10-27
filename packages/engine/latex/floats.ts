// Floats (latex.ltx \@float, \@xfloat, \end@float) built in vertical mode, with their captions
// (\caption, \@caption, the class's \@makecaption); the output routine places them.

import type { GlueSpec } from "../layout/dimen"
import { QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT } from "../layout/font"
import { parseGlue } from "../layout/dimen"
import { appendText } from "../layout/hmode"
import { lineBreak } from "../layout/linebreak"
import { glue, paramGlue, penalty, type BoxNode, type Node, type WhatsitNode, filGlue } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { type Block } from "./blocks"
import type { Ctx } from "./context"
import { centering as centeringShape, sloppy } from "./kernel"
import { singleSpaced } from "./setspace"
import { Unsupported } from "./unsupported"
import { IGNORE_DEPTH, plain } from "./vlist"
import type { ParagraphTrace } from "../trace/decisions"
import { type Float } from "./output"
import { anchor, labelName, spotAnchor } from "./hyperref"
import { colorPop, colorPush, setgroup, xcolor } from "./xcolor"
import { classParams, appendToVlist, crefWrites, labelWrite, paragraphInput, selectFont, type ParagraphOptions } from "./paragraph"
import { representation } from "./counters"
import type { SizeCommand } from "../layout/classdata"
import { algorithmBox } from "./algorithm"

/** where a caption goes, and what caption.sty reads there */
export interface CaptionOut {
  push(n: Node): void; box(b: BoxNode): void; paragraph(start: Node[], text: string): void
  /** caption.sty: \prevdepth where \caption stands, an \hrule there, and a paragraph's lines at a size (its trace recorded) */
  prevDepth(): number | null; rule(): void; lines(start: Node[], text: string, opts: ParagraphOptions, size?: SizeCommand): Node[]
}

/** what a caption leaves for a \label after it: the float's number, \@currentlabel, nameref's name, and a subcaption's
 *  \thesub<type> (subcaption's \label writes sub@key with it too) */
export interface Captioned { number: number; label: string; name: string; sub?: string }

/**
 * \caption{text} in a float of type `env` at \hsize `hsize`: \refstepcounter, the lof/lot line, then in a group
 * \@parboxrestore\normalsize\@makecaption: \vskip\abovecaptionskip, the caption centered in an \hbox to \hsize
 * or, wider than that, a paragraph, then \vskip\belowcaptionskip. `sub`: subcaption's, in a subfigure or subtable.
 */
export function caption(cx: Ctx, env: "figure" | "table", source: string, hsize: number, out: CaptionOut, sub = false): Captioned {
  const { hyper } = cx.pre
  const { counters, refs, romanFont, run } = cx
  const text = source.replace(/\s+/g, " ").trim()
  if (/[\\{}$%&#^_~]/.test(text)) throw new Unsupported(`caption "${text}"`)
  if (cx.pre.usesCaption) return captionPackage(cx, env, text, hsize, out, sub)
  const number = ++counters[env]
  refs.href = counters.href(env, number) // global; \@currentlabel ends with the float's group
  out.push(lofLine(cx, env, number, text))
  out.push(glue(run.k.dimens.abovecaptionskip))
  // \sbox\@tempboxa{\fnum@figure: text}: \figurename\nobreakspace\thefigure
  const l: Node[] = [], state = { spaceFactor: 1000 }
  appendText(l, env === "figure" ? "Figure" : "Table", romanFont, state, false)
  l.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0)) // \nobreak\ 
  // hyperref: \hyper@@anchor (H.S H.R) before the text, after "n: "
  if (hyper) { appendText(l, `${counters.the(number)}: `, romanFont, state, false); l.push(...spotAnchor(refs.href, "h", l.at(-1), run.k.sizes.normalsize.baselineskip.width)); appendText(l, text, romanFont, state, false) }
  else appendText(l, `${counters.the(number)}: ${text}`, romanFont, state, false)
  const cap = hpack(setgroup(l)) // \sbox
  if (cap.width > hsize) { // too wide for a line: #1: #2\par, a paragraph
    const start: Node[] = [hpack([])]
    appendText(start, env === "figure" ? "Figure" : "Table", romanFont, { spaceFactor: 1000 }, false)
    start.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0))
    if (hyper) { appendText(start, `${counters.the(number)}: `, romanFont, { spaceFactor: 1000 }); start.push(...spotAnchor(refs.href, "h", start.at(-1), run.k.sizes.normalsize.baselineskip.width)); out.paragraph(start, text) }
    else out.paragraph(start, `${counters.the(number)}: ${text}`)
  } else out.box(hpack([filGlue(), cap, filGlue()], { exactly: hsize }))
  out.push(glue(run.k.dimens.belowcaptionskip))
  return { number, label: counters.the(number), name: labelName(text) } // (nameref drops a final period)
}

/** \addcontentsline{lof}{figure}{\protect\numberline{n}{text}} (or lot): its \write */
function lofLine(cx: Ctx, env: "figure" | "table", number: number, text: string): Node {
  const ext = env === "figure" ? "lof" : "lot"
  return { kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\contentsline {${env}}{\\protect \\numberline {${cx.counters.the(number)}}{\\ignorespaces ${text}}}{\\thepage }{${cx.pre.hyper ? cx.refs.href : ""}}\\protected@file@percent }}` }
}

/**
 * caption.sty's \@makecaption at its defaults (format=plain, labelsep=colon, justification=justified,
 * singlelinecheck, strut, position=auto): position=auto puts the caption on top when \prevdepth is -1000pt
 * (nothing above it) at the group's first caption, \vskip\belowcaptionskip, the caption, \vskip\abovecaptionskip, \hrule height 0pt;
 * below, the reverse. The caption is a paragraph: \hspace{0pt} and a \parbox[b]{\hsize} holding
 * \leavevmode label \vrule height\ht\strutbox width0pt \nobreak\hskip0pt text \@finalstrut\strutbox\par,
 * centered (\centering) when it fits on a line (its \hbox no wider than \hsize), else justified.
 * A subcaption (subcaption.sty's options for sub: font+=smaller, labelformat=parens, labelsep=space, skip=6pt,
 * list=0) is (a) text in \small, without a lof line; the first one in a float steps the float's counter, and
 * the \caption after it takes that number.
 */
function captionPackage(cx: Ctx, env: "figure" | "table", text: string, hsize: number, out: CaptionOut, isSub: boolean): Captioned {
  const { counters, refs, run } = cx
  const f = run.floatCaption
  let number: number, sub: string | undefined
  if (isSub) {
    if (f.number === null || f.pending) f.subAbove = true // (\caption@setsubcaption: flag 4 before the \caption, 8 after)
    if (f.number === null) { f.number = ++counters[env]; f.pending = true; f.sub = 0 } // (\newcounter{subfigure}[figure])
    number = f.number
    const n = ++f.sub
    sub = representation("alph", n)
    // \theHsubfigure: \theHfigure.\arabic{subfigure}; with hypcap, the float's \caption@makecurrentHref (its sub=hypcap=0
    // leaves the float's definition in force): the float's anchor, and no anchor in the text
    refs.href = f.hypcap ?? `sub${counters.href(env, number)}.${n}`
  } else {
    if (f.pending) { number = f.number!; f.pending = false }
    else { number = ++counters[env]; f.number = number; f.sub = 0 }
    refs.href = f.hypcap ?? counters.href(env, number)
    out.push(lofLine(cx, env, number, text))
  }
  if (xcolor.on) out.push(colorPush()) // (\caption@normalsize's \normalcolor, popped where its group ends)
  const size: SizeCommand = isSub ? "small" : "normalsize"
  const font = selectFont(run.k, size, cx.normalAttrs), sz = run.k.sizes[size]
  const above = isSub ? 6 * 65536 : run.k.dimens.abovecaptionskip
  // (\caption@fixposition: the first caption in a group, or in the float around it, fixes the position)
  const top = f.top ??= !f.subAbove && out.prevDepth() === IGNORE_DEPTH
  if (top) out.push(glue(run.k.dimens.belowcaptionskip))
  else { out.rule(); out.push(glue(above)) }
  const label: Node[] = []
  if (isSub) appendText(label, `(${sub}) `, font, { spaceFactor: 1000 }, false)
  else {
    appendText(label, env === "figure" ? "Figure" : "Table", font, { spaceFactor: 1000 }, false)
    label.push(penalty(10000), glue(font.params[SPACE], font.params[SPACE_STRETCH], 0, font.params[SPACE_SHRINK], 0)) // \nobreakspace
    appendText(label, `${counters.the(number)}: `, font, { spaceFactor: 1000 }, false)
  }
  // \caption@slc: \sbox\@tempboxa{label text}, no wider than \hsize
  const words: Node[] = []
  appendText(words, text, font, { spaceFactor: 1000 }, false)
  const single = hpack([...label, ...words]).width <= hsize
  const start: Node[] = [hpack([]), ...label, { kind: "rule", width: 0, height: sz.strut.height, depth: null }, penalty(10000), glue(0)]
  const lines = out.lines(start, text, { hsize, end: [penalty(10000), { kind: "rule", width: 0, height: 0, depth: sz.strut.depth }], ...(single ? centeringShape() : {}) }, size)
  const inner: Node[] = []
  let pd: number | null = IGNORE_DEPTH
  for (const n of lines) {
    if (n.kind === "hlist") pd = appendToVlist(inner, n, pd, sz.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit)
    else inner.push(n)
  }
  out.paragraph([hpack([]), glue(0), vpack(inner)], "") // (the \hspace after the \parbox goes at the paragraph's end)
  if (top) { out.push(glue(above)); out.rule() }
  else out.push(glue(run.k.dimens.belowcaptionskip))
  if (xcolor.on) out.push(colorPop())
  return { number, label: counters.the(number) + (sub ?? ""), name: labelName(text), ...(sub ? { sub } : {}) }
}

/**
 * caption.sty's \caption@startanchor in vertical mode, at the float's start: \nointerlineskip,
 * \vspace*{-\caption@hypcapspace} (.5\baselineskip), \hyper@anchorstart{name}\hyper@anchorend,
 * \vspace*{\caption@hypcapspace}, then \prevdepth restored (-1000pt: the float's list was empty)
 */
function hypcapAnchor(name: string, baselineskip: number): Node[] {
  const half = Math.trunc(baselineskip / 2) // (.5\baselineskip: xn_over_d, the sign applied after)
  const vspace = (w: number): Node[] => [{ kind: "rule", width: null, height: 0, depth: 0 }, penalty(10000), glue(w), glue(0)] // \@vspacer
  return [...vspace(-half), ...anchor(name, baselineskip, "v", glue(0)), ...vspace(half)]
}

/** caption.sty's \label in a float (\caption@xlabel): the first one writes \caption@xref's definition first;
 *  in a minipage, amsmath's \@arrayparboxrestore (\let\label\ltx@label) put LaTeX's \label back */
export function captionXref(cx: Ctx, minipage = false): Node[] {
  if (!cx.pre.usesCaption || cx.run.captionXref || minipage && cx.pre.amsmath) return []
  cx.run.captionXref = true
  return [{ kind: "whatsit", text: "\\write1{\\providecommand*\\caption@xref[2]{\\@setref\\relax\\@undefined{#1}}}" }]
}

export function floatBlock(cx: Ctx, b: Extract<Block, { kind: "float" }>) {
  if (b.fps === "H") { if (b.blank) cx.v.par(); hereBox(cx, b); return } // (in a paragraph: \float@endH's \vskip ends it)
  if (b.inPar) throw new Unsupported("a float inside a paragraph")
  if (b.blank) cx.v.par() // (after \@doendpe, its \par resets \clubpenalty)
  const marker = floatMarker(cx, b)
  cx.v.nodes.push(marker)
  // placed here, the float ends \if@nobreak (\@addtocurcol's \nobreak\@nobreakfalse\everypar{});
  // elsewhere \nobreak alone, and the text after it is still right after the heading
  if ((marker.float as Float).here) cx.v.nobreak = false
}

/**
 * float.sty's [H] (\@float@HH, \float@endH): no float, the box in the text, \vskip\intextsep \box\@currbox
 * \vskip\intextsep, its caption box set to an empty \vbox first
 */
function hereBox(cx: Ctx, b: Extract<Block, { kind: "float" }>) {
  const { run, v } = cx
  if (b.env !== "algorithm") throw new Unsupported(`a ${b.env} [H]`) // (float.sty's H: \if@flstyle false, the bare box)
  if (cx.pre.usesCaption && cx.pre.hyper) throw new Unsupported("an [H] float with caption.sty and hyperref")
  if (v.nobreak) throw new Unsupported("an [H] float right after a heading")
  // after a paragraph's text, \float@endH's \vskip ends it: its line breaking comes after the box's
  const pending = b.inPar ? cx.decisions.pop() : undefined
  const traces: ParagraphTrace[] = []
  // (setspace's \@xfloat runs for [H] only when it loads after float.sty: single spacing in the box)
  const spaced = run.k
  if (cx.pre.algorithm.singleHere) run.k = singleSpaced(spaced)
  let box: BoxNode
  try { box = algorithmBox(cx, b.body, traces, v.club, true) } finally { run.k = spaced }
  if (pending) cx.decisions.push(...traces, pending)
  else cx.decisions.push(...traces)
  v.vskip(run.k.glue.intextsep)
  v.box(box, run.k.sizes.normalsize.baselineskip)
  v.vskip(run.k.glue.intextsep)
}

/**
 * A float: its box, built as \@xfloat … \end@float build it, and the marker that stands for its \penalty-\@Miv
 * \vbox{}\penalty\@floatpenalty (on the vertical list, or in a paragraph's \vadjust: `b.inPar`, where
 * \if@nobreak is false and \@floatpenalty is -\@Mii); its paragraphs' traces go to `traces`, and `club` is the
 * \clubpenalty in force (in a paragraph, what its \everypar set)
 */
export function floatMarker(cx: Ctx, b: Extract<Block, { kind: "float" }>, traces: ParagraphTrace[] = cx.decisions, club = cx.v.club): WhatsitNode {
  const { amsmath, hyper } = cx.pre
  const { counters, doc, normalAttrs, notHere, refs, romanFont, run, v } = cx
  const decisions = traces // (in a paragraph: with its footnotes', in the order TeX reads them)
  // the placement specifier as \@xfloat counts it: h, t (2), b (4), p (8), and 16 unless !
  let fps = 16
  for (const c of b.fps ?? (b.env === "algorithm" ? "htbp" : "tbp")) { // \fps@figure and \fps@table are tbp, \fps@algorithm htbp
    if (c === "h") { if (fps % 2 === 0) fps++ }
    else if (c === "t" || c === "b" || c === "p") { const bit = c === "t" ? 2 : c === "b" ? 4 : 8; if (Math.floor(fps / bit) % 2 === 0) fps += bit }
    else if (c === "!") { if (fps > 15) fps -= 16 }
    else throw new Unsupported(`float option ${c}`)
  }
  if (b.env === "algorithm") {
    if (cx.pre.usesCaption && hyper) throw new Unsupported("an algorithm float with caption.sty and hyperref") // (hypcap's anchor)
    const spaced = run.k
    run.k = singleSpaced(spaced) // (setspace's \@xfloat)
    let box: BoxNode
    try { box = algorithmBox(cx, b.body, decisions, club) } finally { run.k = spaced }
    return floatWhatsit(cx, b, box, fps + 32 * 4) // \ftype@algorithm: float.sty's float@type, 4 after figure and table
  }
  const content: Node[] = []
  let pd: number | null = IGNORE_DEPTH, cap: Captioned | null = null
  const hsize = run.k.dimens.columnwidth
  const fbody = b.body.trim()
  const tokens = [...fbody.matchAll(/\\centering\b|\\caption\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\(?:label|vspace)\s*\{[^}]*\}|\\LXtabular\{\d+\}|\\LX(?:minipage|graphic)\{\d+\}|\S+/g)]
  const items = tokens.map((t) => t[0])
  let centered = false
  /** a paragraph in the float: \parindent is zero (\@parboxrestore), \sloppy (\tolerance 9999, \emergencystretch
   *  3em), and \centering's flush glue when it came before */
  const floatLines = (start: Node[], body: string, centering: boolean, opts: ParagraphOptions = {}, size: SizeCommand = "normalsize") => {
    // \centering's \finalhyphendemerits=\z@ outlasts \@parboxrestore, which resets only the skips
    const shape = centering ? centeringShape() : centered ? { finalHyphenDemerits: 0 } : {}
    // (\clubpenalty is the one in force: \@parboxrestore leaves it, and \@setminipage's \everypar replaces \@afterheading's)
    const par = paragraphInput(body, run.k, size, doc, { ...shape, start, amsmath, ...sloppy(romanFont.params[QUAD]), clubPenalty: club, ...opts })
    const lb = lineBreak(par.list, par.params)
    decisions.push(...par.notes, lb.trace)
    return lb.vlist
  }
  const floatParagraph = (start: Node[], body: string, centering = centered) => {
    const vlist = floatLines(start, body, centering)
    // new_graf in internal vertical mode adds \parskip (zero here) only to a list that is not empty, and
    // so does LaTeX's restart of the paragraph
    if (content.length) content.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
    for (const n of vlist) {
      if (n.kind === "hlist") pd = appendToVlist(content, n, pd, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit)
      else content.push(n)
    }
  }
  run.captype = b.env
  run.floatCaption = { number: null, pending: false, sub: 0, top: null, subAbove: false }
  // setspace's \@xfloat: \def\baselinestretch{\setspace@singlespace}\normalsize in the float
  const spaced = run.k
  run.k = singleSpaced(spaced)
  try {
  if (cx.pre.usesCaption && hyper) { // caption.sty's \caption@xfloat: \caption@start, hypcap's anchor (\Hy@linkcounter)
    run.floatCaption.hypcap = `${b.env}.caption.${++run.linkcounter}`
    content.push(...hypcapAnchor(run.floatCaption.hypcap, run.k.sizes.normalsize.baselineskip.width))
  }
  for (let ii = 0; ii < items.length; ii++) {
    const it = items[ii]
    if (it === "\\centering") { centered = true; continue }
    // minipages and graphics start a paragraph (\leavevmode): with what joins them on the line (\hfill, \quad, ~),
    // up to a blank line
    if (/^\\LX(?:minipage|graphic)\{\d+\}$/.test(it)) {
      let jj = ii
      while (jj + 1 < items.length && /^(?:\\LX(?:minipage|graphic)\{\d+\}|\\hfill|\\hfil|\\quad|\\qquad|~)$/.test(items[jj + 1]) && !/\n[ \t]*\n/.test(fbody.slice(tokens[jj].index! + items[jj].length, tokens[jj + 1].index!))) jj++
      floatParagraph([hpack([])], fbody.slice(tokens[ii].index!, tokens[jj].index! + items[jj].length))
      ii = jj
      continue
    }
    // a tabular starts a paragraph (\leavevmode): the \parindent box (zero after \@parboxrestore), then
    // the tabular's box, alone on its line; \centering sets \leftskip and \rightskip to \@flushglue
    const tab = it.match(/^\\LXtabular\{(\d+)\}$/)
    if (tab) {
      floatParagraph([hpack([]), doc.tabular!(Number(tab[1]), "normalsize", normalAttrs, undefined, { notes: decisions, club, widow: run.k.ints.widowpenalty, finalHyph: centered ? 0 : classParams(run.k).finalHyphenDemerits })], "")
      continue
    }
    // \vspace{skip} in vertical mode: \vskip skip \vskip\z@skip
    let m = it.match(/^\\vspace\s*\{([^}]*)\}$/)
    if (m) {
      let g: GlueSpec
      try { g = parseGlue(m[1], { em: romanFont.params[QUAD], ex: romanFont.params[X_HEIGHT] }) } catch { throw new Unsupported(`\\vspace{${m[1]}}`) }
      content.push(plain(g), glue(0))
      continue
    }
    m = it.match(/^\\caption\s*\{([^]*)\}$/)
    if (m) {
      cap = caption(cx, b.env, m[1], hsize, {
        push: (n) => content.push(n),
        box: (x) => { pd = appendToVlist(content, x, pd, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit) },
        paragraph: (start, text) => floatParagraph(start, text, false), // \@caption's \@parboxrestore undoes \centering
        prevDepth: () => pd,
        rule: () => { content.push({ kind: "rule", width: null, height: 0, depth: 0 }); pd = IGNORE_DEPTH },
        lines: (start, text, opts, size) => floatLines(start, text, false, opts, size),
      })
      continue
    }
    // \label after the caption: \protected@write\@auxout{}{\string\newlabel{key}{{n}{\thepage }{}{figure.n}{}}}
    m = it.match(/^\\label\s*\{([A-Za-z0-9:._-]+)\}$/)
    if (m && cap) { // nameref: the caption
      content.push(...captionXref(cx), labelWrite(refs, m[1], cap.label, refs.href, hyper ? cap.name : refs.name), ...crefWrites(refs, m[1], false, { type: b.env, arabic: cap.number, prefix: counters.crefPrefix(b.env), label: cap.label }))
      continue
    }
    if (/^\\label\b/.test(it)) throw new Unsupported(m ? "\\label before the caption" : `${it} in a ${b.env}`)
    throw new Unsupported(`${it} in a ${b.env}`)
  }
  } finally { run.captype = null; run.k = spaced }
  content.push(glue(0)) // \@endfloatbox: \par\vskip\z@skip
  const box = vpack(xcolor.on ? [colorPush(), vpack(content), colorPop()] : [vpack(content)]) // \color@vbox\normalcolor\vbox{…}
  return floatWhatsit(cx, b, box, fps + 32 * (b.env === "figure" ? 1 : 2)) // \ftype@figure 1, \ftype@table 2
}

/** \end@float's marker for a float's box and \count\@currbox */
function floatWhatsit(cx: Ctx, b: Extract<Block, { kind: "float" }>, box: BoxNode, count: number): WhatsitNode {
  const { notHere, run, v } = cx
  if (box.height > run.k.dimens.textheight) box.height = run.k.dimens.textheight // \@largefloatcheck
  const index = run.floats++
  return { kind: "whatsit", text: "", float: { box, count, nobreak: !b.inPar && v.nobreak, index, here: !notHere.has(index), ...(b.inPar ? { inPar: true } : {}) } satisfies Float }
}
