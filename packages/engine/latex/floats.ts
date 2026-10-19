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
import { labelName, spotAnchor } from "./hyperref"
import { colorPop, colorPush, setgroup, xcolor } from "./xcolor"
import { classParams, appendToVlist, crefWrites, labelWrite, paragraphInput } from "./paragraph"

/**
 * \caption{text} in a float of type `env` at \hsize `hsize`: \refstepcounter, the lof/lot line, then in a group
 * \@parboxrestore\normalsize\@makecaption: \vskip\abovecaptionskip, the caption centered in an \hbox to \hsize
 * or, wider than that, a paragraph, then \vskip\belowcaptionskip. Its number and nameref's name come back.
 */
export function caption(cx: Ctx, env: "figure" | "table", source: string, hsize: number, out: { push(n: Node): void; box(b: BoxNode): void; paragraph(start: Node[], text: string): void }): { number: number; name: string } {
  const { hyper } = cx.pre
  const { counters, refs, romanFont, run } = cx
  const text = source.replace(/\s+/g, " ").trim()
  if (/[\\{}$%&#^_~]/.test(text)) throw new Unsupported(`caption "${text}"`)
  const number = ++counters[env]
  refs.href = counters.href(env, number) // global; \@currentlabel ends with the float's group
  const ext = env === "figure" ? "lof" : "lot"
  out.push({ kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\contentsline {${env}}{\\protect \\numberline {${counters.the(number)}}{\\ignorespaces ${text}}}{\\thepage }{${hyper ? refs.href : ""}}\\protected@file@percent }}` })
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
  return { number, name: labelName(text) } // (nameref drops a final period)
}

export function floatBlock(cx: Ctx, b: Extract<Block, { kind: "float" }>) {
  if (b.inPar) throw new Unsupported("a float inside a paragraph")
  if (b.blank) cx.v.par() // (after \@doendpe, its \par resets \clubpenalty)
  const marker = floatMarker(cx, b)
  cx.v.nodes.push(marker)
  // placed here, the float ends \if@nobreak (\@addtocurcol's \nobreak\@nobreakfalse\everypar{});
  // elsewhere \nobreak alone, and the text after it is still right after the heading
  if ((marker.float as Float).here) cx.v.nobreak = false
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
  for (const c of b.fps ?? "tbp") { // \fps@figure and \fps@table are tbp
    if (c === "h") { if (fps % 2 === 0) fps++ }
    else if (c === "t" || c === "b" || c === "p") { const bit = c === "t" ? 2 : c === "b" ? 4 : 8; if (Math.floor(fps / bit) % 2 === 0) fps += bit }
    else if (c === "!") { if (fps > 15) fps -= 16 }
    else throw new Unsupported(`float option ${c}`)
  }
  const content: Node[] = []
  let pd: number | null = IGNORE_DEPTH, number = 0, captionName = ""
  const hsize = run.k.dimens.columnwidth
  const fbody = b.body.trim()
  const tokens = [...fbody.matchAll(/\\centering\b|\\caption\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\(?:label|vspace)\s*\{[^}]*\}|\\LXtabular\{\d+\}|\\LX(?:minipage|graphic)\{\d+\}|\S+/g)]
  const items = tokens.map((t) => t[0])
  let centered = false
  /** a paragraph in the float: \parindent is zero (\@parboxrestore), \sloppy (\tolerance 9999, \emergencystretch
   *  3em), and \centering's flush glue when it came before */
  const floatParagraph = (start: Node[], body: string, centering = centered) => {
    // \centering's \finalhyphendemerits=\z@ outlasts \@parboxrestore, which resets only the skips
    const shape = centering ? centeringShape() : centered ? { finalHyphenDemerits: 0 } : {}
    // (\clubpenalty is the one in force: \@parboxrestore leaves it, and \@setminipage's \everypar replaces \@afterheading's)
    const par = paragraphInput(body, run.k, "normalsize", doc, { ...shape, start, amsmath, ...sloppy(romanFont.params[QUAD]), clubPenalty: club })
    const lb = lineBreak(par.list, par.params)
    decisions.push(...par.notes, lb.trace)
    // new_graf in internal vertical mode adds \parskip (zero here) only to a list that is not empty, and
    // so does LaTeX's restart of the paragraph
    if (content.length) content.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
    for (const n of lb.vlist) {
      if (n.kind === "hlist") pd = appendToVlist(content, n, pd, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit)
      else content.push(n)
    }
  }
  run.captype = b.env
  // setspace's \@xfloat: \def\baselinestretch{\setspace@singlespace}\normalsize in the float
  const spaced = run.k
  run.k = singleSpaced(spaced)
  try {
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
      ({ number, name: captionName } = caption(cx, b.env, m[1], hsize, {
        push: (n) => content.push(n),
        box: (x) => { pd = appendToVlist(content, x, pd, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit) },
        paragraph: (start, text) => floatParagraph(start, text, false), // \@caption's \@parboxrestore undoes \centering
      }))
      continue
    }
    // \label after the caption: \protected@write\@auxout{}{\string\newlabel{key}{{n}{\thepage }{}{figure.n}{}}}
    m = it.match(/^\\label\s*\{([A-Za-z0-9:._-]+)\}$/)
    if (m && number) { // nameref: the caption
      content.push(labelWrite(refs, m[1], counters.the(number), refs.href, hyper ? captionName : refs.name), ...crefWrites(refs, m[1], false, { type: b.env, arabic: number, prefix: counters.crefPrefix(b.env), label: counters.the(number) }))
      continue
    }
    if (/^\\label\b/.test(it)) throw new Unsupported(m ? "\\label before the caption" : `${it} in a ${b.env}`)
    throw new Unsupported(`${it} in a ${b.env}`)
  }
  } finally { run.captype = null; run.k = spaced }
  content.push(glue(0)) // \@endfloatbox: \par\vskip\z@skip
  const box = vpack(xcolor.on ? [colorPush(), vpack(content), colorPop()] : [vpack(content)]) // \color@vbox\normalcolor\vbox{…}
  if (box.height > run.k.dimens.textheight) box.height = run.k.dimens.textheight // \@largefloatcheck
  const index = run.floats++
  // \ftype@figure 1, \ftype@table 2
  return { kind: "whatsit", text: "", float: { box, count: fps + 32 * (b.env === "figure" ? 1 : 2), nobreak: !b.inPar && v.nobreak, index, here: !notHere.has(index), ...(b.inPar ? { inPar: true } : {}) } satisfies Float }
}
