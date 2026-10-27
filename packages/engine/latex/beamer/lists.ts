// beamer's itemize, enumerate and description (beamerbaselocalstructure.sty) to the
// third level, with the default inner theme's templates (beamerinnerthemedefault.sty):
// the body's font (a nested list's \small, then \footnotesize) and color, then LaTeX's
// \list (latex.ltx \@trivlist, \@item, \endtrivlist) with beamer's \@listi, \@listii and
// \@listiii, each label in \makelabel's {\hss\llap{{\usebeamerfont*{… item}
// \usebeamercolor[fg]{… item}label}}}, and beamer's \item, which puts \kern0pt after
// LaTeX's. itemize's label is \raise1.25pt\hbox{$\blacktriangleright$} (msam; raised
// 1.5pt below the first level), enumerate's \insertenumlabel. (2.1 and 2.1.1 below),
// \item[label]'s the label. description's labels are \hfil\hspace\labelsep and the
// description item template, in a \labelwidth and \leftmargin of 2cm plus \labelsep
// (or the widest label's width plus it). An item's material is paragraphs and nested
// lists. Items may have overlay specifications.

import type { SizeCommand } from "../../layout/classdata"
import { parseDimen, type GlueSpec } from "../../layout/dimen"
import { SPACE, SPACE_SHRINK, SPACE_STRETCH, type Font } from "../../layout/font"
import { appendText } from "../../layout/hmode"
import { charNode, filGlue, glue, kern, penalty, ssGlue, type BoxNode, type Node } from "../../layout/nodes"
import { hpack } from "../../layout/pack"
import { pgfPoint } from "../../pgf/points"
import { pgfText, type PgfText } from "../../pgf/shapes"
import { pgfTransformScale, pgfTransformShift } from "../../pgf/transformations"
import { fontAt, selectFont } from "../paragraph"
import { Unsupported } from "../unsupported"
import { LOW_PENALTY, type VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { resetColor } from "./colorbox"
import { addParagraph, SANS, type FrameCtx } from "./frame"
import { coverBegin, coverEnd, inSpec, smuggle } from "./overlays"
import { fontSize, outerColors, useColor, type ColorState } from "./theme"

/** \blacktriangleright: amssymb's \DeclareMathSymbol{\blacktriangleright}{\mathrel}{AMSa}{"49} */
const BLACKTRIANGLERIGHT = 0x49

/** U/msa/m/n (umsa.fd) at a size: msam10 from 8pt (every beamer \normalsize; msam5 and msam7 below) */
function msam(size: number) {
  if (size < 8 * 65536) throw new Unsupported("msam below 8pt")
  return fontAt("msam10", size)
}

export type ListKind = "itemize" | "enumerate" | "description"
/** where a list begins */
export const LIST_BEGIN = /\\begin\{(?:itemize|enumerate|description)\}/

/** An item: its overlay specification (\item<spec>), its label (\item[label]) and its material */
export interface ItemSource { spec?: string; label?: string; text: string }

/** Where the \end{kind} that ends the environment begun before `from` is in `text` (-1: nowhere): \begin{kind}'s
 *  nested in it skipped */
export function envEnd(text: string, kind: string, from: number): number {
  const begin = `\\begin{${kind}}`, end = `\\end{${kind}}`
  let depth = 1
  for (let i = from; ;) {
    const b = text.indexOf(begin, i), e = text.indexOf(end, i)
    if (e < 0) return -1
    if (b >= 0 && b < e) { depth++; i = b + begin.length; continue }
    if (--depth === 0) return e
    i = e + end.length
  }
}

/** The items: the text after each \item (at the list's own level: not in braces or a nested environment), none
 *  before the first */
export function itemsOf(body: string): ItemSource[] {
  const texts: string[] = []
  let depth = 0, from = -1
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    const env = depth === 0 && c === "\\" ? body.slice(i).match(/^\\begin\{([A-Za-z]+)\}/) : null
    if (env) {
      const e = envEnd(body, env[1], i + env[0].length)
      if (e < 0) throw new Unsupported(`beamer: ${env[1]} not ended`)
      i = e + env[1].length + 5
    } else if (c === "\\" && depth === 0 && /^\\item(?![A-Za-z])/.test(body.slice(i, i + 6))) {
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
    // \item<spec>[label] or \item[label]<spec> (\@ifnextchar skips spaces)
    const item: ItemSource = { text: it }
    for (;;) {
      const s = item.text.match(/^\s*<([^<>]*)>/)
      if (s && item.spec === undefined) { item.spec = s[1]; item.text = item.text.slice(s[0].length); continue }
      const l = item.text.match(/^\s*\[([^\]]*)\]/)
      if (l && item.label === undefined) { item.label = l[1]; item.text = item.text.slice(l[0].length); continue }
      return item
    }
  })
}

