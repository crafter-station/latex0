// algorithm.sty's float (float.sty's \newfloat{algorithm}{htbp}{loa} in the ruled style) and algorithmicx's
// algorithmic environment with algpseudocode's entities.

import { QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT, loadFont } from "../layout/font"
import { Scanner } from "../layout/dimen"
import { appendText } from "../layout/hmode"
import { lineBreak } from "../layout/linebreak"
import { filGlue, glue, kern, paramGlue, penalty, type BoxNode, type Node } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import type { ParagraphTrace } from "../trace/decisions"
import type { Ctx } from "./context"
import { dataFont } from "./data"
import { sloppy } from "./kernel"
import { appendToVlist, crefWrites, labelWrite, paragraphInput } from "./paragraph"
import { Unsupported } from "./unsupported"
import { IGNORE_DEPTH, LOW_PENALTY } from "./vlist"
import { colorPop, colorPush, setgroup, xcolor } from "./xcolor"

/** algpseudocode's options: [noend] takes the end entities' text away (\algtext*) */
export interface AlgorithmPackages {
  algorithm: boolean; algpseudocode: boolean; noend: boolean
  /** setspace loaded after float.sty: its \@xfloat (single spacing) runs for [H] too */
  singleHere?: boolean
}

const kw = (w: string) => `\\textbf{${w}}`

/**
 * An entity (\algdef): its arguments, the blocks it ends (or continues), the block it opens, and its text.
 * \State opens STATE, a block of no credits that the next entity closes; the others open blocks of
 * infinite credits, which only their own end entities close.
 */
interface Entity { args: number; closes?: string[]; opens?: string; end?: boolean; text: (a: string[]) => string }
const proc = (name: string) => ([n, args]: string[]) => `${kw(name)}\\ \\textsc{${n}}${args === "" ? "" : `(${args})`}`
const ENTITIES: Record<string, Entity> = {
  State: { args: 0, opens: "STATE", text: () => "" },
  If: { args: 1, opens: "IF", text: ([c]) => `${kw("if")}\\ ${c}\\ ${kw("then")}` },
  ElsIf: { args: 1, closes: ["IF"], opens: "IF", text: ([c]) => `${kw("else")}\\ ${kw("if")}\\ ${c}\\ ${kw("then")}` },
  Else: { args: 0, closes: ["IF"], opens: "ELSE", text: () => kw("else") },
  EndIf: { args: 0, closes: ["IF", "ELSE"], end: true, text: () => `${kw("end")}\\ ${kw("if")}` },
  While: { args: 1, opens: "WHILE", text: ([c]) => `${kw("while")}\\ ${c}\\ ${kw("do")}` },
  EndWhile: { args: 0, closes: ["WHILE"], end: true, text: () => `${kw("end")}\\ ${kw("while")}` },
  For: { args: 1, opens: "FOR", text: ([c]) => `${kw("for")}\\ ${c}\\ ${kw("do")}` },
  ForAll: { args: 1, opens: "FOR", text: ([c]) => `${kw("for all")}\\ ${c}\\ ${kw("do")}` },
  EndFor: { args: 0, closes: ["FOR"], end: true, text: () => `${kw("end")}\\ ${kw("for")}` },
  Loop: { args: 0, opens: "LOOP", text: () => kw("loop") },
  EndLoop: { args: 0, closes: ["LOOP"], end: true, text: () => `${kw("end")}\\ ${kw("loop")}` },
  Repeat: { args: 0, opens: "REPEAT", text: () => kw("repeat") },
  Until: { args: 1, closes: ["REPEAT"], text: ([c]) => `${kw("until")}\\ ${c}` },
  Procedure: { args: 2, opens: "PROCEDURE", text: proc("procedure") },
  EndProcedure: { args: 0, closes: ["PROCEDURE"], end: true, text: () => `${kw("end")}\\ ${kw("procedure")}` },
  Function: { args: 2, opens: "FUNCTION", text: proc("function") },
  EndFunction: { args: 0, closes: ["FUNCTION"], end: true, text: () => `${kw("end")}\\ ${kw("function")}` },
}

/** A braced argument at `i` (after spaces, as TeX reads an undefined argument): its text and where it ends. */
function argument(src: string, i: number): [string, number] {
  while (/\s/.test(src[i] ?? "")) i++
  if (src[i] !== "{") throw new Unsupported(`algorithmic: an argument without braces near "${src.slice(i, i + 20)}"`)
  let depth = 0
  for (let j = i; j < src.length; j++) {
    if (src[j] === "\\") j++
    else if (src[j] === "{") depth++
    else if (src[j] === "}" && --depth === 0) return [src.slice(i + 1, j), j + 1]
  }
  throw new Unsupported("algorithmic: an unbalanced argument")
}

