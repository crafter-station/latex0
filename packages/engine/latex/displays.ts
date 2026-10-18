// Paragraphs with displayed math: the text around \[ \], $$ $$, equation, displaymath and align (the
// display's line, \abovedisplayskip and \belowdisplayskip, \predisplaypenalty, equation numbers), and a
// paragraph broken from a prepared list.

import { QUAD } from "../layout/font"
import { appendText } from "../layout/hmode"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, glue, kern, paramGlue, penalty, type BoxNode, type CharNode, type Node, filGlue, fillGlue, ssGlue } from "../layout/nodes"
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
import { squeeze, appendToVlist, labelWrite, mathEnv, paragraphInput, spec, parseFormula } from "./paragraph"

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
  const quad = romanFont.params[QUAD]
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
    const line = displayLine(prevGraf, ps.hsize, ps.hangIndent, ps.hangAfter, ps.parShape)
    if (next.kind === "align" || next.kind === "align*") {
      if (!amsmath) throw new Unsupported(`${next.kind} without amsmath`)
      alignDisplay(cx, next, line, ps)
      prevGraf += 3
      return
    }
    // \label{key}: \protected@write\@auxout{}{\string\newlabel{key}{{\@currentlabel}{\thepage }{}{\@currentHref}{}}}.
    // amsmath keeps it for after the tag (\label@in@display); LaTeX writes it where it stands
    const labels = [...next.src.matchAll(/\\label\s*\{([^{}]*)\}/g)]
    if (labels.length && next.kind !== "equation") throw new Unsupported(`\\label in ${next.kind}`)
    if (labels.length > 1) throw new Unsupported("several \\label in an equation")
    const label = labels[0]
    if (label && !/^[A-Za-z0-9:._-]+$/.test(label[1])) throw new Unsupported(`\\label{${label[1]}}`)
    const parse = (f: string) => parseFormula(f.replace(/\s+/g, " "), amsmath, romanFont.params[QUAD])
    if (next.kind === "equation") { counters.equation++; refs.href = counters.href("equation", counters.equation) } // \refstepcounter, or amsmath's \incr@eqnum
    const newlabel: Node | null = label ? labelWrite(refs, label[1], counters.the(counters.equation)) : null
    let mlist: MItem[]
    if (!label) mlist = parse(next.src)
    else {
      const before = next.src.slice(0, label.index), after = next.src.slice(label.index! + label[0].length)
      if (amsmath) mlist = parse(before + after)
      else if (depthOf(before) !== 0) throw new Unsupported("\\label inside a group in an equation")
      else mlist = [...parse(before), newlabel!, ...parse(after)]
    }
    const env = mathEnv(run.k, "normalsize", amsmath)
    if (next.kind === "equation*" && !amsmath) throw new Unsupported("equation* without amsmath")
    let eqno: BoxNode | null = null
    if (next.kind === "equation" && amsmath) { // \mathopen{} after \incr@eqnum, and \veqno \tagform@\theequation: \hbox{\normalfont (1\/)}, then the \label
      mlist.unshift({ noad: OPEN_NOAD, nucleus: groupField([]), sup: null, sub: null })
      // hyperref: \refstepcounter's anchor in a math group before it (an ord noad)
      if (hyper && hyperDriver.pdftex) mlist.unshift(...mathAnchor(refs.href, run.k.sizes.normalsize.baselineskip.width))
      else if (hyper) mlist.unshift({ noad: ORD_NOAD, nucleus: { kind: "mlist", list: [HS(), HA(run.k.sizes.normalsize.baselineskip.width), dest(refs.href)] }, sup: null, sub: null })
      const l: Node[] = []
      appendText(l, `(${counters.the(counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
      l.push(kern(romanFont.chars.get((l[l.length - 1] as CharNode).char)!.italic, true)) // \@@italiccorr
      appendText(l, ")", romanFont, { spaceFactor: 1000 }, false)
      eqno = hpack(newlabel ? [hpack(l), newlabel] : [hpack(l)]); eqno.display = true
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
    prevGraf += 3
  })
}

/**
 * amsmath's align and align* (\start@align\@ne, \align@, \measure@, \calc@shift@align,
 * \math@cr@@@align, \place@tag): fields alternate right- and left-aligned, the whole is centred
 * by \eqnshift@ with \alignsep@ between column pairs, and each row's number is set off at the
 * right edge. TeX finishes it as an alignment in a display (§ 1206).
 */
export function alignDisplay(cx: Ctx, d: Display, line: { width: number; indent: number }, _ps: unknown) {
  const { amsmath, hyper } = cx.pre
  const { counters, decisions, doc, refs, romanFont, run, v } = cx
  const starred = d.kind === "align*"
  let src = d.src.trim()
  if (/\\\\\s*$/.test(src)) throw new Unsupported("align ending with \\\\")
  if (/\\(label|tag|intertext|shortintertext)\b/.test(src)) throw new Unsupported("\\label, \\tag or \\intertext in align")
  const env = mathEnv(run.k, "normalsize", true)
  const mathBox = (items: MItem[]) => hpack([{ kind: "math", on: true, width: 0 }, ...mlistToHlist([{ kind: "style", style: DISPLAY_STYLE }, ...items], env, TEXT_STYLE, false), { kind: "math", on: false, width: 0 }])
  const parse = (f: string) => parseFormula(f.replace(/\s+/g, " "), amsmath, romanFont.params[QUAD])
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
    refs.href = counters.href("equation", counters.equation)
    const l: Node[] = []
    appendText(l, `(${counters.the(counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
    const last = l[l.length - 1] as CharNode
    l.push(kern(romanFont.chars.get(last.char)!.italic, true)) // \@@italiccorr
    appendText(l, ")", romanFont, { spaceFactor: 1000 }, false)
    // hyperref: the anchor between the strut and the number, at \baselineskip plus \jot
    if (hyper) { const s = strutBox(); return hpack([s, ...anchor(counters.href("equation", counters.equation), sz.baselineskip.width + run.k.dimens.jot, "h", s), hpack(l)]) }
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
    const par = paragraphInput("", run.k, "normalsize", doc, { start: [wide], amsmath })
    const lb = lineBreak(par.list, par.params)
    decisions.push(lb.trace)
    v.nodes.push(glue(-strut.height), glue(-strut.depth), vpack(lb.vlist))
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
