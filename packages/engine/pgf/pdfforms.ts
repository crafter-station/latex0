// pdfTeX's form XObjects as pgf makes them (\pdfxform, \pdflastxform, \pdfrefxform) and the object numbers
// they take. Every object shares one numbering (PgfState.pdfLastObject). A form takes the next number when
// it is made; it is written (shipped) at once with \immediate, else when something written refers to it
// (here: an \immediate form whose box refers to it, the forms it refers to written right after). Writing a
// form writes one more object, its resources, which goes to an object stream (\pdfobjcompresslevel 2, PDF
// 1.5): a stream holds 100 objects and takes a number of its own when its first object comes
// (PgfState.pdfObjectStream). Only the numbers pgf prints show in the pages (a fading's `/pgfsmask<N> gs`),
// so the count must be pdfTeX's.
//
// A document's other objects share the numbering (pdftex.web's pdf_create_obj, the line numbers below cite
// pdftex.web 1.40.27): what a format reserves (\pdfobj reserveobjnum, \pdfximage), \pdfoutline (an action
// and a title written at once, the outline, its destination's object when the name is new) and \pdfcatalog's
// openaction (written at once; `goto page 1` makes page 1's object), each \pdfstartlink when it is typeset,
// and each page shipped (pdfShipPage): its resources, its object unless a reference made it, its contents
// (a stream, not in an object stream), a font object for each font name first used, an object for each
// destination name first met, there or in a link's `goto name` when the link is written, a /Pages node every
// sixth page; then the page, its links, its destinations and its resources are written to the object
// stream. What a page makes objects of is read from its box (pdfPageObjects) and applied in pdfTeX's order
// where the page is shipped, which may be before the document lays the page out. Text in a form (its fonts'
// objects), a form first written with a page, a link shipped twice (a new number) and a destination placed
// twice are refused.

import type { BoxNode, Node, WhatsitNode } from "../layout/nodes"
import { Unsupported } from "../latex/unsupported"
import { hpack } from "../layout/pack"
import type { PgfState } from "./state"

export type PgfPdfFormKind = "shading" | "fading" | "mask" | "group"

/** a form: its number, what made it, its box, its attr and resources texts */
export interface PgfPdfForm { number: number; kind: PgfPdfFormKind; box: BoxNode; attr: string; resources: string; written: boolean }

const forms = new WeakMap<PgfState, PgfPdfForm[]>()
function list(s: PgfState): PgfPdfForm[] {
  let l = forms.get(s)
  if (!l) forms.set(s, (l = []))
  return l
}

/** what has an object so far: font names, destination names (made, and placed on a page), pages (by number), and
 *  how many pages were shipped */
interface Made { fonts: Set<string>; dests: Set<string>; placed: Set<string>; pages: Set<number>; shipped: number }
const made = new WeakMap<PgfState, Made>()
function objects(s: PgfState): Made {
  let m = made.get(s)
  if (!m) made.set(s, (m = { fonts: new Set(), dests: new Set(), placed: new Set(), pages: new Set(), shipped: 0 }))
  return m
}

/** the forms pgf made so far, in order */
export const pgfPdfForms = (s: PgfState): readonly PgfPdfForm[] => list(s)

/** the forms a list refers to (\pdfrefxform), in order */
function references(nodes: Node[], out: number[] = []): number[] {
  for (const n of nodes) {
    if (n.kind !== "hlist" && n.kind !== "vlist") continue
    if (n.form !== undefined) out.push(n.form)
    references(n.list, out)
  }
  return out
}

/** `n` new objects (pdf_create_obj: \pdfobj reserveobjnum, \pdfstartlink …) */
export function pdfObjects(s: PgfState, n = 1) { s.pdfLastObject += n }

/** an object written to the object stream (pdf_os_prepare_obj, 16880: opened with a number of its own, written when it
 *  holds 100) */
function toStream(s: PgfState) {
  if (s.pdfObjectStream === 0) s.pdfLastObject++
  s.pdfObjectStream = (s.pdfObjectStream + 1) % 100
}

/** a new object written to the object stream at once */
function compressed(s: PgfState) {
  s.pdfLastObject++
  toStream(s)
}

/** whether a list shows text (outside forms' boxes) */
function text(nodes: Node[]): boolean {
  return nodes.some((n) => n.kind === "char" || ((n.kind === "hlist" || n.kind === "vlist") && text(n.list))
    || (n.kind === "glue" && n.leaders !== undefined && n.leaders.box.kind !== "rule" && text([n.leaders.box])))
}
/** the font object of a font first used (pdf_init_font, 16163: one per font name) */
function font(s: PgfState, name: string) {
  const m = objects(s)
  if (!m.fonts.has(name)) { m.fonts.add(name); pdfObjects(s) }
}

/** a destination name's object (get_obj, 34728), made when the name is first met */
function dest(s: PgfState, name: string) {
  const m = objects(s)
  if (!m.dests.has(name)) { m.dests.add(name); pdfObjects(s) }
}

/** a form written (pdf_ship_out of the form, 19166): its resources' object, then the unwritten forms it refers to */
function ship(s: PgfState, f: PgfPdfForm) {
  if (text(f.box.list)) throw new Unsupported("pdfTeX: a form with text (its fonts' objects)")
  f.written = true
  compressed(s)
  for (const k of references([f.box])) {
    const g = list(s).find((x) => x.number === k)
    if (g && !g.written) ship(s, g)
  }
}