/** algpseudocode's commands in a line's text: \Return (\algorithmicreturn{} ), \Call, \textproc, \Comment (\hfill\(\triangleright\) #1) */
function inline(text: string): string {
  let out = "", i = 0
  for (;;) {
    const m = text.slice(i).match(/\\(Return|Call|textproc|Comment)(?![A-Za-z])\s*/)
    if (!m) return out + text.slice(i)
    out += text.slice(i, i + m.index!)
    i += m.index! + m[0].length
    if (m[1] === "Return") { out += `${kw("return")}{} `; continue }
    const [a, j] = argument(text, i)
    if (m[1] === "textproc") { out += `\\textsc{${inline(a)}}`; i = j; continue }
    if (m[1] === "Comment") { out += `\\hfill $\\triangleright$ ${inline(a)}`; i = j; continue }
    const [b, k] = argument(text, j)
    out += `\\textsc{${inline(a)}}${b === "" ? "" : `(${inline(b)})`}`; i = k
  }
}

/** One \item of the list: what makes its label, and the text after it. */
interface Item { kind: "entity" | "label" | "statex"; entity?: string; label?: string; text: string; tlm: number }

/**
 * The algorithmic environment's lines, as \list builds them in a float (\@minipagetrue: the first \item adds
 * nothing above it): \list{\ALG@step}{… \labelwidth 1.2em (0.5em unnumbered) \labelsep 0.5em \leftmargin
 * \labelwidth+\labelsep \topsep 0.2em …}; each entity is \item (\item[] with no text) \noindent\hskip\ALG@tlm
 * and its text, \Require and \Ensure \item[\textbf{…}], \Statex \item[]. Returns \prevdepth and the lines
 * \ALG@step counted (ALG@line).
 */
