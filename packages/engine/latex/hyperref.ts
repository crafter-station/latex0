// hyperref with its dvips driver (pdfmark.def), as LaTeX loads it for `latex`: the pdfmark
// \special nodes of anchors, links and outlines, and the bookmark lines it writes to the .out file. With
// pdfTeX's driver (hpdftex.def, `pdflatex`) an anchor is a \pdfdest and a link \pdfstartlink … \pdfendlink
// around its text, which stays in the paragraph (no box: it can break across lines); the outlines are
// \pdfoutline objects, no nodes.

import { printScaled } from "../layout/arith"
import { glue, kern, penalty, type BoxNode, type Node, ssGlue } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { Unsupported } from "./unsupported"
import { sourceText, withoutTextCommands } from "./encodings"

/** a link's type, as \pdf@linktype or \hyper@link's first argument names it: its \@<type>color and \@<type>bordercolor */
export type LinkType = "link" | "cite" | "url" | "file" | "anchor"

/** the document's driver: set for each layout (DocumentOptions.driver); `onLink`, where a layout counts pdfTeX's
 *  objects, is told of each \pdfstartlink typeset (it takes an object number then); and hyperref's link options:
 *  \@pdfborder, and with colorlinks each link type's color as the driver's color special (\Hy@colorlink) */
export const hyperDriver: { pdftex: boolean; onLink: (() => void) | null; border: string; colors: Record<LinkType, string> | null } = { pdftex: false, onLink: null, border: "0 0 1", colors: null }
/** hyperref's defaults, for a layout whose options are not hyperref's own (beamer's) */
export const HYPER_LINK_DEFAULTS = { border: "0 0 1", colors: null }

/** pdfmark.def's Border key (\@pdfborder) as the /ANN pdfmark has it, and hpdftex.def's \Hy@setpdfborder */
const border = () => `/Border [${hyperDriver.border}]BorderArrayPatch`
const pdfBorder = () => `/Border[${hyperDriver.border}]`
/** \Hy@colorlink … \Hy@endcolorlink with colorlinks: the color pushed, popped at the group's end */
function colored(type: LinkType, nodes: Node[]): Node[] {
  const c = hyperDriver.colors?.[type]
  return c === undefined ? nodes : [{ kind: "whatsit", text: `\\special{color push ${c}}` }, ...nodes, { kind: "whatsit", text: "\\special{color pop}" }]
}

const special = (ps: string): Node => ({ kind: "whatsit", text: `\\special{${ps}}` })
/** hpdftex.def's \Hy@DestName: \pdfdest name{…} xyz (\@pdfview) */
export const pdfdest = (name: string): Node => ({ kind: "whatsit", text: `\\pdfdest name{${name}} xyz` })
/** \pdfstartlink with its running size, and \pdfendlink (\close@pdflink) */
function startLink(action: string): Node {
  hyperDriver.onLink?.()
  return { kind: "whatsit", text: `\\pdfstartlink(*+*)x* ${action}` }
}
const endLink = (): Node => ({ kind: "whatsit", text: "\\pdfendlink" })
/** a pdfTeX link around the text where it stands: \pdfstartlink with its attributes and action, \pdfendlink */
export const pdftexLink = (action: string, text: Node[]): Node[] => [startLink(action), ...text, endLink()]
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
  // hpdftex.def's \new@pdflink: \Hy@SaveLastskip, the \pdfdest, \Hy@RestoreLastskip; in horizontal mode inside
  // \Hy@raisedlink (empty with dvips): \penalty\@M \smash{\raise\baselineskip\hbox{…}}, where nothing came before
  if (hyperDriver.pdftex && mode === "h") return raisedlink([pdfdest(name), ...restoreLastskip("h", undefined)], baselineskip)
  const out: Node[] = hyperDriver.pdftex ? [pdfdest(name)] : [HS(), ...(mode === "h" ? [penalty(10000), glue(0)] : []), HA(baselineskip), dest(name)]
  return [...out, ...restoreLastskip(mode, last)]
}

/** \Hy@raisedlink in horizontal mode: \penalty\@M, then \smash (an \hbox, its height and depth zero) of the material
 *  in an \hbox raised by \baselineskip */