/** The list a list is in (null at the frame's level): what the nested one starts from */
export interface ListLevel {
  /** \@listdepth, \@itemdepth and \@enumdepth */
  listDepth: number; itemDepth: number; enumDepth: number
  /** \c@enumi … of the enumerates it is in */
  enum: number[]
  /** \@totalleftmargin and \linewidth; \labelwidth, which beamer's \@list… leave as it is (description sets it) */
  totalLeftMargin: number; lineWidth: number; labelwidth: number
  /** \parskip (the list's \parsep) */
  parskip: GlueSpec
  /** the size and the fg color in force */
  size: SizeCommand; fg: string
}

/** The frame's level: no list, \textwidth wide, the frame's \parskip, \normalsize, normal text's fg */
export const frameLevel = (cx: FrameCtx): ListLevel => ({ listDepth: 0, itemDepth: 0, enumDepth: 0, enum: [], totalLeftMargin: 0, lineWidth: cx.k.dimens.textwidth, labelwidth: cx.k.dimens.labelwidth,
  parskip: cx.k.glue.parskip, size: "normalsize", fg: outerColors(cx.theme).fg })

const PREFIX = ["", "sub", "subsub"]

/**
 * A list in the frame's list `v`, in the list `outer` (null: at the frame's level). `inParagraph`: the list began right
 * after a paragraph's text, which took the body color's push (\@trivlist then ended the paragraph: \unskip\par). The
 * text after \end{…}, read next, comes with \@endpetrue. An item with an overlay specification (its own, or the
 * list's `defaultSpec`) is in an uncoverenv (overlays.ts): begun before \@item, ended at the next \item (after its
 * \par) or, for the last one, at \endtrivlist (in its paragraph unless a blank line ended that). `widest`: description's
 * [label], whose width sets \labelwidth.
 */
