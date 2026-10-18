// fancyhdr (v5.2, TL 2025) with \pagestyle{fancy}: twelve fields, a left, centre and right one for the head
// and the foot of odd and even pages. \fancyhead, \fancyfoot and \fancyhf set them by selectors
// (\f@nch@fancyhf); \lhead … \rfoot are the old names. A field not empty is its text and a \strut
// (\f@nch@def). At shipout each is a \parbox of \headwidth (\textwidth when \ps@fancy first ran) holding
// a \raggedright, \centering or \raggedleft paragraph in the normal size, bottom-aligned in the head and
// top-aligned in the foot (\f@nch@parbox); the three overlap, the left in an \rlap and the right in an
// \llap with \hfill between (\f@nch@hfbox@center), under the head rule or over the foot rule
// (\f@nch@head, \f@nch@foot), in a \vbox no taller than \headheight or \footskip (\f@nch@vbox).

import { xnOverD } from "../layout/arith"
import { parseDimen, roundDecimals } from "../layout/dimen"
import { QUAD } from "../layout/font"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, fillGlue, glue, ssGlue, type BoxNode, type Node } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import type { ParagraphTrace } from "../trace/decisions"
import type { Ctx } from "./context"
import { today } from "./frontmatter"
import { centering, raggedleft, raggedright, sloppy } from "./kernel"
import type { MarkValue } from "./marks"
import { appendToVlist, fontDeclaration, paragraphInput } from "./paragraph"
import { vtop } from "./tabular"
import { Unsupported } from "./unsupported"
import { IGNORE_DEPTH } from "./vlist"

/** The fields by name (e|o, l|c|r, h|f: "olh" is the odd pages' left head), each as \f@nch@def left it */
export interface FancyHdr { fields: Record<string, string>; headrulewidth: string; footrulewidth: string }

const def = (text: string) => (text === "" ? "" : `${text}\\strut`) // \f@nch@def

/** \f@nch@initialise: the article's fields, \headrulewidth 0.4pt, \footrulewidth 0pt */
export function fancyDefaults(twoside: boolean): FancyHdr {
  const f: FancyHdr = { fields: {}, headrulewidth: "0.4pt", footrulewidth: "0pt" }
  for (const eo of "eo") for (const lcr of "lcr") for (const hf of "hf") f.fields[eo + lcr + hf] = ""
  const right = def("\\fancyplain{}{\\slshape\\rightmark}"), left = def("\\fancyplain{}{\\slshape\\leftmark}")
  if (twoside) Object.assign(f.fields, { elh: right, orh: right, erh: left, olh: left })
  else Object.assign(f.fields, { elh: right, olh: right, erh: left, orh: left })
  Object.assign(f.fields, { ecf: def("\\rmfamily\\thepage"), ocf: def("\\rmfamily\\thepage") })
  return f
}

/** a preamble line fancyhdr reads, applied to `f`; false for any other line */
export function fancyCommand(f: FancyHdr, line: string): boolean {
  const m = line.match(/^\\fancy(head|foot|hf)(?:\[([^\]]*)\])?\{(.*)\}$/)
  if (m) {
    const [, cmd, sel = "", text] = m
    // \f@nch@fancyhf: each comma-separated selector picks e/o, l/c/r and h/f, all of a kind when it names none
    if (/[^eolcrhf,\s]/i.test(sel)) throw new Unsupported(`\\fancy${cmd}[${sel}]`)
    for (const item of sel.split(",").map((x) => x.replace(/\s/g, "").toLowerCase())) {
      const pick = (all: string, s: string) => [...all].filter((c) => s.includes(c)).join("") || all
      const hf = pick("hf", (cmd === "hf" ? "" : cmd[0]) + item)
      for (const eo of pick("eo", item)) for (const lcr of pick("lcr", item)) for (const x of hf) f.fields[eo + lcr + x] = def(text)
    }
    return true
  }
  // \lhead{…} … \rfoot{…}: the odd field, and the even one as its default \f@nch@olh (\LXfancyfield{olh}: whatever that
  // field holds at shipout), which is not empty text: another \strut
  const old = line.match(/^\\([lcr])(head|foot)\{(.*)\}$/)
  if (old) {
    const key = `${old[1]}${old[2][0]}`
    f.fields[`o${key}`] = def(old[3])
    f.fields[`e${key}`] = `\\LXfancyfield{o${key}}\\strut`
    return true
  }
  const rule = line.match(/^\\LXfancyrule\{(headrulewidth|footrulewidth)\}\{([^{}]*)\}$/) // \renewcommand (source.ts)
  if (rule) { f[rule[1] as "headrulewidth" | "footrulewidth"] = rule[2].trim(); return true }
  return false
}

