// Paragraphs with displayed math: the text around \[ \], $$ $$, equation, displaymath and align (the
// display's line, \abovedisplayskip and \belowdisplayskip, \predisplaypenalty, equation numbers), and a
// paragraph broken from a prepared list.

import { QUAD, type Font } from "../layout/font"
import { appendText } from "./encodings"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, FIL, glue, kern, NORMAL, paramGlue, penalty, type BoxNode, type CharNode, type Node, filGlue, fillGlue, ssGlue } from "../layout/nodes"
import { displayLine, finishDisplay, preDisplaySize } from "../layout/display"
import { CLOSE as CLOSE_NOAD, DISPLAY as DISPLAY_STYLE, groupField, mlistToHlist, OPEN as OPEN_NOAD, ORD as ORD_NOAD, TEXT as TEXT_STYLE, type MItem } from "../mathlayout/mlist"
import { hpack, vpack } from "../layout/pack"
import { halign } from "../layout/align"
import { xnOverD } from "../layout/arith"
import { displaySegments, type Display } from "./blocks"
import type { Ctx } from "./context"
import { depthOf } from "./source"
import { Unsupported } from "./unsupported"
import { addGlue, dimen, IGNORE_DEPTH } from "./vlist"
import { anchor, dest, HA, HS, hyperDriver, pdfdest } from "./hyperref"
import { setgroup } from "./xcolor"
import { qedSymbol } from "./lists"
import { squeeze, appendToVlist, closingBrace, crefWrites, fontAt, hlistInput, hsizeOf, labelWrite, framed, mathEnv, mathFonts, mathText, paragraphInput, selectFont, spec, parseFormula, siContext, type FontAttrs, type ParagraphOptions } from "./paragraph"
import type { CrefLabel } from "./cleveref"
import type { ParagraphTrace } from "../trace/decisions"
import type { MathText } from "../mathlayout/parse"
import type { GlueSpec } from "../layout/dimen"
import type { SizeCommand } from "../layout/classdata"

/**
 * A paragraph that may hold displays (§§ 1145–1206). The text before each display is broken
 * with \displaywidowpenalty; the display goes on the vertical list; the paragraph resumes after
 * it with prev_graf+3, no indentation and no \parskip. `club` is \clubpenalty while the
 * paragraph is read and `parClub` the one its final \par sees.
 */
export function paragraphWithDisplays(cx: Ctx, text: string, noindent: boolean, club: number, parClub: number, start?: Node[], unskip = 0, firstClub = club, leadNoteClub?: number, leadLanguageGroups = 0) {
  const { amsmath, hyper } = cx.pre
  const { counters, decisions, doc, outerParskip, refs, romanFont, run, v } = cx
  const segs = displaySegments(text)
  const font = romanFont
  let prevGraf = 0
  segs.forEach((seg, i) => {
    if (typeof seg !== "string") return
    const first = i === 0, last = i === segs.length - 1
    const t = squeeze(seg) // a display ends with \ignorespaces
    const next = segs[i + 1] as Display | undefined
    let justBox: BoxNode | null = null, nlines = 0
    let params: ReturnType<typeof paragraphInput>["params"] | null = null
    const opts = {
      clubPenalty: last ? parClub : first ? firstClub : club, noteClubPenalty: first ? firstClub : club, prevGraf,
      ...(first && leadNoteClub !== undefined ? { leadGroupNoteClubPenalty: leadNoteClub, ...(leadLanguageGroups ? { leadLanguageGroups } : {}) } : {}),
      ...(last ? (unskip ? { unskip } : {}) : { widowPenalty: run.k.ints.displaywidowpenalty }),
      ...(first ? (start ? { start } : {}) : { start: [] as Node[] }),
    }
    if (first && !t) {
      // the display starts the paragraph: $$ (and amsmath's \[) from vertical mode starts it with the
      // indent box; LaTeX's own \[ first sets \nointerlineskip\makebox[.6\linewidth]{}
      if (next!.kind === "bracket" && !amsmath || next!.kind === "displaymath" && !amsmath) {
        v.prevDepth = IGNORE_DEPTH
        const lw = hsizeOf(run.k)
        const mb = hpack([ssGlue(), ssGlue()], { exactly: xnOverD(lw, 39322, 65536) })
        const r = typesetList(cx, [...(start ?? (noindent ? [] : [emptyBox("hlist", run.k.dimens.parindent)])), mb], opts, true)
        justBox = r.just; params = r.params; nlines = r.lines
      } else if (!noindent || start) { // a run-in heading takes the indent box's place
        const r = typesetList(cx, start ?? [emptyBox("hlist", run.k.dimens.parindent)], opts, true)
        justBox = r.just; params = r.params; nlines = r.lines
      } else v.nodes.push(spec("parskip", outerParskip), paramGlue("parskip", glue(0))) // \noindent$$: an empty paragraph
    } else if (t || !last) {
      const { list, params: ps, notes } = paragraphInput(t, run.k, "normalsize", doc, { ...opts, amsmath, groups: true, ...(first && noindent ? { everyparNoindent: true } : {}) })
      if (list.length || first) {
        const lb = lineBreak(list, ps)
        decisions.push(...notes, lb.trace)
        if (first) v.paragraph(lb.vlist, outerParskip); else v.lines(lb.vlist)
        justBox = lb.lines[lb.lines.length - 1] ?? null
        params = ps; nlines = lb.lines.length
      }
    }
    prevGraf += nlines
    if (!next) return
    // the display
    const ps = params ?? paragraphInput("", run.k, "normalsize", doc, { amsmath }).params
    displayMath(cx, next, displayLine(prevGraf, ps.hsize, ps.hangIndent, ps.hangAfter, ps.parShape), justBox, font, {}, ps.hangIndent === 0 && !ps.parShape.length ? { clubPenalty: club } : null)
    prevGraf += 3
  })
}

/** the \leftskip and \rightskip in force (\raggedright and friends), which a paragraph in the display keeps (\black@'s) */
type Skips = Pick<ParagraphOptions, "leftSkip" | "rightSkip">
const skipsOf = (o: ParagraphOptions): Skips => ({ ...(o.leftSkip ? { leftSkip: o.leftSkip } : {}), ...(o.rightSkip ? { rightSkip: o.rightSkip } : {}) })

/** \@currentHref after a display's \refstepcounter: \theH<counter>, or under hyperref in an \item of a numbered list that
 *  stepped none (\if@hyper@item), Item.n; the \@hyper@itemfalse that goes with it is local to the display's group
 *  (to an alignment's cell), so the next one is an Item.n again. Only amsmath's \incr@eqnum goes through hyperref's
 *  \refstepcounter: without it, hyperref's equation steps the counter with the kernel's */
/** siunitx's view of a display's text (displays are at \\normalsize) */
/** \text and \mbox in a display: the text font then (the roman of the document's encoding; others are not modeled here) */
const text = (cx: Ctx, font: Font): MathText => {
  const a: FontAttrs = { enc: cx.pre.t1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" }
  if (selectFont(cx.run.k, "normalsize", a).name !== font.name) return () => { throw new Unsupported("\\text in a display in a font not roman") }
  return mathText(cx.run.k, "normalsize", cx.doc, a, cx.pre.amsmath)
}
/** a display's source split at \\\\ or & outside braces and inner environments (an array, a matrix) */
function splitTop(src: string, sep: "\\\\" | "&"): string[] {
  const out: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === "\\") {
      const env = src.slice(i).match(/^\\(begin|end)\s*\{/)
      if (env) depth += env[1] === "begin" ? 1 : -1
      else if (depth === 0 && sep === "\\\\" && src[i + 1] === "\\") { out.push(src.slice(start, i)); start = i + 2; i++; continue }
      i++ // (a control symbol: \{, \&, \\)
      continue
    }
    if (c === "{") depth++
    else if (c === "}") depth--
    else if (c === "&" && sep === "&" && depth === 0) { out.push(src.slice(start, i)); start = i + 1 }
  }
  out.push(src.slice(start))
  return out
}
const si = (cx: Ctx, font: Font) => (cx.doc.siunitx ? siContext(cx.run.k, "normalsize", font, cx.doc.siunitx) : undefined)