export function raisedlink(material: Node[], baselineskip: number): Node[] {
  const raised = hpack(material); raised.shift = -baselineskip
  const smash = hpack([raised]); smash.height = 0; smash.depth = 0
  return [penalty(10000), smash]
}

/** \MakeLinkTarget* in horizontal mode (\__hyp_target_raise:n): \penalty\@M and \smash of the anchor
 *  (\hyper@anchorstart…\hyper@anchorend; with pdfTeX the \pdfdest, not raised again) in an \hbox raised by
 *  \normalbaselineskip */
export function linkTarget(name: string, baselineskip: number, normalBaselineskip: number): Node[] {
  return raisedlink(hyperDriver.pdftex ? [pdfdest(name), penalty(10000)] : anchor(name, baselineskip, "h", undefined), normalBaselineskip)
}

/** \Hy@RestoreLastskip after an anchor */
function restoreLastskip(mode: "v" | "h", last: Node | undefined): Node[] {
  const out: Node[] = []
  if (last?.kind === "glue" && last.width !== 0) { // \ifdim\lastskip=\z@ looks at the natural width
    out.push(penalty(10000), glue(-last.width, -last.stretch, last.stretchOrder, -last.shrink, last.shrinkOrder), glue(last.width, last.stretch, last.stretchOrder, last.shrink, last.shrinkOrder))
  } else if (mode === "h" || last?.kind !== "hlist") out.push(penalty(10000))
  return out
}

/**
 * \hyper@anchor{name} (\pdfmark[\anchor@spot]: \pdf@rect gives H.S and H.R), the /DEST pdfmark, and
 * \Hy@RestoreLastskip as for anchor()
 */
export function spotAnchor(name: string, mode: "v" | "h", last: Node | undefined, baselineskip = 0): Node[] {
  if (hyperDriver.pdftex && mode === "h") return raisedlink([pdfdest(name), ...restoreLastskip("h", undefined)], baselineskip)
  return [...(hyperDriver.pdftex ? [pdfdest(name)] : colored("anchor", [HS(), HR(), dest(name)])), ...restoreLastskip(mode, last)]
}

/** \Hy@@SectionAnchor: \hbox to 0pt{\kern-\Hy@SectionHShift <anchor> \hss}, at the start of a heading's title */
export function sectionAnchorBox(name: string, shift: number, baselineskip: number): BoxNode {
  const k = kern(-shift, true)
  return hpack([k, ...anchor(name, baselineskip, "h", k), ssGlue()], { exactly: 0 })
}

/**
 * A \ref or \pageref link (\hyper@link through \pdf@rect): H.S, the text in an hbox, \raise\ht H.R in an
 * empty hbox, and the /ANN pdfmark with the anchor
 */
export function refLink(text: Node[], name: string, color?: string, type: "link" | "cite" = "link"): Node[] {
  // \@linkbordercolor, or \@citebordercolor for \hyper@@link[cite]
  const bc = type === "cite" ? "0 1 0" : "1 0 0"
  if (hyperDriver.pdftex) return [startLink(`attr{${pdfBorder()}/H/I/C[${bc}]} action goto name{${name}}`), ...colored(type, text), endLink()] // (find@pdflink)
  return colored(type, linkBox(text, hyperDriver.colors?.[type] ?? color, `[/Color [${bc}]/H /I${border()}/Subtype /Link/Dest (${name}) cvn H.B /ANN pdfmark`))
}

/** \hyper@linkurl (hdvips.def): a link to a URI around the typeset text, as for \ref */
export function uriLink(text: Node[], uri: string, color?: string): Node[] {
  if (hyperDriver.pdftex) return [startLink(`attr{${pdfBorder()}/H/I/C[0 1 1]} action user{/Subtype/Link/A<</Type/Action/S/URI/URI(${uri})>>}`), ...colored("url", text), endLink()]
  return colored("url", linkBox(text, hyperDriver.colors?.url ?? color, `[/H /I${border()}/Color [0 1 1]/Action <</Subtype/URI/URI(${uri})>>/Subtype /Link H.B /ANN pdfmark`))
}

