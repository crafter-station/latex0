// beamer's blocks (beamerbaselocalstructure.sty) with the default inner theme's
// templates (beamerinnerthemedefault.sty), rectangular: block, alertblock and
// exampleblock, and the theorem-like environments and proof beamerbasetheorems.sty
// makes blocks of. Each is an actionenv (overlays.ts: an uncoverenv, shown with <*>);
// its "begin" template is \par\vskip\medskipamount, then the title in a beamercolorbox
// [colsep*=.75ex]{block title …} in its font, \noframebreak, where both the title and
// the body have a bg \nointerlineskip\vskip-0.5pt, then the body in a beamercolorbox
// [colsep*=.75ex,vmode]{block body …} that begins with \vskip-.25ex (-.75ex with a bg)
// and \vbox{}; its "end" template ends that box and puts \vskip\smallskipamount.

import type { SizeCommand } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT, type Font } from "../../layout/font"
import { emptyBox, fillGlue, filGlue, glue, penalty, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import { DISPLAY } from "../blocks"
import type { FontAttrs } from "../paragraph"
import { selectFont } from "../paragraph"
import { Unsupported } from "../unsupported"
import { dimen, plain, type VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { beamercolorbox, boxParagraph, colorboxOptions, lengthEnv } from "./colorbox"
import { addParagraph, bracedArg, SANS, setParagraph, type FrameCtx } from "./frame"
import { coverBegin, coverEnd, inSpec, overlayText, smuggle } from "./overlays"
import { roundedBox } from "./rounded"
import { emptyBackground, fontSize, outerColors, useColor } from "./theme"

/** the three kinds of block: their beamer colors and fonts are "block title", "block title alerted", … */
type BlockKind = "" | " alerted" | " example"
const BLOCK_ENVS: Record<string, BlockKind> = { block: "", alertblock: " alerted", exampleblock: " example" }

/** beamerbasetheorems.sty's \newtheorem's: the name (\translate'd, in English), the style (\theoremstyle): plain sets the
 *  body in \itshape, definition in \normalfont, beamer's example in \normalfont in an exampleblock */
const THEOREMS: Record<string, { name: string; style: "plain" | "definition" | "example" }> = {
  theorem: { name: "Theorem", style: "plain" }, corollary: { name: "Corollary", style: "plain" }, fact: { name: "Fact", style: "plain" },
  lemma: { name: "Lemma", style: "plain" }, problem: { name: "Problem", style: "plain" }, solution: { name: "Solution", style: "plain" },
  definition: { name: "Definition", style: "definition" }, definitions: { name: "Definitions", style: "definition" },
  example: { name: "Example", style: "example" }, examples: { name: "Examples", style: "example" },
}

/** the environments this file reads */
export const BLOCK_NAMES = [...Object.keys(BLOCK_ENVS), ...Object.keys(THEOREMS), "proof"]
/** where one, or columns (columns.ts, an actionenv too), begins in a frame's text */
export const BLOCK_BEGIN = new RegExp(`\\\\begin\\{(?:${[...BLOCK_NAMES, "columns"].join("|")})\\}`)

/** A block as written: its kind, overlay specification, title, body font, body and the text after its \end */
interface BlockSource { env: string; kind: BlockKind; spec?: string; title: string; italic: boolean; qed: boolean; body: string; rest: string }

/** The environment at the start of `text`, read */
function readBlock(text: string): BlockSource {
  const env = text.match(/^\\begin\{([A-Za-z]+)\}/)![1]
  let i = env.length + 8
  const end = `\\end{${env}}`
  // \newenvironment<>: the overlay specification before the arguments
  let spec: string | undefined
  const s = text.slice(i).match(/^\s*<([^<>]*)>/)
  if (s) { spec = s[1]; i += s[0].length }
  let kind: BlockKind, title: string, italic = false, qed = false
  if (env in BLOCK_ENVS) {
    kind = BLOCK_ENVS[env]
    const a = bracedArg(text, i)
    if (!a) throw new Unsupported(`beamer: ${env} without its title`)
    title = a.arg; i = a.end
  } else if (env === "proof") {
    // \begin{proof}[name]: \insertproofname is the name with \@addpunct{.} (none after one there)
    kind = ""
    const o = text.slice(i).match(/^\s*\[([^\]]*)\]/)
    let name = "Proof"
    if (o) { name = o[1].trim(); i += o[0].length }
    if (/[\\{}]/.test(name)) throw new Unsupported(`beamer: a proof's name ${name}`)
    title = /[.?!]$/.test(name) ? name : `${name}.`
    qed = true
  } else {
    const t = THEOREMS[env]
    kind = t.style === "example" ? " example" : ""
    italic = t.style === "plain"
    // \begin{theorem}[addition]: "Theorem (addition)"
    const o = text.slice(i).match(/^\s*\[([^\]]*)\]/)
    title = t.name
    if (o) { if (o[1].trim()) title += `\\ (${o[1]})`; i += o[0].length }
  }
  if (/^\s*</.test(text.slice(i))) throw new Unsupported(`beamer: ${env}'s overlay specification after its arguments`)
  const stop = text.indexOf(end, i)
  if (stop < 0) throw new Unsupported(`beamer: ${env} not ended`)
  const body = text.slice(i, stop)
  // (displays are read with the paragraph they are in)
  if (/\\begin\{/.test(body.replace(new RegExp(DISPLAY.source, "g"), ""))) throw new Unsupported(`beamer: an environment in a ${env}`)
  return { env, kind, spec, title, italic, qed, body, rest: text.slice(stop + end.length) }
}

/** actionenv's begin: the uncoverenv the block is in (<*>: shown); the specials it smuggles */
function begin(cx: FrameCtx, b: BlockSource): { shown: boolean; nodes: Node[] } {
  const shown = b.spec === undefined ? true : inSpec(cx.overlay, b.spec)
  return { shown, nodes: coverBegin(shown) }
}

/**
 * A block whose \begin ends the paragraph in `text` (block, alertblock and exampleblock: actionenv begins in that
 * paragraph, its specials smuggled past the space that ends it, which \par then takes): the specials, for the
 * paragraph's end, and what the block's handler then knows. Theorems and proofs end the paragraph (\unskip\par)
 * before theirs: none.
 */
export function blockInParagraph(cx: FrameCtx, text: string): Node[] {
  if (text.startsWith("\\begin{columns}")) { cx.blockBegun = true; return coverBegin(true) }
  const b = readBlock(text)
  if (!(b.env in BLOCK_ENVS)) return []
  const { shown, nodes } = begin(cx, b)
  cx.blockBegun = shown
  return nodes
}

/** The block at the start of `text` in the frame's list `v`; returns the text after it */
export function frameBlock(cx: FrameCtx, v: VerticalList, text: string): string {
  const b = readBlock(text)
  const { k, theme } = cx
  let shown: boolean
  if (cx.blockBegun !== undefined) { shown = cx.blockBegun; cx.blockBegun = undefined }
  else { const o = begin(cx, b); shown = o.shown; smuggle(v, o.nodes) }
  cx.endpe = false
  const at = outerColors(theme)
  const normal = selectFont(k, "normalsize", SANS)
  const env = lengthEnv(k, normal.params[QUAD], normal.params[X_HEIGHT])
  const bs = k.sizes.normalsize.baselineskip
  const colseps = (f: Font) => parseDimen(".75ex", { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
  // \par\vskip\medskipamount
  v.vskip(k.glue.medskipamount)
  if (theme.inner === "rounded") { roundedBlock(cx, v, b, normal); smuggle(v, coverEnd(shown)); return b.rest }
  // the title: \usebeamerfont*{block title …}\insertblocktitle after \leavevmode; the box's \vskip colsep* at its end
  // is .75ex in that font
  const titleName = `block title${b.kind}`, bodyName = `block body${b.kind}`
  const titleSize = fontSize(theme, k, titleName, "normalsize")
  const titleFont = selectFont(k, titleSize, SANS)
  const titleOptions = { ...colorboxOptions("colsep*=.75ex", k, env), colsepsEnd: colseps(titleFont) }
  v.box(beamercolorbox(k, theme, titleName, titleOptions, at, (box) => {
    boxParagraph(box.v, setParagraph(cx, overlayText(cx.overlay, b.title, cx.smuggled), { size: titleSize, hsize: box.hsize, leftskip: box.leftskip, rightskip: box.rightskip, sloppy: normal.params[QUAD] }), k.sizes[titleSize].baselineskip)
  }), bs)
  v.nodes.push(penalty(10000)) // \noframebreak
  const titleBg = !emptyBackground(theme, titleName), bodyBg = !emptyBackground(theme, bodyName)
  if (titleBg && bodyBg) { v.prevDepth = null; v.vskip(dimen(-parseDimen("0.5pt", env))) }
  // the body: \usebeamerfont{block body …}, the theorem's \itshape
  const bodySize = fontSize(theme, k, bodyName, "normalsize")
  const attrs: FontAttrs = b.italic ? { ...SANS, shape: "it" } : SANS
  const bodyFont = selectFont(k, bodySize, attrs)
  const bodyOptions = { ...colorboxOptions("colsep*=.75ex", k, env), colsepsEnd: colseps(bodyFont) }
  const pars = b.body.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean)
  if (!pars.length) throw new Unsupported(`beamer: an empty ${b.env}`)
  if (b.qed && /\n[ \t]*\n\s*$/.test(b.body)) throw new Unsupported("beamer: a proof whose qed symbol starts a paragraph")
  v.box(beamercolorbox(k, theme, bodyName, bodyOptions, at, (box) => {
    box.v.vskip(dimen(-parseDimen(bodyBg ? ".75ex" : ".25ex", { em: bodyFont.params[QUAD], ex: bodyFont.params[X_HEIGHT] })))
    box.v.box(emptyBox("vlist"), k.sizes[bodySize].baselineskip)
    pars.forEach((p, n) => {
      const end = b.qed && n === pars.length - 1 ? { end: qed(cx, bodySize, attrs) } : {}
      // (\par in the box: its list is not empty, so new_graf adds \parskip, zero there)
      addParagraph(cx, box.v, overlayText(cx.overlay, p, cx.smuggled), { size: bodySize, attrs, hsize: box.hsize, leftskip: box.leftskip, rightskip: box.rightskip, sloppy: normal.params[QUAD], ...end }, dimen(0))
    })
  }), bs)
  // \vskip\smallskipamount, then actionenv's end: its specials before that skip
  v.vskip(k.glue.smallskipamount)
  smuggle(v, coverEnd(shown))
  return b.rest
}

/**
 * The rounded inner theme's block (beamerbaseauxtemplates.sty 765–796): \begin{beamerboxesrounded}[upper=block title …,
 * lower=block body …]{\raggedright\usebeamerfont*{block title …}\insertblocktitle}\raggedright\usebeamerfont{block
 * body …}, the body, \end{beamerboxesrounded}\vskip\smallskipamount (rounded.ts); in the minipages \@parboxrestore's
 * \sloppy and beamer's \raggedright
 */
function roundedBlock(cx: FrameCtx, v: VerticalList, b: BlockSource, normal: Font) {
  const { k, theme } = cx
  const titleName = `block title${b.kind}`, bodyName = `block body${b.kind}`
  const titleSize = fontSize(theme, k, titleName, "normalsize"), bodySize = fontSize(theme, k, bodyName, "normalsize")
  const attrs: FontAttrs = b.italic ? { ...SANS, shape: "it" } : SANS
  const par = { hsize: k.dimens.textwidth, leftskip: dimen(0), rightskip: { ...dimen(0), stretch: 65536, stretchOrder: 1 as const }, sloppy: normal.params[QUAD] }
  const pars = b.body.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean)
  if (!pars.length) throw new Unsupported(`beamer: an empty ${b.env}`)
  if (b.qed && /\n[ \t]*\n\s*$/.test(b.body)) throw new Unsupported("beamer: a proof whose qed symbol starts a paragraph")
  v.box(roundedBox(cx, outerColors(theme), normal, {
    upper: titleName, lower: bodyName, width: k.dimens.textwidth,
    // (an empty title begins no paragraph: the head is empty)
    head: b.title.trim() === "" ? null : (hv) => boxParagraph(hv, setParagraph(cx, overlayText(cx.overlay, b.title, cx.smuggled), { ...par, size: titleSize }), k.sizes[titleSize].baselineskip),
    body: (bv) => pars.forEach((p, n) => {
      const end = b.qed && n === pars.length - 1 ? { end: qed(cx, bodySize, attrs) } : {}
      addParagraph(cx, bv, overlayText(cx.overlay, p, cx.smuggled), { ...par, size: bodySize, attrs, ...end }, dimen(0))
    }),
  }), k.sizes.normalsize.baselineskip)
  v.vskip(k.glue.smallskipamount)
}

/**
 * proof's \popQED: amsthm's \qed at the end of the last paragraph, \leavevmode\unskip\penalty9999 \hbox{}\nobreak\hfill
 * \quad\hbox{\qedsymbol}; beamer's \qedsymbol is \leavevmode\hbox{\usebeamertemplate*{qed symbol}}: in "qed symbol"'s
 * color, amsthm's \openbox (\hbox to.77778em{\hfil\vrule\vbox to.675em{\hrule width.6em\vfil\hrule}\vrule\hfil})
 */
function qed(cx: FrameCtx, size: SizeCommand, attrs: FontAttrs): Node[] {
  const { k, theme } = cx
  const f = selectFont(k, size, attrs)
  const env = { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
  // (the themes define no "qed symbol" font: \usebeamerfont* leaves \normalfont, the proof's own)
  if (theme.data.fonts["qed symbol"]) throw new Unsupported("beamer: a qed symbol font")
  const em = (s: string) => parseDimen(s, env)
  const rule = parseDimen("0.4pt", env)
  const vrule: Node = { kind: "rule", width: rule, height: null, depth: null }
  const box = vpack([{ kind: "rule", width: em(".6em"), height: rule, depth: 0 }, filGlue(), { kind: "rule", width: null, height: rule, depth: 0 }], { exactly: em(".675em") })
  const openbox = hpack([filGlue(), vrule, box, vrule, filGlue()], { exactly: em(".77778em") })
  const symbol = hpack([colorPush(useColor(theme, "qed symbol", outerColors(theme)).fg), openbox, colorPop()])
  return [penalty(9999), hpack([]), penalty(10000), fillGlue(), plain(dimen(f.params[QUAD])), hpack([symbol])]
}

/** \alert{…} and \structure{…} (alertenv, structureenv): the text in "alerted text"'s or "structure"'s fg (and font,
 *  which the themes leave empty), its last space taken off (\ifhmode\unskip\fi); as \textcolor with the driver's spec */
export function alerts(cx: FrameCtx, text: string): string {
  const spec = text.match(/\\(alert|structure)\s*</)
  if (spec) throw new Unsupported(`beamer: \\${spec[1]} with an overlay specification`)
  let t = text, prev = ""
  while (t !== prev) {
    prev = t
    t = t.replace(/\\(alert|structure)\s*\{([^{}]*)\}/g, (_m, name: string, arg: string) => {
      const color = name === "alert" ? "alerted text" : "structure"
      const f = cx.theme.data.fonts[color]
      if (!f || Object.keys(f).length) throw new Unsupported(`beamer: the ${color} font`)
      if (/^\s/.test(arg)) throw new Unsupported(`beamer: \\${name}'s text after a space`)
      return `\\textcolor[LXdriver]{${useColor(cx.theme, color, outerColors(cx.theme)).fg}}{${arg.trimEnd()}}`
    })
  }
  const left = t.match(/\\(alert|structure)(?![A-Za-z])/)
  if (left) throw new Unsupported(`beamer: \\${left[1]} around commands`)
  return t
}
