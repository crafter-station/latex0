// letter.cls: \begin{letter}{to} with \opening and \closing (\ps@firstpage, the address and date at
// \longindentation, the signature's \parbox), and its \par tokens.

import type { GlueSpec } from "../layout/dimen"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, glue, paramGlue, penalty, type Node, filGlue } from "../layout/nodes"
import { vpack } from "../layout/pack"
import { xnOverD } from "../layout/arith"
import { type Block } from "./blocks"
import type { Ctx } from "./context"
import { processBlock } from "./body"
import { Unsupported } from "./unsupported"
import { dimen, IGNORE_DEPTH, negate, VerticalList } from "./vlist"
import { type OutputHook } from "./output"
import { preamble, type TabLine } from "./tabular"
import { mathEnv, paragraphInput } from "./paragraph"
import { today } from "./frontmatter"
import { tabular } from "./boxes"

/**
 * \tableofcontents: \section*{\contentsname} (report: \chapter*), then \@starttoc{toc}, which reads
 * the lines the run before wrote (\contentsline → \l@<name>) and ends with \@nobreakfalse
 */
/**
 * letter.cls's letter environment: \newpage, \c@page\@ne, \interlinepenalty200. \opening (with a return
 * address): \thispagestyle{empty}, {\raggedleft\begin{tabular}{l@{}}\fromaddress\\*[2\parskip]\@date
 * \end{tabular}\par}, \vspace{2\parskip}, {\raggedright\toname\\\toaddress\par}, \vspace{2\parskip}, the
 * opening\par\nobreak; the body; \closing: \par\nobreak\vspace{\parskip}, \stopbreaks (\interlinepenalty\@M,
 * \par is \@@par\nobreak), \noindent\hspace*{\longindentation}\parbox{\indentedwidth}{\raggedright closing
 * \\[6\medskipamount] signature\strut}\par; \end{letter}'s \pagebreak
 */
export function letter(cx: Ctx, b: Extract<Block, { kind: "letter" }>) {
  const { amsmath, classTextwidth, cls, letterInfo, medskipamount, pagestyle, title } = cx.pre
  const { decisions, doc, epoch, outerParskip, run, typeset, v } = cx
  if (cls !== "letter") throw new Unsupported(`a letter in ${cls}`)
  if (pagestyle === "headings") throw new Unsupported("letter's \\ps@headings") // To: name, date, Page n
  // letter.cls's \footnoterule and \@makefntext (a 5pt \hangindent) are its own
  if (/\\footnote\b/.test(JSON.stringify(b))) throw new Unsupported("a footnote in a letter")
  if (!letterInfo.address) throw new Unsupported("a letter without \\address (\\ps@firstpage)")
  if (run.k.ints.twoside) throw new Unsupported("a two-sided letter")
  const check = (t: string) => { if (/[\\{}$%&#^_~]/.test(t.replace(/\\\\/g, ""))) throw new Unsupported(`a letter's "${t}"`) }
  ;[letterInfo.address, b.to, letterInfo.signature ?? letterInfo.name ?? "", b.closing].forEach(check)
  const hook = (h: OutputHook): Node => ({ kind: "whatsit", text: "", hook: h })
  const sz = run.k.sizes.normalsize
  v.par()
  v.nodes.push(filGlue(), penalty(-10000), hook("page=1"))
  run.k = { ...run.k, ints: { ...run.k.ints, interlinepenalty: 200 } }
  const parskip = run.k.glue.parskip.width // letter.cls: 0.7em; 2\parskip is a dimension
  const vspace = (g: GlueSpec) => { v.vskip(g); v.vskip(dimen(0)) } // \vspace in vertical mode
  const flush = (p: string) => paramGlue(p, filGlue())
  const raggedleft = { leftSkip: flush("leftskip"), rightSkip: paramGlue("rightskip", glue(0)), parFillSkip: paramGlue("parfillskip", glue(0)), finalHyphenDemerits: 0 }
  const raggedright = { rightSkip: flush("rightskip"), finalHyphenDemerits: 0 }
  // \opening
  v.nodes.push(hook("empty"))
  const from = letterInfo.address.split(/\\\\/).map((x) => x.trim())
  const date = (title.date ?? "\\today").replace(/\\today\b\s*/g, today(epoch)).trim()
  check(date)
  const lines: TabLine[] = from.map((r, i) => ({ cells: [{ text: r }], ...(i === from.length - 1 ? { skip: 2 * parskip } : {}) }))
  lines.push({ cells: [{ text: date }] })
  typeset("", { ...raggedleft, start: [emptyBox("hlist", 0), tabular(cx, lines, preamble("l@{}"), "normalsize", "c")] }, outerParskip)
  vspace(dimen(2 * parskip))
  b.to.split(/\\\\/).map((x) => x.trim()).forEach((line, i) => { // \@centercr between the lines
    if (i) v.addvspace(negate(outerParskip))
    typeset(line, { ...raggedright, start: [emptyBox("hlist", 0)] }, outerParskip)
  })
  vspace(dimen(2 * parskip))
  typeset(b.opening, {}, outerParskip)
  v.nodes.push(penalty(10000))
  b.blocks.forEach((x, i, all) => processBlock(cx, x, i, all))
  // \closing
  v.par()
  v.nodes.push(penalty(10000))
  vspace(run.k.glue.parskip)
  run.k = { ...run.k, ints: { ...run.k.ints, interlinepenalty: 10000 } }
  const longindentation = xnOverD(classTextwidth, 32768, 65536), width = classTextwidth - longindentation
  // the \parbox: \@parboxrestore (\parskip and \parindent zero), \raggedright, \\[6\medskipamount] (\@centercr)
  const pv = new VerticalList(run.k)
  pv.nodes = []; pv.prevDepth = IGNORE_DEPTH
  const inBox = (text: string, end: Node[]) => {
    const p = paragraphInput(text, run.k, "normalsize", doc, { ...raggedright, hsize: width, start: [emptyBox("hlist", 0)], amsmath })
    p.list.push(...end)
    const lb = lineBreak(p.list, p.params)
    decisions.push(...p.notes, lb.trace)
    return lb.vlist
  }
  pv.lines(inBox(b.closing, []))
  pv.addvspace(dimen(0))
  pv.vskip(dimen(6 * medskipamount))
  pv.paragraph(inBox(letterInfo.signature ?? letterInfo.name ?? "", [{ kind: "rule", width: 0, height: sz.strut.height, depth: sz.strut.depth }]), dimen(0)) // \strut
  const box = vpack(pv.nodes)
  const delta = box.height + box.depth // \vcenter (make_vcenter, § 736)
  box.height = mathEnv(run.k, "normalsize", amsmath).fonts[0][2]!.params[22] + (delta % 2 ? Math.trunc((delta + 1) / 2) : delta / 2)
  box.depth = delta - box.height
  const parbox: Node[] = [{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }]
  // \noindent \hspace*: \vrule width\z@ \nobreak \hskip \hskip\z@skip
  typeset("", { start: [{ kind: "rule", width: 0, height: null, depth: null }, penalty(10000), glue(longindentation), glue(0), ...parbox] }, outerParskip)
  v.nodes.push(penalty(10000))
  for (let i = 0; i < b.pars; i++) v.nodes.push(penalty(10000)) // the \par of a blank line: \@@par\nobreak
  v.nodes.push(penalty(-10000)) // \end{letter}'s \pagebreak
}
