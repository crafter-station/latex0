// TikZ's pictures in a document (tikz.sty): each tikzpicture environment and \tikz taken out of the source
// (\LXtikz{n}) and typeset where it stands by tikz/path.ts on pgf/, under the document's driver (pgf's dvips or
// pdfTeX system layer). A picture's \pgfsys@typesetpicturebox is \leavevmode, the trims' kerns and the picture's
// box: a picture starts a paragraph like a box. pgfmath reads em and ex in the font where the picture stands,
// and nodes' text is typeset there too (\pgfinterruptpicture's \pgfutil@selectfont), as an \hbox's list. Named
// nodes and coordinates are global: a later picture reaches an earlier one's (as TeX does without `remember
// picture`, at the same coordinates in its own picture).

import { emptyBox, glue, kern, paramGlue, ssGlue, type BoxNode, type Node } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { DvipsDriver } from "../pgf/drivers/dvips"
import { DVIPS_HEADER } from "../pgf/drivers/dvipsheader"
import { TexArith } from "../pgf/fixed"
import { pgfSetDash } from "../pgf/graphicstate"
import { pgfDefObject } from "../pgf/objects"
import { pgfPathClose } from "../pgf/paths"
import { pgfPathQCircle, pgfPathQCurveTo, pgfPathQLineTo, pgfPathQMoveTo, pgfUsePathQFill, pgfUsePathQFillStroke, pgfUsePathQStroke } from "../pgf/quick"
import { PdftexDriver } from "../pgf/drivers/pdftex"
import type { PgfNodeRecord } from "../pgf/shapes"
import { PgfState } from "../pgf/state"
import { TikzDocument } from "../tikz/path"
import type { Baselines } from "../tikz/text"
import { tokenize } from "../tikz/tokens"
import { SIZE_COMMANDS, type ClassOptionData, type SizeCommand } from "../layout/classdata"
import type { Ctx } from "./context"
import { QUAD, X_HEIGHT } from "../layout/font"
import { appendToVlist, DECLARATIONS, fontDeclaration, hlistInput, paragraphInput, selectFont, type DocState, type FontAttrs, type ParagraphOptions, type TabularOuter } from "./paragraph"
import { lineBreak } from "../layout/linebreak"
import { parseDimen } from "../layout/dimen"
import { sloppy } from "./kernel"
import { vtop } from "./tabular"
import type { TextAction } from "../tikz/options"
import { Unsupported } from "./unsupported"
import type { Colors } from "./xcolor"

/** 1in */
const INCH = 4736286

/**
 * pgf's shipout/background hook (pgfutil-latex.def 129–135) around a shipped page, by
 * \__shipout_add_background_box:n: \put(\hoffset-1in,\voffset-1in){…} at the paper's corner, holding on the
 * first page under dvips the PostScript header pgf collected in \pgfutil@abc (pgf/drivers/dvipsheader.ts), in
 * \hbox{\kern-1in\vbox to0pt{\kern-1in\hbox{…}\vss}} above the page's contents, then \kern\z@
 */
export function pgfShipoutBackground(page: BoxNode, header: boolean, k: ClassOptionData): BoxNode {
  if (page.kind !== "vlist") throw new Unsupported("a page that is not a vbox")
  if (k.dimens.hoffset || k.dimens.voffset) throw new Unsupported("pgf's page background with \\hoffset or \\voffset")
  const specials: Node[] = header ? DVIPS_HEADER.map((h) => ({ kind: "whatsit", text: `\\special{! ${h}}` })) : []
  // \put: \raise<y>\hb@xt@\z@{\kern<x> … \hss}
  const put = hpack([kern(-INCH, true), ...specials, ssGlue()], { exactly: 0 })
  put.shift = INCH
  const box = hpack([kern(-INCH, true), vpack([kern(-INCH, true), hpack([put]), ssGlue()], { exactly: 0 })])
  return vpack([box, ...page.list, kern(0, true)], { exactly: page.height + page.depth })
}

/**
 * The arrows pgf's compatibility layer makes objects of as pgf.sty loads (pgfcomp-version-0-65.sty 176–245), each
 * \pgfdefarrow{name}{…}{…}{code}: \pgfdefobject{pgf@name} of \pgfsys@setlinewidth{1bp} and the code. Under dvips
 * each object is a PostScript procedure in a \special{! …}, which goes on the main vertical list in the preamble.
 */