/** \hyper@linkfile (pdfmark.def): a link to page 1 of another PDF file, in \@filecolor */
export function fileLink(text: Node[], file: string, color?: string): Node[] {
  if (hyperDriver.pdftex) return [startLink(`attr{${pdfBorder()}/H/I/C[0 .5 .5]} action user{/Subtype/Link/A<</F(${file})/S/GoToR/D[0/Fit]>>}`), ...colored("file", text), endLink()]
  return colored("file", linkBox(text, hyperDriver.colors?.file ?? color, `[/Subtype /Link/H /I${border()}/Color [0 .5 .5]/Action <</S/GoToR/F(${file})/D[0/Fit]>> H.B /ANN pdfmark`))
}

/** The text in an \hbox between H.S and H.R, then the link's pdfmark */
export function linkBox(text: Node[], color: string | undefined, pdfmark: string, unskip = false): Node[] {
  // (with a color package the text's box is a \color@setgroup: the current color pushed and popped; `unskip`: beamer's
  // \reset@color, the pop before a skip that ends the text)
  const last = text.at(-1), skip = unskip && last?.kind === "glue" && (last.width || last.stretch || last.shrink)
  const pop: Node = { kind: "whatsit", text: "\\special{color pop}" }
  const box = hpack(color ? [{ kind: "whatsit", text: `\\special{color push ${color}}` }, ...(skip ? [...text.slice(0, -1), pop, last] : [...text, pop])] : text)
  // H.S at the box's bottom, \lower\dp in an hbox unless the depth is zero; H.R at its top likewise
  let start: Node = HS(), end: Node = HR()
  if (box.depth) { start = hpack([HS()]); start.shift = box.depth }
  if (box.height) { end = hpack([HR()]); end.shift = -box.height }
  return [start, box, end, sdict(pdfmark)]
}

/** natbib's \hyper@natlinkstart{key} … \hyper@natlinkend: \hyper@linkstart{cite}{cite.key} (pdfmark.def: an \hbox with
 *  \Hy@colorlink, H.S and \Hy@AllowHyphens, the text (set in restricted horizontal mode), H.L and the /ANN pdfmark); with
 *  pdfTeX the link nodes where it stands */
export function natLink(content: Node[], key: string, baselineskip: number): Node[] {
  if (hyperDriver.pdftex) return refLink(content, `cite.${key}`, undefined, "cite")
  return [hpack(colored("cite", [HS(), penalty(10000), glue(0), ...content, HL(baselineskip), sdict(`[/Subtype /Link/Dest (cite.${key}) cvn/H /I${border()}/Color [0 1 0] H.B /ANN pdfmark`)]))]
}

/** A toc line's or a footnote mark's link (\hyper@linkstart … \hyper@linkend): an hbox with H.S, \Hy@AllowHyphens,
 *  the entry, H.L, the /ANN pdfmark; with pdfTeX the link nodes around the entry where it stands */
export function tocLink(content: Node[], name: string, baselineskip: number): Node[] {
  if (hyperDriver.pdftex) return [startLink(`attr{${pdfBorder()}/H/I/C[1 0 0]} action goto name{${name}}`), ...colored("link", content), endLink()]
  return [tocBox(content, name, baselineskip)]
}
function tocBox(content: Node[], name: string, baselineskip: number): BoxNode {
  // in restricted horizontal mode no empty discretionary follows a hyphen (§ 1039)
  content = content.filter((n) => !(n.kind === "disc" && !n.pre.length && !n.post.length && !n.replaceCount))
  return hpack(colored("link", [HS(), penalty(10000), glue(0), ...content, HL(baselineskip), sdict(`[/Subtype /Link/Dest (${name}) cvn/H /I${border()}/Color [1 0 0] H.B /ANN pdfmark`)]))
}

/**
 * \pdfstringdef with the unicode option, as \BOOKMARK lines have it: UTF-16BE with octal escapes, a
 * space, parentheses, the backslash and # % & $ as \ooo; null when the title has what is not modeled
 */