/** What a row of an alignment says about its tag, taken out of its source: \label{key} (\label@in@display: \gdef\df@label),
 *  \tag{…} and \tag*{…} (\tag@in@align: \global\tag@true, \nonumber, \gdef\df@tag) and \nonumber or \notag
 *  (\global\@eqnswfalse). They act globally from wherever they stand in the row and make no node. */
interface RowMarks { src: string; label: string | null; tag: { star: boolean; src: string } | null; nonumber: boolean }
function rowMarks(row: string, where: string): RowMarks {
  const m: RowMarks = { src: "", label: null, tag: null, nonumber: false }
  const re = /\\(label|tag|nonumber|notag)(?![A-Za-z@])/g
  let at = 0
  for (let x: RegExpExecArray | null; (x = re.exec(row)); ) {
    if (row[x.index - 1] === "\\") continue // (\\ before it: rows are split there, so this is not reached)
    m.src += row.slice(at, x.index)
    at = x.index + x[0].length
    if (x[1] === "nonumber" || x[1] === "notag") { m.nonumber = true; re.lastIndex = at; continue }
    let j = at
    const star = x[1] === "tag" && row[j] === "*"
    if (star) j++
    while (row[j] === " " || row[j] === "\n") j++
    if (row[j] !== "{") throw new Unsupported(`\\${x[1]} without a braced argument in ${where}`)
    const end = closingBrace(row, j), arg = row.slice(j + 1, end)
    if (x[1] === "label") {
      if (m.label !== null) throw new Unsupported(`several \\label in a row of ${where}`) // (amsmath's error: the first is lost)
      if (!/^[A-Za-z0-9:._-]+$/.test(arg)) throw new Unsupported(`\\label{${arg}}`)
      m.label = arg
    } else {
      if (m.tag) throw new Unsupported(`several \\tag in a row of ${where}`)
      m.tag = { star, src: arg }
    }
    at = end + 1; re.lastIndex = at
  }
  m.src += row.slice(at)
  return m
}

/**
 * \make@display@tag, the tag of a row of an align or gather, or of a multline. A numbered one steps the counter
 * (\incr@eqnum) and prints \tagform@\theequation; a \tag prints \df@tag: \tagform@{…}, or for \tag* \maketag@@@{…},
 * an \hbox{\m@th\normalfont …}, with \@currentlabel what it reads; then the \label (\ltx@label\df@label), after the
 * tag's box. hyperref puts the counter's anchor before the number (after `last`, raised by `raise`, the \baselineskip
 * there), and \Hy@make@anchor, an anchor AMS.<\Hy@linkcounter> after the parenthesis, in a \tag (the measuring pass
 * set every \tag of the display once already, stepping the counter: `measuredTags`).
 */