export function pgfCompatObjects(): Node[] {
  const s = new PgfState()
  const d = new DvipsDriver(s)
  const bp = (x: string) => new TexArith(s.units).dimen(`${x}bp`)
  const move = (x: string, y: string) => pgfPathQMoveTo(s, `${x}bp`, `${y}bp`)
  const line = (x: string, y: string) => pgfPathQLineTo(s, `${x}bp`, `${y}bp`)
  const curve = (...c: string[]) => pgfPathQCurveTo(s, ...(c.map((x) => `${x}bp`) as [string, string, string, string, string, string]))
  const solid = () => pgfSetDash(s, d, [], "0pt")
  const arrows: [string, () => void][] = [
    ["pgfarrowsingle", () => { move("2", "0"); line("-6", "4"); line("-3", "0"); line("-6", "-4"); pgfUsePathQFill(s, d) }],
    ["pgfarrowto", () => {
      d.setlinewidth(bp("0.8")) // \pgfarrowlinewidthscale{0.8}
      solid(); d.cap("round"); d.join("round")
      move("-3", "4"); curve("-2.75", "2.5", "0", "0.25", "0.75", "0"); curve("0", "-0.25", "-2.75", "-2.5", "-3", "-4")
      pgfUsePathQStroke(s, d)
    }],
    ["pgfarrowbar", () => { solid(); move("0", "-5"); line("0", "5"); pgfUsePathQStroke(s, d) }],
    ["pgfarrowsquare", () => { solid(); move("-3", "-5"); line("0", "-5"); line("0", "5"); line("-3", "5"); pgfUsePathQStroke(s, d) }],
    ["pgfarrowround", () => { solid(); move("-2", "-5"); curve("1", "-3", "1", "3", "-2", "5"); pgfUsePathQStroke(s, d) }],
    ["pgfarrowpointed", () => { solid(); move("-4.5", "-5"); line("0.5", "0"); line("-4.5", "5"); pgfUsePathQStroke(s, d) }],
    ["pgfarrowdot", () => { d.transformshift(bp("-2.5"), 0); solid(); pgfPathQCircle(s, "3bp"); pgfUsePathQFillStroke(s, d) }],
    ["pgfarrowdiamond", () => { solid(); move("1", "0"); line("-5", "3"); line("-11", "0"); line("-5", "-3"); pgfPathClose(s); pgfUsePathQFillStroke(s, d) }],
  ]
  for (const [name, code] of arrows) pgfDefObject(s, d, `pgf@${name}`, () => { d.setlinewidth(bp("1")); code() })
  return s.out
}

const arrowStates = new WeakMap<object, PgfState>()
const nodeRegistries = new WeakMap<object, Map<string, PgfNodeRecord>>()

/**
 * A node's text as \hbox{<font><text>} holds it, at the size and in the font where the picture stands: the font
 * option's size commands set the size, its declarations (\bfseries …) apply in order; nothing else is modeled.
 */
export function nodeHlist(text: string, font: string, k: ClassOptionData, size: SizeCommand, doc: DocState, attrs: FontAttrs, amsmath: boolean): Node[] {
  let src = `{${text}}`
  const decls = fontOption(font)
  size = decls.size ?? size
  if (decls.length) src = `{${decls.map((d) => `\\${d} `).join("")}${src}}`
  if (/\\(?:footnote|label|par)(?![A-Za-z])/.test(text)) throw new Unsupported(`a node's text "${text.trim().slice(0, 40)}"`)
  try { return hlistInput(src, k, size, doc, attrs, { spaceFactor: 1000 }, amsmath, undefined, true) } catch (e) {
    if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a node's text "${text.trim().slice(0, 40)}"`)
    throw e
  }
}

/** a font option's commands: the declarations (\bfseries …) in order, and the last size command */
function fontOption(font: string): string[] & { size?: SizeCommand } {
  const decls: string[] & { size?: SizeCommand } = []
  for (const m of font.matchAll(/\\([A-Za-z]+)\s*|(\S)/g)) {
    if (m[1] && (SIZE_COMMANDS as readonly string[]).includes(m[1])) decls.size = m[1] as SizeCommand
    else if (m[1] && DECLARATIONS.includes(m[1])) decls.push(m[1])
    else throw new Unsupported(`tikz: font=${font}`)
  }
  return decls
}