function algorithmic(cx: Ctx, src: string, content: Node[], prevDepth: number | null, decisions: ParagraphTrace[], noend: boolean): { prevDepth: number | null; lines: number } {
  const { amsmath } = cx.pre
  const { doc, romanFont, run } = cx
  const k = run.k
  const units = { em: romanFont.params[QUAD], ex: romanFont.params[X_HEIGHT] }
  const em = (x: string) => new Scanner(x, units).scanDimen().value
  const opt = src.match(/^\s*\[\s*(\d+)\s*\]/)
  const freq = opt ? Number(opt[1]) : 0
  let body = opt ? src.slice(opt[0].length) : src
  const labelwidth = em(freq === 0 ? "0.5em" : "1.2em"), labelsep = em("0.5em"), leftmargin = labelwidth + labelsep
  const indent = em("1.5em") // \algorithmicindent
  const topsep = em("0.2em")
  // the items, with the block stack's \ALG@tlm at each
  const items: Item[] = []
  const stack: { block: string; indent: number }[] = []
  let tlm = 0
  const pop = () => { tlm -= stack.pop()!.indent }
  const re = /\\(State|Statex|If|ElsIf|Else|EndIf|While|EndWhile|For|ForAll|EndFor|Loop|EndLoop|Repeat|Until|Procedure|EndProcedure|Function|EndFunction|Require|Ensure)(?![A-Za-z])\s*/g
  body = body.replace(/(^|[^\\])%.*$/gm, "$1")
  const lead = body.slice(0, body.search(re) < 0 ? body.length : body.search(re))
  if (lead.trim()) throw new Unsupported(`algorithmic: text before the first line "${lead.trim().slice(0, 30)}"`)
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const name = m[1]
    let i = m.index + m[0].length
    let item: Item
    if (name === "Require" || name === "Ensure") item = { kind: "label", label: `${name}:`, text: "", tlm }
    else if (name === "Statex") item = { kind: "statex", text: "", tlm }
    else {
      const e = ENTITIES[name]
      const args: string[] = []
      for (let a = 0; a < e.args; a++) { const [x, j] = argument(body, i); args.push(inline(x)); i = j }
      // \ALG@makebegin, \ALG@makenobegin: a block of no credits that this entity does not end is closed by force
      while (stack.length && stack.at(-1)!.block === "STATE" && !e.closes?.includes("STATE")) pop()
      if (e.closes) {
        if (!stack.length || !e.closes.includes(stack.at(-1)!.block)) throw new Unsupported(`algorithmic: \\${name} with no block of its own open`)
        pop()
      }
      item = { kind: "entity", entity: name, text: noend && e.end ? "" : e.text(args), tlm }
      if (e.opens) { stack.push({ block: e.opens, indent }); tlm += indent }
    }
    re.lastIndex = i
    const next = body.slice(i).search(re)
    const end = next < 0 ? body.length : i + next
    item.text += inline(body.slice(i, end))
    items.push(item)
    re.lastIndex = end
  }
  while (stack.length && stack.at(-1)!.block === "STATE") pop() // \ALG@closeloops
  if (stack.length) throw new Unsupported(`algorithmic: a block left open (${stack.at(-1)!.block})`)
  if (!items.length) throw new Unsupported("algorithmic with no lines")
  const footnotesize = loadFont(dataFont(k.sizes.footnotesize.font.name), k.sizes.footnotesize.font.at)
  const bold = loadFont(dataFont(k.sizes.normalsize.bold.name), k.sizes.normalsize.bold.at)
  let line = 0, rem = 0
  let pd = prevDepth
  items.forEach((it, n) => {
    const notext = it.kind === "entity" && noend && ENTITIES[it.entity!].end
    // \@item: after the first, \addpenalty\@itempenalty \addvspace\itemsep (zero: \vskip of it)
    if (n > 0) content.push(penalty(-LOW_PENALTY), glue(0))
    // \makelabel: \@mklab (\hfil #1) of \ALG@step, which numbers every \ALG@numberfreq-th line in \footnotesize
    const label: Node[] = [filGlue()]
    if (it.kind === "entity" && !notext) {
      line++; rem++
      if (String(rem) === String(freq)) { rem = 0; appendText(label, `${line}:`, footnotesize, { spaceFactor: 1000 }, false) }
    } else if (it.kind === "label") {
      appendText(label, it.label!, bold, { spaceFactor: 1000 }, false)
      label.push(kern(0, true)) // \textbf's \check@icr (no italic correction after the colon)
    }
    // \sbox\@tempboxa{\makelabel{…}}: the color group (\color@setgroup) inside
    const natural = hpack(setgroup(label.slice()))
    const boxed = natural.width > labelwidth ? natural : hpack(setgroup(label), { exactly: labelwidth })
    const labels = hpack([glue(0), glue(-labelwidth), glue(-labelsep), boxed, glue(labelsep)])
    // \noindent: \everypar finds no indentation box, \kern-\itemindent; otherwise it takes the box off
    const start: Node[] = it.kind === "entity" ? [kern(0, true), labels, penalty(0), glue(it.tlm)] : [labels, penalty(0)]
    const par = paragraphInput(it.text, k, "normalsize", doc, { start, parShape: [[leftmargin, k.dimens.columnwidth - leftmargin]], ...sloppy(romanFont.params[QUAD]), clubPenalty: k.ints.clubpenalty, amsmath, unskip: n < items.length - 1 ? 2 : 1 })
    const lb = lineBreak(par.list, par.params)
    decisions.push(...par.notes, lb.trace)
    // new_graf in internal vertical mode adds \parskip only to a list that is not empty, and so does LaTeX's restart
    if (content.length) content.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
    if (notext) pd = IGNORE_DEPTH // \nointerlineskip
    for (const x of lb.vlist) {
      if (x.kind === "hlist") pd = appendToVlist(content, x, pd, k.sizes.normalsize.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit)
      else content.push(x)
    }
  })
  // \endtrivlist: \@endparenv, \addpenalty\@endparpenalty \addvspace\@topsepadd (\topsep, with \partopsep zero)
  content.push(penalty(-LOW_PENALTY), glue(topsep))
  return { prevDepth: pd, lines: line }
}

/**
 * An algorithm float's box: its body (\caption's \addcontentsline and \label's writes, the algorithmic
 * environment), then \float@makebox in the ruled style: \hrule height.8pt \kern2pt, the caption's box
 * ({\bfseries Algorithm n} text\par, built where \caption stands), \kern2pt\hrule\kern2pt, the body,
 * \kern2pt\hrule, \vskip\z@.
 */