export function pdfString(title: string): string | null {
  // \textbf{…} and friends keep their text; \# \% \& \$ are the characters; ~ is a space
  let t = title.replace(/\\(?:textbf|textmd|textit|textsl|textsc|textup|textrm|textsf|texttt|textnormal|emph)\s*\{([^{}]*)\}/g, "$1")
  t = t.replace(/\\([#%&$])/g, "$1").replace(/~/g, " ")
  // (accented letters, typed or as commands, are their characters: PU's UTF-16; spanish.ts's marks go)
  if (/[\\{}$^_]/.test(withoutTextCommands(t))) return null
  t = sourceText(t).replace(/\ue000/g, "").replace(/ı(?=[\u0300-\u036f])/g, "i").normalize("NFC") // (\'{\i}: í)
  if (/[^\x20-\x7e\xa0-\xff]/.test(t)) return null
  let out = "\\376\\377"
  for (const c of t) out += " ()\\#%&$".includes(c) || c >= "\xa0" ? `\\000\\${c.charCodeAt(0).toString(8).padStart(3, "0")}` : `\\000${c}`
  return out
}

export interface Bookmark { level: number; anchor: string; title: string; parent: string }

/** \Hy@writebookmark's state: \Hy@currentbookmarklevel, \Parent<level>, and the lines written so far. The .out
 *  file is \write`stream`; `open` is the open state each line has (- for closed, empty with bookmarksopen). */
export class Bookmarks {
  constructor(private stream = 3, private open = "-") {}
  private current = 0
  private checked = false
  private parents = new Map<number, string>()
  readonly written: Bookmark[] = []
  private fixed = (level: number) => (this.checked && this.current < level - 1 ? this.current + 1 : level)
  /** the anchor of the bookmark a new one at the level would have as its parent (\Parent<level-1>) */
  parentOf(level: number): string | undefined { return this.parents.get(this.fixed(level) - 1) }
  /**
   * \@@writetorep: a level more than one below the current one is fixed; \Parent<level> is the anchor; the line has
   * `written`, the anchor after a \phantomsection the caller made because the parent's was the same
   */
  add(level: number, anchor: string, title: string, written = anchor): Node | null {
    const pdf = pdfString(title)
    if (pdf === null) return null
    level = this.fixed(level)
    this.checked = true
    this.current = level
    this.parents.set(level, anchor)
    const parent = this.parents.get(level - 1) ?? ""
    anchor = written
    const b = { level, anchor, title: pdf, parent }
    this.written.push(b)
    return { kind: "whatsit", text: `\\write${this.stream}{\\protect \\BOOKMARK [${level}][${this.open}]{${anchor}}{${pdf}}{${parent}}% ${this.written.length}}` }
  }
}

/**
 * What \AtBeginDocument puts on the main vertical list: the outlines read back from the .out file
 * (/Count is the number of children, negated unless `open`: bookmarksopen), the /DOCVIEW and Catalog pdfmarks;
 * then the Doc-Start anchor
 */
export function documentStart(bookmarks: Bookmark[], open = false): Node[] {
  if (hyperDriver.pdftex) return []
  const children = new Map<string, number>()
  for (const b of bookmarks) if (b.parent) children.set(b.parent, (children.get(b.parent) ?? 0) + 1)
  return [
    ...bookmarks.map((b) => sdict(`[/Count ${open ? "" : "-"}${children.get(b.anchor) ?? 0}/Dest (${b.anchor}) cvn/Title (${b.title}) /OUT pdfmark`)),
    sdict("[/PageMode /UseOutlines/Page 1/View [/Fit] /DOCVIEW pdfmark"),
    sdict("[ {Catalog}<<>> /PUT pdfmark"),
  ]
}

/**
 * hyperref's page labels (\HyPL@EveryPage at each shipout, \HyPL@StorePageLabel's \HyPL@Entry in the .aux): an entry
 * `abspage<</S/type>>` where the numbering style changes or the page number does not follow the last (from 1: one
 * from another number has ` /St n`), for \thepage an \arabic or \roman page number; "" when \HyPL@SetPageLabels
 * puts nothing (no entry, or only 0<</S/D>>)
 */
export function pageLabels(pages: { count: number; thepage: string }[]): string {
  let out = "", lastType = "", lastNumber = 0
  pages.forEach((p, i) => {
    const type = /^\d+$/.test(p.thepage) ? "D" : /^[ivxlcdm]+$/.test(p.thepage) ? "r" : null
    if (type === null || p.count <= 0) throw new Unsupported(`hyperref's page label for page ${p.thepage}`)
    if (type !== lastType || p.count - 1 !== lastNumber) {
      if (p.count !== 1) throw new Unsupported(`hyperref's page label starting at ${p.count}`) // (/St n)
      out += `${i}<</S/${type}>>`
    }
    lastType = type; lastNumber = p.count
  })
  return out === "0<</S/D>>" ? "" : out
}

/** \HyPL@SetPageLabels in \AtBeginDocument, what the last run wrote: \Hy@PutCatalog{/PageLabels<</Nums[…]>>} */
export const putPageLabels = (nums: string): Node => sdict(`[ {Catalog} <</PageLabels<</Nums[${nums}]>>>> /PUT pdfmark`)

/** pdfmark.def's \Hy@DistillerDestFix, the first thing \Hy@EveryPageAnchor puts in every page (dvips only) */
export const distillerDestFix = (): Node => sdict("/product where{pop product(Distiller)search{pop pop pop version(.)search{exch pop exch pop(3011)eq{gsave newpath 0 0 moveto closepath clip/Courier findfont 10 scalefont setfont 72 72 moveto(.)show grestore}if}{pop}ifelse}{pop}ifelse}if")

/** hyperref's options that change the page: package options, then \hypersetup in the preamble, in order */
export interface HyperOptions {
  /** \ifHy@colorlinks at \begin{document} */
  colorlinks: boolean
  /** \@pdfborder (colorlinks makes it 0 0 0 at \begin{document}) */
  border: string
  /** \@<type>color: a color expression, used with colorlinks */
  colors: Record<LinkType, string>
  /** the /DOCINFO strings, as \pdfstringdef made them (the creator's and producer's defaults as they are) */
  info: { producer: string; title: string; subject: string; creator: string; author: string; keywords: string }
  /** bookmarksopen */
  bookmarksOpen: boolean
}

export const hyperDefaults = (): HyperOptions => ({
  colorlinks: false, border: "0 0 1",
  colors: { link: "red", anchor: "black", cite: "green", file: "cyan", url: "magenta" },
  info: { producer: "dvips + Distiller", title: "", subject: "", creator: "LaTeX with hyperref", author: "", keywords: "" },
  bookmarksOpen: false,
})

/** a key=value list as kvsetkeys reads it: split at commas outside braces, each side trimmed, one pair of braces off a value */
export function keyvals(list: string): [string, string | null][] {
  const out: [string, string | null][] = []
  let depth = 0, from = 0
  const take = (part: string) => {
    if (!part.trim()) return
    const eq = part.indexOf("=")
    const key = (eq < 0 ? part : part.slice(0, eq)).trim()
    let value = eq < 0 ? null : part.slice(eq + 1).trim()
    if (value !== null && /^\{[^]*\}$/.test(value) && balancedBraces(value.slice(1, -1))) value = value.slice(1, -1)
    out.push([key, value])
  }
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "\\") { i++; continue }
    if (list[i] === "{") depth++
    else if (list[i] === "}") depth--
    else if (list[i] === "," && depth === 0) { take(list.slice(from, i)); from = i + 1 }
  }
  take(list.slice(from))
  return out
}
function balancedBraces(s: string): boolean {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue }
    if (s[i] === "{") depth++
    else if (s[i] === "}" && --depth < 0) return false
  }
  return depth === 0
}