/** \baselineskip, \lineskip and \lineskiplimit in a node's text: the size's, or the font option's size command's */
export function nodeBaselines(font: string, k: ClassOptionData, size: SizeCommand): Baselines {
  size = fontOption(font).size ?? size
  return { baselineskip: k.sizes[size].baselineskip, lineskip: k.glue.lineskip, lineskiplimit: k.dimens.lineskiplimit }
}

/** em and ex after a font option's commands (pgfmath's \pgfmath@selectfont, LaTeX's \selectfont) */
export function nodeUnits(font: string, k: ClassOptionData, size: SizeCommand, doc: DocState, attrs: FontAttrs): { em: number; ex: number } {
  const decls = fontOption(font)
  for (const d of decls) attrs = fontDeclaration(d, attrs, k, decls.size ?? size, doc)!
  const f = selectFont(k, decls.size ?? size, attrs)
  return { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
}

/**
 * A node's text with a text width (tikz.code.tex 3882–3891, 3925–3929): \minipage[t]{width}\leavevmode\hbox{}, the
 * font option's commands and the text action (`action`'s skips, \spaceskip and \xspaceskip in that font), the text,
 * \unskip, \endminipage; `nodeFont` is where the minipage starts (its \sloppy's em). The paragraph's trace joins
 * `outer`'s, as a minipage's does.
 */
export function nodeMinipage(text: string, nodeFont: string, textFont: string, width: number, action: TextAction, before: Node[], after: Node[], k: ClassOptionData, size: SizeCommand, doc: DocState, attrs: FontAttrs, amsmath: boolean, outer: TabularOuter): BoxNode {
  if (/\\(?:par(?![A-Za-z])|footnote|label|begin|item)|\n\s*\n/.test(text)) throw new Unsupported(`a node's text with a text width "${text.trim().slice(0, 40)}"`)
  const node = fontOption(nodeFont)
  for (const d of node) attrs = fontDeclaration(d, attrs, k, node.size ?? size, doc)!
  size = node.size ?? size
  const em = selectFont(k, size, attrs).params[QUAD] // (\@parboxrestore's \sloppy)
  const decls = fontOption(textFont)
  for (const d of decls) attrs = fontDeclaration(d, attrs, k, decls.size ?? size, doc)!
  size = decls.size ?? size
  const tf = selectFont(k, size, attrs), env = { em: tf.params[QUAD], ex: tf.params[X_HEIGHT] }
  const skip = (param: string, stretch = 0, order: 0 | 1 = 0) => paramGlue(param, glue(0, stretch, order))
  const plus2em = (param: string) => skip(param, parseDimen("2em", env))
  const fixed = (v: string) => ({ width: parseDimen(v, env), stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } as const)
  const spaces = { spaceSkips: { space: fixed(".3333em"), xspace: fixed(".5em") } }
  // \pgfutil@raggedright and …left are \raggedright and \raggedleft (\finalhyphendemerits zero); \@parboxrestore's \parfillskip is \@flushglue
  const shapes: Record<TextAction, Partial<ParagraphOptions>> = {
    ragged: { leftSkip: skip("leftskip"), rightSkip: plus2em("rightskip"), finalHyphenDemerits: 0, ...spaces },
    "badly ragged": { leftSkip: skip("leftskip"), rightSkip: skip("rightskip", 65536, 1), finalHyphenDemerits: 0 },
    "ragged left": { leftSkip: plus2em("leftskip"), rightSkip: skip("rightskip"), parFillSkip: skip("parfillskip"), finalHyphenDemerits: 0, ...spaces },
    "badly ragged left": { leftSkip: skip("leftskip", 65536, 1), rightSkip: skip("rightskip"), parFillSkip: skip("parfillskip"), finalHyphenDemerits: 0 },
    justified: { leftSkip: skip("leftskip"), rightSkip: skip("rightskip") },
    centered: { leftSkip: plus2em("leftskip"), rightSkip: plus2em("rightskip"), parFillSkip: skip("parfillskip"), ...spaces },
    "badly centered": { leftSkip: skip("leftskip", 65536, 1), rightSkip: skip("rightskip", 65536, 1), parFillSkip: skip("parfillskip") },
  }
  // \\ is \@centercr but in justified text (\@parboxrestore's \@normalcr): \unskip\par, then \addvspace{-\parskip} (a
  // \vskip of zero after a line), and the next paragraph, its indentation \parindent (zero)
  const parts = action === "justified" ? [text] : centercrSplit(text)
  const sz = k.sizes[size]
  const list: Node[] = []
  let pd: number | null = null
  parts.forEach((part, i) => {
    const last = i === parts.length - 1
    // (new_graf's \parskip, and LaTeX's restart of the paragraph adds it again)
    if (i > 0) list.push(glue(0), paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
    let p: ReturnType<typeof paragraphInput>
    try {
      p = paragraphInput(part, k, size, doc, {
        attrs, hsize: width, start: i === 0 ? [emptyBox("hlist", 0), emptyBox("hlist", 0), ...before] : [emptyBox("hlist", 0)], amsmath, ...sloppy(em),
        clubPenalty: outer.club, widowPenalty: outer.widow, noteWidowPenalty: outer.widow, finalHyphenDemerits: outer.finalHyph, ...shapes[action],
        // (the group's \aftergroup\unskip comes before the color's \reset@color)
        unskip: 1, end: last ? after : [],
      })
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a node's text "${text.trim().slice(0, 40)}"`)
      throw e
    }
    const lb = lineBreak(p.list, p.params)
    outer.notes.push(...p.notes, lb.trace)
    for (const x of lb.vlist) {
      if (x.kind === "hlist") pd = appendToVlist(list, x, pd, sz.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit)
      else list.push(x)
    }
  })
  return vtop(list) // (\endminipage's \unskip finds a line)
}

/** text at each \\ outside braces; \\* and \\[…], and an empty last part (\\ at the end) are not modeled */
function centercrSplit(text: string): string[] {
  const parts: string[] = []
  let depth = 0, from = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "{") depth++
    else if (c === "}") depth--
    else if (c === "\\") {
      if (text[i + 1] === "\\" && depth === 0) {
        parts.push(text.slice(from, i))
        from = i + 2
        if (/^\s*[*[]/.test(text.slice(from))) throw new Unsupported("a node's text with \\\\* or \\\\[…]")
      }
      i++
    }
  }
  parts.push(text.slice(from))
  if (parts.length > 1 && !parts.at(-1)!.trim()) throw new Unsupported("a node's text ending with \\\\")
  return parts
}

/** picture number n where it stands, with xcolor's current color there, the current font's em and ex, its size and font */
export function tikzAt(cx: Ctx, colors: Colors, n: number, color: string, units: { em: number; ex: number }, size: SizeCommand, attrs: FontAttrs, outer: TabularOuter): Node[] {
  const tikz = cx.pre.tikz
  if (!tikz) throw new Unsupported("a tikzpicture without tikz")
  const src = cx.tikz[n]
  let nodes = nodeRegistries.get(cx.doc)
  if (!nodes) nodeRegistries.set(cx.doc, (nodes = new Map()))
  const doc = new TikzDocument({
    units, colors, positioning: tikz.libraries.includes("positioning"), arrowsMeta: tikz.libraries.includes("arrows.meta"),
    text: { hlist: (text, font) => nodeHlist(text, font, cx.run.k, size, cx.doc, attrs, cx.pre.amsmath), baselines: (font) => nodeBaselines(font, cx.run.k, size),
      units: (font) => nodeUnits(font, cx.run.k, size, cx.doc, attrs),
      minipage: (text, nodeFont, textFont, width, action, before, after) => nodeMinipage(text, nodeFont, textFont, width, action, before, after, cx.run.k, size, cx.doc, attrs, cx.pre.amsmath, outer) }, nodes,
  })
  // the preamble's style definitions
  for (const line of tikz.sets) {
    const t = tokenize(line)
    if (t[0] === "\\tikzset") {
      const body = t.slice(1).join("").trim()
      doc.tz.set(tokenize(body.slice(1, -1)))
    } else if (doc.tz.tikzstyle(t.slice(1)) !== t.length - 1) throw new Unsupported(`preamble: ${line}`)
    const st = doc.tz.st
    if (st.options.length || st.mode.length || st.transform?.length) throw new Unsupported(`preamble: ${line} sets more than styles`)
  }
  // (the arrow tips instantiated so far are the document's: its first picture's state keeps them)
  doc.arrows = arrowStates.get(cx.doc) ?? null
  const s = new PgfState(units)
  // (the color pgf reads as `.`: \colorlet's view of xcolor's current color)
  const used = doc.picture(src, s, cx.driver === "pdftex" ? new PdftexDriver(s) : new DvipsDriver(s), colors.pgfColor(color))
  if (tokenize(src, false, true).slice(used).some((x) => x !== " ")) throw new Unsupported("text after a picture")
  if (doc.arrows) arrowStates.set(cx.doc, doc.arrows)
  return s.out
}
