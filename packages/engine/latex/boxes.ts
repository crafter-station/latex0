// Boxes in text: a tabular (latex.ltx \@tabular, \@mkpream, \@array with \halign) and a minipage
// (\@iiiminipage, \@parboxrestore, \@iiiparbox) where they stand, and the width registers inside them.

import { type SizeCommand } from "../layout/classdata"
import { QUAD, X_HEIGHT } from "../layout/font"
import { dimexpr, parseDimen, parseGlue, type Internal, type Scanner } from "../layout/dimen"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, glue, paramGlue, penalty, ssGlue, type BoxNode, type Node } from "../layout/nodes"
import { vpack, type PackSpec } from "../layout/pack"
import type { Ctx } from "./context"
import { centering as centeringShape, raggedleft, raggedright, sloppy } from "./kernel"
import { caption, captionCall, captionXref, type Captioned } from "./floats"
import { copyKeys, runList, setCaptionKeys } from "./captionsetup"
import { Unsupported } from "./unsupported"
import { IGNORE_DEPTH, negate, plain } from "./vlist"
import type { MinipageSource } from "./source"
import { preamble, tabularBox, tabularLines, vtop, xColumns, type ColumnTypes, type TabCol, type TabLine, type TabularEnv } from "./tabular"
import type { TabularSource } from "./source"
import { closingBrace, hlistInput, appendToVlist, crefWrites, labelWrite, mathEnv, paragraphInput, selectFont, siContext, type FontAttrs, type ParagraphOptions, type TabularOuter } from "./paragraph"
import { mlistToHlist, TEXT } from "../mathlayout/mlist"
import { siTableCell } from "./siunitx"

/** tabular number n where it stands in text (DocState.tabular) */
export function tabularAt(cx: Ctx, n: number, size: SizeCommand, attrs: FontAttrs, sfcodes?: Record<number, number>, outer?: TabularOuter): BoxNode {
  const { tabulars } = cx
  const t = tabulars[n]
  const lines = tabularLines(t.body)
  if (t.x) return tabularx(cx, t, lines, size, attrs, sfcodes, outer)
  const cols = preamble(t.spec, cx.run.k.array && { types: cx.pre.columnTypes, si: !!cx.doc.siunitx })
  return tabular(cx, lines, cols, size, t.pos, attrs, sfcodes, outer, t.width)
}

/** tabularx.sty's \TX@delta: \hfuzz when it is loaded (0.1pt) */
const TX_DELTA = 6554
const MAX_DIMEN = 0o7777777777

/**
 * \begin{tabularx}{width}[pos]{cols} (tabularx.sty 2.12a): the body set as a tabular in \setbox\@tempboxa\hbox{…}
 * with each X column p{\TX@col@width}, \TX@col@width the width first and \TX@cols one more than the X columns the
 * preambles rewrite (\multicolumn's too); then \TX@arith until it stops, a trial after each step (X columns
 * \tabularxcolumn{\TX@col@width}); then tabular* to the width with those columns
 */
function tabularx(cx: Ctx, t: TabularSource, lines: TabLine[], size: SizeCommand, attrs: FontAttrs, sfcodes?: Record<number, number>, outer?: TabularOuter): BoxNode {
  const tx = cx.pre.tabularx
  if (!tx || !cx.run.k.array) throw new Unsupported("tabularx without \\usepackage{tabularx}")
  const font = selectFont(cx.run.k, size, attrs)
  let target: number
  try { target = parseDimen(t.width!, { em: font.params[QUAD], ex: font.params[X_HEIGHT], internal: widthRegisters(cx, outer?.lineWidth) }) } catch { throw new Unsupported(`a tabularx of width ${t.width}`) }
  const user = cx.pre.columnTypes
  /** the column types with X as `column` (#1 the width) */
  const types = (column: string, width: number): ColumnTypes => ({ ...user, X: { n: 0, spec: column.split("#1").join(`${width}sp`) } })
  /** a trial's \wd\@tempboxa */
  const trial = (column: string, width: number) => {
    const x = types(column, width)
    return tabular(cx, lines, preamble(t.spec, { types: x, si: !!cx.doc.siunitx }), size, t.pos, attrs, sfcodes, outer, undefined, x).width
  }
  let cols = 1 + xColumns(t.spec, user)
  for (const l of lines) if ("cells" in l) for (const c of l.cells) if ("span" in c) cols += xColumns(c.spec, user)
  let width = target, oldTable = MAX_DIMEN, oldCol = 0
  let wd = trial("p{#1}", width)
  for (;;) { // \TX@arith
    if (width > Math.trunc(MAX_DIMEN / cols)) wd = MAX_DIMEN
    if (oldTable === wd) { width = oldCol; break } // (reached the minimum width: back up)
    let d = wd - target
    if (d < TX_DELTA) break // (reached the target)
    if (cols > 1) cols--
    d = Math.trunc(d / cols) - width
    if (d > 0) { width = font.params[QUAD]; break } // (X columns too narrow: \TX@error@width, 1em)
    oldCol = width; oldTable = wd; width = -d
    wd = trial(tx.column, width)
  }
  const x = types(tx.column, width)
  return tabular(cx, lines, preamble(t.spec, { types: x, si: !!cx.doc.siunitx }), size, t.pos, attrs, sfcodes, outer, `${target}sp`, x)
}