const measuredTags = (cx: Ctx, rows: { marks: RowMarks }[]) => { if (cx.pre.hyper) cx.run.linkcounter += rows.filter((r) => r.marks.tag).length }
/** the tag column's cell of an align or gather row: \setboxz@h{\strut@{\make@display@tag}} */
function rowTag(cx: Ctx, m: RowMarks, numbered: boolean, strutBox: () => BoxNode, noTags = false): BoxNode {
  const s = strutBox()
  return hpack([s, ...displayTag(cx, m, numbered, () => ({ raise: cx.run.k.sizes.normalsize.baselineskip.width + cx.run.k.dimens.jot, last: s }), noTags)]) // (\baselineskip after \openup\jot)
}
/** `place`, given the tag's width, says where it goes: the \baselineskip there and the node before it */
function displayTag(cx: Ctx, m: RowMarks, numbered: boolean, place: (width: number) => { raise: number; last: Node }, noTags = false): Node[] {
  const { hyper } = cx.pre
  const { counters, refs, romanFont, run } = cx
  const out: Node[] = []
  let label = refs.label, cref: CrefLabel | null | undefined = undefined
  if (numbered) {
    counters.equation++
    refs.href = stepHref(cx, "equation", counters.equation)
    const l: Node[] = []
    appendText(l, `(${counters.the("equation", counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
    l.push(kern(romanFont.chars.get((l[l.length - 1] as CharNode).char)!.italic, true)) // \@@italiccorr
    appendText(l, ")", romanFont, { spaceFactor: 1000 }, false)
    // hyperref: the anchor between the strut and the number
    const box = hpack(l), at = place(box.width)
    if (hyper) out.push(...anchor(refs.href, at.raise, "h", at.last))
    out.push(box)
    label = counters.the("equation", counters.equation)
    cref = { type: "equation", arabic: counters.equation, prefix: counters.crefPrefix("equation"), label }
  } else if (m.tag) {
    const a: FontAttrs = { enc: cx.pre.t1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" }
    if (selectFont(run.k, "normalsize", a).name !== romanFont.name) throw new Unsupported("\\tag in a document whose \\normalfont is not roman")
    const body = m.tag.src.replace(/\s+/g, " ").trim() // \ignorespaces … \unskip
    if (/\\(label|footnote|tag)(?![A-Za-z])/.test(body)) throw new Unsupported("\\label, \\footnote or \\tag in a \\tag")
    const st = { spaceFactor: 1000 }
    const open: Node[] = []
    let l: Node[]
    if (hyper) {
      refs.href = `AMS.${++run.linkcounter}`
      if (!m.tag.star) appendText(open, "(", romanFont, st, false)
      l = hlistInput(body, run.k, "normalsize", cx.doc, a, st, true)
    } else l = hlistInput((m.tag.star ? "" : "(") + body, run.k, "normalsize", cx.doc, a, st, true)
    if (!m.tag.star) {
      const tail = l[l.length - 1] ?? open[open.length - 1]
      if (tail?.kind === "char") l.push(kern(fontAt(tail.font, tail.size).chars.get(tail.char)!.italic, true)) // \@@italiccorr
      appendText(l, ")", romanFont, st, false)
    }
    // (the anchor has no width: where the tag goes, which sets how far the anchor is raised, depends on the width only)
    const at = place(hpack([...open, ...l]).width)
    out.push(hpack(hyper ? [...open, ...anchor(refs.href, at.raise, "h", open[open.length - 1]), ...l] : l))
    if (m.label !== null && !/^[^\\{}$#%&~^_]*$/.test(body)) throw new Unsupported(`\\label of a row with \\tag{${body}}`)
    // \make@df@tag@@@: \toks@\@xp{\p@equation{#1}}\edef\@currentlabel{\the\toks@}, the braces kept; \tag*: \def\@currentlabel{#1}
    label = m.tag.star ? body : `{${body}}`
    cref = { type: "equation", arabic: 2147483647, prefix: "", label } // cleveref's \make@df@tag@@@
  }
  if (m.label !== null) {
    // a row with no tag (gather's): \@currentlabel is the one outside the display, \@currentHref (global) the last one
    // set, by a tag of the display in the measuring pass or in a row before; only a display with no tag at all is modelled
    if (cref === undefined && (refs.cleveref || !noTags)) throw new Unsupported("\\label in a row with no tag")
    out.push(labelWrite(refs, m.label, label), ...(cref ? crefWrites(refs, m.label, true, cref) : []))
  }
  return out
}

/** \intertext{…} or mathtools' \shortintertext{…} between the rows of an alignment */
interface Intertext { text: string; short: boolean }
type RowOrText = { row: string } | Intertext
/** An alignment's source as its rows (split at \\) and the \intertext between them; an \intertext ends the row it
 *  stands in (\ifvmode\else\\\@empty\fi) */
function rowsAndTexts(src: string, where: string): RowOrText[] {
  const out: RowOrText[] = []
  const chunks: (string | Intertext)[] = []
  let depth = 0, start = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === "{") depth++
    else if (c === "}") depth--
    else if (c === "\\") {
      const x = src.slice(i).match(/^\\(short)?intertext(?![A-Za-z@])\s*(?=\{)/)
      if (!x) { const env = src.slice(i).match(/^\\(begin|end)\s*\{/); if (env) depth += env[1] === "begin" ? 1 : -1; i++; continue }
      if (depth !== 0) throw new Unsupported(`\\intertext inside a group or an environment in ${where}`)
      const open = i + x[0].length, end = closingBrace(src, open)
      chunks.push(src.slice(start, i), { text: src.slice(open + 1, end), short: !!x[1] })
      start = end + 1; i = end
    }
  }
  chunks.push(src.slice(start))
  chunks.forEach((ch, i) => {
    if (typeof ch !== "string") { out.push(ch); return }
    const rows = splitTop(ch, "\\\\")
    const last = i === chunks.length - 1
    if (!last && !rows[rows.length - 1].trim()) rows.pop() // the \\ before an \intertext (in vertical mode it adds none)
    else if (last && chunks.length > 1 && !rows[rows.length - 1].trim()) throw new Unsupported(`${where} ending with \\intertext`)
    for (const row of rows) out.push({ row })
  })
  return out
}

/**
 * An \intertext's \vbox{\normalbaselines \noindent\ignorespaces text\par}: a paragraph of the text around the display.
 * `par` is what that paragraph's surroundings set, null where they are not modelled (a \parshape or a hanging
 * indentation in force, a text font not the roman one). amsmath's \measure@ and \gmeasure@ set the rows once before
 * the alignment itself, the \intertext with them, so each is broken twice: its trace is noted here and again where it
 * is put (`rowsToVlist`). In the measuring pass \label is \@gobble, in the alignment \label@in@display.
 */
function intertextBox(cx: Ctx, it: Intertext, par: ParagraphOptions | null, skips: Skips, where: string): { box: BoxNode; trace: ParagraphTrace } {
  const { run, doc, decisions } = cx
  const name = it.short ? "\\shortintertext" : "\\intertext"
  if (it.short && !mathFonts.packages.mathtools) throw new Unsupported("\\shortintertext without mathtools")
  if (!par) throw new Unsupported(`${name} in ${where} in a shaped paragraph or in a font not roman`)
  if (skips.leftSkip || skips.rightSkip) throw new Unsupported(`${name} in ${where} in \\centering or a ragged paragraph`)
  if (/\\(label|footnote|footnotetext|footnotemark|begin|par|\\|\[)(?![A-Za-z])|\$\$|\n[ \t]*\n/.test(it.text)) throw new Unsupported(`\\label, a footnote, an environment or a second paragraph in ${name}`)
  const p = paragraphInput(squeeze(it.text), run.k, "normalsize", doc, { ...par, start: [], amsmath: true })
  if (p.notes.length) throw new Unsupported(`a footnote in ${name}`)
  const lb = lineBreak(p.list, p.params)
  decisions.push(lb.trace)
  const list: Node[] = [], sz = run.k.sizes.normalsize
  let depth: number | null = IGNORE_DEPTH
  for (const n of lb.vlist) { // (\normalbaselines)
    if (n.kind === "hlist") depth = appendToVlist(list, n, depth, sz.baselineskip, run.k.glue.normallineskip, run.k.dimens.normallineskiplimit)
    else list.push(n)
  }
  return { box: vpack(list), trace: lb.trace }
}

/**
 * The rows of an align or gather on the vertical list (§ 1206: an alignment in a display), with \openup\jot and amsmath's
 * \everycr: \predisplaypenalty and \abovedisplayskip; after the preamble's \cr \vskip-\lineskiplimit
 * \vskip\normallineskiplimit; each row, then \penalty\@eqpen (\interdisplaylinepenalty, \@M) and \\'s \vskip\z@.
 * An \intertext is \noalign material: \penalty\postdisplaypenalty \vskip\belowdisplayskip, the text's \vbox,
 * \penalty\predisplaypenalty \vskip\abovedisplayskip. mathtools' own (\MT_intertext:) has after each of the two
 * skips \vskip-\lineskiplimit \vskip\normallineskiplimit and \vskip of its above- and below-intertext-sep (0pt);
 * its \shortintertext is the same with \abovedisplayshortskip for both skips and 3pt for both seps.
 * `after` is what follows the last row (\black@), before \postdisplaypenalty and \belowdisplayskip.
 */
function rowsToVlist(cx: Ctx, seq: (BoxNode | { box: BoxNode; trace: ParagraphTrace; short: boolean })[], indent: number, after: () => void) {
  const { run, v, decisions } = cx
  const sz = run.k.sizes.normalsize
  const jot = run.k.dimens.jot
  const skip = (g: GlueSpec) => glue(g.width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder)
  const limits = () => [glue(-(run.k.dimens.lineskiplimit + jot)), glue(run.k.dimens.normallineskiplimit)]
  const mt = !!mathFonts.packages.mathtools
  v.nodes.push(penalty(run.k.ints.predisplaypenalty), spec("abovedisplayskip", sz.abovedisplayskip))
  v.nodes.push(...limits())
  const bs = addGlue(sz.baselineskip, dimen(jot)), ls = addGlue(run.k.glue.lineskip, dimen(jot))
  for (const rb of seq) {
    if ("kind" in rb) {
      rb.display = true; rb.shift = indent
      v.prevDepth = appendToVlist(v.nodes, rb, v.prevDepth, bs, ls, run.k.dimens.lineskiplimit + jot)
      v.nodes.push(penalty(10000), glue(0)) // \interdisplaylinepenalty is \@M in amsmath; \\ adds \vskip\z@
      continue
    }
    const sep = rb.short ? [glue(196608)] : [glue(0)]
    v.nodes.push(penalty(run.k.ints.postdisplaypenalty), skip(rb.short ? sz.abovedisplayshortskip : sz.belowdisplayskip), ...(mt ? [...limits(), ...sep] : []))
    decisions.push(rb.trace)
    v.prevDepth = appendToVlist(v.nodes, rb.box, v.prevDepth, bs, ls, run.k.dimens.lineskiplimit + jot)
    v.nodes.push(penalty(run.k.ints.predisplaypenalty), skip(rb.short ? sz.abovedisplayshortskip : sz.abovedisplayskip), ...(mt ? [...limits(), ...sep.map((g) => ({ ...g }))] : []))
  }
  after()
  v.nodes.push(penalty(run.k.ints.postdisplaypenalty), spec("belowdisplayskip", sz.belowdisplayskip))
}

function stepHref(cx: Ctx, counter: string, n: number): string {
  return cx.run.hyperItem && cx.pre.amsmath ? `Item.${++cx.run.items}` : cx.counters.href(counter, n)
}

/**
 * A paragraph with displays in a list (an item, a theorem, a proof): broken as `typeset` breaks one, with the list's
 * \parshape, font and penalties, before each display with \displaywidowpenalty; the display takes line prev_graf+2
 * of the \parshape (§ 1149), and the paragraph resumes with prev_graf+3, no indentation, the same \parshape (only
 * \par resets it). What starts the paragraph goes with its first part, what ends it (\@item's \unskip, a proof's
 * \qed) with its last, even when that is empty (TeX resumes in horizontal mode after the display).
 */
export function listParagraphWithDisplays(cx: Ctx, text: string, opts: ParagraphOptions, parskip: GlueSpec, size: SizeCommand) {
  const { amsmath } = cx.pre
  const { decisions, doc, run, v, counted } = cx
  if (size !== "normalsize" || opts.parSize) throw new Unsupported(`a display in a list in \\${opts.parSize ?? size}`)
  const segs = displaySegments(text)
  const font = selectFont(run.k, size, opts.attrs ?? cx.normalAttrs)
  let prevGraf = 0
  // what a paragraph inside a display (an \intertext) keeps of this one: its penalties; with a \parshape that is not
  // the whole width (a list's), a hanging indentation or another font, not modelled
  const whole = (opts.parShape ?? []).every(([indent, width]) => indent === 0 && width === hsizeOf(run.k))
  const inner: ParagraphOptions | null = whole && !opts.hangIndent && !opts.attrs && !opts.font
    ? { ...(opts.clubPenalty !== undefined ? { clubPenalty: opts.clubPenalty } : {}), ...(opts.interLinePenalty !== undefined ? { interLinePenalty: opts.interLinePenalty } : {}) } : null
  segs.forEach((seg, i) => {
    if (typeof seg !== "string") return
    const first = i === 0, last = i === segs.length - 1
    const t = squeeze(seg) // a display ends with \ignorespaces
    if (first && !t) throw new Unsupported("a display starting a paragraph in a list")
    const next = segs[i + 1] as Display | undefined
    const { start, end, unskip, noteClubPenalty, leadGroupNoteClubPenalty, ...rest } = opts
    // (the group that starts the paragraph, and what \everypar set in it, is in its first part)
    const o: ParagraphOptions = { ...rest, prevGraf,
      ...(first ? { start, ...(noteClubPenalty !== undefined ? { noteClubPenalty } : {}), ...(leadGroupNoteClubPenalty !== undefined ? { leadGroupNoteClubPenalty } : {}) } : { start: [] }),
      ...(last ? { ...(end ? { end } : {}), ...(unskip ? { unskip } : {}) } : { widowPenalty: run.k.ints.displaywidowpenalty }) }
    if (last && !t && !end) return // (an empty paragraph after the display makes no line)
    if (!first && !last && !t) { // two displays in a row: the second starts with an empty list (§ 1145: no line break)
      displayMath(cx, next!, displayLine(prevGraf, hsizeOf(run.k), 0, 1, opts.parShape ?? []), null, font, skipsOf(opts), inner)
      prevGraf += 3
      return
    }
    const { list, params, notes } = paragraphInput(counted(t, true), run.k, size, doc, { ...o, amsmath })
    const lb = lineBreak(list, params)
    decisions.push(...notes, lb.trace)
    if (first) v.paragraph(lb.vlist, parskip, run.k.sizes[size].baselineskip); else v.lines(lb.vlist)
    prevGraf += lb.lines.length
    if (next) {
      displayMath(cx, next, displayLine(prevGraf, params.hsize, params.hangIndent, params.hangAfter, params.parShape), lb.lines[lb.lines.length - 1] ?? null, font, skipsOf(opts), inner)
      prevGraf += 3
    }
  })
}

/** A display (§§ 1145–1206) on line prev_graf+2 of the paragraph (`line`), after `justBox`, its last line so far;
 *  `font`: the text font then, whose \fontdimen6 \predisplaysize allows for */
function displayMath(cx: Ctx, next: Display, line: { width: number; indent: number }, justBox: BoxNode | null, font: Font, skips: Skips = {}, par: ParagraphOptions | null = null) {
  const quad = font.params[QUAD]
  const { amsmath, hyper } = cx.pre
  // amsmath's \iftag@ after it: \mathdisplay (equation, \[ \]) and \displ@y@'s \everycr (align, gather) leave it false,
  // a numbered multline's \mmeasure@ true; $$ leaves it alone
  if (amsmath && next.kind !== "dollars") cx.run.tagFlag = next.kind === "multline" && !/\\(nonumber|notag)\b/.test(next.src) || next.kind.startsWith("multline") && /\\tag(?![A-Za-z@])/.test(next.src)
  const { counters, refs, romanFont, run, v } = cx
  // (amsart's tags are on the left: leqno)
  if (cx.pre.cls === "amsart" && (["align", "alignat", "gather", "multline"].includes(next.kind) || /\\tag\b/.test(next.src))) throw new Unsupported(`an equation number in amsart (leqno): ${next.kind}`)
  if (next.kind === "align" || next.kind === "align*" || next.kind === "alignat" || next.kind === "alignat*" || next.kind === "gather" || next.kind === "gather*" || next.kind === "multline" || next.kind === "multline*") {
    if (!amsmath) throw new Unsupported(`${next.kind} without amsmath`)
    if (next.kind.startsWith("gather")) gatherDisplay(cx, next, line, font, skips, par)
    else if (next.kind.startsWith("multline")) multlineDisplay(cx, next, line, font)
    else alignDisplay(cx, next, line, font, skips, par)
    return
  }
  // \label{key}: \protected@write\@auxout{}{\string\newlabel{key}{{\@currentlabel}{\thepage }{}{\@currentHref}{}}}.
  // amsmath keeps it for after the tag (\label@in@display); LaTeX writes it where it stands
  const labels = [...next.src.matchAll(/\\label\s*\{([^{}]*)\}/g)]
  if (labels.length && next.kind !== "equation") throw new Unsupported(`\\label in ${next.kind}`)
  if (labels.length > 1) throw new Unsupported("several \\label in an equation")
  const label = labels[0]
  if (label && !/^[A-Za-z0-9:._-]+$/.test(label[1])) throw new Unsupported(`\\label{${label[1]}}`)
  const parse = (f: string) => parseFormula(f.replace(/\s+/g, " "), amsmath, quad, si(cx, font), { display: true, dollarNext: next.kind === "dollars", font, text: text(cx, font), frame: (b) => framed(b, [], cx.doc.xcolorFbox), env: mathEnv(cx.run.k, "normalsize", amsmath) }) // (\quad: 1em of the text font then)
  if (next.kind === "equation") { counters.equation++; refs.href = stepHref(cx, "equation", counters.equation) } // \refstepcounter, or amsmath's \incr@eqnum
  const crefEq = { type: "equation", arabic: counters.equation, prefix: counters.crefPrefix("equation"), label: counters.the("equation", counters.equation) }
  const newlabel: Node[] | null = label ? [labelWrite(refs, label[1], counters.the("equation", counters.equation)), ...crefWrites(refs, label[1], true, crefEq)] : null
  let mlist: MItem[]
  const qedhere = /\\qedhere(?![A-Za-z])/.test(next.src)
  if (qedhere && (!cx.pre.usesAmsthm || label)) throw new Unsupported("\\qedhere here")
  if (qedhere) next = { ...next, src: next.src.replace(/\\qedhere(?![A-Za-z])\s*/, "") }
  if (/\\qedhere(?![A-Za-z])/.test(next.src)) throw new Unsupported("two \\qedhere")
  if (!label) mlist = parse(next.src)
  else {
    const before = next.src.slice(0, label.index), after = next.src.slice(label.index! + label[0].length)
    if (amsmath) mlist = parse(before + after)
    else if (depthOf(before) !== 0) throw new Unsupported("\\label inside a group in an equation")
    else mlist = [...parse(before), ...newlabel!, ...parse(after)]
  }
  const env = mathEnv(run.k, "normalsize", amsmath); cx.doc.mathSize = "normalsize"
  if (next.kind === "equation*" && !amsmath) throw new Unsupported("equation* without amsmath")
  // (amsart passes leqno to amsmath: \veqno is \leqno; \displaymath@qed's is \eqno still)
  const left = next.kind === "equation" && cx.pre.cls === "amsart"
  let eqno: BoxNode | null = null
  // amsthm's \qedhere in amsmath's equation* (\[ \]): \displaymath@qed's \eqno\hbox{\qedsymbol}
  if (qedhere) {
    if (!(amsmath && (next.kind === "equation*" || next.kind === "bracket"))) throw new Unsupported(`\\qedhere in ${next.kind}`)
    eqno = hpack([hpack([qedSymbol(cx, "normalsize")])]); eqno.display = true
  }
  if (next.kind === "equation" && amsmath) { // \mathopen{} after \incr@eqnum, and \veqno \tagform@\theequation: \hbox{\normalfont (1\/)}, then the \label
    mlist.unshift({ noad: OPEN_NOAD, nucleus: groupField([]), sup: null, sub: null })
    // (hyperref's \refstepcounter socket with cleveref, hyperref/fixcleveref: after the anchor, the first aid's
    // {\firstaid@cref@updatelabeldata{\@currentcounter}}, here an empty ord noad)
    if (hyper && cx.refs.cleveref) mlist.unshift({ noad: ORD_NOAD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null })
    // hyperref: \refstepcounter's anchor in a math group before it (an ord noad)
    if (hyper && hyperDriver.pdftex) mlist.unshift(...mathAnchor(refs.href, run.k.sizes.normalsize.baselineskip.width))
    else if (hyper) mlist.unshift({ noad: ORD_NOAD, nucleus: { kind: "mlist", list: [HS(), HA(run.k.sizes.normalsize.baselineskip.width), dest(refs.href)] }, sup: null, sub: null })
    const l: Node[] = []
    appendText(l, `(${counters.the("equation", counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
    l.push(kern(romanFont.chars.get((l[l.length - 1] as CharNode).char)!.italic, true)) // \@@italiccorr
    appendText(l, ")", romanFont, { spaceFactor: 1000 }, false)
    eqno = hpack(newlabel ? [hpack(l), ...newlabel] : [hpack(l)]); eqno.display = true
  } else if (next.kind === "equation") { // \eqno \hbox{\@eqnnum}: {\normalfont (\theequation)}
    // hyperref's \equation: \mathopen{\hyper@anchorstart} at the start, \hyper@anchorend (and \nobreak) at the end
    if (hyper && hyperDriver.pdftex) { // \endequation: \mathclose{\Hy@raisedlink{\hyper@anchorend}}, its box empty (\pdf@endanchor)
      mlist.unshift({ noad: OPEN_NOAD, nucleus: { kind: "mlist", list: mathAnchor(refs.href, run.k.sizes.normalsize.baselineskip.width) }, sup: null, sub: null })
      mlist.push({ noad: CLOSE_NOAD, nucleus: { kind: "mlist", list: mathAnchor(null, run.k.sizes.normalsize.baselineskip.width) }, sup: null, sub: null })
    }
    else if (hyper) {
      mlist.unshift({ noad: OPEN_NOAD, nucleus: { kind: "mlist", list: [HS()] }, sup: null, sub: null })
      mlist.push(HA(run.k.sizes.normalsize.baselineskip.width), dest(refs.href), penalty(10000))
    }
    // (with cleveref, the \refstepcounter's first aid group before it: an empty ord)
    if (hyper && cx.refs.cleveref) mlist.unshift({ noad: ORD_NOAD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null })
    const l: Node[] = []
    appendText(l, `(${counters.the("equation", counters.equation)})`, romanFont, { spaceFactor: 1000 }, false)
    eqno = hpack([hpack(setgroup(l))]); eqno.display = true // {\normalfont\normalcolor (n)}
  }
  const sz = run.k.sizes.normalsize
  const items = finishDisplay(mlistToHlist(mlist, env, DISPLAY_STYLE, false), eqno, {
    width: line.width, indent: line.indent, preSize: preDisplaySize(justBox, quad), mathQuad: env.fonts[0][2]!.params[QUAD],
    preDisplayPenalty: run.k.ints.predisplaypenalty, postDisplayPenalty: run.k.ints.postdisplaypenalty,
    aboveDisplaySkip: sz.abovedisplayskip, belowDisplaySkip: sz.belowdisplayskip, aboveDisplayShortSkip: sz.abovedisplayshortskip, belowDisplayShortSkip: sz.belowdisplayshortskip,
  }, left)
  for (const it of items) { if ("box" in it) v.box(it.box, sz.baselineskip); else v.nodes.push(it.node) }
}

/**
 * amsmath's align and align* (\start@align\@ne, \align@, \measure@, \calc@shift@align,
 * \math@cr@@@align, \place@tag): fields alternate right- and left-aligned, the whole is centred
 * by \eqnshift@ with \alignsep@ between column pairs, and each row's number is set off at the
 * right edge. TeX finishes it as an alignment in a display (§ 1206). alignat and alignat* (\start@align\z@) are the
 * same with no space between the column pairs, as many pairs as declared. A row's \tag, \label and \notag are in its
 * tag (`rowTag`); \intertext goes between the rows (`rowsToVlist`).
 */
export function alignDisplay(cx: Ctx, d: Display, line: { width: number; indent: number }, font: Font, skips: Skips = {}, par: ParagraphOptions | null = null) {
  const em = font.params[QUAD]
  const { amsmath } = cx.pre
  const { decisions, doc, run, v } = cx
  const starred = d.kind.endsWith("*")
  let src = d.src.trim()
  // alignat's argument, the number of column pairs (\start@align\z@: \maxfields@ twice it, \checkat@true)
  const at = d.kind.startsWith("alignat") ? src.match(/^\{\s*(\d+)\s*\}/) : null
  if (d.kind.startsWith("alignat")) {
    if (!at || +at[1] < 1) throw new Unsupported(`${d.kind} without its number of columns`)
    src = src.slice(at[0].length)
  }
  if (/\\\\\s*$/.test(src)) throw new Unsupported("align ending with \\\\")
  if (/\\raisetag\b/.test(src)) throw new Unsupported("\\raisetag in align")
  const env = mathEnv(run.k, "normalsize", true); cx.doc.mathSize = "normalsize"
  const mathBox = (items: MItem[]) => hpack([{ kind: "math", on: true, width: 0 }, ...mlistToHlist([{ kind: "style", style: DISPLAY_STYLE }, ...items], env, TEXT_STYLE, false), { kind: "math", on: false, width: 0 }])
  const parse = (f: string) => parseFormula(f.replace(/\s+/g, " "), amsmath, em, si(cx, font), { display: true, font, text: text(cx, font), frame: (b) => framed(b, [], cx.doc.xcolorFbox), env: mathEnv(cx.run.k, "normalsize", amsmath) })
  const field = (f: string, j: number) => {
    const items = parse(f)
    // \setboxz@h{\@lign$\m@th\displaystyle{##}$} and {{}##} for the left-aligned fields
    return mathBox([{ noad: ORD_NOAD, nucleus: groupField(j % 2 ? [{ noad: ORD_NOAD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null }, ...items] : items), sup: null, sub: null }])
  }
  const seq = rowsAndTexts(src, d.kind)
  const texts = seq.map((x) => ("row" in x ? null : { ...intertextBox(cx, x, par, skips, d.kind), short: x.short })) // (\measure@ sets them first)
  const rows = seq.flatMap((x) => ("row" in x ? [x.row] : [])).map((row) => {
    const marks = rowMarks(row, d.kind)
    // \math@cr@@@align: a row has a tag when it is numbered (\if@eqnsw) or has a \tag (\iftag@)
    const numbered = !starred && !marks.nonumber && !marks.tag
    // (a row with neither never runs \make@display@tag: its \label stays in \df@label for the next row that does)
    if (marks.label !== null && !numbered && !marks.tag) throw new Unsupported(`\\label in a row of ${d.kind} with no tag`)
    const fields = splitTop(marks.src, "&").map(field)
    return { fields, numbered, marks, tagged: numbered || !!marks.tag }
  })
  const z = line.width
  const sz = run.k.sizes.normalsize, strut = sz.strut
  const strutBox = () => hpack([{ ...vpack([kern(-run.k.dimens.normallineskiplimit, true), hpack([{ kind: "rule", width: 0, height: strut.height, depth: strut.depth }])]), shift: xnOverD(run.k.dimens.normallineskiplimit, 32768, 65536) }]) // \strut@: \lower.5\normallineskiplimit\vbox{\kern-\normallineskiplimit\copy\strutbox}
  // tags: \strut@ and (n) in \maketag@@@, numbered in row order
  measuredTags(cx, rows)
  const tags = rows.map((r) => rowTag(cx, r.marks, r.numbered, strutBox))
  // \measure@
  let maxfields = Math.max(...rows.map((r) => r.fields.length))
  if (at) {
    if (maxfields > 2 * +at[1]) throw new Unsupported(`more columns in ${d.kind} than it declares`) // (amsmath's error: Extra & on this line)
    maxfields = 2 * +at[1]
  }
  if (maxfields % 2) maxfields++
  const colW = Array.from({ length: maxfields }, (_, j) => Math.max(0, ...rows.map((r) => r.fields[j]?.width ?? 0)))
  const totwidth = colW.reduce((a, b) => a + b, 0)
  const div = (a: number, b: number) => Math.trunc(a / b)
  const minalignsep = at ? 0 : 655360 // (\measure@, \xatlevel@ 0: \let\minalignsep\z@)
  const mintagsep = xnOverD(env.fonts[0][2]!.params[QUAD], 32768, 65536)
  // \xatlevel@ 1 (align): the space is shared between the margins and the column pairs; 0 (alignat): no space between
  // the pairs, the rest halved
  const tempcntb = at ? 0 : maxfields / 2 - 1, tempcnta = at ? 2 : maxfields / 2 + 1
  let eqnshift = div(z - totwidth, tempcnta), alignsep = at ? 0 : eqnshift
  if (alignsep < minalignsep) { alignsep = minalignsep; if (eqnshift > 0) eqnshift = div(z - totwidth - tempcntb * alignsep, 2) }
  if (eqnshift < 0) eqnshift = 0
  // \calc@shift@align (tags on the right, not fleqn), last row first; a tag that does not fit beside its
  // row is shifted below it (\saveshift@1)
  const shifted = rows.map(() => false)
  for (let r = rows.length - 1; r >= 0; r--) {
    const tw = tags[r].width
    if (!(tw > 0)) continue
    let dimb = 0, dimc = 0
    rows[r].fields.forEach((f, i) => { // \x@rcalc@width
      const col = i + 1, a = f.width
      if (a > 0) { dimc += dimb; if (col % 2) { dimc += colW[i]; dimb = 0 } else { dimc += a; dimb = colW[i] - a } }
      else dimb += colW[i]
    })
    let cnta = tempcnta, cntb = tempcntb
    const column = div(rows[r].fields.length - 1, 2)
    if (cntb > column) { cnta -= cntb; cnta += column; cntb = column }
    const dima = dimc + tw
    let dimen = minalignsep * cntb + mintagsep + mintagsep + dima
    if (dimen > z) { shifted[r] = true; continue }
    dimen = eqnshift + dima + cntb * alignsep + tw
    if (dimen > z) {
      dimen = div(z - dima, cnta)
      if (dimen < minalignsep) { alignsep = minalignsep; eqnshift = div(z - dima - cntb * alignsep, 2) }
      else {
        if (dimen < eqnshift) eqnshift = dimen < 0 ? 0 : dimen
        if (dimen < alignsep) alignsep = dimen
      }
    }
  }
  const tagshift = totwidth + tempcntb * alignsep + eqnshift - z
  // the main \halign: cells, then the \omit column with \kern-\alignsep@ and \place@tag
  const cells = rows.map((r, ri) => {
    const row: Node[][] = []
    for (let j = 0; j < maxfields; j++) {
      const f = r.fields[j] ?? field("", j) // \add@amps: the fields a row leaves out are set too, empty
      row.push(j % 2 ? [f, filGlue()] : [filGlue(), strutBox(), f])
    }
    const tagCol: Node[] = [kern(-alignsep, true)]
    if (r.tagged && shifted[ri]) {
      // \place@tag: \llap{\vtop{\normalbaselines \setbox\@ne\null \dp\@ne\lineht@ \box\@ne \boxz@}}, \lineht@
      // the deepest field of the row (\set@field; \math@cr@@@align resets it after each row)
      // (\measure@'s rows never reset it: the first row starts from the deepest field of them all)
      const lineht = Math.max(0, ...(ri === 0 ? rows.flatMap((x) => x.fields) : r.fields).map((f) => f.depth))
      const nul = hpack([]); nul.depth = lineht
      const list: Node[] = [nul]
      appendToVlist(list, tags[ri], lineht, run.k.sizes.normalsize.baselineskip, run.k.glue.normallineskip, run.k.dimens.normallineskiplimit)
      const vt = vpack(list)
      vt.depth = vt.height + vt.depth; vt.height = 0 // \vtop: the first box's height (§ 1087)
      tagCol.push(kern(-tagshift, true), hpack([ssGlue(), vt], { exactly: 0 }))
    } else if (r.tagged) tagCol.push(kern(-tagshift, true), hpack([ssGlue(), tags[ri]], { exactly: 0 }))
    row.push(tagCol)
    return row
  })
  const tabskip = [paramGlue("tabskip", glue(eqnshift))]
  for (let j = 0; j <= maxfields; j++) tabskip.push(paramGlue("tabskip", glue(j % 2 ? alignsep : 0)))
  const rowBoxes = halign(cells.map((r) => r.map((c) => c)), tabskip, { additional: 0 })
  let nrow = 0
  rowsToVlist(cx, texts.map((t) => t ?? rowBoxes[nrow++]), line.indent, () => {
  // \black@\totwidth@ after the last row: an align wider than the display shows its width in a
  // \noalign{\nointerlineskip \vskip-\ht\strutbox@ \vskip-\dp\strutbox@ \vbox{\noindent
  // \hbox to\displaywidth{\hbox to\totwidth@{\strut@\hfill}}} \prevdepth restored}
  // (\totwidth@ by then has \minalignsep for each space between column pairs)
  const blackWidth = totwidth + tempcntb * minalignsep
  if (blackWidth > z) {
    const wide = hpack([hpack([strutBox(), fillGlue()], { exactly: blackWidth })], { exactly: z })
    const par = paragraphInput("", run.k, "normalsize", doc, { start: [wide], amsmath, ...skips })
    const lb = lineBreak(par.list, par.params)
    decisions.push(lb.trace)
    v.nodes.push(glue(-strut.height), glue(-strut.depth), vpack(lb.vlist))
  }
  })
}

/**
 * amsmath's gather and gather* (\start@gather, \gather@, \gmeasure@, \calc@shift@gather, \set@gather@field,
 * \place@tag@gather): each row centred on its own (\kern\eqnshift@ before it, half what the display width leaves,
 * less the tag's width when that is tight), its number set off at the right edge, or below the row when it does not
 * fit; an \halign to \displaywidth finished as an alignment in a display (§ 1206), as align is.
 */
export function gatherDisplay(cx: Ctx, d: Display, line: { width: number; indent: number }, font: Font, skips: Skips = {}, par: ParagraphOptions | null = null) {
  const em = font.params[QUAD]
  const { amsmath } = cx.pre
  const { decisions, doc, run, v } = cx
  const starred = d.kind === "gather*"
  const src = d.src.trim()
  if (/\\\\\s*$/.test(src)) throw new Unsupported("gather ending with \\\\")
  if (/\\raisetag\b/.test(src)) throw new Unsupported("\\raisetag in gather")
  if (splitTop(src, "&").length > 1) throw new Unsupported("& in gather")
  const env = mathEnv(run.k, "normalsize", true); cx.doc.mathSize = "normalsize"
  const parse = (f: string) => parseFormula(f.replace(/\s+/g, " "), amsmath, em, si(cx, font), { display: true, font, text: text(cx, font), frame: (b) => framed(b, [], cx.doc.xcolorFbox), env: mathEnv(cx.run.k, "normalsize", amsmath) })
  const sz = run.k.sizes.normalsize, strut = sz.strut
  const strutBox = () => hpack([{ ...vpack([kern(-run.k.dimens.normallineskiplimit, true), hpack([{ kind: "rule", width: 0, height: strut.height, depth: strut.depth }])]), shift: xnOverD(run.k.dimens.normallineskiplimit, 32768, 65536) }]) // \strut@: \lower.5\normallineskiplimit\vbox{\kern-\normallineskiplimit\copy\strutbox}
  // \setboxz@h{$\m@th\displaystyle{##}$}
  const seq = rowsAndTexts(src, d.kind)
  const texts = seq.map((x) => ("row" in x ? null : { ...intertextBox(cx, x, par, skips, d.kind), short: x.short })) // (\gmeasure@ sets them first)
  const rows = seq.flatMap((x) => ("row" in x ? [x.row] : [])).map((row) => {
    const marks = rowMarks(row, d.kind)
    const numbered = !starred && !marks.nonumber && !marks.tag
    return {
      marks, numbered, tagged: numbered || !!marks.tag,
      box: hpack([{ kind: "math", on: true, width: 0 }, ...mlistToHlist([{ kind: "style", style: DISPLAY_STYLE }, { noad: ORD_NOAD, nucleus: groupField(parse(marks.src)), sup: null, sub: null }], env, TEXT_STYLE, false), { kind: "math", on: false, width: 0 }]),
    }
  })
  // the tag column: \setboxz@h{\strut@{##}}, ## \make@display@tag's (n) in \maketag@@@, numbered in row order
  // (\math@cr@@@gather runs \make@display@tag in every row: a row with no tag writes its \label too)
  measuredTags(cx, rows)
  // \gmeasure@ set the rows with \math@cr@@@gather itself, whose \make@display@tag steps the counter with
  // \refstepcounter (align's and multline's measuring pass use \stepcounter): \@currentHref, which the kernel sets
  // globally, is the last numbered row's from then on, and a \tag row before the first numbered one writes it in its
  // \label (with hyperref a \tag has an anchor of its own)
  const nums = rows.filter((r) => r.numbered).length
  if (nums && !cx.pre.hyper) cx.refs.href = cx.counters.href("equation", cx.counters.equation + nums)
  const tags = rows.map((r) => rowTag(cx, r.marks, r.numbered, strutBox, !rows.some((x) => x.tagged)))
  const z = line.width
  const totwidth = Math.max(0, ...rows.map((r) => r.box.width)) // \gmeasure@
  const mintagsep = xnOverD(env.fonts[0][2]!.params[QUAD], 32768, 65536)
  // (amsart: tags on the left, \iftagsleft@; with no tags, gather* alone: each row's \eqnshift@ the display width less
  // the row and less half of it, the tag column \kern-\gdisplaywidth@\rlap{\boxz@}, then \tabskip\gdisplaywidth@)
  const left = cx.pre.cls === "amsart"
  if (left && rows.some((r) => r.tagged)) throw new Unsupported("gather's numbers on the left (leqno)")
  const gdw = Math.max(totwidth, z)
  let leftBoxes: BoxNode[] | null = null
  if (left) {
    const cells = rows.map((r) => {
      const e = Math.max(0, -Math.trunc((z - r.box.width) / 2) + z - r.box.width)
      return [[strutBox(), kern(e, true), r.box, filGlue()], [kern(-gdw, true), hpack([hpack([strutBox()]), ssGlue()], { exactly: 0 })]]
    })
    leftBoxes = halign(cells, [paramGlue("tabskip", glue(0)), paramGlue("tabskip", glue(0, 65536000, NORMAL, 0, NORMAL)), paramGlue("tabskip", glue(gdw))], { exactly: z })
  }
  const cells = rows.map((r, ri) => {
    // \calc@shift@gather (tags on the right, not fleqn)
    const tw = tags[ri].width
    let eqnshift = z - r.box.width, shifted = false
    if (tw > 0) {
      if (2 * mintagsep + r.box.width + tw > z) shifted = true
      else if (eqnshift < 4 * tw) eqnshift -= tw
    }
    eqnshift = Math.max(0, Math.trunc(eqnshift / 2))
    // \place@tag@gather: \kern-(\totwidth@-\displaywidth) when wider; \llap{\boxz@}, or below the row \llap{\vtop{\raise@tag
    // \normalbaselines \setbox\@ne\null \dp\@ne\lineht@ \box\@ne \boxz@}} with \lineht@ the row's depth (\set@gather@field)
    const tagCol: Node[] = totwidth > z ? [kern(-(totwidth - z), true)] : []
    if (shifted) {
      const nul = hpack([]); nul.depth = r.box.depth
      const list: Node[] = [nul]
      appendToVlist(list, tags[ri], r.box.depth, sz.baselineskip, run.k.glue.normallineskip, run.k.dimens.normallineskiplimit)
      const vt = vpack(list)
      vt.depth = vt.height + vt.depth; vt.height = 0 // \vtop: the first box's height (§ 1087)
      tagCol.push(hpack([ssGlue(), vt], { exactly: 0 }))
    } else tagCol.push(hpack([ssGlue(), tags[ri]], { exactly: 0 }))
    return [[strutBox(), kern(eqnshift, true), r.box, filGlue()], tagCol]
  })
  const centering = paramGlue("tabskip", glue(0, 65536000, NORMAL, 0, NORMAL)) // \@centering: 0pt plus 1000pt
  const rowBoxes = leftBoxes ?? halign(cells, [paramGlue("tabskip", glue(0)), centering, paramGlue("tabskip", glue(0))], { exactly: z })
  let nrow = 0
  rowsToVlist(cx, texts.map((t) => t ?? rowBoxes[nrow++]), line.indent, () => {
  // \black@\totwidth@
  if (totwidth > z) {
    const wide = hpack([hpack([strutBox(), fillGlue()], { exactly: totwidth })], { exactly: z })
    const par = paragraphInput("", run.k, "normalsize", doc, { start: [wide], amsmath, ...skips })
    const lb = lineBreak(par.list, par.params)
    decisions.push(lb.trace)
    v.nodes.push(glue(-strut.height), glue(-strut.depth), vpack(lb.vlist))
  }
  })
}

/**
 * amsmath's multline and multline* (\start@multline, \multline@, \mmeasure@, \rendmultline@): one formula broken
 * into rows, each \hbox to\displaywidth{\hfil\strut@$\displaystyle{}row$\hfil} in a one-column \halign; the first
 * row starts (in its formula) with \hfilneg\hskip\multlinegap, so it sits \multlinegap from the left, the middle
 * ones are centred, and the last ends with \hskip\multlinetaggap, the number and \hfilneg (with no number,
 * \hskip\multlinegap\hfilneg in its formula), so it sits at the right; a number that does not fit beside the last
 * row (\mmeasure@'s \shifttag@) goes below it. Finished as an alignment in a display (§ 1206), as align is.
 */
export function multlineDisplay(cx: Ctx, d: Display, line: { width: number; indent: number }, font: Font) {
  const em = font.params[QUAD]
  const { amsmath } = cx.pre
  const { run, v } = cx
  // \label, \tag and \nonumber act in \mmeasure@ (\label@in@display, \tag@in@align); in the alignment \label is \@gobble
  // and \tag \gobble@tag
  const marks = rowMarks(d.src.trim(), d.kind), src = marks.src.trim()
  if (/\\\\\s*$/.test(src)) throw new Unsupported("multline ending with \\\\")
  if (/\\(shoveleft|shoveright|raisetag|begin|intertext|shortintertext)\b/.test(src)) throw new Unsupported("\\shoveleft, \\shoveright, \\intertext or an environment in multline")
  const numbered = d.kind === "multline" && !marks.nonumber && !marks.tag
  const env = mathEnv(run.k, "normalsize", true); cx.doc.mathSize = "normalsize"
  const parse = (f: string) => parseFormula(f.replace(/\\(nonumber|notag)\b/g, "").replace(/\s+/g, " "), amsmath, em, si(cx, font), { display: true, font, text: text(cx, font), frame: (b) => framed(b, [], cx.doc.xcolorFbox), env: mathEnv(cx.run.k, "normalsize", amsmath) })
  const sz = run.k.sizes.normalsize, strut = sz.strut
  const strutBox = () => hpack([{ ...vpack([kern(-run.k.dimens.normallineskiplimit, true), hpack([{ kind: "rule", width: 0, height: strut.height, depth: strut.depth }])]), shift: xnOverD(run.k.dimens.normallineskiplimit, 32768, 65536) }]) // \strut@: \lower.5\normallineskiplimit\vbox{\kern-\normallineskiplimit\copy\strutbox}
  const z = line.width, gap = 655360 // \multlinegap and \multlinetaggap, 10pt
  const empty: MItem = { noad: ORD_NOAD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null } // the {} after \displaystyle
  const formula = (items: MItem[]) => [{ kind: "math", on: true, width: 0 } as Node, ...mlistToHlist([{ kind: "style", style: DISPLAY_STYLE }, empty, ...items], env, TEXT_STYLE, false), { kind: "math", on: false, width: 0 } as Node]
  const hfilneg = () => glue(0, -65536, FIL)
  const rowSrcs = splitTop(src, "\\\\"), rows = rowSrcs.map(parse)
  // \mmeasure@: the last row's width and depth, and whether the number fits beside it (its own mlist: mlist_to_hlist
  // changes the one it converts)
  const lastBox = hpack(formula(parse(rowSrcs[rowSrcs.length - 1])))
  // \make@display@tag: the number or the \tag (\maketag@@@'s box) and the \label; with hyperref the number's anchor
  // before it. It goes after `g`, the \hskip\multlinetaggap, or when it does not fit (\mmeasure@'s \shifttag@) after
  // the strut `s` of a box below the row, where \normalbaselines holds
  const tagged = numbered || !!marks.tag
  if (marks.label !== null && !tagged) throw new Unsupported(`\\label in ${d.kind} with no tag`)
  const g = glue(gap), s = strutBox()
  let shifted = false
  measuredTags(cx, [{ marks }])
  const tag = tagged ? displayTag(cx, marks, numbered, (w) => {
    shifted = lastBox.width + w + gap > z
    return shifted ? { raise: sz.baselineskip.width, last: s } : { raise: sz.baselineskip.width + run.k.dimens.jot, last: g }
  }) : null
  const cells = rows.map((items, ri) => {
    const first = ri === 0, last = ri === rows.length - 1
    const lead: MItem[] = first ? [hfilneg(), glue(gap)] : []
    let inner: Node[]
    if (!last) inner = formula([...lead, ...items])
    else if (!tag) inner = formula([...lead, ...items, glue(gap), hfilneg()])
    else if (!shifted) inner = [...formula([...lead, ...items]), g, ...tag, hfilneg()]
    else {
      // \llap{\vtop{\normalbaselines \setbox\@ne\null \dp\@ne\lineht@ \box\@ne \hbox{\strut@\make@display@tag}}}
      const nul = hpack([]); nul.depth = lastBox.depth
      const list: Node[] = [nul]
      appendToVlist(list, hpack([s, ...tag]), lastBox.depth, sz.baselineskip, run.k.glue.normallineskip, run.k.dimens.normallineskiplimit)
      const vt = vpack(list)
      vt.depth = vt.height + vt.depth; vt.height = 0 // \vtop: the first box's height (§ 1087)
      inner = [...formula([...lead, ...items]), glue(gap), hpack([ssGlue(), vt], { exactly: 0 }), hfilneg()]
    }
    return [[hpack([filGlue(), strutBox(), ...inner, filGlue()], { exactly: z })]]
  })
  const rowBoxes = halign(cells, [paramGlue("tabskip", glue(0)), paramGlue("tabskip", glue(0))], { additional: 0 })
  // § 1206, with \openup\jot and amsmath's \everycr (\@display@init); \mmeasure@'s \halign ran it already and cleared
  // \ifdt@p, so the first \cr's \noalign is the \penalty\@eqpen, not align's \lineskiplimit skips
  v.nodes.push(penalty(run.k.ints.predisplaypenalty), spec("abovedisplayskip", sz.abovedisplayskip))
  const jot = run.k.dimens.jot
  v.nodes.push(penalty(10000))
  const bs = addGlue(sz.baselineskip, dimen(jot)), ls = addGlue(run.k.glue.lineskip, dimen(jot))
  for (const rb of rowBoxes) {
    rb.display = true; rb.shift = line.indent
    v.prevDepth = appendToVlist(v.nodes, rb, v.prevDepth, bs, ls, run.k.dimens.lineskiplimit + jot)
    v.nodes.push(penalty(10000), glue(0))
  }
  v.nodes.push(penalty(run.k.ints.postdisplaypenalty), spec("belowdisplayskip", sz.belowdisplayskip))
}

export function typesetList(cx: Ctx, list: Node[], opts: Parameters<typeof paragraphInput>[4], withParskip: boolean) {
  const { amsmath } = cx.pre
  const { decisions, doc, outerParskip, run, v } = cx
  const { params } = paragraphInput("", run.k, "normalsize", doc, { ...opts, amsmath })
  const lb = lineBreak(list, params)
  decisions.push(lb.trace)
  if (withParskip) v.paragraph(lb.vlist, outerParskip); else v.lines(lb.vlist)
  return { just: lb.lines[lb.lines.length - 1] ?? null, params, lines: lb.lines.length }
}

/**
 * hpdftex's anchor in math mode (\refstepcounter's, hyperref's \equation): \Hy@raisedlink there is \penalty\@M then
 * \smash, which in math is \mathpalette\mathsm@sh: an empty group {} and \hbox{$\m@th\raise\baselineskip\hbox{…}$}
 * of height and depth zero, the \pdfdest and \Hy@RestoreLastskip's \nobreak in the raised box
 */
function mathAnchor(name: string | null, baselineskip: number): MItem[] {
  const raised = hpack(name === null ? [] : [pdfdest(name), penalty(10000)]); raised.shift = -baselineskip
  const box = hpack([{ kind: "math", on: true, width: 0 }, raised, { kind: "math", on: false, width: 0 }]); box.height = 0; box.depth = 0
  return [penalty(10000), { noad: ORD_NOAD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null }, { noad: ORD_NOAD, nucleus: { kind: "box", box }, sup: null, sub: null }]
}
