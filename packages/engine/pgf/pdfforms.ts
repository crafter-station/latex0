// pdfTeX's form XObjects as pgf makes them (\pdfxform, \pdflastxform, \pdfrefxform) and the object numbers
// they take. Every object shares one numbering (PgfState.pdfLastObject). A form takes the next number when
// it is made; it is written (shipped) at once with \immediate, else when something written refers to it
// (here: an \immediate form whose box refers to it, the forms it refers to written right after). Writing a
// form writes one more object, its resources, which goes to an object stream (\pdfobjcompresslevel 2, PDF
// 1.5): a stream holds 100 objects and takes a number of its own when its first object comes
// (PgfState.pdfObjectStream). Only the numbers pgf prints show in the pages (a fading's `/pgfsmask<N> gs`),
// so the count must be pdfTeX's.

import type { BoxNode, Node } from "../layout/nodes"
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

/** an object written to the object stream (opened with a number of its own, closed when it holds 100) */
function compressed(s: PgfState) {
  if (s.pdfObjectStream === 0) s.pdfLastObject++
  s.pdfLastObject++
  s.pdfObjectStream = (s.pdfObjectStream + 1) % 100
}

/** a form written: its resources' object, then the unwritten forms it refers to */
function ship(s: PgfState, f: PgfPdfForm) {
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