/**
 * \begin{minipage}[pos]{width} number n where it stands (DocState.minipage): \setbox\@tempboxa\vbox{\hsize width
 * \@parboxrestore (\parindent and \parskip zero, \sloppy, the normal baselines) \@setminipage body \par\unskip},
 * then \@iiiparbox: \vbox{\unvbox\@tempboxa} as $\vcenter{…}\m@th$ for c, a \vtop for t, a \vbox for b
 */
export function minipageAt(cx: Ctx, n: number, size: SizeCommand, attrs: FontAttrs, sfcodes: Record<number, number> | undefined, outer: TabularOuter): Node[] {
  return parboxed(cx, cx.minipages[n], false, size, attrs, sfcodes, outer)
}

/**
 * \parbox[pos][height][inner]{width}{text} where it stands (DocState.parbox): \@iiiparbox as a minipage's, with
 * \vbox{\hsize width \@parboxrestore text\@@par} (no \unskip, and \textwidth stays the page's)
 */
export function parboxAt(cx: Ctx, p: { pos: string; height: string | null; inner: string; width: string; src: string }, size: SizeCommand, attrs: FontAttrs, sfcodes: Record<number, number> | undefined, outer: TabularOuter): Node[] {
  if (!/^[tbc]$/.test(p.pos) || !/^[tbcs]$/.test(p.inner)) throw new Unsupported(`\\parbox[${p.pos}]…[${p.inner}]`)
  return parboxed(cx, { pos: p.pos as "t", height: p.height, width: p.width, body: p.src, inner: p.inner as "t" }, true, size, attrs, sfcodes, outer)
}

/** a minipage's or a \parbox's box: its paragraphs in a \vbox of its width, then \@iiiparbox's \vbox, \vtop or \vcenter,
 *  to its height (the inner position's \vss around the list) when it has one */
