// pgf's objects and opacities: \pgfsys@defobject and \pgfsys@useobject (dvips: pgfsys-common-postscript.def
// 159–185, a PostScript procedure /pgf<N> in a header special; pdfTeX: pgfsys.code.tex 1655–1690, the
// protocol kept in a macro and invoked again), the basic layer's \pgfdefobject and \pgfuseobject
// (pgfcoreobjects.code.tex), and \pgfsetstrokeopacity, \pgfsetfillopacity (pgfcoretransparency.code.tex 13–20)
// with the drivers' \pgfsys@stroke@opacity and \pgfsys@fill@opacity (common-postscript 150–157, common-pdf
// 67–80: an ExtGState resource per value, named after it).

import { Unsupported } from "../latex/unsupported"
import type { PgfDriver } from "./drivers"
import { DvipsDriver } from "./drivers/dvips"
import { PdftexDriver } from "./drivers/pdftex"
import { parse } from "./points"
import type { PgfState } from "./state"

/** what pgf keeps globally: \pgf@objectcount and each object's macro, pdfTeX's ExtGState resources */
interface Globals {
  count: number
  objects: Map<string, string>
  /** the ExtGState entries added (\pgfutil@addpdfresource@extgs), by name */
  extgs: Map<string, string>
}
const globals = new WeakMap<PgfState, Globals>()
function global(s: PgfState): Globals {
  let g = globals.get(s)
  if (!g) globals.set(s, (g = { count: 0, objects: new Map(), extgs: new Map() }))
  return g
}
/** pdfTeX's ExtGState resources added so far, in order */
export const pdfExtGStates = (s: PgfState) => [...global(s).extgs.values()]

/** \pgfsysprotocol@literal (pgfsysprotocol.code.tex 38–44) */
function literal(s: PgfState, d: PgfDriver, text: string) {
  s.protocol += `${text} `
  if (!s.sw.buffered) d.flush()
}

/** \pgfsys@invoke{#1}: the driver's literal of `text` as it is */
function invokeText(s: PgfState, d: PgfDriver, text: string) {
  const saved = s.protocol
  s.protocol = text
  d.flush()
  s.protocol = saved
}

function opacity(s: PgfState, d: PgfDriver, v: string, stroke: boolean) {
  if (d instanceof DvipsDriver) return literal(s, d, `${v} .pgfset${stroke ? "stroke" : "fill"}opacityalpha`)
  if (!(d instanceof PdftexDriver)) throw new Unsupported("pgf: opacity under this driver")
  const name = `/pgf@${stroke ? "CA" : "ca"}${v}`
  const extgs = global(s).extgs
  if (!extgs.has(name)) extgs.set(name, `${name} << /${stroke ? "CA" : "ca"} ${v} >>`)
  literal(s, d, `${name} gs`)
}

/** \pgfsys@stroke@opacity{#1} */
export const sysStrokeOpacity = (s: PgfState, d: PgfDriver, v: string) => opacity(s, d, v, true)
/** \pgfsys@fill@opacity{#1} */
export const sysFillOpacity = (s: PgfState, d: PgfDriver, v: string) => opacity(s, d, v, false)
/** \pgfsetstrokeopacity{#1}: \pgfmathparse'd */
export const pgfSetStrokeOpacity = (s: PgfState, d: PgfDriver, e: string) => sysStrokeOpacity(s, d, parse(e, s.units))
/** \pgfsetfillopacity{#1} */
export const pgfSetFillOpacity = (s: PgfState, d: PgfDriver, e: string) => sysFillOpacity(s, d, parse(e, s.units))

/**
 * \pgfsys@defobject{#1}{#2}{#3}{#4}: `body` (#4, protocolled code only) run with the protocol empty and buffered.
 * dvips counts the object (\pgf@objectcount, which fadings share) and defines its procedure in a header
 * special; pdfTeX keeps what it protocolled, in a graphic scope, under the name.
 */
export function sysDefObject(s: PgfState, d: PgfDriver, name: string, body: () => void) {
  const g = global(s)
  const saved = s.protocol
  s.begingroup()
  s.protocol = ""
  s.sw.buffered = true
  if (d instanceof DvipsDriver) {
    g.count++
    g.objects.set(name, String(g.count))
    body()
    s.special(`! /pgf${g.count}{gsave exec ${s.protocol} grestore} bind def`)
  } else {
    if (!(d instanceof PdftexDriver)) throw new Unsupported("pgf: objects under this driver")
    const picture = s.inPicture
    s.inPicture = true // \pgfpicturetrue
    d.beginscope()
    body()
    d.endscope()
    s.inPicture = picture
    g.objects.set(name, s.protocol)
  }
  s.endgroup()
  s.protocol = saved
}

/** \pgfsys@useobject{#1}{#2}: `before` (#2) unbuffered, then the object */
export function sysUseObject(s: PgfState, d: PgfDriver, name: string, before: () => void) {
  const object = global(s).objects.get(name)
  if (object === undefined) throw new Unsupported(`pgf: undefined object ${name}`)
  const saved = s.protocol
  s.begingroup()
  s.protocol = ""
  s.sw.buffered = false
  before()
  if (d instanceof DvipsDriver) {
    d.flush() // \pgfsysprotocol@invokecurrentprotocol
    invokeText(s, d, `pgf${object}`)
  } else {
    s.protocol = object
    d.flush()
  }
  s.endgroup()
  s.protocol = saved
}

/**
 * \pgfdefobject{#1}{#2}{#3}{#4} (pgfcoreobjects.code.tex 31–37): in \pgfinterruptpath (the soft path, its extent,
 * the last point and the last moveto saved and restored), nothing enlarging the picture
 */
export function pgfDefObject(s: PgfState, d: PgfDriver, name: string, body: () => void) {
  s.begingroup()
  const path = s.softPath, extent = { ...s.path }, last = s.last, lastMoveTo = s.lastMoveTo
  s.softPath = []
  s.begingroup()
  s.setLocal({ relevant: false })
  sysDefObject(s, d, name, body)
  s.endgroup()
  s.softPath = path
  s.path = extent
  s.last = last
  s.lastMoveTo = lastMoveTo
  s.endgroup()
}

/** \pgfuseobject{#1} (40): in a graphic scope */
export function pgfUseObject(s: PgfState, d: PgfDriver, name: string) {
  d.beginscope()
  sysUseObject(s, d, name, () => {})
  d.endscope()
}
