// Paragraphs with displayed math: the text around \[ \], $$ $$, equation, displaymath and align (the
// display's line, \abovedisplayskip and \belowdisplayskip, \predisplaypenalty, equation numbers), and a
// paragraph broken from a prepared list.

import { QUAD, type Font } from "../layout/font"
import { appendText } from "../layout/hmode"
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
import { squeeze, appendToVlist, crefWrites, labelWrite, mathEnv, paragraphInput, selectFont, spec, parseFormula, siContext, type ParagraphOptions } from "./paragraph"
import type { GlueSpec } from "../layout/dimen"
import type { SizeCommand } from "../layout/classdata"

/**
 * A paragraph that may hold displays (§§ 1145–1206). The text before each display is broken
 * with \displaywidowpenalty; the display goes on the vertical list; the paragraph resumes after
 * it with prev_graf+3, no indentation and no \parskip. `club` is \clubpenalty while the
 * paragraph is read and `parClub` the one its final \par sees.
 */
export function paragraphWithDisplays(cx: Ctx, text: string, noindent: boolean, club: number, parClub: number, start?: Node[], unskip = 0, firstClub = club, leadNoteClub?: number) {
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
      ...(first && leadNoteClub !== undefined ? { leadGroupNoteClubPenalty: leadNoteClub } : {}),
      ...(last ? (unskip ? { unskip } : {}) : { widowPenalty: run.k.ints.displaywidowpenalty }),
      ...(first ? (start ? { start } : {}) : { start: [] as Node[] }),
    }
    if (first && !t) {
      // the display starts the paragraph: $$ (and amsmath's \[) from vertical mode starts it with the
      // indent box; LaTeX's own \[ first sets \nointerlineskip\makebox[.6\linewidth]{}
      if (next!.kind === "bracket" && !amsmath || next!.kind === "displaymath" && !amsmath) {
        v.prevDepth = IGNORE_DEPTH
        const lw = run.k.dimens.textwidth
        const mb = hpack([ssGlue(), ssGlue()], { exactly: xnOverD(lw, 39322, 65536) })
        const r = typesetList(cx, [...(start ?? (noindent ? [] : [emptyBox("hlist", run.k.dimens.parindent)])), mb], opts, true)
        justBox = r.just; params = r.params; nlines = r.lines
      } else if (!noindent || start) { // a run-in heading takes the indent box's place
        const r = typesetList(cx, start ?? [emptyBox("hlist", run.k.dimens.parindent)], opts, true)
        justBox = r.just; params = r.params; nlines = r.lines
      } else v.nodes.push(spec("parskip", outerParskip), paramGlue("parskip", glue(0))) // \noindent$$: an empty paragraph
    } else if (t || !last) {
      const { list, params: ps, notes } = paragraphInput((first && noindent ? "\\noindent " : "") + t, run.k, "normalsize", doc, { ...opts, amsmath })
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
    displayMath(cx, next, displayLine(prevGraf, ps.hsize, ps.hangIndent, ps.hangAfter, ps.parShape), justBox, font)
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
const si = (cx: Ctx, font: Font) => (cx.doc.siunitx ? siContext(cx.run.k, "normalsize", font, cx.doc.siunitx) : undefined)

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
  if (size !== "normalsize") throw new Unsupported(`a display in a list in \\${size}`)
  const segs = displaySegments(text)
  const font = selectFont(run.k, size, opts.attrs ?? cx.normalAttrs)
  let prevGraf = 0
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
      displayMath(cx, next!, displayLine(prevGraf, run.k.dimens.textwidth, 0, 1, opts.parShape ?? []), null, font, skipsOf(opts))
      prevGraf += 3
      return
    }
    const { list, params, notes } = paragraphInput(counted(t, true), run.k, size, doc, { ...o, amsmath })
    const lb = lineBreak(list, params)
    decisions.push(...notes, lb.trace)
    if (first) v.paragraph(lb.vlist, parskip, run.k.sizes[size].baselineskip); else v.lines(lb.vlist)
    prevGraf += lb.lines.length
    if (next) {
      displayMath(cx, next, displayLine(prevGraf, params.hsize, params.hangIndent, params.hangAfter, params.parShape), lb.lines[lb.lines.length - 1] ?? null, font, skipsOf(opts))
      prevGraf += 3
    }
  })
}