function parboxed(cx: Ctx, m: MinipageSource, parbox: boolean, size: SizeCommand, attrs: FontAttrs, sfcodes: Record<number, number> | undefined, outer: TabularOuter): Node[] {
  const { amsmath, hyper } = cx.pre
  const { counters, doc, refs, romanFont, run } = cx
  if (m.sub && (!cx.pre.usesSubcaption || run.captype !== m.sub)) throw new Unsupported(`a sub${m.sub} ${run.captype ? `in a ${run.captype}` : "outside a float"}`)
  // subcaption's position: b, or t after the float's \caption (\caption@ifcaption)
  let f = run.floatCaption
  const pos = m.pos ?? (f.number !== null && !f.pending ? "t" : "b")
  const font = selectFont(run.k, size, attrs), sz = run.k.sizes[size]
  let hsize: number
  try { hsize = parseDimen(m.width, { em: font.params[QUAD], ex: font.params[X_HEIGHT], internal: widthRegisters(cx, outer.lineWidth) }) } catch { throw new Unsupported(`a minipage {${m.width}}`) }
  let body = m.body.replace(/(^|[^\\])%.*\n[ \t]*/g, "$1")
  // a leading \centering: \leftskip and \rightskip \@flushglue, \parfillskip zero, \finalhyphendemerits zero
  // \centering in vertical mode (first, or after a caption): \leftskip and \rightskip \@flushglue, \parfillskip zero,
  // \finalhyphendemerits zero, from there on
  // (\raggedright and \raggedleft likewise; under them \\ is \@centercr)
  let align: "centering" | "raggedright" | "raggedleft" | null = null
  const shape = () => (align === "centering" ? centeringShape() : align === "raggedright" ? raggedright() : align === "raggedleft" ? raggedleft() : { finalHyphenDemerits: outer.finalHyph })
  const what = parbox ? "a \\parbox" : "a minipage"
  const odd = body.match(/\\(?:footnote|begin|item|vspace|noindent|LXlstinline|pagebreak|nopagebreak)(?![A-Za-z])|(?<!\\)\\\[|\$\$/)
  if (odd) throw new Unsupported(`${odd[0]} in ${what}`)
  const list: Node[] = []
  let pd: number | null = IGNORE_DEPTH
  // (in it, \textwidth and \columnwidth are its \hsize, and so is \linewidth after \@parboxrestore)
  const outerWidth = run.minipageWidth, outerTop = f.top, outerKeys = f.keys, outerCaptype = run.captype, outerCaption = run.floatCaption
  if (!parbox) run.minipageWidth = hsize
  // caption.sty's lengths here: \linewidth (and \textwidth) the minipage's
  const dim = (v: string) => parseDimen(v, { em: font.params[QUAD], ex: font.params[X_HEIGHT], internal: widthRegisters(cx, hsize) })
  try {
  // (\captionsetup in it ends with its group; outside a float, it starts from the preamble's)
  if (!run.captype && cx.pre.caption) { run.floatCaption = f = { number: null, pending: false, sub: 0, top: null, subAbove: false, keys: cx.pre.caption.keys } }
  if (f.keys) f.keys = copyKeys(f.keys)
  // subcaption's \setcaptionsubtype: \caption@subtypehook (margin 0pt; list=false at the float sticks), the lists sub
  // and sub<type>, then \caption@setanchor (with hypcap, an anchor of its own)
  const listWas = f.keys?.list
  const stickList = () => { if (m.sub && listWas === false) f.keys!.list = false }
  if (m.sub && f.keys) {
    // \caption@subtypehook's \caption@stepcounter\@captype: the float's counter steps at its first sub-float, with a
    // caption or not, unless the float's caption came first (\caption@ifcounter); a sub-float after the caption and
    // one before it is ambiguous (caption's warning, its flags cleared: the counter steps again); then
    // \caption@setsubcaption's flag
    if (f.number === null || !f.pending && f.subAbove) { f.number = ++counters[m.sub]; f.pending = true; f.sub = 0 }
    if (f.pending) f.subAbove = true
    const k = f.keys
    k.left = 0; k.right = 0; k.width = 0
    if (runList(cx.pre.caption!, "sub", k, "sub", dim, m.sub).position || runList(cx.pre.caption!, `sub${m.sub}`, k, "sub", dim, m.sub).position) f.top = null
    stickList()
    if (k.hypcap && hyper) throw new Unsupported("a subcaption with hypcap")
  }
  const lines = (vl: Node[], bs = sz.baselineskip) => { for (const x of vl) { if (x.kind === "hlist") pd = appendToVlist(list, x, pd, bs, run.k.glue.lineskip, run.k.dimens.lineskiplimit); else list.push(x) } }
  // new_graf in internal vertical mode adds \parskip (zero here) only to a list that is not empty, and so does
  // LaTeX's restart of the paragraph
  const parskips = () => { if (list.length) list.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0))) }
  // \caption (\par first) and a \label right after it, in vertical mode; paragraphs between
  let cap: Captioned | null = null
  const capLines = (start: Node[], text: string, opts: ParagraphOptions, size: SizeCommand = "normalsize") => {
    const p = paragraphInput(text, run.k, size, doc, { start, hsize, amsmath, ...sloppy(romanFont.params[QUAD]), clubPenalty: outer.club, widowPenalty: outer.widow, finalHyphenDemerits: align ? 0 : outer.finalHyph, ...opts })
    const lb = lineBreak(p.list, p.params)
    outer.notes.push(...p.notes, lb.trace)
    return lb.vlist
  }
  let captionOf = false, prev = "" // (the text part before)
  const cleared = new Set<string>() // (\caption@setoptions clears the list it ran, in the group)
  for (let part of body.split(/(\\caption(?:\*)?\s*(?:\[[^\]]*\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\captionsetup\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\captionof\s*\{(?:figure|table)\}\s*(?:\[[^\]]*\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\label\s*\{[^{}]*\})/)) {
    const before = prev
    prev = part
    // \captionsetup{keys}: for the rest of the minipage
    const sm = part.match(/^\\captionsetup\s*\{([^]*)\}$/)
    if (sm) {
      if (!f.keys) throw new Unsupported("\\captionsetup without caption.sty")
      if (setCaptionKeys(f.keys, sm[1], m.sub ? "sub" : "float", dim, run.captype ?? undefined).position) f.top = null
      stickList()
      continue
    }
    // caption.sty's \captionof{type}: \setcaptiontype*{type} (\caption@settype, the type's list, no hypcap anchor), then \caption
    const om = part.match(/^\\captionof\s*\{(figure|table)\}([^]*)$/)
    if (om) {
      if (!cx.pre.caption || outerCaptype) throw new Unsupported(cx.pre.caption ? "\\captionof in a float" : "\\captionof without caption.sty")
      const type = om[1] as "figure" | "table"
      run.captype = type; captionOf = true
      run.floatCaption = f = { number: null, pending: false, sub: 0, top: null, subAbove: false, keys: f.keys }
      if (!cleared.has(type)) runList(cx.pre.caption, type, f.keys!, "list", dim, type)
      cleared.add(type)
      part = `\\caption${om[2]}`
    }
    const call = captionCall(part)
    if (call) {
      if (!run.captype) throw new Unsupported("\\caption in a minipage outside a float")
      // (float.sty after hyperref: \refstepcounter's anchor would go in the paragraph before it)
      if (hyper && cx.pre.algorithm.afterHyperref && !cx.pre.usesCaption && /\S[^\n]*(?:\n[ \t]*)?$/.test(before) && !/(?:\n[ \t]*\n|\\par)\s*$/.test(before)) throw new Unsupported("a minipage caption right after text, float.sty after hyperref")
      cap = caption(cx, run.captype, call, hsize, {
        push: (x) => list.push(x),
        box: (x) => { pd = appendToVlist(list, x, pd, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit) },
        // \@parboxrestore undoes \centering's skips (not its \finalhyphendemerits); its \sloppy comes before
        // \caption@normalsize: 3em in the minipage's font (the \parbox's own, after it: the normal font's)
        paragraph: (start, text) => { parskips(); lines(capLines(start, text, sloppy(font.params[QUAD])), run.k.sizes.normalsize.baselineskip) },
        prevDepth: () => pd,
        rule: () => { list.push({ kind: "rule", width: null, height: 0, depth: 0 }); pd = IGNORE_DEPTH },
        lines: (start, text, opts, size) => capLines(start, text, opts, size),
        last: () => list.at(-1),
      }, !!m.sub)
      continue
    }
    const lm = part.match(/^\\label\s*\{([A-Za-z0-9:._-]+)\}$/)
    if (lm) {
      if (!cap) throw new Unsupported("a \\label in a minipage")
      list.push(...(captionOf ? [] : captionXref(cx, true)), labelWrite(refs, lm[1], cap.label, refs.href, cx.pre.nameref ? cap.name : refs.name)) // nameref: the caption
      // subcaption's \label: \label{key}, then \label{sub@key} with \@currentlabel \thesub<type>; cleveref's write after
      // each, the same (\cref@currentlabel of \refstepcounter{sub<type>}, a counter within the float's)
      if (cap.sub !== undefined) {
        const type = run.captype!, cref = { type: `sub${type}`, arabic: f.sub, prefix: [counters.crefPrefix(type), String(cap.number)].filter(Boolean).join(","), label: cap.label }
        list.push(...crefWrites(refs, lm[1], false, cref), labelWrite(refs, `sub@${lm[1]}`, cap.sub, refs.href, cx.pre.nameref ? cap.name : refs.name), ...crefWrites(refs, `sub@${lm[1]}`, false, cref))
        continue
      }
      list.push(...crefWrites(refs, lm[1], false, { type: run.captype!, arabic: cap.number, prefix: counters.crefPrefix(run.captype!), label: cap.label }))
      continue
    }
    if (/^\\label/.test(part)) throw new Unsupported(`${part} in a minipage`)
    if (part.trim()) cap = null // (a \label after text is in a paragraph)
  for (let text of part.split(/\n[ \t]*\n|\\par(?![A-Za-z])/)) {
    for (let d; (d = text.match(/^\s*\\(centering|raggedright|raggedleft)(?![A-Za-z])\s*/)); text = text.slice(d[0].length)) align = d[1] as "centering"
    if (/\\(?:centering|raggedright|raggedleft)(?![A-Za-z])/.test(text)) throw new Unsupported(`\\centering or friends in ${what}'s paragraph`)
    // under \centering and friends \\ is \@centercr: \unskip\par, \nobreak for \\*, \addvspace{-\parskip} (\parskip is
    // zero here: a zero skip after the lines), \vskip for \\[skip]
    const crs = align ? centercrLines(text) : [{ text, star: false, skip: undefined as string | undefined, cr: false }]
    crs.forEach((ln, li) => {
      if (li > 0) {
        const prev = crs[li - 1]
        if (prev.star) list.push(penalty(10000))
        // \addvspace{-\parskip}: the larger of zero and \lastskip
        const last = list.at(-1), lastSkip = last?.kind === "glue" ? last : null
        if (!lastSkip || lastSkip.width === 0) list.push(glue(0))
        else if (lastSkip.width < 0) list.push(plain(negate(lastSkip)), glue(0))
        if (prev.skip !== undefined) { try { list.push(plain(parseGlue(prev.skip, { em: font.params[QUAD], ex: font.params[X_HEIGHT] }))) } catch { throw new Unsupported(`\\\\[${prev.skip}] in ${what}`) } }
      }
      if (!ln.text.trim()) { if (li === 0 && ln.cr) throw new Unsupported(`\\\\ first in ${what}`); return }
      parskips()
      let p: ReturnType<typeof paragraphInput>
      try {
        p = paragraphInput(ln.text, run.k, size, doc, { attrs, ...(sfcodes ? { sfcodes } : {}), hsize, start: [emptyBox("hlist", 0)], amsmath, ...sloppy(font.params[QUAD]), clubPenalty: outer.club, widowPenalty: outer.widow, noteWidowPenalty: outer.widow, ...shape(), ...(ln.cr ? { unskip: 1 } : {}) })
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`${what} paragraph "${ln.text.trim().slice(0, 40)}"`)
        throw e
      }
      const lb = lineBreak(p.list, p.params)
      outer.notes.push(...p.notes, lb.trace)
      lines(lb.vlist)
    })
  }
  }
  } finally { run.minipageWidth = outerWidth; run.captype = outerCaptype; run.floatCaption = outerCaption; outerCaption.top = outerTop; outerCaption.keys = outerKeys } // (the position a caption fixed in it ends with its group)
  if (!parbox && list.at(-1)?.kind === "glue") list.pop() // \unskip
  // \@parboxto: to the height, with \bm@<inner> as \vss and \unvbox (s: \unvbox alone)
  let to: PackSpec | undefined
  if (m.height !== null) {
    try { to = { exactly: parseDimen(m.height, { em: font.params[QUAD], ex: font.params[X_HEIGHT], internal: widthRegisters(cx, outer.lineWidth) }) } } catch { throw new Unsupported(`${what} of height ${m.height}`) }
    const inner = m.inner ?? pos
    if (inner === "c" || inner === "b") list.unshift(ssGlue())
    if (inner === "c" || inner === "t") list.push(ssGlue())
  }
  if (pos === "t") return [vtop(list, to)]
  const box = vpack(list, to)
  if (pos === "b") return [box]
  const delta = box.height + box.depth // \vcenter: make_vcenter (§ 736), about the axis
  box.height = mathEnv(run.k, size, amsmath).fonts[0][2]!.params[22] + (delta % 2 ? Math.trunc((delta + 1) / 2) : delta / 2)
  box.depth = delta - box.height
  return [{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }]
}