export function algorithmBox(cx: Ctx, fbody: string, decisions: ParagraphTrace[], club: number, here = false): BoxNode {
  const { algorithm, hyper } = cx.pre
  const { counters, doc, refs, romanFont, run } = cx
  const k = run.k
  if (!algorithm.algorithm) throw new Unsupported("an algorithm float without algorithm.sty")
  if (hyper) throw new Unsupported("an algorithm float with hyperref")
  const content: Node[] = []
  // ([H]: \setbox\@floatcapt=\vbox{}, so the caption's rule comes even with no caption)
  let cap: Node[] | null = here ? [] : null, number = 0, captioned = false
  let pd: number | null = IGNORE_DEPTH
  const re = /\\caption\s*\{((?:[^{}]|\{[^{}]*\})*)\}|\\label\s*\{([^{}]*)\}|\\begin\{algorithmic\}([^]*?)\\end\{algorithmic\}|\S+/g
  let listed = false
  for (const m of fbody.matchAll(re)) {
    if (m[1] !== undefined) {
      if (captioned) throw new Unsupported("two captions in an algorithm")
      if (cx.pre.usesCaption) throw new Unsupported("an algorithm caption with caption.sty") // (its float.sty styles)
      captioned = true
      const text = m[1].replace(/\s+/g, " ").trim()
      if (/[\\{}$%&#^_~]/.test(text)) throw new Unsupported(`caption "${text}"`)
      number = ++counters.algorithm
      refs.href = `algorithm.${number}` // global; \@currentlabel ends with the float's group
      // \addcontentsline{loa}{algorithm}{\protect\numberline{n}{\ignorespaces text}}
      content.push({ kind: "whatsit", text: `\\write1{\\@writefile{loa}{\\protect \\contentsline {algorithm}{\\protect \\numberline {${number}}{\\ignorespaces ${text}}}{\\thepage }{}\\protected@file@percent }}` })
      // \float@caption: \vbox{\@parboxrestore\normalsize {\bfseries Algorithm n} text\par}
      const start: Node[] = [hpack([])]
      const bf = loadFont(dataFont(k.sizes.normalsize.bold.name), k.sizes.normalsize.bold.at)
      appendText(start, `Algorithm ${number}`, bf, { spaceFactor: 1000 }, false)
      start.push(glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0))
      const par = paragraphInput(text, k, "normalsize", doc, { start, ...sloppy(romanFont.params[QUAD]), clubPenalty: club, amsmath: cx.pre.amsmath })
      const lb = lineBreak(par.list, par.params)
      decisions.push(...par.notes, lb.trace)
      cap = []
      let cd: number | null = IGNORE_DEPTH
      for (const x of lb.vlist) {
        if (x.kind === "hlist") cd = appendToVlist(cap, x, cd, k.sizes.normalsize.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit)
        else cap.push(x)
      }
      continue
    }
    if (m[2] !== undefined) {
      if (!number) throw new Unsupported("\\label before the caption")
      if (!/^[A-Za-z0-9:._-]+$/.test(m[2])) throw new Unsupported(`\\label{${m[2]}}`)
      // (cleveref: the caption's \refstepcounter{algorithm}, a counter within nothing; algorithmicx's line
      // counter is the type only in the algorithmic's group)
      content.push(labelWrite(refs, m[2], String(number), refs.href, refs.name), ...crefWrites(refs, m[2], false, { type: "algorithm", arabic: number, prefix: "", label: String(number) }))
      continue
    }
    if (m[3] !== undefined) {
      if (listed) throw new Unsupported("two algorithmic environments in an algorithm")
      if (!algorithm.algpseudocode) throw new Unsupported("algorithmic without algpseudocode")
      listed = true
      const alg = algorithmic(cx, m[3], content, pd, decisions, algorithm.noend)
      pd = alg.prevDepth
      // cleveref's algorithmicx support: \ALG@step's \refstepcounter{ALG@line}, whose \@currentHref is global
      if (cx.pre.cleveref && alg.lines) refs.href = `ALG@line.${alg.lines}`
      continue
    }
    throw new Unsupported(`${m[0]} in an algorithm`)
  }
  content.push(glue(0)) // \@endfloatbox: \par\vskip\z@skip
  const rule = (h: number): Node => ({ kind: "rule", width: null, height: h, depth: 0 })
  const two = 2 * 65536
  const body = xcolor.on ? [colorPush(), vpack(content), colorPop()] : [vpack(content)] // \color@vbox\normalcolor\vbox{…}, unboxed
  return vpack([
    rule(new Scanner(".8pt", { em: 0, ex: 0 }).scanDimen().value), kern(two, true),
    ...(cap ? [...cap, kern(two, true), rule(26214), kern(two, true)] : []),
    ...body, kern(two, true), rule(26214), glue(0),
  ])
}