/** A display (§§ 1145–1206) on line prev_graf+2 of the paragraph (`line`), after `justBox`, its last line so far;
 *  `font`: the text font then, whose \fontdimen6 \predisplaysize allows for */
function displayMath(cx: Ctx, next: Display, line: { width: number; indent: number }, justBox: BoxNode | null, font: Font, skips: Skips = {}) {
  const quad = font.params[QUAD]
  const { amsmath, hyper } = cx.pre
  // amsmath's \iftag@ after it: \mathdisplay (equation, \[ \]) and \displ@y@'s \everycr (align, gather) leave it false,
  // a numbered multline's \mmeasure@ true; $$ leaves it alone
  if (amsmath && next.kind !== "dollars") cx.run.tagFlag = next.kind === "multline" && !/\\(nonumber|notag)\b/.test(next.src)
  const { counters, refs, romanFont, run, v } = cx
  if (next.kind === "align" || next.kind === "align*" || next.kind === "gather" || next.kind === "gather*" || next.kind === "multline" || next.kind === "multline*") {
    if (!amsmath) throw new Unsupported(`${next.kind} without amsmath`)
    if (next.kind.startsWith("gather")) gatherDisplay(cx, next, line, font, skips)
    else if (next.kind.startsWith("multline")) multlineDisplay(cx, next, line, font)
    else alignDisplay(cx, next, line, font, skips)
    return
  }
  // \label{key}: \protected@write\@auxout{}{\string\newlabel{key}{{\@currentlabel}{\thepage }{}{\@currentHref}{}}}.
  // amsmath keeps it for after the tag (\label@in@display); LaTeX writes it where it stands
  const labels = [...next.src.matchAll(/\\label\s*\{([^{}]*)\}/g)]
  if (labels.length && next.kind !== "equation") throw new Unsupported(`\\label in ${next.kind}`)
  if (labels.length > 1) throw new Unsupported("several \\label in an equation")
  const label = labels[0]
  if (label && !/^[A-Za-z0-9:._-]+$/.test(label[1])) throw new Unsupported(`\\label{${label[1]}}`)
  const parse = (f: string) => parseFormula(f.replace(/\s+/g, " "), amsmath, quad, si(cx, font)) // (\quad: 1em of the text font then)
  if (next.kind === "equation") { counters.equation++; refs.href = stepHref(cx, "equation", counters.equation) } // \refstepcounter, or amsmath's \incr@eqnum
  const crefEq = { type: "equation", arabic: counters.equation, prefix: counters.crefPrefix("equation"), label: counters.the(counters.equation) }
  const newlabel: Node[] | null = label ? [labelWrite(refs, label[1], counters.the(counters.equation)), ...crefWrites(refs, label[1], true, crefEq)] : null
  let mlist: MItem[]
  if (!label) mlist = parse(next.src)
  else {
    const before = next.src.slice(0, label.index), after = next.src.slice(label.index! + label[0].length)
    if (amsmath) mlist = parse(before + after)
    else if (depthOf(before) !== 0) throw new Unsupported("\\label inside a group in an equation")
    else mlist = [...parse(before), ...newlabel!, ...parse(after)]
  }
  const env = mathEnv(run.k, "normalsize", amsmath)
  if (next.kind === "equation*" && !amsmath) throw new Unsupported("equation* without amsmath")
  let eqno: BoxNode | null = null
  if (next.kind === "equation" && amsmath) { // \mathopen{} after \incr@eqnum, and \veqno \tagform@\theequation: \hbox{\normalfont (1\/)}, then the \label
    mlist.unshift({ noad: OPEN_NOAD, nucleus: groupField([]), sup: null, sub: null })
    // (hyperref's \refstepcounter socket with cleveref, hyperref/fixcleveref: after the anchor, the first aid's
    // {\firstaid@cref@updatelabeldata{\@currentcounter}}, here an empty ord noad)
    if (hyper && cx.refs.cleveref) mlist.unshift({ noad: ORD_NOAD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null })
    // hyperref: \refstepcounter's anchor in a math group before it (an ord noad)
    if (hyper && hyperDriver.pdftex) mlist.unshift(...mathAnchor(refs.href, run.k.sizes.normalsize.baselineskip.width))
    else if (hyper) mlist.unshift({ noad: ORD_NOAD, nucleus: { kind: "mlist", list: [HS(), HA(run.k.sizes.normalsize.baselineskip.width), dest(refs.href)] }, sup: null, sub: null })
    const l: Node[] = []
    appendText(l, `(${counters.the(counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
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
    const l: Node[] = []
    appendText(l, `(${counters.the(counters.equation)})`, romanFont, { spaceFactor: 1000 }, false)
    eqno = hpack([hpack(setgroup(l))]); eqno.display = true // {\normalfont\normalcolor (n)}
  }
  const sz = run.k.sizes.normalsize
  const items = finishDisplay(mlistToHlist(mlist, env, DISPLAY_STYLE, false), eqno, {
    width: line.width, indent: line.indent, preSize: preDisplaySize(justBox, quad), mathQuad: env.fonts[0][2]!.params[QUAD],
    preDisplayPenalty: run.k.ints.predisplaypenalty, postDisplayPenalty: run.k.ints.postdisplaypenalty,
    aboveDisplaySkip: sz.abovedisplayskip, belowDisplaySkip: sz.belowdisplayskip, aboveDisplayShortSkip: sz.abovedisplayshortskip, belowDisplayShortSkip: sz.belowdisplayshortskip,
  })
  for (const it of items) { if ("box" in it) v.box(it.box, sz.baselineskip); else v.nodes.push(it.node) }
}

/**
 * amsmath's align and align* (\start@align\@ne, \align@, \measure@, \calc@shift@align,
 * \math@cr@@@align, \place@tag): fields alternate right- and left-aligned, the whole is centred
 * by \eqnshift@ with \alignsep@ between column pairs, and each row's number is set off at the
 * right edge. TeX finishes it as an alignment in a display (§ 1206).
 */
export function alignDisplay(cx: Ctx, d: Display, line: { width: number; indent: number }, font: Font, skips: Skips = {}) {
  const em = font.params[QUAD]
  const { amsmath, hyper } = cx.pre
  const { counters, decisions, doc, refs, romanFont, run, v } = cx
  const starred = d.kind === "align*"
  let src = d.src.trim()
  if (/\\\\\s*$/.test(src)) throw new Unsupported("align ending with \\\\")
  if (/\\(label|tag|intertext|shortintertext)\b/.test(src)) throw new Unsupported("\\label, \\tag or \\intertext in align")
  const env = mathEnv(run.k, "normalsize", true)
  const mathBox = (items: MItem[]) => hpack([{ kind: "math", on: true, width: 0 }, ...mlistToHlist([{ kind: "style", style: DISPLAY_STYLE }, ...items], env, TEXT_STYLE, false), { kind: "math", on: false, width: 0 }])
  const parse = (f: string) => parseFormula(f.replace(/\s+/g, " "), amsmath, em, si(cx, font))
  const rows = src.split(/\\\\/).map((r) => {
    const numbered = !starred && !/\\(nonumber|notag)\b/.test(r)
    const fields = r.replace(/\\(nonumber|notag)\b/g, "").split("&").map((f, j) => {
      const items = parse(f)
      // \setboxz@h{\@lign$\m@th\displaystyle{##}$} and {{}##} for the left-aligned fields
      return mathBox([{ noad: ORD_NOAD, nucleus: groupField(j % 2 ? [{ noad: ORD_NOAD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null }, ...items] : items), sup: null, sub: null }])
    })
    return { fields, numbered }
  })
  const z = line.width
  const sz = run.k.sizes.normalsize, strut = sz.strut
  const strutBox = () => hpack([vpack([kern(-run.k.dimens.normallineskiplimit, true), hpack([{ kind: "rule", width: 0, height: strut.height, depth: strut.depth }])])]) // \strut@
  // tags: \strut@ and (n) in \maketag@@@, numbered in row order
  const tags = rows.map((r) => {
    if (!r.numbered) return hpack([strutBox()])
    counters.equation++
    refs.href = stepHref(cx, "equation", counters.equation)
    const l: Node[] = []
    appendText(l, `(${counters.the(counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
    const last = l[l.length - 1] as CharNode
    l.push(kern(romanFont.chars.get(last.char)!.italic, true)) // \@@italiccorr
    appendText(l, ")", romanFont, { spaceFactor: 1000 }, false)
    // hyperref: the anchor between the strut and the number, at \baselineskip plus \jot
    if (hyper) { const s = strutBox(); return hpack([s, ...anchor(refs.href, sz.baselineskip.width + run.k.dimens.jot, "h", s), hpack(l)]) }
    return hpack([strutBox(), hpack(l)])
  })
  // \measure@
  let maxfields = Math.max(...rows.map((r) => r.fields.length))
  if (maxfields % 2) maxfields++
  const colW = Array.from({ length: maxfields }, (_, j) => Math.max(0, ...rows.map((r) => r.fields[j]?.width ?? 0)))
  const totwidth = colW.reduce((a, b) => a + b, 0)
  const div = (a: number, b: number) => Math.trunc(a / b)
  const minalignsep = 655360
  const mintagsep = xnOverD(env.fonts[0][2]!.params[QUAD], 32768, 65536)
  let tempcntb = maxfields / 2, tempcnta = tempcntb
  tempcntb -= 1; tempcnta += 1
  let eqnshift = div(z - totwidth, tempcnta), alignsep = eqnshift
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
      const f = r.fields[j]
      if (!f) { row.push(j % 2 ? [filGlue()] : [filGlue(), strutBox()]); continue } // \add@amps: empty fields
      row.push(j % 2 ? [f, filGlue()] : [filGlue(), strutBox(), f])
    }
    const tagCol: Node[] = [kern(-alignsep, true)]
    if (r.numbered && shifted[ri]) {
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
    } else if (r.numbered) tagCol.push(kern(-tagshift, true), hpack([ssGlue(), tags[ri]], { exactly: 0 }))
    row.push(tagCol)
    return row
  })
  const tabskip = [paramGlue("tabskip", glue(eqnshift))]
  for (let j = 0; j <= maxfields; j++) tabskip.push(paramGlue("tabskip", glue(j % 2 ? alignsep : 0)))
  const rowBoxes = halign(cells.map((r) => r.map((c) => c)), tabskip, { additional: 0 })
  // § 1206, with \openup\jot and amsmath's \everycr
  v.nodes.push(penalty(run.k.ints.predisplaypenalty), spec("abovedisplayskip", sz.abovedisplayskip))
  const jot = 196608
  v.nodes.push(glue(-(run.k.dimens.lineskiplimit + jot)), glue(run.k.dimens.normallineskiplimit))
  const bs = addGlue(sz.baselineskip, dimen(jot)), ls = addGlue(run.k.glue.lineskip, dimen(jot))
  for (const rb of rowBoxes) {
    rb.display = true; rb.shift = line.indent
    v.prevDepth = appendToVlist(v.nodes, rb, v.prevDepth, bs, ls, run.k.dimens.lineskiplimit + jot)
    v.nodes.push(penalty(10000), glue(0)) // \interdisplaylinepenalty is \@M in amsmath; \\ adds \vskip\z@
  }
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
  v.nodes.push(penalty(run.k.ints.postdisplaypenalty), spec("belowdisplayskip", sz.belowdisplayskip))
}

