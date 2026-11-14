// KOMA-Script's scrlayer-scrpage (scrlayer.sty, scrlayer-scrpage.sty): the pair of page styles scrheadings and
// plain.scrheadings on one-sided pages, their fields (\ihead, \chead, \ohead, \ifoot, \cfoot, \ofoot and the \lohead …
// forms) and \pagemark. A page style is a list of layers (\DeclarePageStyleByLayers): \@oddhead holds the background
// layers and \@oddfoot the foreground ones, each layer a \parbox placed from the page's corner, so every page has the
// paragraphs of all of them, which TeX breaks as it ships the page.

import { QUAD } from "../layout/font"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, filGlue, FILL, glue, kern, paramGlue, ssGlue, type BoxNode, type Node } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import type { ParagraphTrace } from "../trace/decisions"
import type { Ctx } from "./context"
import { centering, raggedleft, raggedright, sloppy } from "./kernel"
import { appendToVlist, mathEnv, paragraphInput, selectFont, type ParagraphOptions } from "./paragraph"
import { vtop } from "./tabular"
import { Unsupported } from "./unsupported"
import { IGNORE_DEPTH } from "./vlist"

/** the fields of a one-sided page: the head's and the foot's left, middle and right (\sls@ps@<style>@odd@<where>@<head|foot>) */
export interface ScrFields { hl: string; hc: string; hr: string; fl: string; fc: string; fr: string }
/** scrheadings' fields and plain.scrheadings' */
export interface ScrPage { main: ScrFields; plain: ScrFields }

const EMPTY: ScrFields = { hl: "", hc: "", hr: "", fl: "", fc: "", fr: "" }

/** As the package loads in a KOMA-Script class (pagestyleset=KOMA-Script, one-sided): \pagestyle{scrheadings},
 *  \clearpairofpagestyles, \chead{\headmark}, \cfoot[\pagemark]{\pagemark} (the \if@twoside branches are empty) */
export const scrDefaults = (): ScrPage => ({ main: { ...EMPTY, hc: "\\headmark", fc: "\\pagemark" }, plain: { ...EMPTY, fc: "\\pagemark" } })

/**
 * A preamble line that sets fields: \clearpairofpagestyles (\ihead[]{} … \ofoot[]{}), \clearmainofpairofpagestyles,
 * \clearplainofpairofpagestyles, and \ihead, \chead, \ohead, \ifoot, \cfoot, \ofoot: {text} sets scrheadings' field,
 * [plain]{text} plain.scrheadings' too, *{text} both to the text. On a one-sided page the inner field is the left and
 * the outer the right (\ihead: \rehead and \lohead; \ohead: \lehead and \rohead); \lohead, \cohead, \rohead and the
 * foot's set those themselves, the even pages' (\lehead …) fields of pages there are none of.
 */
export function scrCommand(s: ScrPage, line: string): boolean {
  if (line === "\\clearpairofpagestyles") { s.main = { ...EMPTY }; s.plain = { ...EMPTY }; return true }
  if (line === "\\clearmainofpairofpagestyles") { s.main = { ...EMPTY }; return true }
  if (line === "\\clearplainofpairofpagestyles") { s.plain = { ...EMPTY }; return true }
  const m = line.match(/^\\(?:([ico])|([lcr])([eo]))(head|foot)\s*(\*)?\s*(?:\[([^\]]*)\])?\s*\{(.*)\}$/)
  if (!m) return false
  const [, io, lcr, eo, hf, star, plain, text] = m
  if (eo === "e") return true
  const key = `${hf[0]}${io ? { i: "l", c: "c", o: "r" }[io] : lcr}` as keyof ScrFields
  if (star && plain !== undefined) throw new Unsupported(`preamble: ${line}`)
  s.main[key] = text.trim()
  if (star) s.plain[key] = text.trim()
  else if (plain !== undefined) s.plain[key] = plain.trim()
  return true
}

const INCH = 4736286
/** TeX's half (§ 100) */
const half = (x: number) => (x % 2 ? (x + 1) / 2 : x / 2)