/** a tabular's \hbox at a size, its entries in the font `attrs` (tabular.ts) */
export function tabular(cx: Ctx, lines: TabLine[], cols: TabCol[], size: SizeCommand, pos: "t" | "b" | "c", attrs: FontAttrs = cx.normalAttrs, sfcodes?: Record<number, number>, outer?: TabularOuter, width?: string, types: ColumnTypes = cx.pre.columnTypes): BoxNode {
  const { amsmath } = cx.pre
  const { booktabs, doc, run } = cx
  const font = selectFont(run.k, size, attrs)
  const sz = run.k.sizes[size]
  const strutbox = run.k.sizes[size].strut, extra = run.k.array?.extrarowheight ?? 0
  const env: TabularEnv = {
    strut: { height: strutbox.height + extra, depth: strutbox.depth }, tabcolsep: run.k.dimens.tabcolsep, arrayrulewidth: run.k.dimens.arrayrulewidth, doublerulesep: run.k.dimens.doublerulesep,
    lineskiplimit: run.k.dimens.lineskiplimit, axis: mathEnv(run.k, size, amsmath).fonts[0][2]!.params[22],
    cell: (text, state) => {
      if (/\\(?:footnote|label)(?![A-Za-z])/.test(text)) throw new Unsupported(`a tabular entry "${text.trim().slice(0, 40)}"`)
      try { return hlistInput(text, run.k, size, doc, attrs, sfcodes ? Object.assign(state, { sfcodes }) : state, amsmath, undefined, true) } catch (e) {
        if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a tabular entry "${text.trim().slice(0, 40)}"`)
        throw e
      }
    },
    skip: (text) => { try { return parseGlue(text, { em: font.params[QUAD], ex: font.params[X_HEIGHT] }).width } catch { throw new Unsupported(`\\\\[${text}] in a tabular`) } },
    // (\fill: 0pt plus 1fill; \stretch{n}: 0pt plus nfill)
    glue: (text) => {
      const st = text.match(/^\s*\\stretch\s*\{([^{}]*)\}\s*$/)
      try { return parseGlue(st ? `0pt plus ${st[1]}fill` : text, { em: font.params[QUAD], ex: font.params[X_HEIGHT], internal: (name, s) => name === "fill" ? { level: "glue", value: { width: 0, stretch: 65536, stretchOrder: 2, shrink: 0, shrinkOrder: 0 } } : widthRegisters(cx, outer?.lineWidth)(name, s) }) } catch { throw new Unsupported(`\\extracolsep{${text}}`) }
    },
    // \vtop\bgroup \hsize width \@arrayparboxrestore (\parindent and \parskip zero, \leftskip and \rightskip zero,
    // \parfillskip \@flushglue, the normal \baselineskip, \lineskip and \lineskiplimit, \sloppy) \ignorespaces entry,
    // then \@finalstrut\@arstrutbox (\unskip, then \nobreak in a paragraph and \vskip-\baselineskip out of one, and
    // \vrule depth \dp\@arstrutbox) \par\egroup
    // array.sty's \@startpbox adds \everypar{\vrule height\ht\@arstrutbox width0pt}, and its \@finalstrut leaves out
    // the \vskip-\baselineskip when the box is empty
    pbox: (text, width, cr, array) => {
      if (!outer) throw new Unsupported("a p{width} column here")
      if (/\\(?:footnote|label|par|newline|linebreak|multirow)(?![A-Za-z])|\n\s*\n/.test(text)) throw new Unsupported(`a p{width} entry "${text.trim().slice(0, 40)}"`)
      let hsize: number
      try { hsize = parseDimen(width, { em: font.params[QUAD], ex: font.params[X_HEIGHT], internal: widthRegisters(cx, outer.lineWidth) }) } catch { throw new Unsupported(`p{${width}}`) }
      const list: Node[] = []
      const strut: Node = { kind: "rule", width: 0, height: 0, depth: sz.strut.depth }
      let end: Node[] = [...cr, penalty(10000), strut]
      // (an empty entry: the \vrule starts a paragraph after the \vskip, and new_graf and LaTeX's restart of it each
      // add \parskip, zero here)
      // (groups and font declarations alone start no paragraph)
      const blank = !text.replace(/\\(?:bfseries|mdseries|itshape|slshape|scshape|upshape|rmfamily|sffamily|ttfamily|normalfont)(?![A-Za-z])|[{}\s]/g, "")
      if (blank && !cr.length) {
        if (!array) list.push(glue(-sz.baselineskip.width), paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
        end = [strut]
      }
      const start: Node[] = [emptyBox("hlist", 0), ...(array ? [{ kind: "rule", width: 0, height: env.strut.height, depth: null } as Node] : [])]
      const shape = array?.shape === "centering" ? centeringShape() : array?.shape === "raggedright" ? raggedright() : array?.shape === "raggedleft" ? raggedleft() : { finalHyphenDemerits: outer.finalHyph }
      let p: ReturnType<typeof paragraphInput>
      try {
        p = paragraphInput(text, run.k, array?.size ?? size, doc, { attrs, ...(sfcodes ? { sfcodes } : {}), hsize, start, amsmath, groups: true, ...sloppy(font.params[QUAD]), clubPenalty: outer.club, widowPenalty: outer.widow, ...shape, unskip: 1, end })
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a p{width} entry "${text.trim().slice(0, 40)}"`)
        throw e
      }
      const lb = lineBreak(p.list, p.params)
      outer.notes.push(...p.notes, lb.trace)
      let pd: number | null = IGNORE_DEPTH
      for (const n of lb.vlist) {
        if (n.kind === "hlist") pd = appendToVlist(list, n, pd, array?.size ? run.k.sizes[array.size].baselineskip : sz.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit)
        else list.push(n)
      }
      return !array || array.kind === "p" ? vtop(list) : vpack(list)
    },
    ...(booktabs ? { booktabs } : {}),
    multirow: cx.pre.usesMultirow,
    ...(run.k.array ? { array: { types, strutbox, strutOf: (sz: SizeCommand) => run.k.sizes[sz].strut, si: !!doc.siunitx } } : {}),
    // an S entry's boxes: $…$ in them (\mathsurround zero), text as the entry's
    ...(doc.siunitx ? { si: (text: string, options: string, state: { spaceFactor: number }) => siTableCell(text, options, state, { ...siContext(run.k, size, font, doc.siunitx!), formula: (l) => [{ kind: "math", on: true, width: 0 }, ...mlistToHlist(l, mathEnv(run.k, size, amsmath), TEXT, false), { kind: "math", on: false, width: 0 }], cell: (src) => env.cell(src, state) }) } : {}),
  }
  // tabular*'s width: \setlength\dimen@{width} where it stands
  let to: number | undefined
  if (width !== undefined) {
    try { to = parseDimen(width, { em: font.params[QUAD], ex: font.params[X_HEIGHT], internal: widthRegisters(cx, outer?.lineWidth) }) } catch { throw new Unsupported(`a tabular* of width ${width}`) }
  }
  return tabularBox(lines, cols, env, pos, to)
}