/**
 * amsmath's gather and gather* (\start@gather, \gather@, \gmeasure@, \calc@shift@gather, \set@gather@field,
 * \place@tag@gather): each row centred on its own (\kern\eqnshift@ before it, half what the display width leaves,
 * less the tag's width when that is tight), its number set off at the right edge, or below the row when it does not
 * fit; an \halign to \displaywidth finished as an alignment in a display (§ 1206), as align is.
 */
export function gatherDisplay(cx: Ctx, d: Display, line: { width: number; indent: number }, font: Font, skips: Skips = {}) {
  const em = font.params[QUAD]
  const { amsmath, hyper } = cx.pre
  const { counters, decisions, doc, refs, romanFont, run, v } = cx
  const starred = d.kind === "gather*"
  const src = d.src.trim()
  if (/\\\\\s*$/.test(src)) throw new Unsupported("gather ending with \\\\")
  if (/\\(label|tag|intertext|shortintertext|raisetag)\b/.test(src)) throw new Unsupported("\\label, \\tag or \\intertext in gather")
  if (/&/.test(src)) throw new Unsupported("& in gather")
  const env = mathEnv(run.k, "normalsize", true)
  const parse = (f: string) => parseFormula(f.replace(/\s+/g, " "), amsmath, em, si(cx, font))
  const sz = run.k.sizes.normalsize, strut = sz.strut
  const strutBox = () => hpack([vpack([kern(-run.k.dimens.normallineskiplimit, true), hpack([{ kind: "rule", width: 0, height: strut.height, depth: strut.depth }])])]) // \strut@
  // \setboxz@h{$\m@th\displaystyle{##}$}
  const rows = src.split(/\\\\/).map((r) => ({
    numbered: !starred && !/\\(nonumber|notag)\b/.test(r),
    box: hpack([{ kind: "math", on: true, width: 0 }, ...mlistToHlist([{ kind: "style", style: DISPLAY_STYLE }, { noad: ORD_NOAD, nucleus: groupField(parse(r.replace(/\\(nonumber|notag)\b/g, ""))), sup: null, sub: null }], env, TEXT_STYLE, false), { kind: "math", on: false, width: 0 }]),
  }))
  // the tag column: \setboxz@h{\strut@{##}}, ## \make@display@tag's (n) in \maketag@@@, numbered in row order
  const tags = rows.map((r) => {
    if (!r.numbered) return hpack([strutBox()])
    counters.equation++
    refs.href = stepHref(cx, "equation", counters.equation)
    const l: Node[] = []
    appendText(l, `(${counters.the(counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
    l.push(kern(romanFont.chars.get((l[l.length - 1] as CharNode).char)!.italic, true)) // \@@italiccorr
    appendText(l, ")", romanFont, { spaceFactor: 1000 }, false)
    if (hyper) { const s = strutBox(); return hpack([s, ...anchor(refs.href, sz.baselineskip.width + run.k.dimens.jot, "h", s), hpack(l)]) }
    return hpack([strutBox(), hpack(l)])
  })
  const z = line.width
  const totwidth = Math.max(0, ...rows.map((r) => r.box.width)) // \gmeasure@
  const mintagsep = xnOverD(env.fonts[0][2]!.params[QUAD], 32768, 65536)
  const cells = rows.map((r, ri) => {
    // \calc@shift@gather (tags on the right, not fleqn)
    const tw = r.numbered ? tags[ri].width : 0
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
  const rowBoxes = halign(cells, [paramGlue("tabskip", glue(0)), centering, paramGlue("tabskip", glue(0))], { exactly: z })
  // § 1206, with \openup\jot and amsmath's \everycr, as align
  v.nodes.push(penalty(run.k.ints.predisplaypenalty), spec("abovedisplayskip", sz.abovedisplayskip))
  const jot = 196608
  v.nodes.push(glue(-(run.k.dimens.lineskiplimit + jot)), glue(run.k.dimens.normallineskiplimit))
  const bs = addGlue(sz.baselineskip, dimen(jot)), ls = addGlue(run.k.glue.lineskip, dimen(jot))
  for (const rb of rowBoxes) {
    rb.display = true; rb.shift = line.indent
    v.prevDepth = appendToVlist(v.nodes, rb, v.prevDepth, bs, ls, run.k.dimens.lineskiplimit + jot)
    v.nodes.push(penalty(10000), glue(0))
  }
  // \black@\totwidth@
  if (totwidth > z) {
    const wide = hpack([hpack([strutBox(), fillGlue()], { exactly: totwidth })], { exactly: z })
    const par = paragraphInput("", run.k, "normalsize", doc, { start: [wide], amsmath, ...skips })
    const lb = lineBreak(par.list, par.params)
    decisions.push(lb.trace)
    v.nodes.push(glue(-strut.height), glue(-strut.depth), vpack(lb.vlist))
  }
  v.nodes.push(penalty(run.k.ints.postdisplaypenalty), spec("belowdisplayskip", sz.belowdisplayskip))
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
  const { amsmath, hyper } = cx.pre
  const { counters, refs, romanFont, run, v } = cx
  const src = d.src.trim()
  if (/\\\\\s*$/.test(src)) throw new Unsupported("multline ending with \\\\")
  if (/\\(label|tag|shoveleft|shoveright|raisetag|begin)\b/.test(src)) throw new Unsupported("\\label, \\tag, \\shoveleft, \\shoveright or an environment in multline")
  const numbered = d.kind === "multline" && !/\\(nonumber|notag)\b/.test(src)
  const env = mathEnv(run.k, "normalsize", true)
  const parse = (f: string) => parseFormula(f.replace(/\\(nonumber|notag)\b/g, "").replace(/\s+/g, " "), amsmath, em, si(cx, font))
  const sz = run.k.sizes.normalsize, strut = sz.strut
  const strutBox = () => hpack([vpack([kern(-run.k.dimens.normallineskiplimit, true), hpack([{ kind: "rule", width: 0, height: strut.height, depth: strut.depth }])])]) // \strut@
  const z = line.width, gap = 655360 // \multlinegap and \multlinetaggap, 10pt
  const empty: MItem = { noad: ORD_NOAD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null } // the {} after \displaystyle
  const formula = (items: MItem[]) => [{ kind: "math", on: true, width: 0 } as Node, ...mlistToHlist([{ kind: "style", style: DISPLAY_STYLE }, empty, ...items], env, TEXT_STYLE, false), { kind: "math", on: false, width: 0 } as Node]
  const hfilneg = () => glue(0, -65536, FIL)
  const rowSrcs = src.split(/\\\\/), rows = rowSrcs.map(parse)
  // \mmeasure@: the last row's width and depth, and whether the number fits beside it (its own mlist: mlist_to_hlist
  // changes the one it converts)
  const lastBox = hpack(formula(parse(rowSrcs[rowSrcs.length - 1])))
  let tag: BoxNode | null = null
  if (numbered) {
    counters.equation++
    refs.href = stepHref(cx, "equation", counters.equation)
    const l: Node[] = []
    appendText(l, `(${counters.the(counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
    l.push(kern(romanFont.chars.get((l[l.length - 1] as CharNode).char)!.italic, true)) // \@@italiccorr
    appendText(l, ")", romanFont, { spaceFactor: 1000 }, false)
    tag = hpack(l) // \maketag@@@
  }
  const shifted = !!tag && lastBox.width + tag.width + gap > z
  const cells = rows.map((items, ri) => {
    const first = ri === 0, last = ri === rows.length - 1
    const lead: MItem[] = first ? [hfilneg(), glue(gap)] : []
    let inner: Node[]
    if (!last) inner = formula([...lead, ...items])
    else if (!tag) inner = formula([...lead, ...items, glue(gap), hfilneg()])
    // (hyperref: \make@display@tag's \refstepcounter puts the equation's anchor before the number)
    else if (!shifted) { const g = glue(gap); inner = [...formula([...lead, ...items]), g, ...(hyper ? anchor(refs.href, sz.baselineskip.width + run.k.dimens.jot, "h", g) : []), tag, hfilneg()] }
    else {
      // \llap{\vtop{\normalbaselines \setbox\@ne\null \dp\@ne\lineht@ \box\@ne \hbox{\strut@\make@display@tag}}}
      const nul = hpack([]); nul.depth = lastBox.depth
      const list: Node[] = [nul]
      const s = strutBox()
      appendToVlist(list, hpack([s, ...(hyper ? anchor(refs.href, sz.baselineskip.width, "h", s) : []), tag]), lastBox.depth, sz.baselineskip, run.k.glue.normallineskip, run.k.dimens.normallineskiplimit)
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
  const jot = 196608
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
