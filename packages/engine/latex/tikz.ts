// TikZ's pictures in a document (tikz.sty): each tikzpicture environment and \tikz taken out of the source
// (\LXtikz{n}) and typeset where it stands by tikz/path.ts on pgf/, under the document's driver (pgf's dvips or
// pdfTeX system layer). A picture's \pgfsys@typesetpicturebox is \leavevmode, the trims' kerns and the picture's
// box: a picture starts a paragraph like a box. pgfmath reads em and ex in the font where the picture stands,
// and nodes' text is typeset there too (\pgfinterruptpicture's \pgfutil@selectfont), as an \hbox's list. Named
// nodes and coordinates are global: a later picture reaches an earlier one's (as TeX does without `remember
// picture`, at the same coordinates in its own picture).

import type { Node } from "../layout/nodes"
import { DvipsDriver } from "../pgf/drivers/dvips"
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
