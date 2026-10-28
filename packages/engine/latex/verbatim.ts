// LaTeX's \verb and verbatim environment (latex.ltx, ltmiscen.dtx): the text in \verbatim@font with \@noligs,
// \language\l@nohyphenation, \frenchspacing and \@vobeyspaces. \verb is \leavevmode\null and the text in a group;
// verbatim is \@verbatim's trivlist (\item\relax, \vskip\parskip, \leftskip and \rightskip zero, \parfillskip
// \@flushglue, \parskip zero), each line a paragraph that \par (\obeylines) ends with \leavevmode\null\@@par
// \penalty\interlinepenalty, the first one with the item's labels (\everypar's \unpenalty taking off its \penalty\z@).

import type { Font } from "../layout/font"
import { spaceGlue } from "../layout/hmode"
import { appendRun } from "../layout/mainloop"
import { emptyBox, kern, penalty, type Node } from "../layout/nodes"
import { Unsupported } from "./unsupported"

/** \verbatim@nolig@list: each made active as \leavevmode\kern\z@\char`c (\do@noligs) */
const NOLIG = "`<>,'-"

/** \frenchspacing's \sfcode: the uppercase letters' 999 and the 0 of ) ' ] stay, everything else is 1000 */
const frenchSf = (c: number) => (c >= 65 && c <= 90 ? 999 : c === 41 || c === 39 || c === 93 ? 0 : 1000)

/**
 * Verbatim text in `font`: its characters as typed (the font's \hyphenchar is -1: no discretionary after -), each of
 * \verbatim@nolig@list after \kern\z@, a space \nobreakspace (\penalty\@M and the font's \ ), or with `star`
 * \asciispace (\char32). `state`'s space factor is what its characters leave.
 */
export function verbatimText(text: string, star: boolean, font: Font, state: { spaceFactor: number }): Node[] {
  const list: Node[] = []
  let run: number[] = []
  const flush = () => { if (run.length) appendRun(list, run, font, { paragraph: true, hyphenChar: -1 }); run = [] }
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (c === 9 || c > 126 || c < 32) throw new Unsupported(`a tab or a character other than printable ASCII in verbatim text`)
    if (c === 32 && !star) { flush(); list.push(penalty(10000), spaceGlue(font, 1000)); continue }
    if (NOLIG.includes(ch)) { flush(); list.push(kern(0, true)) }
    run.push(c)
    // (adjust_space_factor, § 1034)
    const s = frenchSf(c)
    if (s === 1000) state.spaceFactor = 1000
    else if (s < 1000) { if (s > 0) state.spaceFactor = s }
    else if (state.spaceFactor < 1000) state.spaceFactor = 1000
  }
  flush()
  return list
}

/** \verb's material where it stands (not in math): \null (space factor 1000), then the text */
export function verbNodes(text: string, star: boolean, font: Font, state: { spaceFactor: number }): Node[] {
  state.spaceFactor = 1000
  return [emptyBox("hlist"), ...verbatimText(text, star, font, state)]
}

/**
 * A verbatim environment's lines as the paragraphs' material, each without its start (the indentation box or the
 * labels): the line's text and \null. The last line (what comes before \end{verbatim} on its line) is one only when
 * it is not empty, \endtrivlist's \unskip taking off a space that ends it.
 */
export function verbatimLines(lines: string[], star: boolean, font: Font): Node[][] {
  const out: Node[][] = []
  lines.forEach((line, i) => {
    const last = i === lines.length - 1
    if (last && !line) return
    const nodes = verbatimText(line, star, font, { spaceFactor: 1000 })
    if (last && nodes.at(-1)?.kind === "glue") nodes.pop()
    out.push([...nodes, emptyBox("hlist")])
  })
  if (!out.length) throw new Unsupported("an empty verbatim environment")
  return out
}
