// Boxes in text: a tabular (latex.ltx \@tabular, \@mkpream, \@array with \halign) and a minipage
// (\@iiiminipage, \@parboxrestore, \@iiiparbox) where they stand, and the width registers inside them.

import { type SizeCommand } from "../layout/classdata"
import { QUAD, X_HEIGHT } from "../layout/font"
import { parseDimen, parseGlue } from "../layout/dimen"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, glue, paramGlue, penalty, type BoxNode, type Node } from "../layout/nodes"
import { vpack } from "../layout/pack"
import type { Ctx } from "./context"
import { centering as centeringShape, raggedleft, raggedright, sloppy } from "./kernel"
import { caption, captionCall, captionXref, type Captioned } from "./floats"
import { copyKeys, runList, setCaptionKeys } from "./captionsetup"
import { Unsupported } from "./unsupported"
import { IGNORE_DEPTH } from "./vlist"
import { preamble, tabularBox, tabularLines, vtop, type TabCol, type TabLine, type TabularEnv } from "./tabular"
import { hlistInput, appendToVlist, crefWrites, labelWrite, mathEnv, paragraphInput, selectFont, siContext, type FontAttrs, type ParagraphOptions, type TabularOuter } from "./paragraph"
import { mlistToHlist, TEXT } from "../mathlayout/mlist"
import { siTableCell } from "./siunitx"

/** tabular number n where it stands in text (DocState.tabular) */
export function tabularAt(cx: Ctx, n: number, size: SizeCommand, attrs: FontAttrs, sfcodes?: Record<number, number>, outer?: TabularOuter): BoxNode {
  const { tabulars } = cx
  const t = tabulars[n]
  const lines = tabularLines(t.body), cols = preamble(t.spec, cx.run.k.array && { types: cx.pre.columnTypes, si: !!cx.doc.siunitx })
  return tabular(cx, lines, cols, size, t.pos, attrs, sfcodes, outer)
}

/**
 * \begin{minipage}[pos]{width} number n where it stands (DocState.minipage): \setbox\@tempboxa\vbox{\hsize width
 * \@parboxrestore (\parindent and \parskip zero, \sloppy, the normal baselines) \@setminipage body \par\unskip},
 * then \@iiiparbox: \vbox{\unvbox\@tempboxa} as $\vcenter{…}\m@th$ for c, a \vtop for t, a \vbox for b
 */