/**
 * \@oddhead and \@oddfoot of a layer page style on a one-sided page (\scrlayer@declare@ps@by@layers), `style`
 * scrheadings, plain (the alias of plain.scrheadings) or empty (scrlayer's: no layers).
 *
 * The head is \parbox[b][\headheight][t]{\textwidth}{\vskip-\topmargin-1in-\ht\strutbox \hskip-\oddsidemargin-1in
 * \strut\makebox[0pt][l]{the background layers}}, the foot \parbox[t][\headheight][t]{\textwidth}{…} with the foreground
 * layers after a \vskip up from the foot to the page's top. A layer (\scr@@layerbox) is \parbox[t][0pt][t]{0pt}{\vskip y
 * (\vskip-height when aligned at its bottom) \makebox[0pt][l]{\hskip x \makebox[0pt][l]{\parbox[v][height][v]{width}
 * {\vskip0pt\strut contents\strut\vskip0pt}}}}.
 *
 * scrlayer-scrpage's styles (\defpagestyle) have the layers head.oneside, head.above.line and head.below.line in the
 * background and foot.oneside, foot.above.line and foot.below.line in the foreground. The head's and foot's contents
 * are \sls@secure@box: a \vbox of \makebox[0pt][l]{\parbox{width}{\raggedright\strut left\strut}}\parbox{width}
 * {\centering\strut middle\strut}\makebox[0pt][r]{\parbox{width}{\raggedleft\strut right\strut}} in \normalfont and
 * the font of pageheadfoot (\normalcolor\slshape); \pagemark is {\usekomafont{pagenumber}{\thepage}} (\normalfont).
 * The lines are \sls@hf@rule: \vbox to 0pt{\kern-thickness \vrule (0pt thick here) \hskip 0pt plus 1fill minus
 * \paperwidth\null\par}.
 *
 * `plain` is the style of one page (\thispagestyle, in the output routine's group): \pagestyle{plain} would set the
 * lines' lengths to 0pt for the styles selected after it too, and is not laid out.
 *
 * Every \parbox and \vbox ends its paragraph as it closes, the innermost first: the traces come in that order.
 */