const INFO_KEYS: Record<string, keyof HyperOptions["info"]> = { pdftitle: "title", pdfauthor: "author", pdfsubject: "subject", pdfkeywords: "keywords", pdfcreator: "creator", pdfproducer: "producer" }

/** hyperref's keys (\usepackage[…]{hyperref}, \hypersetup{…}) into the options; a key not modeled throws */
export function hyperOptions(o: HyperOptions, list: string): void {
  const bool = (key: string, v: string | null) => {
    if (v === null || v === "true") return true
    if (v === "false") return false
    throw new Unsupported(`hyperref option ${key}=${v}`)
  }
  for (const [key, v] of keyvals(list)) {
    const color = key.match(/^(link|anchor|cite|file|url)color$/)
    if (key === "colorlinks") o.colorlinks = bool(key, v)
    // (\Hy@colorlink as \begingroup, the border 0 0 0; \begin{document} defines \Hy@colorlink again from \ifHy@colorlinks)
    else if (key === "hidelinks" && v === null) { o.colorlinks = false; o.border = "0 0 0" }
    else if (color && v !== null && /^[A-Za-z][A-Za-z0-9.!@-]*$/.test(v)) o.colors[color[1] as LinkType] = v
    else if (key === "allcolors" && v !== null && /^[A-Za-z][A-Za-z0-9.!@-]*$/.test(v)) o.colors = { link: v, anchor: v, cite: v, file: v, url: v }
    // (\Hy@Match: three non-negative numbers; a dash array not modeled)
    else if (key === "pdfborder" && v !== null && /^\d*\.?\d+ \d*\.?\d+ \d*\.?\d+$/.test(v)) o.border = v
    else if (key in INFO_KEYS && v !== null) {
      const pdf = pdfString(v)
      if (pdf === null) throw new Unsupported(`hyperref option ${key}=${v}`)
      o.info[INFO_KEYS[key]] = pdf
    }
    else if (key === "bookmarksopen") o.bookmarksOpen = bool(key, v)
    // what the defaults are already: unicode strings, bookmarks, final
    else if (["unicode", "bookmarks", "final"].includes(key) && bool(key, v)) continue
    else throw new Unsupported(`hyperref option ${key}${v === null ? "" : `=${v}`}`)
  }
}