/** \\ under \centering and friends (\@centercr): the text's lines, each with the * and [skip] of the \\ that ends it */
function centercrLines(text: string): { text: string; star: boolean; skip: string | undefined; cr: boolean }[] {
  const out: { text: string; star: boolean; skip: string | undefined; cr: boolean }[] = []
  let at = 0
  for (let i = 0; i < text.length; ) {
    if (text[i] === "{") { i = closingBrace(text, i) + 1; continue }
    if (text[i] === "$") { const j = text.indexOf("$", i + 1); if (j < 0) throw new Unsupported("an unbalanced $"); i = j + 1; continue }
    const cr = text.slice(i).match(/^\\\\(\*)?\s*(?:\[([^\]]*)\])?/)
    if (cr) { out.push({ text: text.slice(at, i), star: !!cr[1], skip: cr[2], cr: true }); i += cr[0].length; at = i; continue }
    i += text[i] === "\\" ? 2 : 1
  }
  out.push({ text: text.slice(at), star: false, skip: undefined, cr: false })
  return out
}

/** \textwidth, \columnwidth and \linewidth in a width (`lineWidth`: \linewidth where it stands) */
export function widthRegisters(cx: Ctx, lineWidth?: number) {
  const { run } = cx
  // (\fboxsep and \fboxrule: 3pt and .4pt in every class; e-TeX's \dimexpr)
  const internal = (name: string, s: Scanner): Internal | undefined => {
    const value = name === "textwidth" ? run.minipageWidth ?? run.k.dimens.textwidth : name === "columnwidth" ? run.minipageWidth ?? run.k.dimens.columnwidth : name === "linewidth" ? lineWidth
      : name === "fboxsep" ? 3 * 65536 : name === "fboxrule" ? 26214 : name === "dimexpr" ? dimexpr(s) : undefined
    return value === undefined ? undefined : { level: "dimen" as const, value }
  }
  return internal
}