export function frameList(cx: FrameCtx, v: VerticalList, kind: ListKind, body: string, inParagraph: boolean, defaultSpec?: string, outer: ListLevel = frameLevel(cx), widest?: string) {
  const { k, theme } = cx
  const g = k.glue, d = k.dimens
  const listDepth = outer.listDepth + 1
  const itemDepth = outer.itemDepth + (kind === "description" ? 0 : 1)
  const enumDepth = outer.enumDepth + (kind === "enumerate" ? 1 : 0)
  if (listDepth > 3 || itemDepth > 3) throw new Unsupported("beamer: a list nested deeper than three")
  // (\@listi is the size's; only \normalsize's is in the data)
  if (listDepth === 1 && outer.size !== "normalsize") throw new Unsupported("beamer: a list in another size")
  const prefix = PREFIX[itemDepth - 1] ?? ""
  // \usebeamerfont and \usebeamercolor[fg]{itemize/enumerate … body} (or description body; "body begin" is empty)
  const bodyName = kind === "description" ? "description body" : `itemize/enumerate ${prefix}body`
  const size = fontSize(theme, k, bodyName, outer.size)
  const fg = useColor(theme, bodyName, { fg: outer.fg, bg: outerColors(theme).bg }).fg
  if (!inParagraph) v.nodes.push(colorPush(fg))
  // \list: \@listi…, then \@trivlist: \@topsepadd is \topsep plus \partopsep in vertical mode, \@topsep that plus the
  // outer \parskip, and \parskip becomes \parsep; beamer's \partopsep is zero
  const zero = (x: GlueSpec) => !x.width && !x.stretch && !x.shrink
  if (!zero(g[`list${listDepth}partopsep`])) throw new Unsupported("beamer: list skips with \\partopsep")
  const topsepadd = g[`list${listDepth}topsep`], parsep = g[`list${listDepth}parsep`], itemsep = g[`list${listDepth}itemsep`]
  const topsep = { ...topsepadd, width: topsepadd.width + outer.parskip.width, stretch: topsepadd.stretch + outer.parskip.stretch, shrink: topsepadd.shrink + outer.parskip.shrink }
  if (topsepadd.stretchOrder || topsepadd.shrinkOrder || outer.parskip.stretchOrder || outer.parskip.shrinkOrder) throw new Unsupported("beamer: list skips of infinite order")
  const labelsep = d.labelsep, itemindent = 0
  const font = selectFont(k, size, SANS)
  let leftmargin = d[`list${listDepth}leftmargin`], labelwidth = outer.labelwidth
  if (kind === "description") {
    // \beamer@descdefault: \beamer@descriptionwidth (2cm), or the widest label's width, plus \labelsep
    labelwidth = leftmargin = (widest === undefined ? parseDimen("2cm", { em: 0, ex: 0 }) : hpack(descriptionText(cx, widest, size)).width) + labelsep
  }
  const level: ListLevel = { listDepth, itemDepth, enumDepth, enum: outer.enum, totalLeftMargin: outer.totalLeftMargin + leftmargin, lineWidth: outer.lineWidth - leftmargin, labelwidth, parskip: parsep, size, fg }
  const items = itemsOf(body)
  /** the uncoverenv the item before is in: shown or covered (null: none) */
  let env: boolean | null = null
  let counter = 0
  items.forEach(({ spec, label, text }, n) => {
    if (env !== null) smuggle(v, coverEnd(env))
    const s = spec ?? defaultSpec
    env = s === undefined ? null : inSpec(cx.overlay, s)
    if (env !== null) smuggle(v, coverBegin(env))
    // \@item: the first opens the list (\addpenalty\@beginparpenalty\addvspace\@topsep; \addvspace{-\parskip} adds
    // nothing), the others \addpenalty\@itempenalty\addvspace\itemsep; then beamer's \kern0pt
    v.addpenalty(-LOW_PENALTY)
    v.addvspace(n === 0 ? topsep : itemsep)
    v.nodes.push(kern(0, true))
    // the label (\refstepcounter only without [label]): \makelabel's box (in \sbox: the color in force pushed), in
    // \hbox to\labelwidth unless it is wider
    if (kind === "enumerate" && label === undefined) counter++
    const made = kind === "description" ? [colorPush(fg), filGlue(), glue(labelsep), ...descriptionText(cx, label ?? "", size), colorPop()]
      : [colorPush(fg), ssGlue(), hpack([ssGlue(), ...itemLabel(cx, kind, level, label, counter), colorPop()], { exactly: 0 }), colorPop()]
    const box = hpack(made)
    const labels = hpack([glue(itemindent), glue(-labelwidth), glue(-labelsep), box.width > labelwidth ? box : hpack(made, { exactly: labelwidth }), glue(labelsep)])
    // the item's material: \everypar takes the indentation box off the first paragraph and puts \box\@labels
    // \penalty\z@ there; \parshape 1 \@totalleftmargin \linewidth
    const last = n === items.length - 1
    // (the last item's uncoverenv ends in its last paragraph, unless a blank line ended that)
    const closing = last && env !== null && !/\n[ \t]*\n\s*$/.test(text) ? coverEnd(env) : null
    if (env !== null && LIST_BEGIN.test(text)) throw new Unsupported("beamer: a nested list in an item with an overlay specification")
    itemMaterial(cx, v, text, { ...level, enum: kind === "enumerate" ? [...outer.enum, counter] : outer.enum }, [labels, penalty(0)], closing)
    if (last && env !== null && !closing) smuggle(v, coverEnd(env))
  })
  // \endtrivlist (a skip that ends the list redone without the list's \parskip), \@endparenv (\addpenalty
  // \@endparpenalty\addvspace\@topsepadd), then the environment's group ends: the body color's pop (beamer's
  // \reset@color: before the skip that ends the list)
  v.endtrivlist(parsep, outer.parskip, topsepadd)
  resetColor(v.nodes)
}