/**
 * hyperref's shipout/firstpage code under dvips, as the specials print: \Hy@FirstPageHook (pdfmark.def's
 * \headerps@out testing for pdfmark, \PDF@FinishDoc's /DOCINFO with the document information, hdvips.def's
 * PostScript procedures for H.S, H.R, H.A …), then hdvips.def's \special{papersize=\the\paperwidth,\the\paperheight}
 */
export function hyperFirstPage(paperwidth: number, paperheight: number, info = hyperDefaults().info): string[] {
  return [
    "\\special{! systemdict /pdfmark known{userdict /?pdfmark systemdict /exec get put}{userdict /?pdfmark systemdict /pop get put userdict /pdfmark systemdict /cleartomark get put}ifelse}",
    `\\special{ps:SDict begin [/Producer (${info.producer})/Title (${info.title})/Subject (${info.subject})/Creator (${info.creator})/Author (${info.author})/Keywords (${info.keywords}) /DOCINFO pdfmark end}`,
    "\\special{! /DvipsToPDF{72.27 mul Resolution div} def/PDFToDvips{72.27 div Resolution mul} def/BPToDvips{72 div Resolution mul}def product (Ghostscript) search {pop pop pop revision 927 gt}{pop false} ifelse{/BorderArrayPatch{} def}{/BorderArrayPatch{[exch{dup dup type/integertype eq exch type/realtype eq or{BPToDvips}if}forall]}def} ifelse /HyperBorder {1 PDFToDvips} def/H.V {pdf@hoff pdf@voff null} def/H.B {/Rect[pdf@llx pdf@lly pdf@urx pdf@ury]} def/H.S {currentpoint HyperBorder add /pdf@lly exch def dup DvipsToPDF 72 add /pdf@hoff exch def HyperBorder sub /pdf@llx exch def} def/H.L {2 sub dup/HyperBasePt exch def PDFToDvips /HyperBaseDvips exch def currentpoint HyperBaseDvips sub /pdf@ury exch def/pdf@urx exch def} def/H.A {H.L currentpoint exch pop vsize 72 sub exch DvipsToPDF HyperBasePt sub sub /pdf@voff exch def} def/H.R {currentpoint HyperBorder sub /pdf@ury exch def HyperBorder add /pdf@urx exch def currentpoint exch pop vsize 72 sub exch DvipsToPDF sub /pdf@voff exch def} def}",
    papersize(paperwidth, paperheight),
  ]
}

/** \special{papersize=\the\paperwidth,\the\paperheight} (hdvips.def, geometry.sty) */
export const papersize = (w: number, h: number): string => `\\special{papersize=${printScaled(w)}pt,${printScaled(h)}pt}`

/**
 * \AtBeginShipout: the page in a \vbox after the page anchor, \vbox to 0pt{\kern\voffset \kern\topmargin
 * \kern-1bp \hbox to 0pt{\kern\hoffset \kern\oddsidemargin \kern-1bp H.S H.R /DEST page.n \nobreak\hss}\vss}
 */
export function pageAnchor(page: string, topmargin: number, sidemargin: number): BoxNode {
  const bp = 65781 // 1bp
  const mark = hyperDriver.pdftex ? [pdfdest(`page.${page}`)] : colored("anchor", [HS(), HR(), dest(`page.${page}`)])
  const h = hpack([kern(0, true), kern(sidemargin, true), kern(-bp, true), ...mark, penalty(10000), ssGlue()], { exactly: 0 })
  return vpack([kern(0, true), kern(topmargin, true), kern(-bp, true), h, ssGlue()], { exactly: 0 })
}

