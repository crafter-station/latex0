// Floats (latex.ltx \@float, \@xfloat, \end@float) built in vertical mode, with their captions
// (\caption, \@caption, the class's \@makecaption); the output routine places them.

import type { GlueSpec } from "../layout/dimen"
import { QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT } from "../layout/font"
import { parseDimen, parseGlue } from "../layout/dimen"
import { appendText } from "../layout/hmode"
import { lineBreak } from "../layout/linebreak"
import { FIL, glue, paramGlue, penalty, type BoxNode, type Node, type WhatsitNode, filGlue } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { type Block } from "./blocks"
import type { Ctx } from "./context"
import { centering as centeringShape, raggedleft, raggedright, sloppy } from "./kernel"
import { copyKeys, runList, setCaptionKeys, type CaptionFont, type CaptionKeys } from "./captionsetup"
import { widthRegisters } from "./boxes"
import { singleSpaced } from "./setspace"
import { Unsupported } from "./unsupported"
import { IGNORE_DEPTH, plain } from "./vlist"
import type { ParagraphTrace } from "../trace/decisions"
import { type Float } from "./output"
import { anchor, labelName, spotAnchor } from "./hyperref"
import { colorPop, colorPush, setgroup, xcolor } from "./xcolor"
import { classParams, appendToVlist, crefWrites, fontDeclaration, labelWrite, paragraphInput, selectFont, type FontAttrs, type ParagraphOptions } from "./paragraph"
import { representation } from "./counters"
import { SIZE_COMMANDS, type SizeCommand } from "../layout/classdata"
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
export function caption(cx: Ctx, env: "figure" | "table", source: CaptionCall, hsize: number, out: CaptionOut, sub = false): Captioned | null {
  const { hyper } = cx.pre
  const { counters, refs, romanFont, run } = cx
  const clean = (t: string) => {
    const c = t.replace(/\s+/g, " ").trim()
    if (/[\\{}$%&#^_~]/.test(c)) throw new Unsupported(`caption "${c}"`)
    return c
  }
  const text = clean(source.text), short = source.short === null ? null : clean(source.short)
  if (cx.pre.usesCaption) {
    if (text === "") throw new Unsupported("an empty caption with caption.sty") // (\caption@xdblarg's [\relax])
    return captionPackage(cx, env, { text, short, star: source.star }, hsize, out, sub)
  }
  if (source.star) throw new Unsupported("\\caption* without caption.sty")
  const number = ++counters[env]
  refs.href = counters.href(env, number) // global; \@currentlabel ends with the float's group
  out.push(lofLine(cx, env, number, short ?? text)) // (\@caption's lof line: the short caption)
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
  return { number, label: counters.the(number), name: labelName(short ?? text) } // (nameref drops a final period; the short caption)
}

/** \caption, \caption* or \caption[short]{text} */
export interface CaptionCall { text: string; short: string | null; star: boolean }
/** a \caption call where it stands: its star, short caption and text */
const CAPTION_RE = /\\caption(\*)?\s*(?:\[([^\]]*)\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/
export function captionCall(src: string): CaptionCall | null {
  const m = src.match(new RegExp(`^${CAPTION_RE.source}$`))
  return m && { star: !!m[1], short: m[2] ?? null, text: m[3] }
}

/** \addcontentsline{lof}{figure}{\protect\numberline{n}{text}} (or lot): its \write */
function lofLine(cx: Ctx, env: "figure" | "table", number: number, text: string): Node {
  const ext = env === "figure" ? "lof" : "lot"
  return { kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\contentsline {${env}}{\\protect \\numberline {${cx.counters.the(number)}}{\\ignorespaces ${text}}}{\\thepage }{${cx.pre.hyper ? cx.refs.href : ""}}\\protected@file@percent }}` }
}

/**
 * caption.sty's \caption@@make (caption3.sty) with the keys in force (run.floatCaption.keys): position (auto puts the
 * caption on top when \prevdepth is -1000pt, nothing above it, at the group's first caption; top and bottom), then
 * \vskip\belowcaptionskip, the caption, \vskip\abovecaptionskip, \hrule height 0pt on top; below, the reverse. The
 * caption is a paragraph: \hspace{left margin (+ indention)} and a \parbox[b]{width (- indention)} holding
 * \leavevmode (or \hskip-indention) label separator \vrule height\ht\strutbox width0pt \nobreak\hskip0pt text
 * \@finalstrut\strutbox\par in the fonts (\captionfont, \captionlabelfont, \captiontextfont) and justification set;
 * the single-line check (\caption@slc: \sbox\@tempboxa{label separator text} no wider than the width) sets it
 * with indention 0pt and \centering instead (the default style's single-line options). format=hang sets label and
 * separator in an \hbox and hangs the lines after it by its width (\@hangfrom). A subcaption (subcaption.sty's
 * options for sub: font+=smaller, labelformat=parens, labelsep=space, skip=6pt, list=0) has no lof line; the first one
 * in a float steps the float's counter, and the \caption after it takes that number. \caption* has no label, no
 * separator, no number and no lof line.
 */
function captionPackage(cx: Ctx, env: "figure" | "table", call: CaptionCall, hsize: number, out: CaptionOut, isSub: boolean): Captioned | null {
  const { counters, refs, run } = cx
  const { hyper } = cx.pre
  const f = run.floatCaption, keys = f.keys!
  const { text, star } = call, short = call.short ?? text
  let number = 0, sub: string | undefined
  if (star) {} // (\caption@star: no \caption@refstepcounter, \caption@prepareanchor or lof line)
  else if (isSub) {
    if (keys.list) throw new Unsupported("a subcaption in the list of figures") // (\caption@addsubcontentsline)
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
    // (\caption@addcontentsline: none for list=false, nor for an empty short caption)
    if (keys.list && short !== "") out.push(lofLine(cx, env, number, short))
  }
  // the label (\caption@labelformat{\figurename}{\thefigure}; for a subcaption, \subfigurename: empty)
  const name = isSub ? "" : keys.names[env] ?? (env === "figure" ? "Figure" : "Table"), the = sub ?? counters.the(number)
  // hyperref without hypcap: \caption@makeanchor, \hyper@@anchor's H.S H.R before the text
  captionMake(cx, keys, f, { name, the, isSub, star, text, anchor: hyper && !f.hypcap && !star, normalcolor: true }, hsize, out)
  if (star) return null
  return { number, label: counters.the(number) + (sub ?? ""), name: labelName(short), ...(sub ? { sub } : {}) }
}

/** what \caption@@make sets: the label's name and number (\caption@labelformat's arguments), \caption* and the
 *  text, whether the text starts with hyperref's anchor (at refs.href), whether \caption@normalsize's \normalcolor
 *  comes first, the skips when not the keys' (null: none, \caption@@make alone), and whether label format original
 *  (\fnum@<type>) has a space between name and number rather than \nobreakspace (float.sty's \fname@<type>{} \the<type>) */
export interface CaptionMake { name: string; the: string; isSub: boolean; star: boolean; text: string; anchor: boolean; normalcolor: boolean; skips?: { above: Node; below: Node } | null; fnumSpace?: boolean }

/** \caption@@make with `keys`: the skips around the caption (the position fixed in `f`), and the caption's paragraph */
export function captionMake(cx: Ctx, keys: CaptionKeys, f: { top: boolean | null; subAbove: boolean }, c: CaptionMake, hsize: number, out: CaptionOut) {
  const { refs, run } = cx
  const { isSub, star, text } = c
  const color = xcolor.on && c.normalcolor
  if (color) out.push(colorPush()) // (\caption@normalsize's \normalcolor, popped where its group ends)
  // \caption@normalsize (\normalfont\normalsize), then \captionfont; \captionlabelfont and \captiontextfont after it
  const cf = captionFont(cx, { size: "normalsize", attrs: cx.normalAttrs }, keys.font)
  const lf = captionFont(cx, cf, keys.labelfont), tf = captionFont(cx, cf, keys.textfont)
  const lfont = selectFont(run.k, lf.size, lf.attrs), cfont = selectFont(run.k, cf.size, cf.attrs), sz = run.k.sizes[tf.size]
  const above = c.skips?.above ?? glue(keys.above ?? run.k.dimens.abovecaptionskip), below = c.skips?.below ?? glue(keys.below ?? run.k.dimens.belowcaptionskip)
  // (\caption@fixposition: the first caption in a group, or in the float around it, fixes the position)
  const skips = c.skips !== null
  const top = skips && (f.top ??= keys.position === "auto" ? !f.subAbove && out.prevDepth() === IGNORE_DEPTH : keys.position === "top")
  if (skips && top) out.push(below)
  else if (skips) { out.rule(); out.push(above) }
  // the label (label format original is \fnum@figure, and for a subcaption, with no \fnum@subfigure, simple),
  // empty for \caption*
  const { name, the } = c
  const fmt = keys.labelformat === "original" && isSub ? "simple" : keys.labelformat
  const label = star || fmt === "empty" ? null : { nbsp: fmt === "original" ? !c.fnumSpace : name !== "", space: fmt === "original" && !!c.fnumSpace, name, the: fmt === "parens" ? `(${the})` : fmt === "brace" ? `${the})` : the }
  // (the separator is none after an empty label, \caption@tempa, or before empty text)
  const sep = !label || text === "" ? "none" : keys.labelsep
  const state = { spaceFactor: 1000 }
  const labelNodes = (): Node[] => {
    const l: Node[] = []
    if (!label) return l
    if (label.name) appendText(l, label.name, lfont, state, false)
    if (label.nbsp) l.push(penalty(10000), glue(lfont.params[SPACE], lfont.params[SPACE_STRETCH], 0, lfont.params[SPACE_SHRINK], 0)) // \nobreakspace
    else if (label.space) appendText(l, " ", lfont, state, false)
    appendText(l, label.the, lfont, state, false)
    return l
  }
  // the separator: colon, period and space in the label font, quad and endash in the caption font
  const sepNodes = (centercr: boolean): Node[] => {
    const l: Node[] = []
    if (sep === "colon" || sep === "period" || sep === "space") appendText(l, sep === "colon" ? ": " : sep === "period" ? ". " : " ", lfont, state, false)
    else if (sep === "quad") l.push(glue(cfont.params[QUAD]))
    else if (sep === "endash") appendText(l, ` ${cf.attrs.enc === "T1" ? "\x15" : "{"} `, cfont, state, false) // \space\textendash\space (OT1's \char123, T1's 21)
    else if (sep === "newline" && !centercr) l.push(penalty(10000), filGlue(), penalty(-10000)) // \\ as \@normalcr: \nobreak\hfil\break
    return l
  }
  const strut = (): Node[] => [...(keys.strut ? [{ kind: "rule", width: 0, height: sz.strut.height, depth: null } as const] : []), penalty(10000), glue(0)]
  const end: Node[] = keys.strut ? [penalty(10000), { kind: "rule", width: 0, height: 0, depth: sz.strut.depth }] : []
  // the width (\caption@calcmargin): \hsize less the margins, or the margins half of what the width leaves
  if (keys.left !== keys.right && keys.twoside) throw new Unsupported("unequal caption margins in a twoside document") // (\caption@ifoddpage)
  const width = keys.width ? keys.width : hsize - keys.left - keys.right
  const left = keys.width ? Math.trunc((hsize - keys.width) / 2) : keys.left
  // \caption@slc: \sbox\@tempboxa{label separator text} with the single-line format
  let single = false
  if (keys.slc) {
    const words: Node[] = []
    appendText(words, text, selectFont(run.k, tf.size, tf.attrs), { spaceFactor: 1000 }, false)
    single = hpack([...labelNodes(), ...sepNodes(false), ...strut(), ...words, ...end]).width <= width
  }
  // (a single-line caption has format=hang's single-line format, plain's; with more lines, newline is an error there)
  const hang = keys.format === "hang" && !single
  if (sep === "newline" && hang) throw new Unsupported("labelsep=newline with format=hang")
  // (the single-line style's options: the default style's indent=0pt,justification=centering)
  const slsty = single && keys.style === "default"
  const indent = slsty ? 0 : keys.indent
  const justification = slsty ? "centering" : keys.justification
  const shape: ParagraphOptions = justification === "centering" ? centeringShape() : justification === "raggedright" ? raggedright() : justification === "raggedleft" ? raggedleft()
    : justification === "centerlast" ? { leftSkip: paramGlue("leftskip", glue(0, 65536, FIL)), rightSkip: paramGlue("rightskip", glue(0, -65536, FIL)), parFillSkip: paramGlue("parfillskip", glue(0, 2 * 65536, FIL)) } : {}
  const centercr = justification !== "justified" // (\\ is \@centercr after \centering, \raggedright … and \centerlast)
  state.spaceFactor = 1000
  const start: Node[] = [hpack([]), ...(indent ? [glue(-indent)] : [])] // \leavevmode, or \hskip-\caption@indent
  const lines: Node[] = []
  const opts: ParagraphOptions = { hsize: width - indent, end, ...shape, attrs: tf.attrs }
  if (hang) {
    const box = hpack([...labelNodes(), ...sepNodes(false)]) // \@hangfrom{label separator}
    start.push(box)
    if (box.width) opts.hangIndent = box.width
  } else {
    start.push(...labelNodes())
    if (sep === "newline" && centercr) { // \\ as \@centercr: \par, \addvspace{-\parskip}, and the text a new paragraph
      if (tf.size !== cf.size) throw new Unsupported("labelsep=newline with a text font size") // (the label's lines' \baselineskip)
      // (new_graf's \parskip and LaTeX's restart of the paragraph's: two)
      lines.push(...out.lines(start, "", { hsize: width - indent, ...shape }, lf.size), glue(0), paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
      start.splice(0, start.length, hpack([]))
    } else start.push(...sepNodes(false))
  }
  start.push(...strut())
  if (c.anchor) start.push(...spotAnchor(refs.href, "h", start.at(-1), run.k.sizes.normalsize.baselineskip.width))
  lines.push(...out.lines(start, text, opts, tf.size))
  const inner: Node[] = []
  let pd: number | null = IGNORE_DEPTH
  for (const n of lines) {
    if (n.kind === "hlist") pd = appendToVlist(inner, n, pd, sz.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit)
    else inner.push(n)
  }
  out.paragraph([hpack([]), glue(left + indent), vpack(inner)], "") // (the \hspace after the \parbox goes at the paragraph's end)
  if (skips && top) { out.push(above); out.rule() }
  else if (skips) out.push(below)
  if (color) out.push(colorPop())
}

/** a font and size and the caption font keys after it, as \captionfont and the others select them */
function captionFont(cx: Ctx, from: { size: SizeCommand; attrs: FontAttrs }, fonts: CaptionFont[]): { size: SizeCommand; attrs: FontAttrs } {
  let { size, attrs } = from
  for (const key of fonts) {
    const i = SIZE_COMMANDS.indexOf(size)
    if (key === "smaller") size = SIZE_COMMANDS[Math.max(i - 1, 0)] // (\caption@smaller: \tiny stays)
    else if (key === "larger") size = SIZE_COMMANDS[Math.min(i + 1, SIZE_COMMANDS.length - 1)]
    else if ((SIZE_COMMANDS as readonly string[]).includes(key)) size = key as SizeCommand
    else attrs = fontDeclaration(FONT_COMMANDS[key as keyof typeof FONT_COMMANDS], attrs, cx.run.k, size, cx.doc)!
    if (!cx.run.k.sizes[size]) throw new Unsupported(`caption font \\${size}`)
  }
  const r = cx.run.k.sizes[size].fonts[`${attrs.enc}/${attrs.fam}/${attrs.ser}/${attrs.shape}`]
  if (!r?.declared) throw new Unsupported(`caption font ${attrs.fam}/${attrs.ser}/${attrs.shape}`) // (NFSS would substitute)
  return { size, attrs }
}
const FONT_COMMANDS = { bf: "bfseries", md: "mdseries", it: "itshape", sl: "slshape", sc: "scshape", up: "upshape", rm: "rmfamily", sf: "sffamily", tt: "ttfamily" }

/**
 * caption.sty's \caption@startanchor in vertical mode, at the float's start: \nointerlineskip,
 * \vspace*{-\caption@hypcapspace} (.5\baselineskip), \hyper@anchorstart{name}\hyper@anchorend,
 * \vspace*{\caption@hypcapspace}, then \prevdepth restored (-1000pt: the float's list was empty)
 */
export function hypcapAnchor(name: string, baselineskip: number): Node[] {
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
  // (right after a heading, \@setnobreak clears \if@nobreak in the box and \@endfloatbox's \outer@nobreak sets it again)
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
  const tokens = [...fbody.matchAll(/\\centering\b|\\caption(?:\*)?\s*(?:\[[^\]]*\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\captionsetup\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\(?:label|vspace)\s*\{[^}]*\}|\\LXtabular\{\d+\}|\\LX(?:minipage|graphic)\{\d+\}|\S+/g)]
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
  // caption.sty's \caption@settype: the float's option list (\caption@setoptions{figure}), its lengths as there
  const dim = (v: string) => parseDimen(v, { em: romanFont.params[QUAD], ex: romanFont.params[X_HEIGHT], internal: widthRegisters(cx, hsize) })
  if (cx.pre.caption) { run.floatCaption.keys = copyKeys(cx.pre.caption.keys); runList(cx.pre.caption, b.env, run.floatCaption.keys, "list", dim, b.env) }
  // setspace's \@xfloat: \def\baselinestretch{\setspace@singlespace}\normalsize in the float
  const spaced = run.k
  run.k = singleSpaced(spaced)
  try {
  if (cx.pre.usesCaption && hyper && run.floatCaption.keys!.hypcap) { // caption.sty's \caption@xfloat: \caption@start, hypcap's anchor (\Hy@linkcounter)
    run.floatCaption.hypcap = refs.href = `${b.env}.caption.${++run.linkcounter}` // (\hyper@makecurrent's \xdef: a \label after a \caption* or none points here)
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
    // \captionsetup{keys} in the float (caption.sty), for the rest of it; a position resets the one fixed
    m = it.match(/^\\captionsetup\s*\{([^]*)\}$/)
    if (m) {
      if (!cx.pre.caption) throw new Unsupported("\\captionsetup without caption.sty")
      if (setCaptionKeys(run.floatCaption.keys!, m[1], "float", dim, b.env).position) run.floatCaption.top = null
      continue
    }
    const call = captionCall(it)
    if (call) {
      cap = caption(cx, b.env, call, hsize, {
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
      content.push(...captionXref(cx), labelWrite(refs, m[1], cap.label, refs.href, cx.pre.nameref ? cap.name : refs.name), ...crefWrites(refs, m[1], false, { type: b.env, arabic: cap.number, prefix: counters.crefPrefix(b.env), label: cap.label }))
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