export function minipageAt(cx: Ctx, n: number, size: SizeCommand, attrs: FontAttrs, sfcodes: Record<number, number> | undefined, outer: TabularOuter): Node[] {
  const { amsmath, hyper } = cx.pre
  const { counters, doc, minipages, refs, romanFont, run } = cx
  const m = minipages[n]
  if (m.height !== null) throw new Unsupported("a minipage with a height")
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
  let centering = false
  const shape = () => (centering ? centeringShape() : { finalHyphenDemerits: outer.finalHyph })
  const odd = body.match(/\\(?:footnote|begin|item|raggedright|raggedleft|vspace|noindent|LXlstinline)(?![A-Za-z])|\\\[|\$\$/) ?? (/\\centering(?![A-Za-z])/.test(body) ? body.match(/\\\\/) : null)
  if (odd) throw new Unsupported(`${odd[0]} in a minipage`)
  const list: Node[] = []
  let pd: number | null = IGNORE_DEPTH
  // (in it, \textwidth and \columnwidth are its \hsize, and so is \linewidth after \@parboxrestore)
  const outerWidth = run.minipageWidth, outerTop = f.top, outerKeys = f.keys, outerCaptype = run.captype, outerCaption = run.floatCaption
  run.minipageWidth = hsize
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
    const k = f.keys
    k.left = 0; k.right = 0; k.width = 0
    if (runList(cx.pre.caption!, "sub", k, "sub", dim, m.sub).position || runList(cx.pre.caption!, `sub${m.sub}`, k, "sub", dim, m.sub).position) f.top = null
    stickList()
    if (k.hypcap && hyper) throw new Unsupported("a subcaption with hypcap")
  }
  const lines = (vl: Node[]) => { for (const x of vl) { if (x.kind === "hlist") pd = appendToVlist(list, x, pd, sz.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit); else list.push(x) } }
  // new_graf in internal vertical mode adds \parskip (zero here) only to a list that is not empty, and so does
  // LaTeX's restart of the paragraph
  const parskips = () => { if (list.length) list.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0))) }
  // \caption (\par first) and a \label right after it, in vertical mode; paragraphs between
  let cap: Captioned | null = null
  const capLines = (start: Node[], text: string, opts: ParagraphOptions, size: SizeCommand = "normalsize") => {
    const p = paragraphInput(text, run.k, size, doc, { start, hsize, amsmath, ...sloppy(romanFont.params[QUAD]), clubPenalty: outer.club, widowPenalty: outer.widow, finalHyphenDemerits: centering ? 0 : outer.finalHyph, ...opts })
    const lb = lineBreak(p.list, p.params)
    outer.notes.push(...p.notes, lb.trace)
    return lb.vlist
  }
  let captionOf = false
  const cleared = new Set<string>() // (\caption@setoptions clears the list it ran, in the group)
  for (let part of body.split(/(\\caption(?:\*)?\s*(?:\[[^\]]*\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\captionsetup\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\captionof\s*\{(?:figure|table)\}\s*(?:\[[^\]]*\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\label\s*\{[^{}]*\})/)) {
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
      // (\caption@normalsize's singlespacing: the caption and the paragraph around its \parbox single-spaced in the text)
      if (run.k.singleSizes && run.k.sizes !== run.k.singleSizes) throw new Unsupported("\\captionof with setspace")
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
      if (size !== "normalsize" || attrs.ser !== "m" || attrs.shape !== "n" || attrs.fam !== "cmr") throw new Unsupported("a minipage caption in another font")
      cap = caption(cx, run.captype, call, hsize, {
        push: (x) => list.push(x),
        box: (x) => { pd = appendToVlist(list, x, pd, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit) },
        // \@parboxrestore undoes \centering's skips (not its \finalhyphendemerits)
        paragraph: (start, text) => { parskips(); lines(capLines(start, text, {})) },
        prevDepth: () => pd,
        rule: () => { list.push({ kind: "rule", width: null, height: 0, depth: 0 }); pd = IGNORE_DEPTH },
        lines: (start, text, opts, size) => capLines(start, text, opts, size),
      }, !!m.sub)
      continue
    }
    const lm = part.match(/^\\label\s*\{([A-Za-z0-9:._-]+)\}$/)
    if (lm) {
      if (!cap) throw new Unsupported("a \\label in a minipage")
      list.push(...(captionOf ? [] : captionXref(cx, true)), labelWrite(refs, lm[1], cap.label, refs.href, cx.pre.nameref ? cap.name : refs.name)) // nameref: the caption
      // subcaption's \label: \label{key}, then \label{sub@key} with \@currentlabel \thesub<type>
      if (cap.sub !== undefined) {
        if (cx.pre.cleveref) throw new Unsupported("a subcaption's \\label with cleveref")
        list.push(labelWrite(refs, `sub@${lm[1]}`, cap.sub, refs.href, cx.pre.nameref ? cap.name : refs.name))
        continue
      }
      list.push(...crefWrites(refs, lm[1], false, { type: run.captype!, arabic: cap.number, prefix: counters.crefPrefix(run.captype!), label: cap.label }))
      continue
    }
    if (/^\\label/.test(part)) throw new Unsupported(`${part} in a minipage`)
    if (part.trim()) cap = null // (a \label after text is in a paragraph)
  for (let text of part.split(/\n[ \t]*\n|\\par(?![A-Za-z])/)) {
    if (/^\s*\\centering(?![A-Za-z])/.test(text)) { centering = true; text = text.replace(/^\s*\\centering\s*/, "") }
    if (/\\centering(?![A-Za-z])/.test(text)) throw new Unsupported("\\centering in a minipage's paragraph")
    if (!text.trim()) continue
    parskips()
    let p: ReturnType<typeof paragraphInput>
    try {
      p = paragraphInput(text, run.k, size, doc, { attrs, ...(sfcodes ? { sfcodes } : {}), hsize, start: [emptyBox("hlist", 0)], amsmath, ...sloppy(font.params[QUAD]), clubPenalty: outer.club, widowPenalty: outer.widow, noteWidowPenalty: outer.widow, ...shape() })
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a minipage paragraph "${text.trim().slice(0, 40)}"`)
      throw e
    }
    const lb = lineBreak(p.list, p.params)
    outer.notes.push(...p.notes, lb.trace)
    lines(lb.vlist)
  }
  }
  } finally { run.minipageWidth = outerWidth; run.captype = outerCaptype; run.floatCaption = outerCaption; outerCaption.top = outerTop; outerCaption.keys = outerKeys } // (the position a caption fixed in it ends with its group)
  if (list.at(-1)?.kind === "glue") list.pop() // \unskip
  if (pos === "t") return [vtop(list)]
  const box = vpack(list)
  if (pos === "b") return [box]
  const delta = box.height + box.depth // \vcenter: make_vcenter (§ 736), about the axis
  box.height = mathEnv(run.k, size, amsmath).fonts[0][2]!.params[22] + (delta % 2 ? Math.trunc((delta + 1) / 2) : delta / 2)
  box.depth = delta - box.height
  return [{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }]
}

/** a tabular's \hbox at a size, its entries in the font `attrs` (tabular.ts) */
export function tabular(cx: Ctx, lines: TabLine[], cols: TabCol[], size: SizeCommand, pos: "t" | "b" | "c", attrs: FontAttrs = cx.normalAttrs, sfcodes?: Record<number, number>, outer?: TabularOuter): BoxNode {
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
    ...(run.k.array ? { array: { types: cx.pre.columnTypes, strutbox, strutOf: (sz: SizeCommand) => run.k.sizes[sz].strut, si: !!doc.siunitx } } : {}),
    // an S entry's boxes: $…$ in them (\mathsurround zero), text as the entry's
    ...(doc.siunitx ? { si: (text: string, options: string, state: { spaceFactor: number }) => siTableCell(text, options, state, { ...siContext(run.k, size, font, doc.siunitx!), formula: (l) => [{ kind: "math", on: true, width: 0 }, ...mlistToHlist(l, mathEnv(run.k, size, amsmath), TEXT, false), { kind: "math", on: false, width: 0 }], cell: (src) => env.cell(src, state) }) } : {}),
  }
  return tabularBox(lines, cols, env, pos)
}

/** \textwidth, \columnwidth and \linewidth in a width (`lineWidth`: \linewidth where it stands) */
export function widthRegisters(cx: Ctx, lineWidth?: number) {
  const { run } = cx
  return (name: string) => {
    const value = name === "textwidth" ? run.minipageWidth ?? run.k.dimens.textwidth : name === "columnwidth" ? run.minipageWidth ?? run.k.dimens.columnwidth : name === "linewidth" ? lineWidth : undefined
    return value === undefined ? undefined : { level: "dimen" as const, value }
  }
}
