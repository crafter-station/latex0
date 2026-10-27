// beamer's itemize and enumerate (beamerbaselocalstructure.sty) at the first list
// level, with the default inner theme's templates (beamerinnerthemedefault.sty):
// the body's color pushed, then LaTeX's \list (latex.ltx \@trivlist, \@item,
// \endtrivlist) with beamer's \@listi, each label in \makelabel's
// {\hss\llap{{\usebeamerfont*{… item}\usebeamercolor[fg]{… item}label}}}, and
// beamer's \item, which puts \kern0pt after LaTeX's. itemize's label is
// \raise1.25pt\hbox{$\blacktriangleright$} (msam), enumerate's \insertenumlabel.
// (arabic). Items may have overlay specifications. Nested lists and \item[…] throw
// Unsupported.

import { parseDimen, type GlueSpec } from "../../layout/dimen"
import type { Font } from "../../layout/font"
import { appendText } from "../../layout/hmode"
import { charNode, glue, kern, penalty, ssGlue, type Node } from "../../layout/nodes"
import { hpack } from "../../layout/pack"
import { fontAt, selectFont } from "../paragraph"
import { Unsupported } from "../unsupported"
import { LOW_PENALTY, type VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { resetColor } from "./colorbox"
import { SANS, setParagraph, type FrameCtx } from "./frame"
import { coverBegin, coverEnd, inSpec, smuggle } from "./overlays"
import { outerColors, useColor } from "./theme"

/** \blacktriangleright: amssymb's \DeclareMathSymbol{\blacktriangleright}{\mathrel}{AMSa}{"49} */
const BLACKTRIANGLERIGHT = 0x49

/** U/msa/m/n (umsa.fd) at a size: msam10 from 8pt (every beamer \normalsize; msam5 and msam7 below) */
function msam(size: number) {
  if (size < 8 * 65536) throw new Unsupported("msam below 8pt")
  return fontAt("msam10", size)
}

/** An item: its overlay specification (\item<spec>) and its text */
export interface ItemSource { spec?: string; text: string }

/** The items: the text after each \item (at the list's own level), none before the first */
export function itemsOf(body: string): ItemSource[] {
  const texts: string[] = []
  let depth = 0, from = -1
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === "\\" && depth === 0 && /^\\item(?![A-Za-z])/.test(body.slice(i, i + 6))) {
      if (from < 0) { if (body.slice(0, i).trim()) throw new Unsupported("beamer: material before a list's first \\item") }
      else texts.push(body.slice(from, i))
      from = i + 5
      i += 4
    } else if (c === "\\") i++
    else if (c === "{") depth++
    else if (c === "}") depth--
  }
  if (from < 0) throw new Unsupported("beamer: a list without \\item")
  texts.push(body.slice(from))
  return texts.map((it) => {
    if (/\\begin\{(itemize|enumerate|description)\}/.test(it)) throw new Unsupported("beamer: a nested list")
    // \item<spec> (\@ifnextchar< skips spaces)
    const m = it.match(/^\s*<([^<>]*)>/)
    const item: ItemSource = m ? { spec: m[1], text: it.slice(m[0].length) } : { text: it }
    if (/^\s*\[/.test(item.text)) throw new Unsupported("beamer: \\item with an optional label")
    return item
  })
}

/**
 * itemize or enumerate in the frame (the first level): `v` is the frame's list. `inParagraph`: the list began right
 * after a paragraph's text, which took the body color's push (\@trivlist then ended the paragraph). The frame's text
 * after \end{…}, read next, comes with \@endpetrue. An item with an overlay specification (its own, or the list's
 * `defaultSpec`) is in an uncoverenv (overlays.ts): begun before \@item, ended at the next \item (after its \par)
 * or, for the last one, at \endtrivlist (in its paragraph unless a blank line ended that).
 */