/** An item's paragraphs and nested lists: `start` begins the first paragraph (the labels), `closing` ends the last */
function itemMaterial(cx: FrameCtx, v: VerticalList, text: string, level: ListLevel, start: Node[], closing: Node[] | null) {
  const { k } = cx
  let first = true, endpe = false
  for (let rest = text.trim(); rest; rest = rest.trim()) {
    const blank = rest.search(/\n[ \t]*\n/), list = rest.search(LIST_BEGIN)
    if (list === 0 && !first && !endpe) {
      // a nested list in vertical mode (after a blank line)
      rest = nested(cx, v, rest, level, false)
      endpe = !/^[ \t]*\n[ \t]*\n/.test(rest)
      continue
    }
    if (list === 0) throw new Unsupported(first ? "beamer: a nested list right after \\item" : "beamer: a nested list right after a nested list")
    // a paragraph, up to a blank line or a nested list (which ends it after pushing its body color)
    const stop = list >= 0 && (blank < 0 || list < blank) ? list : blank
    const par = stop < 0 ? rest : rest.slice(0, stop)
    const ended = list >= 0 && stop === list
    let after = stop < 0 ? "" : rest.slice(stop)
    const end: Node[] = []
    let size = level.size
    if (ended) {
      const kind = after.match(/^\\begin\{([a-z]+)\}/)![1] as ListKind
      const inner = kind === "description" ? "description body" : `itemize/enumerate ${PREFIX[level.itemDepth] ?? ""}body`
      end.push(colorPush(useColor(cx.theme, inner, { fg: level.fg, bg: outerColors(cx.theme).bg }).fg))
      // (\par comes after the nested body's font: its \baselineskip sets the lines apart)
      size = fontSize(cx.theme, k, inner, level.size)
    }
    const isLast = !after.trim()
    if (isLast && closing) end.push(...closing)
    addParagraph(cx, v, par, { size: level.size, parShape: [[level.totalLeftMargin, level.lineWidth]],
      ...(first ? { indent: false, start } : endpe ? { indent: false } : {}), ...(end.length ? { end } : {}), ...(ended && /\s$/.test(par) ? { trailingSpace: true } : {}) },
      level.parskip, k.sizes[size].baselineskip)
    first = false; endpe = false
    if (ended) { after = nested(cx, v, after, level, true); endpe = !/^[ \t]*\n[ \t]*\n/.test(after) }
    rest = after
  }
  if (first) throw new Unsupported("beamer: an empty \\item")
}

/** The nested list at the start of `text`; returns the text after it */
function nested(cx: FrameCtx, v: VerticalList, text: string, level: ListLevel, inParagraph: boolean): string {
  const m = text.match(/^\\begin\{(itemize|enumerate|description)\}/)!
  const kind = m[1] as ListKind
  const { body, spec, widest, rest } = listSource(kind, text.slice(m[0].length))
  frameList(cx, v, kind, body, inParagraph, spec, level, widest)
  return rest
}

/** A list's options and body (after its \begin), and the text after its \end: [<spec>] (the items' default overlay
 *  specification, <*> giving none) for itemize and enumerate, [widest label] for description */