/** \@thehead and \@thefoot on a page of style fancy, and the paragraphs their fields make (TeX breaks them at shipout) */
export function fancyPage(cx: Ctx, f: FancyHdr, even: boolean, thepage: string, marks: { left?: MarkValue; right?: MarkValue }): { head: Node[]; foot: Node[]; traces: ParagraphTrace[] } {
  const k = cx.run.k, sz = k.sizes.normalsize
  const headwidth = k.dimens.textwidth
  const traces: ParagraphTrace[] = []
  const eo = even ? "e" : "o"
  const dimen = (x: string) => { try { return parseDimen(x, { em: cx.romanFont.params[QUAD], ex: 0 }) } catch { throw new Unsupported(`fancyhdr's rule width ${x}`) } }

  /** \leftmark and \rightmark: what the mark typesets, as source */
  const markSource = (m: MarkValue | undefined) => (m?.parts ?? []).map((p) => ("text" in p ? (m!.upper ? p.text.toUpperCase() : p.text) : "quad" in p ? "\\quad " : "\\ ")).join("")
  /** \f@nch@parbox: \parbox[v]{\headwidth}{h\leavevmode\ignorespaces field} in the normal size, after \@parboxrestore */
  const field = (name: string, v: "b" | "t", h: "l" | "c" | "r"): BoxNode => {
    let text = f.fields[name].replace(/\\LXfancyfield\{(\w+)\}/g, (_, other: string) => f.fields[other]), struts = 0
    while (text.endsWith("\\strut")) { text = text.slice(0, -6); struts++ }
    // (after a control word, a space keeps the text that comes in its place apart from it)
    const sep = (before: string) => (/\\[A-Za-z]+$/.test(before) ? " " : "")
    text = expandFancyplain(text)
      .replace(/\\thepage(?![A-Za-z])\s*/g, (_, at: number, s: string) => sep(s.slice(0, at)) + thepage)
      .replace(/\\today(?![A-Za-z])\s*/g, (_, at: number, s: string) => sep(s.slice(0, at)) + today(cx.epoch))
      .replace(/\\(left|right)mark(?![A-Za-z])\s*/g, (_, lr: string, at: number, s: string) => sep(s.slice(0, at)) + markSource(lr === "left" ? marks.left : marks.right))
    // declarations that start the field (\slshape, \rmfamily …) set its font, which the parbox's group ends
    let attrs = cx.normalAttrs
    for (let d = text.match(/^\\([a-z]+)(?![A-Za-z])\s*/); d; d = text.match(/^\\([a-z]+)(?![A-Za-z])\s*/)) {
      const next = fontDeclaration(d[1], attrs, k, "normalsize", cx.doc)
      if (!next) break
      attrs = next; text = text.slice(d[0].length)
    }
    if (/\s$/.test(text)) throw new Unsupported("a fancyhdr field ending with a space")
    const strut: Node = { kind: "rule", width: 0, height: sz.strut.height, depth: sz.strut.depth } // \unhcopy\strutbox
    const shape = h === "l" ? raggedright() : h === "c" ? centering() : raggedleft()
    let p: ReturnType<typeof paragraphInput>
    try {
      p = paragraphInput(text, k, "normalsize", cx.doc, { attrs, hsize: headwidth, start: [emptyBox("hlist", 0)], end: Array.from({ length: struts }, () => ({ ...strut })), amsmath: cx.pre.amsmath, ...sloppy(cx.romanFont.params[QUAD]), ...shape })
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a fancyhdr field "${text.slice(0, 40)}"`)
      throw e
    }
    const lb = lineBreak(p.list, p.params)
    traces.push(...p.notes, lb.trace)
    const list: Node[] = []
    let pd: number | null = IGNORE_DEPTH
    for (const x of lb.vlist) { if (x.kind === "hlist") pd = appendToVlist(list, x, pd, sz.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit); else list.push(x) }
    return v === "t" ? vtop(list) : vpack(list)
  }
  /** \f@nch@hfbox@center (three fields of \headwidth always overflow it) */
  const fields = (hf: "h" | "f") => {
    const v = hf === "h" ? "b" : "t"
    const l = field(`${eo}l${hf}`, v, "l"), c = field(`${eo}c${hf}`, v, "c"), r = field(`${eo}r${hf}`, v, "r")
    return hpack([hpack([l, ssGlue()], { exactly: 0 }), fillGlue(), c, fillGlue(), hpack([ssGlue(), r], { exactly: 0 })], { exactly: headwidth })
  }
  /** \f@nch@vbox: the box, its height cut to the parameter's */
  const limited = (b: BoxNode, max: number) => { if (b.height > max) b.height = max; return b }
  /** \f@nch@Oolh … around the \hbox to\headwidth: \hss after it on odd pages, before it on even ones */
  const placed = (b: BoxNode): Node[] => (even ? [ssGlue(), hpack([b], { exactly: headwidth })] : [hpack([b], { exactly: headwidth }), ssGlue()])

  const hr = dimen(f.headrulewidth), fr = dimen(f.footrulewidth)
  // \headrule: \hrule\@height\headrulewidth\@width\headwidth \vskip-\headrulewidth, after \vskip\headruleskip (0pt)
  const head = limited(vpack([fields("h"), glue(0), { kind: "rule", width: headwidth, height: hr, depth: 0 }, glue(-hr)]), k.dimens.headheight)
  // \footrule, then \vskip\footruleskip (.3\normalbaselineskip)
  const footruleskip = xnOverD(sz.baselineskip.width, roundDecimals([3]), 65536)
  const foot = limited(vpack([{ kind: "rule", width: headwidth, height: fr, depth: 0 }, glue(footruleskip), fields("f")]), k.dimens.footskip)
  return { head: placed(head), foot: placed(foot), traces }
}

/** \fancyplain{plain}{fancy}: the second, unbraced (\if@fancyplain is false in \ps@fancy) */
function expandFancyplain(s: string): string {
  for (let i = s.indexOf("\\fancyplain"); i >= 0; i = s.indexOf("\\fancyplain")) {
    const args: string[] = []
    let j = i + 11
    for (let n = 0; n < 2; n++) {
      while (/\s/.test(s[j] ?? "")) j++
      if (s[j] !== "{") throw new Unsupported("\\fancyplain without braced arguments")
      let depth = 0, k = j
      for (; k < s.length; k++) { if (s[k] === "{") depth++; else if (s[k] === "}" && --depth === 0) break }
      args.push(s.slice(j + 1, k)); j = k + 1
    }
    s = s.slice(0, i) + args[1] + s.slice(j)
  }
  return s
}
