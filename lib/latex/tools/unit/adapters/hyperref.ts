// hyperref with its dvips driver (pdfmark.def), as LaTeX loads it for `latex`: the pdfmark
// \special nodes of anchors, links and outlines, and the bookmark lines it writes to the .out file.

import { printScaled } from "../../../layout/arith"
import { glue, kern, penalty, FIL, type BoxNode, type Node } from "../../../layout/nodes"
import { hpack, vpack } from "../../../layout/pack"

const special = (ps: string): Node => ({ kind: "whatsit", text: `\\special{${ps}}` })
const sdict = (s: string): Node => special(`ps:SDict begin ${s} end`)

/** \strip@pt@and@otherjunk: a dimension in pt without "pt", and without ".0" */
export const stripPt = (sp: number): string => printScaled(sp).replace(/\.0$/, "")

export const HS = () => sdict("H.S")
export const HR = () => sdict("H.R")
/** \hyper@anchorend's \literalps@out{\strip@pt\baselineskip\space H.A} */
export const HA = (baselineskip: number) => sdict(`${stripPt(baselineskip)} H.A`)
export const HL = (baselineskip: number) => sdict(`${stripPt(baselineskip)} H.L`)
export const dest = (name: string) => sdict(`[/View [/XYZ H.V]/Dest (${name}) cvn /DEST pdfmark`)

/**
 * \hyper@anchorstart{name}\hyper@anchorend: \Hy@SaveLastskip, H.S, \Hy@AllowHyphens (\nobreak\hskip\z@skip
 * in horizontal mode), \baselineskip H.A, the /DEST pdfmark, \Hy@RestoreLastskip. `last` is the node the
 * list ends with: after a skip, \nobreak\vskip-\lastskip\vskip\lastskip; after anything but an hbox (in
 * vertical mode), \nobreak; (\Hy@raisedlink is empty in this driver)
 */
export function anchor(name: string, baselineskip: number, mode: "v" | "h", last: Node | undefined): Node[] {
  const out: Node[] = [HS()]
  if (mode === "h") out.push(penalty(10000), glue(0))
  out.push(HA(baselineskip), dest(name))
  if (last?.kind === "glue" && last.width !== 0) { // \ifdim\lastskip=\z@ looks at the natural width
    out.push(penalty(10000), glue(-last.width, -last.stretch, last.stretchOrder, -last.shrink, last.shrinkOrder), glue(last.width, last.stretch, last.stretchOrder, last.shrink, last.shrinkOrder))
  } else if (mode === "h" || last?.kind !== "hlist") out.push(penalty(10000))
  return out
}

/**
 * \hyper@anchor{name} (\pdfmark[\anchor@spot]: \pdf@rect gives H.S and H.R), the /DEST pdfmark, and
 * \Hy@RestoreLastskip as for anchor()
 */
export function spotAnchor(name: string, mode: "v" | "h", last: Node | undefined): Node[] {
  return [HS(), HR(), dest(name), ...anchor(name, 0, mode, last).slice(mode === "h" ? 5 : 3)]
}

/** \Hy@@SectionAnchor: \hbox to 0pt{\kern-\Hy@SectionHShift <anchor> \hss}, at the start of a heading's title */
export function sectionAnchorBox(name: string, shift: number, baselineskip: number): BoxNode {
  const k = kern(-shift, true)
  return hpack([k, ...anchor(name, baselineskip, "h", k), glue(0, 65536, FIL, 65536, FIL)], { exactly: 0 })
}

/**
 * A \ref or \pageref link (\hyper@link through \pdf@rect): H.S, the text in an hbox, \raise\ht H.R in an
 * empty hbox, and the /ANN pdfmark with the anchor
 */
export function refLink(text: Node[], name: string, color?: string): Node[] {
  // (with a color package the text's box is a \color@setgroup: the current color pushed and popped)
  const box = hpack(color ? [{ kind: "whatsit", text: `\\special{color push ${color}}` }, ...text, { kind: "whatsit", text: "\\special{color pop}" }] : text)
  // H.S at the box's bottom, \lower\dp in an hbox unless the depth is zero; H.R at its top likewise
  let start: Node = HS(), end: Node = HR()
  if (box.depth) { start = hpack([HS()]); start.shift = box.depth }
  if (box.height) { end = hpack([HR()]); end.shift = -box.height }
  return [start, box, end, sdict(`[/Color [1 0 0]/H /I/Border [0 0 1]BorderArrayPatch/Subtype /Link/Dest (${name}) cvn H.B /ANN pdfmark`)]
}