/**
 * nameref's \@currentlabelname for a heading: its title's tokens as \@onelevel@sanitize prints them (a
 * control word with a space after it, spaces after it in the source skipped), without one final period
 */
export function labelName(title: string, stripPeriod = true): string {
  let out = ""
  for (let i = 0; i < title.length; ) {
    const cw = title.slice(i).match(/^\\([A-Za-z@]+)\s*/)
    if (cw) { out += `\\${cw[1]} `; i += cw[0].length; continue }
    if (title[i] === "\\") { out += title.slice(i, i + 2); i += 2; continue }
    if (/\s/.test(title[i])) { if (!out.endsWith(" ")) out += " "; i++; continue }
    out += title[i++]
  }
  return stripPeriod ? out.replace(/\.$/, "") : out
}

/** \<type>autorefname (hyperref's english defaults; \Itemautorefname is \itemautorefname) and listings' \lstlistingname,
 *  for the anchors' types the document makes */
const AUTOREF_NAMES: Record<string, string> = {
  equation: "Equation", Item: "item", figure: "Figure", table: "Table", chapter: "chapter", section: "section",
  subsection: "subsection", subsubsection: "subsubsection", theorem: "Theorem", lstlisting: "Listing", appendix: "Appendix",
}
/** hyperref's \HyLang@spanish, which babel's \extrasspanish runs when babel was loaded first (LaTeX source) */
const SPANISH_AUTOREF_NAMES: Record<string, string> = {
  equation: "Ecuaci\\'on", Item: "Elemento", figure: "Figura", table: "Tabla", chapter: "Cap\\'itulo", section: "Secci\\'on",
  subsection: "Subsecci\\'on", subsubsection: "Subsubsecci\\'on", theorem: "Teorema", lstlisting: "Listing", appendix: "Ap\\'endice",
}
/** hyperref's \HyLang@portuges, for brazil, brazilian and portuguese (not portuges) */
const PORTUGUESE_AUTOREF_NAMES: Record<string, string> = {
  equation: "Equa\\c c\\~ao", Item: "Item", figure: "Figura", table: "Tabela", chapter: "Cap\\'itulo", section: "Se\\c c\\~ao",
  subsection: "Subse\\c c\\~ao", subsubsection: "Subsubse\\c c\\~ao", theorem: "Teorema", lstlisting: "Listing", appendix: "Ap\\^endice",
}
/** hyperref's other autoref names, for anchors not made here yet (\AMS…, \Hfootnote…) */
const AUTOREF_OTHERS = ["AMS", "footnote", "Hfootnote", "item", "part", "paragraph", "subparagraph", "FancyVerbLine", "page"]

/** The language of hyperref's names (\HyLang@DeclareLang): the main language's, when babel came first (its \extras<lang> are
 *  there to add them to) or the class has it as an option; english (null) for the english ones and the others */
export function autorefLanguage(b: { main: string; global: string[]; beforeHyperref?: boolean } | null | undefined): "spanish" | "portuges" | null {
  if (!b || !(b.beforeHyperref || b.global.includes(b.main))) return null
  return b.main === "spanish" ? "spanish" : ["brazil", "brazilian", "portuguese"].includes(b.main) ? "portuges" : null
}

/**
 * \HyRef@testreftype: \autoref's name for an anchor, from its type (the anchor up to its first period):
 * \<type>autorefname, else \<type>name, else either for the type without a final * (\HyRef@StripStar);
 * null with neither (hyperref's warning "No autoref name", and no name)
 */
export function autorefName(href: string, lang: "spanish" | "portuges" | null = null): string | null {
  const type = href.split(".")[0]
  if (AUTOREF_OTHERS.includes(type.replace(/\*$/, ""))) throw new Unsupported(`\\autoref to a ${type} anchor`)
  const names = lang === "spanish" ? SPANISH_AUTOREF_NAMES : lang === "portuges" ? PORTUGUESE_AUTOREF_NAMES : AUTOREF_NAMES
  return names[type] ?? (type.endsWith("*") ? names[type.slice(0, -1)] : undefined) ?? null
}
