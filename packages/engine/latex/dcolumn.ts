// dcolumn.sty (v1.06): the D{sep}{out}{places} column, \newcolumntype{D}[3]{>{\DC@{#1}{#2}{#3}}c<{\DC@end}}.
// \DC@ reads the places (\count@#3) and sets the entry as two boxes, \box\z@ what comes before the first sep
// character and \box\tw@ {out} and what follows it, each a formula ($…$ under \m@th; sep has \mathcode "8000 and
// ends the first box where it stands):
//   places < 0, \DC@centre: \hbox{$before$} and \hbox{${out}after$} (without a sep \hbox{${\phantom{{out}}}$}), the
//     narrower one widened to the other's width with \hfill on its outer side: the sep in the column's middle;
//   places n, \DC@right: \hfill before the boxes (the column's \hfil's lose), \hbox{$before$} and
//     \hbox to n digits (\hbox{$1$}'s width) + \hbox{${out}$}'s width {${out}after$\hfil} (without a sep, empty);
//   places m.n: the first box is \hbox to m digits{\hss\hfill$before$} too.
// \DC@end's \hfil goes in whichever box is open: the first one when the entry has no sep.

import { filGlue, fillGlue, ssGlue, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { Unsupported } from "./unsupported"

/** the column type dcolumn defines (array.sty's \newcolumntype) */
export const DCOLUMN_TYPE = { n: 3, spec: ">{\\DC@{#1}{#2}{#3}}c<{\\DC@end}" }

/** D's arguments: the sep character, what is set for it, and the places */
export interface DColumn { sep: string; out: string; places: string }

/** a braced group at i: its contents and where it ends */
function group(s: string, i: number): [string, number] | null {
  if (s[i] !== "{") return null
  for (let depth = 0, j = i; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue }
    if (s[j] === "{") depth++
    else if (s[j] === "}" && --depth === 0) return [s.slice(i + 1, j), j + 1]
  }
  return null
}

/** a column's >{decl} and <{decl} when they are D's (null: no D column); other declarations with them are not modeled */
export function dcolumnOf(pre: string, post: string): DColumn | null {
  if (!pre.includes("\\DC@") && !post.includes("\\DC@")) return null
  const bad = () => new Unsupported(`a D column with >{${pre}} and <{${post}}`)
  if (!pre.startsWith("\\DC@{") || post !== "\\DC@end") throw bad()
  const a = group(pre, 4), b = a && group(pre, a[1]), c = b && group(pre, b[1])
  if (!a || !b || !c || c[1] !== pre.length) throw bad()
  // (\uccode`\~=`#1: one character; a letter or a digit would be read with the entry's)
  if (!/^[^\sA-Za-z0-9\\{}$&#^_~%]$/.test(a[0])) throw new Unsupported(`D{${a[0]}}: its separator`)
  return { sep: a[0], out: b[0], places: c[0] }
}

/**
 * A D column's entry, between the column's \hskip1sp and \do@row@strut: `cell` sets source in restricted horizontal
 * mode (the entry's formulas)
 */
export function dcolumnEntry(dc: DColumn, text: string, cell: (src: string) => Node[]): Node[] {
  // \afterassignment\DC@x\count@#3\relax: the number, and what follows it
  const pm = dc.places.match(/^\s*(-?)(\d+) ?([^]*)$/)
  if (!pm) throw new Unsupported(`D{${dc.sep}}{${dc.out}}{${dc.places}}`)
  // the entry at the first sep at the top level (its \mathcode "8000 is the first formula's alone)
  if (/[$&]|\\(?:\\|multirow|multicolumn|hfill?|hss|par)(?![A-Za-z])/.test(text)) throw new Unsupported(`a D column's entry "${text.trim().slice(0, 40)}"`)
  let at = -1
  for (let i = 0, depth = 0; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue }
    if (text[i] === "{") depth++
    else if (text[i] === "}") depth--
    else if (text[i] === dc.sep) {
      if (depth) throw new Unsupported(`a D column's entry "${text.trim().slice(0, 40)}": its separator in a group`)
      at = i; break
    }
  }
  const formula = (src: string): Node[] => (src.trim() ? cell(`$${src.trim()}$`) : [{ kind: "math", on: true, width: 0 }, { kind: "math", on: false, width: 0 }])
  const before = formula(at < 0 ? text : text.slice(0, at))
  const after = at < 0 ? null : formula(`{${dc.out}}${text.slice(at + 1)}`)
  if (pm[1] && Number(pm[2]) > 0) { // \DC@centre
    let box0 = hpack(before), box2 = hpack(after ?? cell(`\${\\phantom{{${dc.out}}}}$`))
    if (box0.width > box2.width) box2 = hpack([...box2.list, fillGlue()], { exactly: box0.width }) // (\unhbox\tw@\hfill)
    else box0 = hpack([fillGlue(), ...box0.list], { exactly: box2.width })
    return [box0, box2]
  }
  // \DC@right: the digits after (\count@\@gobble#3: what follows the places' own separator), or the places
  const digit = hpack(cell("$1$")).width
  let right = Number(pm[2])
  if (pm[3]) {
    const r = pm[3].match(/^[^\s\\{}]\s*(\d+) ?$/)
    if (!r) throw new Unsupported(`D{${dc.sep}}{${dc.out}}{${dc.places}}`)
    right = Number(r[1])
  }
  const dimen = right * digit + hpack(cell(`\${${dc.out}}$`)).width
  const end = after ? [] : [filGlue()]
  const box0 = pm[3] ? hpack([ssGlue(), fillGlue(), ...before, ...end], { exactly: Number(pm[2]) * digit }) : hpack([...before, ...end])
  const box2 = hpack(after ? [...after, filGlue()] : [], { exactly: dimen })
  return [...(pm[3] ? [] : [fillGlue()]), box0, box2]
}