/** A toc line's link (\hyper@linkstart … \hyper@linkend): an hbox with H.S, \Hy@AllowHyphens, the entry, H.L, the /ANN pdfmark */
export function tocLink(content: Node[], name: string, baselineskip: number): BoxNode {
  // in restricted horizontal mode no empty discretionary follows a hyphen (§ 1039)
  content = content.filter((n) => !(n.kind === "disc" && !n.pre.length && !n.post.length && !n.replaceCount))
  return hpack([HS(), penalty(10000), glue(0), ...content, HL(baselineskip), sdict(`[/Subtype /Link/Dest (${name}) cvn/H /I/Border [0 0 1]BorderArrayPatch/Color [1 0 0] H.B /ANN pdfmark`)])
}

/**
 * \pdfstringdef with the unicode option, as \BOOKMARK lines have it: UTF-16BE with octal escapes, a
 * space, parentheses, the backslash and # % & $ as \ooo; null when the title has what is not modeled
 */
export function pdfString(title: string): string | null {
  // \textbf{…} and friends keep their text; \# \% \& \$ are the characters; ~ is a space
  let t = title.replace(/\\(?:textbf|textmd|textit|textsl|textsc|textup|textrm|textsf|texttt|textnormal|emph)\s*\{([^{}]*)\}/g, "$1")
  t = t.replace(/\\([#%&$])/g, "$1").replace(/~/g, " ")
  if (/[\\{}$^_]/.test(t) || /[^\x20-\x7e]/.test(t)) return null
  let out = "\\376\\377"
  for (const c of t) out += " ()\\#%&$".includes(c) ? `\\000\\${c.charCodeAt(0).toString(8).padStart(3, "0")}` : `\\000${c}`
  return out
}

export interface Bookmark { level: number; anchor: string; title: string; parent: string }

/** \Hy@writebookmark's state: \Hy@currentbookmarklevel, \Parent<level>, and the lines written so far */
export class Bookmarks {
  private current = 0
  private checked = false
  private parents = new Map<number, string>()
  readonly written: Bookmark[] = []
  /** \@@writetorep: a level more than one below the current one is fixed; \Parent<level> is the anchor */
  add(level: number, anchor: string, title: string): Node | null {
    const pdf = pdfString(title)
    if (pdf === null) return null
    if (this.checked && this.current < level - 1) level = this.current + 1
    this.checked = true
    this.current = level
    this.parents.set(level, anchor)
    const parent = this.parents.get(level - 1) ?? ""
    const b = { level, anchor, title: pdf, parent }
    this.written.push(b)
    return { kind: "whatsit", text: `\\write3{\\protect \\BOOKMARK [${level}][-]{${anchor}}{${pdf}}{${parent}}% ${this.written.length}}` }
  }
}

/**
 * What \AtBeginDocument puts on the main vertical list: the outlines read back from the .out file
 * (/Count is minus the number of children), the /DOCVIEW and Catalog pdfmarks; then the Doc-Start anchor
 */
export function documentStart(bookmarks: Bookmark[]): Node[] {
  const children = new Map<string, number>()
  for (const b of bookmarks) if (b.parent) children.set(b.parent, (children.get(b.parent) ?? 0) + 1)
  return [
    ...bookmarks.map((b) => sdict(`[/Count -${children.get(b.anchor) ?? 0}/Dest (${b.anchor}) cvn/Title (${b.title}) /OUT pdfmark`)),
    sdict("[/PageMode /UseOutlines/Page 1/View [/Fit] /DOCVIEW pdfmark"),
    sdict("[ {Catalog}<<>> /PUT pdfmark"),
  ]
}

/**
 * \AtBeginShipout: the page in a \vbox after the page anchor, \vbox to 0pt{\kern\voffset \kern\topmargin
 * \kern-1bp \hbox to 0pt{\kern\hoffset \kern\oddsidemargin \kern-1bp H.S H.R /DEST page.n \nobreak\hss}\vss}
 */
export function pageAnchor(page: string, topmargin: number, sidemargin: number): BoxNode {
  const bp = 65781 // 1bp
  const h = hpack([kern(0, true), kern(sidemargin, true), kern(-bp, true), HS(), HR(), dest(`page.${page}`), penalty(10000), glue(0, 65536, FIL, 65536, FIL)], { exactly: 0 })
  return vpack([kern(0, true), kern(topmargin, true), kern(-bp, true), h, glue(0, 65536, FIL, 65536, FIL)], { exactly: 0 })
}

/**
 * nameref's \@currentlabelname for a heading: its title's tokens as \@onelevel@sanitize prints them (a
 * control word with a space after it, spaces after it in the source skipped), without one final period
 */
export function labelName(title: string): string {
  let out = ""
  for (let i = 0; i < title.length; ) {
    const cw = title.slice(i).match(/^\\([A-Za-z@]+)\s*/)
    if (cw) { out += `\\${cw[1]} `; i += cw[0].length; continue }
    if (title[i] === "\\") { out += title.slice(i, i + 2); i += 2; continue }
    if (/\s/.test(title[i])) { if (!out.endsWith(" ")) out += " "; i++; continue }
    out += title[i++]
  }
  return out.replace(/\.$/, "")
}
