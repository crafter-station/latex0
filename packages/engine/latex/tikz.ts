// TikZ's pictures in a document (tikz.sty): each tikzpicture environment and \tikz taken out of the source
// (\LXtikz{n}) and typeset where it stands by tikz/path.ts on pgf/, under the document's driver (pgf's dvips or
// pdfTeX system layer). A picture's \pgfsys@typesetpicturebox is \leavevmode, the trims' kerns and the picture's
// box: a picture starts a paragraph like a box. pgfmath reads em and ex in the font where the picture stands,
// and nodes' text is typeset there too (\pgfinterruptpicture's \pgfutil@selectfont), as an \hbox's list. Named
// nodes and coordinates are global: a later picture reaches an earlier one's (as TeX does without `remember
// picture`, at the same coordinates in its own picture).

import { kern, ssGlue, type BoxNode, type Node } from "../layout/nodes"
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
import { tokenize } from "../tikz/tokens"
import { SIZE_COMMANDS, type ClassOptionData, type SizeCommand } from "../layout/classdata"
import type { Ctx } from "./context"
import { DECLARATIONS, hlistInput, type DocState, type FontAttrs } from "./paragraph"
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
  const decls: string[] = []
  for (const m of font.matchAll(/\\([A-Za-z]+)\s*|(\S)/g)) {
    if (m[1] && (SIZE_COMMANDS as readonly string[]).includes(m[1])) size = m[1] as SizeCommand
    else if (m[1] && DECLARATIONS.includes(m[1])) decls.push(m[1])
    else throw new Unsupported(`tikz: font=${font}`)
  }
  if (decls.length) src = `{${decls.map((d) => `\\${d} `).join("")}${src}}`
  if (/\\(?:footnote|label|par)(?![A-Za-z])/.test(text)) throw new Unsupported(`a node's text "${text.trim().slice(0, 40)}"`)
  try { return hlistInput(src, k, size, doc, attrs, { spaceFactor: 1000 }, amsmath, undefined, true) } catch (e) {
    if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a node's text "${text.trim().slice(0, 40)}"`)
    throw e
  }
}

/** picture number n where it stands, with xcolor's current color there, the current font's em and ex, its size and font */
export function tikzAt(cx: Ctx, colors: Colors, n: number, color: string, units: { em: number; ex: number }, size: SizeCommand, attrs: FontAttrs): Node[] {
  const tikz = cx.pre.tikz
  if (!tikz) throw new Unsupported("a tikzpicture without tikz")
  const src = cx.tikz[n]
  let nodes = nodeRegistries.get(cx.doc)
  if (!nodes) nodeRegistries.set(cx.doc, (nodes = new Map()))
  const doc = new TikzDocument({
    units, colors, positioning: tikz.libraries.includes("positioning"), arrowsMeta: tikz.libraries.includes("arrows.meta"),
    text: { hlist: (text, font) => nodeHlist(text, font, cx.run.k, size, cx.doc, attrs, cx.pre.amsmath) }, nodes,
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
  const used = doc.picture(src, s, cx.driver === "pdftex" ? new PdftexDriver(s) : new DvipsDriver(s), color)
  if (tokenize(src, false, true).slice(used).some((x) => x !== " ")) throw new Unsupported("text after a picture")
  if (doc.arrows) arrowStates.set(cx.doc, doc.arrows)
  return s.out
}