export function scrlayerPage(cx: Ctx, s: ScrPage, style: string, thepage: string): { head: Node[]; foot: Node[]; traces: ParagraphTrace[] } {
  const k = cx.run.k, sz = k.sizes.normalsize, D = k.dimens
  if (style !== "scrheadings" && style !== "plain" && style !== "empty") throw new Unsupported(`\\pagestyle{${style}} with scrlayer-scrpage`)
  if (k.ints.twoside || k.ints.twocolumn) throw new Unsupported(`scrlayer-scrpage ${k.ints.twoside ? "two-sided" : "in two columns"}`)
  if (D.footheight === undefined) throw new Unsupported("scrlayer-scrpage without \\footheight")
  const fields = style === "empty" ? null : style === "plain" ? s.plain : s.main
  const traces: ParagraphTrace[] = []
  const em = cx.romanFont.params[QUAD]
  const slanted = { ...cx.normalAttrs, shape: "sl" as const }
  const strut = (): Node => ({ kind: "rule", width: 0, height: sz.strut.height, depth: sz.strut.depth })
  const indent = () => emptyBox("hlist", 0) // (\parindent is 0pt after \@parboxrestore)
  const parskips = (): Node[] => [paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0))]
  /** a paragraph's lines (after \@parboxrestore: \parfillskip\@flushglue, \sloppy), its trace recorded */
  const para = (text: string, opts: ParagraphOptions, emOf = em): Node[] => {
    let p: ReturnType<typeof paragraphInput>
    try {
      p = paragraphInput(text, k, "normalsize", cx.doc, { amsmath: cx.pre.amsmath, parFillSkip: paramGlue("parfillskip", filGlue()), ...sloppy(emOf), ...opts })
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a scrlayer-scrpage field "${text.slice(0, 40)}"`)
      throw e
    }
    const lb = lineBreak(p.list, p.params)
    traces.push(...p.notes, lb.trace)
    return lb.vlist
  }
  /** a vertical list: what comes first, the paragraph's lines (after \parskip, twice, when the list is not empty), the rest */
  const vlist = (pre: Node[], lines: Node[], post: Node[] = []): Node[] => {
    const l = [...pre]
    if (l.length) l.push(...parskips())
    let pd: number | null = IGNORE_DEPTH
    for (const x of lines) { if (x.kind === "hlist") pd = appendToVlist(l, x, pd, sz.baselineskip, k.glue.lineskip, D.lineskiplimit); else l.push(x) }
    return [...l, ...post]
  }
  /** \parbox{width}{…}: $\vcenter{…}$ with \m@th (§ 736: about the axis) */
  const axis = mathEnv(k, "normalsize", cx.pre.amsmath).fonts[0][2]!.params[22]
  const centered = (list: Node[]): Node[] => {
    const box = vpack(list), delta = box.height + box.depth
    box.height = axis + half(delta); box.depth = delta - box.height
    return [{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }]
  }
  /** a field: \parbox{width}{\raggedright (or \centering, \raggedleft) \strut text\strut} */
  const field = (text: string, h: "l" | "c" | "r", width: number): Node[] => {
    if (/\\(?:headmark|leftmark|rightmark)(?![A-Za-z])/.test(text)) throw new Unsupported("\\headmark in scrlayer-scrpage's fields")
    if (/\s$/.test(text) || /^\s/.test(text)) throw new Unsupported("a scrlayer-scrpage field with a space at its end")
    // (after a control word, a space keeps the text that comes in its place apart from it)
    const src = text.replace(/\\(?:pagemark|thepage)(?![A-Za-z])\s*/g, (all) => (all.startsWith("\\pagemark") ? `{\\normalfont ${thepage}}` : thepage))
    const shape = h === "l" ? raggedright() : h === "c" ? centering() : raggedleft()
    const sl = selectFont(k, "normalsize", slanted)
    return centered(vlist([], para(src, { attrs: slanted, groups: true, hsize: width, start: [indent(), strut()], end: [strut()], ...shape }, sl.params[QUAD])))
  }
  /** \sls@secure@box: the three fields in a \vbox, no taller than `limit` (else it enlarges \headheight or \footskip) */
  const secure = (l: string, c: string, r: string, width: number, limit: number, name: string): BoxNode => {
    const left = hpack([...field(l, "l", width), ssGlue()], { exactly: 0 }), middle = field(c, "c", width), right = hpack([ssGlue(), ...field(r, "r", width)], { exactly: 0 })
    const box = vpack(vlist([], para("", { hsize: width, start: [indent(), left, ...middle, right] })))
    if (box.height + box.depth > limit) throw new Unsupported(`scrlayer-scrpage's fields taller than \\${name}`)
    return box
  }
  /** \sls@hf@rule with the thickness 0pt (ilines, one-sided: the \hskip after the rule); its length is the layer's
   *  width, or 0pt in plain.scrheadings (its oninit hook, without the plainheadsepline … options) */
  const line = (width: number): BoxNode =>
    vpack(vlist([kern(0, true)], para("", { hsize: width, start: [indent(), { kind: "rule", width: style === "plain" ? 0 : width, height: 0, depth: 0 }, glue(0, 65536, FILL, D.paperwidth, 0), emptyBox("hlist", 0)] })), { exactly: 0 })
  /** a layer at (x, y), `width` by `height`, aligned at its bottom (bl) or top (tl) */
  const layer = (y: number, width: number, height: number, v: "b" | "t", contents: (width: number) => Node): BoxNode => {
    const inner = vlist([glue(0)], para("", { hsize: width, start: [indent(), strut(), contents(width), strut()] }), [glue(0)])
    const box = v === "b" ? vpack([ssGlue(), ...inner], { exactly: height }) : vtop([...inner, ssGlue()], { exactly: height })
    const placed = hpack([glue(D.oddsidemargin + INCH), hpack([box, ssGlue()], { exactly: 0 }), ssGlue()], { exactly: 0 })
    return vtop([glue(y), ...(v === "b" ? [glue(-height)] : []), ...parskips(), ...para("", { hsize: 0, start: [indent(), placed] }), ssGlue()], { exactly: 0 })
  }
  /** \@oddhead's or \@oddfoot's \parbox: `up` the \vskip to the page's top */
  const outer = (up: number, layers: Node[]): Node[] => [glue(-up), ...parskips(), ...para("", { hsize: D.textwidth, start: [indent(), glue(-D.oddsidemargin - INCH), strut(), hpack([...layers, ssGlue()], { exactly: 0 })] }), ssGlue()]

  const top = D.topmargin + INCH, width = D.textwidth // (\sls@headwidth and \sls@footwidth)
  const { height: sh, depth: sd } = sz.strut
  const footTop = top + D.headheight + D.headsep + D.textheight + D.footskip
  const headLayers = fields ? [
    layer(top + D.headheight, width, D.headheight, "b", (w) => secure(fields.hl, fields.hc, fields.hr, w, D.headheight, "headheight")),
    layer(top + sd, width, 0, "b", line),
    layer(top + D.headheight - sh, width, 0, "t", line),
  ] : []
  const head = vpack(outer(top + sh, headLayers), { exactly: D.headheight })
  const footLayers = fields ? [
    layer(footTop + sd - D.footheight, width, D.footheight, "t", (w) => secure(fields.fl, fields.fc, fields.fr, w, D.footheight, "footheight")),
    layer(footTop - D.footheight + 2 * sd, width, 0, "b", line),
    layer(footTop + 2 * sd, width, 0, "b", line),
  ] : []
  const foot = vtop(outer(footTop + sh, footLayers), { exactly: D.headheight })
  return { head: [head], foot: [foot], traces }
}
