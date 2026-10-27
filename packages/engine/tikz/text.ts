// A node's text box with several lines (tikz.code.tex, line numbers cite it): `align=` without a text width
// puts each line, up to `\\` (\tikz@align@newline), in an \hbox of its own and stacks them with an \halign
// of one column in a \vbox, the lines so far as its first row (\tikz@align@end@check, 4243–4264).

import type { GlueSpec } from "../layout/dimen"
import { appendToVlist } from "../latex/paragraph"
import { halign } from "../layout/align"
import { filGlue, glue, paramGlue, type BoxNode, type Node } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { Unsupported } from "../latex/unsupported"

/** \baselineskip, \lineskip and \lineskiplimit where the lines are stacked */
export interface Baselines { baselineskip: GlueSpec; lineskip: GlueSpec; lineskiplimit: number }

/** the templates \tikz@align@left@header, …right…, …center… (1185–1187): \hfil before and after the cell's text */
const HEADERS: Record<string, [boolean, boolean]> = {
  "\\tikz@align@left@header": [false, true],
  "\\tikz@align@right@header": [true, false],
  "\\tikz@align@center@header": [true, true],
}

/** one line of an aligned node: its \hbox's list, and the \vskip (sp) its `\\[…]` asks for after it */
export interface AlignLine { list: Node[]; skip: number }

/**
 * The aligned box: the first line's \hbox; each next line a row of \vbox{\halign{<header> \box<so far>\cr
 * \noalign{\vskip<skip>pt}\unhbox<line>\unskip\cr}}. A line that a `\\` ends has had its \unskip
 * (\tikz@align@newline@); the last has not.
 */
export function alignLines(lines: AlignLine[], header: string, b: Baselines): BoxNode {
  const h = HEADERS[header]
  if (!h) throw new Unsupported(`tikz: node halign header ${header}`)
  let box = hpack(lines[0].list)
  for (let i = 1; i < lines.length; i++) {
    const row = (x: Node[], unskip: boolean): Node[] => {
      const out = [...(h[0] ? [filGlue()] : []), ...x]
      // (\unskip after an empty line takes the template's \hfil)
      if (unskip && out.at(-1)?.kind === "glue") out.pop()
      return [...out, ...(h[1] ? [filGlue()] : [])]
    }
    const tabskip = paramGlue("tabskip", glue(0))
    const [first, second] = halign([[row([box], false)], [row(lines[i].list, true)]], [tabskip, tabskip], { additional: 0 })
    const list: Node[] = [first, glue(lines[i - 1].skip)]
    appendToVlist(list, second, first.depth, b.baselineskip, b.lineskip, b.lineskiplimit)
    box = vpack(list)
  }
  return box
}