/** [\immediate]\pdfxform [attr {…}] [resources {…}] <box>: the new form's number (\pdflastxform) */
export function pdfXform(s: PgfState, kind: PgfPdfFormKind, box: BoxNode, immediate: boolean, attr = "", resources = ""): number {
  const f: PgfPdfForm = { number: ++s.pdfLastObject, kind, box, attr, resources, written: false }
  list(s).push(f)
  if (immediate) ship(s, f)
  return f.number
}

/** \hbox{\pdfrefxform N}: a box holding the form, of the form's size */
export function pdfRefXform(s: PgfState, number: number): BoxNode {
  const f = list(s).find((x) => x.number === number)
  if (!f) throw new Error(`pgf: no form ${number}`)
  return hpack([{ ...hpack([]), width: f.box.width, height: f.box.height, depth: f.box.depth, form: number }])
}

/** \pdfoutline goto name{dest} … (35000): its action and title, written at once, and the outline; the destination's
 *  object if the name is new */
export function pdfOutline(s: PgfState, name: string) {
  compressed(s)
  dest(s, name)
  pdfObjects(s)
  compressed(s)
}

/** \pdfcatalog{…} openaction goto page 1 {…} (35264): the action, written at once, which makes page 1's object */
export function pdfOpenActionPage1(s: PgfState) {
  compressed(s)
  objects(s).pages.add(1)
  pdfObjects(s)
}

/** What shipping a page makes objects of, in the order pdfTeX meets them: the names of the fonts it shows, of the
 *  destinations it places, of the destinations its links go to (null: a link with another action), and the forms it
 *  shows (their places in the forms made) */
export interface PdfPageObjects { fonts: string[]; dests: string[]; links: (string | null)[]; forms: number[] }

const DEST = /^\\pdfdest name\{(.*)\} /
const LINK = /^\\pdfstartlink(?:\(\*\+\*\)x\*)? .*?action (?:goto name\{(.*)\}|user\{)/

/**
 * What the page `box` makes objects of (pdf_hlist_out, pdf_vlist_out: what they meet in the box's order; leaders
 * repeat their fonts). `links` holds the link nodes shipped in earlier pages: one shipped again is refused.
 */
export function pdfPageObjects(s: PgfState, box: BoxNode, links: WeakSet<WhatsitNode>): PdfPageObjects {
  const out: PdfPageObjects = { fonts: [], dests: [], links: [], forms: [] }
  const all = list(s)
  const walk = (nodes: Node[], leaders: boolean) => {
    for (const n of nodes) {
      if (n.kind === "char") out.fonts.push(n.font)
      else if (n.kind === "hlist" || n.kind === "vlist") {
        if (n.form !== undefined) out.forms.push(all.findIndex((f) => f.number === n.form))
        walk(n.list, leaders)
      } else if (n.kind === "glue" && n.leaders && n.leaders.box.kind !== "rule") walk([n.leaders.box], true)
      else if (n.kind === "whatsit") {
        const d = n.text.match(DEST), l = n.text.match(LINK)
        // (do_dest and do_link ignore leaders' destinations and refuse their links: not modelled)
        if ((d || l) && leaders) throw new Unsupported("pdfTeX: a destination or link in leaders")
        if (d) out.dests.push(d[1])
        else if (l) {
          // (do_link, 36524: a new number)
          if (links.has(n)) throw new Unsupported("pdfTeX: a link shipped twice")
          links.add(n)
          out.links.push(l[1] ?? null)
        } else if (n.text.startsWith("\\pdfstartlink")) throw new Unsupported(`pdfTeX: the link ${n.text}`)
      }
    }
  }
  walk([box], false)
  return out
}

/**
 * \shipout of a page with pdfTeX (19166–19300): its resources, its object (unless made), its contents, then what
 * `p` lists (pdfPageObjects); the page's /Pages node every sixth page (19414); the page written, its links (19601,
 * a link's new destination name taking an object), its destinations (19633) and its resources
 */
export function pdfShipPage(s: PgfState, p: PdfPageObjects) {
  const m = objects(s)
  pdfObjects(s) // the resources
  const page = m.shipped + 1
  if (!m.pages.has(page)) { m.pages.add(page); pdfObjects(s) }
  pdfObjects(s) // the contents
  for (const f of p.fonts) font(s, f)
  // (a name placed again, which do_dest ignores, is refused: not checked yet)
  let placed = 0
  for (const d of p.dests) {
    if (m.placed.has(d)) throw new Unsupported(`pdfTeX: the destination ${d} placed again`)
    m.placed.add(d); dest(s, d); placed++
  }
  m.shipped = page
  if (page % 6 === 1) pdfObjects(s)
  toStream(s) // the page
  const all = list(s)
  for (const i of p.forms) {
    const f = all[i]
    // (a form written with the page, 19524, is not checked yet)
    if (!f?.written) throw new Unsupported("pdfTeX: a form written with a page")
  }
  for (const l of p.links) {
    if (l !== null) dest(s, l)
    toStream(s)
  }
  for (let i = 0; i < placed; i++) toStream(s)
  toStream(s) // the resources
}