export function frameList(cx: FrameCtx, v: VerticalList, kind: "itemize" | "enumerate", body: string, inParagraph: boolean, defaultSpec?: string) {
  const { k, theme } = cx
  const outer = outerColors(theme)
  // \usebeamerfont and \usebeamercolor[fg]{itemize/enumerate body} (the template "body begin" is empty)
  const bodyColor = useColor(theme, "itemize/enumerate body", outer)
  if (!inParagraph) v.nodes.push(colorPush(bodyColor.fg))
  // \list: \@listi, then \@trivlist: \@topsepadd is \topsep plus \partopsep in vertical mode, \@topsep that plus the
  // outer \parskip, and \parskip becomes \parsep; beamer's \partopsep, \parskip and first-level \parsep are all zero
  const g = k.glue, d = k.dimens
  const zero = (x: GlueSpec) => !x.width && !x.stretch && !x.shrink
  if (!zero(g.list1partopsep) || !zero(g.parskip) || !zero(g.list1parsep)) throw new Unsupported("beamer: list skips with \\partopsep, \\parskip or \\parsep")
  const topsep = g.list1topsep, parsep = g.list1parsep
  const leftmargin = d.list1leftmargin, labelwidth = d.list1labelwidth, labelsep = d.labelsep, itemindent = 0
  const lineWidth = d.textwidth - leftmargin
  const font = selectFont(k, "normalsize", SANS)
  const itemColor = useColor(theme, `${kind} item`, bodyColor).fg
  const items = itemsOf(body)
  /** the uncoverenv the item before is in: shown or covered (null: none) */
  let env: boolean | null = null
  items.forEach(({ spec, text }, n) => {
    if (env !== null) smuggle(v, coverEnd(env))
    const s = spec ?? defaultSpec
    env = s === undefined ? null : inSpec(cx.overlay, s)
    if (env !== null) smuggle(v, coverBegin(env))
    // \@item: the first opens the list (\addpenalty\@beginparpenalty\addvspace\@topsep; \addvspace{-\parskip} adds
    // nothing), the others \addpenalty\@itempenalty\addvspace\itemsep; then beamer's \kern0pt
    if (n === 0) { v.addpenalty(-LOW_PENALTY); v.addvspace(topsep) }
    else { v.addpenalty(-LOW_PENALTY); v.addvspace(g.list1itemsep) }
    v.nodes.push(kern(0, true))
    // the label: \makelabel's box (in \sbox: the color in force pushed), \hbox to\labelwidth (it is no wider)
    const label = kind === "itemize" ? triangle(k.sizes.normalsize.size) : enumLabel(font, n + 1)
    const made: Node[] = [colorPush(bodyColor.fg), ssGlue(), hpack([ssGlue(), colorPush(itemColor), ...label, colorPop()], { exactly: 0 }), colorPop()]
    const labels = hpack([glue(itemindent), glue(-labelwidth), glue(-labelsep), hpack(made, { exactly: labelwidth }), glue(labelsep)])
    // \everypar: the indentation box taken off, \box\@labels\penalty\z@; \parshape 1 \@totalleftmargin \linewidth
    const pars = text.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean)
    if (!pars.length) throw new Unsupported("beamer: an empty \\item")
    // (the last item's uncoverenv ends in its last paragraph, unless a blank line ended that)
    const closing = n === items.length - 1 && env !== null && !/\n[ \t]*\n\s*$/.test(text) ? coverEnd(env) : null
    pars.forEach((p, i) => {
      const end = closing && i === pars.length - 1 ? { end: closing } : {}
      const lines = setParagraph(cx, p, { parShape: [[leftmargin, lineWidth]], ...(i === 0 ? { indent: false, start: [labels, penalty(0)] } : {}), ...end })
      v.paragraph(lines, parsep)
    })
    if (n === items.length - 1 && env !== null && !closing) smuggle(v, coverEnd(env))
  })
  // \endtrivlist: \@endparenv (\addpenalty\@endparpenalty\addvspace\@topsepadd), then the environment's group ends:
  // the body color's pop (beamer's \reset@color: before the skip that ends the list)
  v.addpenalty(-LOW_PENALTY)
  v.addvspace(topsep)
  resetColor(v.nodes)
}

/** itemize item: \raise1.25pt\hbox{$\blacktriangleright$} (\mathsurround zero) at the size */
function triangle(size: number): Node[] {
  const f = msam(size)
  const c = f.chars.get(BLACKTRIANGLERIGHT)!
  if (c.italic) throw new Unsupported("an italic correction in \\blacktriangleright")
  const box = hpack([{ kind: "math", on: true, width: 0 }, charNode(f, BLACKTRIANGLERIGHT), { kind: "math", on: false, width: 0 }])
  box.shift = -parseDimen("1.25pt", { em: 0, ex: 0 })
  return [box]
}

/** enumerate item: \insertenumlabel. (\arabic{enumi}) in the text font */
function enumLabel(font: Font, n: number): Node[] {
  const list: Node[] = []
  appendText(list, `${n}.`, font, { spaceFactor: 1000 }, false)
  return list
}
