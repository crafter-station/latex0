// french.ldf (babel-french 4.0e, which pdfTeX reads as french3.ldf 3.7e) with its defaults (#338): what french
// changes beyond its captions and date (babel.ts). While it is selected (\extrasfrench): the active ; ! ? and :
// (a thin space before the first three, an interword space before :, both unbreakable; none in \ttfamily, where
// \FB@spacing is false, nor in math), \og and \fg (\FB@og, \FB@fg: guillemets and \FBguillspace), \frenchspacing
// and the apostrophe a letter to hyphenation (\lccode"27). Always: \up (\fup, \FB@up@fake for Computer Modern:
// scalefnt's 0.65 of the size, raised), \ier and the like, \no and the like.

import type { ClassOptionData, SizeCommand } from "../layout/classdata"
import { xnOverD } from "../layout/arith"
import { roundDecimals, Scanner } from "../layout/dimen"
import { QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT, type Font } from "../layout/font"
import { appendText as appendCodes, spaceGlue } from "../layout/hmode"
import { charNode, glue, kern, penalty, ssGlue, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { babelState } from "./babel"
import type { Ctx } from "./context"
import { appendText } from "./encodings"
import { babelGuillemet } from "./portuguese"
import { fontAt, selectFont } from "./paragraph"
import { Unsupported } from "./unsupported"

/** `decimal` times the dimension `v`, as TeX scans .8\fontdimen2\font (§ 455: xn_over_d by the rounded fraction) */
const times = (decimal: string, v: number) => xnOverD(v, roundDecimals([...decimal].map(Number)), 65536)

/**
 * french's active ; ! ? and : in text, outside \ttfamily: \ifdim\lastskip>1sp \unskip, then \penalty\@M and
 * \FBthinspace (\hskip .5\fontdimen2\font) before ; ! ?, \FBcolonspace (\space: the interword glue) before :;
 * then the character
 */
export function frenchPunctuation(list: Node[], ch: string, font: Font, state: { spaceFactor: number }, tt: boolean, paragraph: boolean): void {
  if (!tt) {
    const last = list.at(-1)
    if (!last) throw new Unsupported(`french's ${ch} starting a paragraph`) // (in vertical mode: \ifhmode is false)
    if (last.kind === "glue" && last.width > 1) list.pop()
    list.push(penalty(10000), ch === ":" ? spaceGlue(font, state.spaceFactor) : glue(times("5", font.params[SPACE])))
  }
  appendText(list, ch, font, state, paragraph)
}

/** \FBguillspace: \hskip .8\fontdimen2\font plus .3\fontdimen3\font minus .8\fontdimen4\font */
const guillspace = (font: Font) => glue(times("8", font.params[SPACE]), times("3", font.params[SPACE_STRETCH]), 0, times("8", font.params[SPACE_SHRINK]), 0)

/**
 * \og and \fg in french: \FB@og (\leavevmode\guillemotleft\penalty\@M\FBguillspace) and \FB@fg (\ifdim\lastskip>\z@
 * \unskip\fi, \penalty\@M\FBguillspace\guillemotright; \xspace is \relax). In OT1 the guillemets are babel's (\ll
 * and \gg). (Outside french they are \textquotedblleft and \textquotedblright: the paragraph's text.)
 */
export function frenchQuote(list: Node[], right: boolean, enc: string, k: ClassOptionData, size: SizeCommand, font: Font, state: { spaceFactor: number }, amsmath: boolean): void {
  const unskip = () => { const last = list.at(-1); if (last?.kind === "glue" && last.width > 0) list.pop() }
  const guillemet = () => babelGuillemet(right, enc, k, size, font, state, amsmath)
  if (!right) { list.push(...guillemet(), penalty(10000), guillspace(font)); return }
  unskip()
  list.push(penalty(10000), guillspace(font), ...guillemet())
}

/** the sizes t1cmr.fd and ot1cmr.fd declare (scaled points) */
const SIZES = [5, 6, 7, 8, 9, 10, 10.95, 12, 14.4, 17.28, 20.74, 24.88, 29.86, 35.83].map((s) => Math.round(s * 65536))
/** t1cmr.fd's EC fonts for Computer Modern Roman's shapes */
const EC: Record<string, string> = { "m/n": "ecrm", "m/sl": "ecsl", "m/it": "ecti", "m/sc": "eccc", "bx/n": "ecbx", "bx/it": "ecbi", "bx/sl": "ecbl", "bx/sc": "ecxc" }

/**
 * \up{text} (\fup: \FB@up@fake, as Computer Modern has no -sup.fd): \settoheight\FB@Mht{M}, less .12 of it and .65ex;
 * \raisebox{\FB@Mht}{\scalefont{.65}\MakeLowercase{text}} (scalefnt: \fontsize{.65\f@size}, which NFSS substitutes
 * with the nearest size it declares)
 */
export function frenchUp(text: string, enc: string, fam: string, series: string, shape: string, font: Font, state: { spaceFactor: number }): Node[] {
  if (!/^[A-Za-z]+$/.test(text)) throw new Unsupported(`\\up{${text}}`)
  if (fam !== "cmr" || (enc !== "T1" && enc !== "OT1")) throw new Unsupported(`\\up in ${enc}/${fam}`)
  const want = times("65", font.size)
  let at = SIZES[0]
  for (const s of SIZES) if (Math.abs(s - want) < Math.abs(at - want)) at = s // (the first of two as near)
  const pt = at / 65536, code = String(Math.round(pt * 100)).padStart(4, "0")
  let name: string
  if (enc === "T1") { const p = EC[`${series}/${shape}`]; if (!p) throw new Unsupported(`\\up in T1/cmr/${series}/${shape}`); name = p + code }
  else { if (series !== "m" || shape !== "n") throw new Unsupported(`\\up in OT1/cmr/${series}/${shape}`); name = pt === 10.95 ? "cmr10" : pt === 14.4 ? "cmr12" : pt > 15 ? "cmr17" : `cmr${pt}` }
  const small = fontAt(name, at)
  const inner: Node[] = []
  appendText(inner, text.toLowerCase(), small, { spaceFactor: 1000 }, false)
  const M = font.chars.get(77)
  if (!M) throw new Unsupported("\\up in a font without M")
  const raise = M.height - times("12", M.height) - new Scanner(".65ex", { em: font.params[QUAD], ex: font.params[X_HEIGHT] }).scanDimen().value
  const box = hpack(inner)
  box.shift = -raise
  state.spaceFactor = 1000
  return [hpack([box])]
}

/** \no, \No, \nos, \Nos: the letter, \up{o} or \up{os}, \FBmedkern (\kern+.2em) */
export function frenchNumero(cmd: string, enc: string, fam: string, series: string, shape: string, font: Font, state: { spaceFactor: number }, paragraph: boolean): Node[] {
  const out: Node[] = []
  appendText(out, cmd[0], font, state, paragraph)
  out.push(...frenchUp(cmd.slice(1).toLowerCase() === "o" ? "o" : "os", enc, fam, series, shape, font, state))
  out.push(kern(new Scanner(".2em", { em: font.params[QUAD], ex: font.params[X_HEIGHT] }).scanDimen().value, true))
  return out
}

/** \FrenchLabelItem, \textemdash (T1's 22, OT1's 124), in `font` */
export function frenchItemLabel(cx: Ctx, font: Font): { node: Node; width: number } {
  const c = cx.run.k.ints.T1 ? 22 : 124
  return { node: charNode(font, c), width: font.chars.get(c)!.width }
}

/** \labelwidthFB (\settowidth to \FrenchLabelItem at \begin{document}, in \normalfont) and \listindentFB
 *  (\setlistindentFB: \parindent, or 1.5em when it is zero) */
export function frenchListDimens(cx: Ctx): { labelwidth: number; listindent: number } {
  const k = cx.run.k, n = k.sizes.normalsize.font
  const font = fontAt(n.name, n.at)
  return { labelwidth: frenchItemLabel(cx, font).width, listindent: k.dimens.parindent || new Scanner("1.5em", { em: font.params[QUAD], ex: font.params[X_HEIGHT] }).scanDimen().value }
}

/** french.ldf's \@footnotemarkFB before the mark (its main language): \leavevmode\unskip\unkern\FBfnmarkspace
 *  (\kern .5\fontdimen2\font) */
export function frenchMarkSpace(list: Node[], font: Font): void {
  if (list.at(-1)?.kind === "glue") list.pop()
  const last = list.at(-1)
  if (last?.kind === "kern" && !last.accent) list.pop()
  list.push(kern(times("5", font.params[SPACE]), true))
}

/**
 * french.ldf's \@makefntextFB (its main language, \FBFrenchFootnotes): \insertfootnotemarkFB, \parindent\parindentFFN
 * (\parindent, 1.5em at least) \rule\z@\footnotesep, then \llap{\@thefnmark}\dotFFN\kernFFN (., \kern.5em): the
 * paragraph's nodes before the text's own \rule\z@\footnotesep. `k`: the class's parameters (\parindentFFN is set at
 * \begin{document}, in \normalfont)
 */
export function frenchNoteStart(n: number, k: ClassOptionData, footnotesep: number, font: Font): Node[] {
  const nf = k.sizes.normalsize.font, normal = fontAt(nf.name, nf.at)
  const em = font.params[QUAD], ffn = Math.max(k.dimens.parindent, new Scanner("1.5em", { em: normal.params[QUAD], ex: normal.params[X_HEIGHT] }).scanDimen().value)
  const strut = () => hpack([{ kind: "rule", width: 0, height: footnotesep, depth: 0 }])
  const mark: Node[] = []
  appendText(mark, String(n), font, { spaceFactor: 1000 }, false)
  const out: Node[] = [hpack([], { exactly: ffn }), strut(), hpack([ssGlue(), ...mark], { exactly: 0 })]
  appendText(out, ".", font, { spaceFactor: 1000 }, false)
  out.push(kern(new Scanner(".5em", { em, ex: font.params[X_HEIGHT] }).scanDimen().value, true))
  return out
}

/**
 * french.ldf's \FB@makecaption (its main language, \FBCustomiseFigTabCaptions): {\FBfigtabshape \fnum@figure}
 * (\scshape while french is selected) and \CaptionSeparator (\space\textendash\space) before the text
 */
export function frenchCaptionStart(cx: Ctx, name: string, number: string, roman: Font, state: { spaceFactor: number }): Node[] {
  const k = cx.run.k, T1 = !!k.ints.T1
  const f = babelState.lang === "french" ? selectFont(k, "normalsize", { enc: T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "sc" }) : roman
  const out: Node[] = []
  appendText(out, name, f, state, false)
  out.push(penalty(10000), glue(f.params[SPACE], f.params[SPACE_STRETCH], 0, f.params[SPACE_SHRINK], 0)) // \nobreakspace
  state.spaceFactor = 1000
  appendText(out, number, f, state, false)
  out.push(spaceGlue(roman, state.spaceFactor))
  appendCodes(out, String.fromCharCode(T1 ? 21 : 123), roman, state, false) // \textendash
  out.push(spaceGlue(roman, state.spaceFactor))
  return out
}

/** text typeset as characters alone (a caption, a list's label, a mark) where french's active ; : ! ? would add their
 *  spaces: not modeled (`loaded`: french is loaded, its language where the text is typeset not known) */
export function frenchTextGuard(text: string, loaded = false): void {
  if ((loaded ? babelState.b?.languages.includes("french") : babelState.lang === "french") && /[;:!?]/.test(text)) throw new Unsupported(`french's ; : ! ? in "${text}"`)
}