export function listSource(kind: ListKind, after: string): { body: string; spec?: string; widest?: string; rest: string } {
  let body = after, spec: string | undefined, widest: string | undefined
  const o = body.match(/^\s*\[\s*<([^<>]*)>\s*\]/)
  if (o) { if (kind === "description") throw new Unsupported("beamer: description's overlay specification"); if (o[1].trim() !== "*") spec = o[1]; body = body.slice(o[0].length) }
  else if (kind === "description") {
    const w = body.match(/^\s*\[([^\]]*)\]/)
    if (w) { widest = w[1]; body = body.slice(w[0].length) }
  }
  if (/^\s*[[<]/.test(body)) throw new Unsupported(`beamer: ${kind}'s options`)
  const stop = envEnd(body, kind, 0)
  if (stop < 0) throw new Unsupported(`beamer: ${kind} not ended`)
  return { body: body.slice(0, stop), spec, widest, rest: body.slice(stop + kind.length + 6) }
}

/** The label in \makelabel's \llap: the item's font (a size alone) and color, then the label: \item[label]'s text,
 *  itemize's triangle, enumerate's \insertenumlabel. (by \@enumdepth: 1., 1.2, 1.2.3) */
function itemLabel(cx: FrameCtx, kind: "itemize" | "enumerate", level: ListLevel, label: string | undefined, counter: number): Node[] {
  const { k, theme } = cx
  const name = `${kind} ${PREFIX[level.itemDepth - 1]}item`
  if (fontSize(theme, k, name, level.size) !== level.size) throw new Unsupported(`beamer: the ${name} font`)
  const font = selectFont(k, level.size, SANS)
  const at = useColor(theme, name, { fg: level.fg, bg: outerColors(theme).bg })
  const out: Node[] = [colorPush(at.fg)]
  if (label !== undefined) out.push(...plainText(label, font))
  else if (kind === "itemize" && theme.inner === "rounded") out.push(ball(cx, level, at))
  else if (kind === "itemize" && theme.inner === "default") out.push(...triangle(k.sizes[level.size].size, level.itemDepth === 1 ? "1.25pt" : "1.5pt"))
  else if (kind === "itemize") throw new Unsupported(`beamer: the ${theme.inner} inner theme's itemize items`)
  else if (theme.inner === "rounded") out.push(...ballNumber(cx, level, at, [...level.enum, counter]))
  else if (theme.inner !== "default") throw new Unsupported(`beamer: the ${theme.inner} inner theme's enumerate items`)
  else {
    const n = [...level.enum, counter]
    out.push(...plainText(level.enumDepth === 1 ? `${n[0]}.` : n.join("."), font))
  }
  return out
}

