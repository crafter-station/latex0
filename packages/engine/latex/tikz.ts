// TikZ's pictures in a document (tikz.sty): each tikzpicture environment and \tikz taken out of the source
// (\LXtikz{n}) and typeset where it stands by tikz/path.ts on pgf/, under the document's driver (pgf's dvips or
// pdfTeX system layer). A picture's \pgfsys@typesetpicturebox is \leavevmode, the trims' kerns and the picture's
// box: a picture starts a paragraph like a box. pgfmath reads em and ex in the font where the picture stands.

import type { Node } from "../layout/nodes"
import { DvipsDriver } from "../pgf/drivers/dvips"
import { PdftexDriver } from "../pgf/drivers/pdftex"
import { PgfState } from "../pgf/state"
import { TikzDocument } from "../tikz/path"
import { tokenize } from "../tikz/tokens"
import type { Ctx } from "./context"
import { Unsupported } from "./unsupported"
import type { Colors } from "./xcolor"

/** picture number n where it stands, with xcolor's current color there and the current font's em and ex */
export function tikzAt(cx: Ctx, colors: Colors, n: number, color: string, units: { em: number; ex: number }): Node[] {
  const tikz = cx.pre.tikz
  if (!tikz) throw new Unsupported("a tikzpicture without tikz")
  const src = cx.tikz[n]
  const doc = new TikzDocument({ units, colors, positioning: tikz.libraries.includes("positioning"), arrowsMeta: tikz.libraries.includes("arrows.meta") })
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
  const s = new PgfState(units)
  const used = doc.picture(src, s, cx.driver === "pdftex" ? new PdftexDriver(s) : new DvipsDriver(s), color)
  if (tokenize(src, false, true).slice(used).some((x) => x !== " ")) throw new Unsupported("text after a picture")
  return s.out
}