/** A label's text: no commands, braces or special characters */
function plainText(text: string, font: Font): Node[] {
  if (/[\\{}$&#^_~%]/.test(text)) throw new Unsupported(`beamer: commands in an item's label: ${text}`)
  const list: Node[] = []
  appendText(list, text.trim().replace(/\s+/g, " "), font, { spaceFactor: 1000 }, false)
  return list
}

/** \usebeamertemplate**{description item}: normal text's fg and description item's pushed, its font, the text */
function descriptionText(cx: FrameCtx, text: string, size: SizeCommand): Node[] {
  const { k, theme } = cx
  if (fontSize(theme, k, "description item", size) !== size) throw new Unsupported("beamer: the description item font")
  const outer = outerColors(theme)
  return [colorPush(outer.fg), colorPush(useColor(theme, "description item", outer).fg), ...plainText(text, selectFont(k, size, SANS)), colorPop(), colorPop()]
}

/**
 * The ball itemize items (beamerbaseauxtemplates.sty 366–368): \raise0.2pt\beamer@usesphere{item projected}{bigsphere}
 * (subitem projected and smallsphere below the first level), \beamer@usesphere{#1}{#2} being \hbox{\usebeamercolor{#1}
 * \normalsize\pgfuseshading{#2}}: the sphere in that color's bg on the bg in force (parent.bg), its size in the ex of
 * \normalsize's font
 */
function ball(cx: FrameCtx, level: ListLevel, at: ColorState): BoxNode {
  const projected = useColor(cx.theme, `${PREFIX[level.itemDepth - 1]}item projected`, at)
  const sphere = cx.pgf.shading(level.itemDepth === 1 ? "bigsphere" : "smallsphere", selectFont(cx.k, "normalsize", SANS), projected.bg, at.bg)
  return { ...hpack([sphere]), shift: -parseDimen("0.2pt", { em: 0, ex: 0 }) }
}

/**
 * The ball enumerate items (beamerbaseauxtemplates.sty 374–406), a template that begins with a space (in the item's
 * font): \begin{pgfpicture}{-1ex}{-0.65ex}{1ex}{1ex} \usebeamercolor{item projected} {\pgftransformscale{1.75}
 * \pgftext{\normalsize\pgfuseshading{bigsphere}}} {\pgftransformshift{\pgfpoint{0pt}{0.5pt}} \pgftext{\usebeamerfont*
 * {item projected}\color{fg}\insertenumlabel}} \end{pgfpicture}; below the first level the bounding box's bottom is
 * -0.55ex, the scale 1.4, the number (\insertsubenumlabel: the level's own counter) not shifted, and the subsubitem's
 * font subitem projected's. Each space between the picture's commands is a \glue 0.0 there (\nullfont's).
 */
function ballNumber(cx: FrameCtx, level: ListLevel, at: ColorState, n: number[]): Node[] {
  const { k, theme, pgf } = cx
  const { s, d } = pgf
  const depth = level.enumDepth
  const font = selectFont(k, level.size, SANS)
  const projected = useColor(theme, `${PREFIX[depth - 1]}item projected`, at)
  const textFont = selectFont(k, fontSize(theme, k, depth === 1 ? "item projected" : "subitem projected", level.size), SANS)
  const sphere = () => pgf.shading("bigsphere", selectFont(k, "normalsize", SANS), projected.bg, at.bg)
  const number: PgfText = { hlist: () => [colorPush(projected.fg), ...plainText(String(n[depth - 1]), textFont), colorPop()] }
  const space = glue(font.params[SPACE], font.params[SPACE_STRETCH], 0, font.params[SPACE_SHRINK], 0)
  return [space, ...pgf.picture(font, at.fg, ["-1ex", depth === 1 ? "-0.65ex" : "-0.55ex", "1ex", "1ex"], () => {
    s.space()
    s.space()
    s.begingroup()
    pgfTransformScale(s, depth === 1 ? "1.75" : "1.4")
    pgfText(s, d, { hlist: () => [sphere()] }, [], "")
    s.endgroup()
    s.space()
    if (depth === 1) {
      s.begingroup()
      pgfTransformShift(s, () => pgfPoint(s, "0pt", "0.5pt"))
      s.space()
      pgfText(s, d, number, [], "")
      s.endgroup()
      s.space()
    } else pgfText(s, d, number, [], "") // (the space after it skipped: \pgf@collectresetcolor's \pgfutil@ifnextchar)
    return 0
  })]
}

/** itemize item: \raise<raise>\hbox{$\blacktriangleright$} (\mathsurround zero) at the size */
function triangle(size: number, raise: string): Node[] {
  const f = msam(size)
  const c = f.chars.get(BLACKTRIANGLERIGHT)!
  if (c.italic) throw new Unsupported("an italic correction in \\blacktriangleright")
  const box = hpack([{ kind: "math", on: true, width: 0 }, charNode(f, BLACKTRIANGLERIGHT), { kind: "math", on: false, width: 0 }])
  box.shift = -parseDimen(raise, { em: 0, ex: 0 })
  return [box]
}

