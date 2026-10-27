// pgf's fadings, transparency groups and blend modes (pgfcoretransparency.code.tex, line numbers cite it) with
// the drivers' \pgfsys@fadingfrombox, \pgfsys@usefading, \pgfsys@clipfading, \pgfsys@transparencygroupfrombox
// (pgfsys-dvips.def 465–580; pgfsys-pdftex.def 272–341) and \pgfsys@blend@mode (dvips.def 187–213,
// pgfsys-common-pdf.def 84–112).
//
// A fading is a soft mask made of a TeX box. Under pdfTeX the box becomes a form XObject (\pdfxform), and
// its first use another form (a transparency group referencing it) and an ExtGState /pgfsmask<N>, which the
// picture then sets: the mask's object number shows in the page. Under dvips the box goes to the top of the
// page between pdfmark specials (\pgfutil@insertatbegincurrentpagefrombox), named pgfsmaskxform@<N> after
// \pgf@objectcount, which objects and transparency groups share.
//
// The page-top hook. \pgfutil@insertatbegincurrentpagefrombox (pgfutil-latex.def 101–118) adds to the global
// box \pgfutil@abb: `\hskip\dimexpr2in-2\hoffset-<its width before>\relax <the material>\hskip\dimexpr-2in-2\hoffset\relax`.
// At shipout LaTeX's shipout/background hook places `\put(\hoffset-1in,\voffset-1in){\pgfutil@abe\unhbox\pgfutil@abb\pgfutil@abc}`,
// which empties the box for the next page. pgfPageTop() returns what \pgfutil@abb holds and pgfTakePageTop()
// empties it: the document layer puts those nodes in the page's background picture and calls pgfSetPage()
// first with the document's \hoffset and \strutbox (the dvips fading material measures against the strut).
// Only fadings fill the box here; \pgfutil@abc (dvips's PostScript header on the first page, drivers/dvipsheader.ts)
// and \pgfutil@abe (pgf's every-page material, none) are the document's. latex/beamer/navigation.ts's
// pgfBackground builds that \put box: the page-top nodes go in it before the header's specials.

import { glue, ssGlue, type BoxNode, type Node, type WhatsitNode } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { pdftexColors } from "../latex/pdftex"
import { Unsupported } from "../latex/unsupported"
import type { Colors } from "../latex/xcolor"
import type { PgfDriver } from "./drivers"
import { DvipsDriver } from "./drivers/dvips"
import { PdftexDriver } from "./drivers/pdftex"
import { TexArith, toNumber } from "./fixed"
import { addExtGState, invokeText, nextObjectCount } from "./objects"
import { invoke } from "./paths"
import { pdfRefXform, pdfXform } from "./pdfforms"
import { pgfPoint, pgfPointOrigin, qpoint } from "./points"
import { EMPTY_EXTENT, type PgfState } from "./state"
import { mul, pgfLowLevelSyncCm, pgfTransformCm, pgfTransformInvert, pgfTransformReset } from "./transformations"

/** what the document gives the page-top material: \hoffset and \strutbox's height and depth */
export interface PgfPage { hoffset: number; strutHeight: number; strutDepth: number }

/** \pgf@sys@pdf@possible@resources (pgfsys-pdftex.def 357–361), the objects named as the document reserved them */
const RESOURCES = "/ColorSpace <colorspaces> 0 R /Pattern <patterns> 0 R /ExtGState <extgs> 0 R"

/** a fading: \pgfsmasktrans@<name>'s shift; dvips's \pgfsmaskxform@<name> (the object count), pdfTeX's (the form) */
interface Fading { x: number; y: number; id: number; width: number; height: number; depth: number }

/** what TeX keeps globally */
interface Globals {
  fadings: Map<string, Fading>
  /** pdfTeX's \pgfsmask@<name>: the mask's form, made at the fading's first use (and kept when it is declared again) */
  masks: Map<string, number>
  /** \pgfutil@abb's list */
  pageTop: Node[]
  page: PgfPage | null
}
const globals = new WeakMap<PgfState, Globals>()
function global(s: PgfState): Globals {
  let g = globals.get(s)
  if (!g) globals.set(s, (g = { fadings: new Map(), masks: new Map(), pageTop: [], page: null }))
  return g
}

/** the document's \hoffset and \strutbox, for the page-top material */
export function pgfSetPage(s: PgfState, page: PgfPage) { global(s).page = page }
/** \pgfutil@abb: the material for the top of the current page (dvips's fadings), in order */
export const pgfPageTop = (s: PgfState): readonly Node[] => global(s).pageTop
/** the page shipped: \pgfutil@abb's material, the box emptied */
export function pgfTakePageTop(s: PgfState): Node[] {
  const g = global(s)
  const nodes = g.pageTop
  g.pageTop = []
  return nodes
}

/** pgfcoretransparency.code.tex 113: \pgfutil@colorlet{pgftransparent}{black} */
export function definePgfTransparent(colors: Colors) { colors.define("pgftransparent", "gray", "0") }

const special = (text: string): WhatsitNode => ({ kind: "whatsit", text: `\\special{${text}}` })
const zeroed = (b: BoxNode): BoxNode => ({ ...b, width: 0, height: 0, depth: 0 })

/** \pgfutil@insertatbegincurrentpagefrombox{#1} (pgfutil-latex.def 101–118, the format being after 2020/10/01) */
function insertAtBeginCurrentPage(s: PgfState, material: Node[]) {
  const g = global(s)
  if (!g.page) throw new Unsupported("pgf: page-top material without the page's \\hoffset and \\strutbox")
  const a = new TexArith(s.units)
  const twoIn = a.dimen("2in"), h2 = 2 * g.page.hoffset
  const before = hpack(g.pageTop).width
  g.pageTop = [...g.pageTop, glue(twoIn - h2 - before), ...material, glue(-twoIn - h2)]
}

/**
 * \pgfdeclarefading{#1}{#2} (108–111): `body` (#2) typeset in `\hbox{{\pgfsys@beginscope\pgfutil@color{white}\ignorespaces#2\pgfsys@endscope}}`
 * outside a picture, then made a fading by the driver. `body` gets the current colour (white) as xcolor's
 * driver text, for the pictures in it (\pgfsetcolor{.})
 */
export function pgfDeclareFading(s: PgfState, d: PgfDriver, name: string, body: (color: string) => void, colors: Colors) {
  if (s.inPicture) throw new Unsupported("pgf: a fading declared inside a picture")
  const outer = s.out
  s.out = []
  s.begingroup() // \hbox{
  s.begingroup() // {
  d.beginscope()
  const white = colors.spec("white")
  const push: WhatsitNode = { kind: "whatsit", text: `\\special{color push ${white}}` }
  s.out.push(push)
  body(white)
  d.endscope()
  s.endgroup()
  const pop: WhatsitNode = { kind: "whatsit", text: "\\special{color pop}" } // (\aftergroup\reset@color)
  s.out.push(pop)
  s.endgroup()
  if (d instanceof PdftexDriver) { pdftexColors(push); pdftexColors(pop) }
  const box = hpack(s.out)
  s.out = outer
  fadingFromBox(s, d, name, box)
}

/** \pgfsys@fadingfrombox{#1}{#2} */
function fadingFromBox(s: PgfState, d: PgfDriver, name: string, box: BoxNode) {
  const g = global(s)
  // \pgfsmasktrans@#1: the box centred on the origin
  const x = mul("-.5", box.width), y = mul("-.5", box.height) + mul(".5", box.depth)
  const size = { width: box.width, height: box.height, depth: box.depth }
  if (d instanceof DvipsDriver) {
    // dvips.def 465–511: the box at the top of the page between pdfmarks, three measuring boxes before it
    const n = nextObjectCount(s)
    const page = g.page
    if (!page) throw new Unsupported("pgf: page-top material without the page's \\hoffset and \\strutbox")
    const measure = (width: number, text: string) => hpack([hpack([ssGlue(), special(text)], { exactly: width }), ssGlue()], { exactly: 0 })
    insertAtBeginCurrentPage(s, [
      special("ps: currentpoint /pgf@refy exch def /pgf@refx exch def"),
      measure(box.height > page.strutHeight ? box.height : page.strutHeight, "ps: /pgf@top pgf@refy currentpoint pop pgf@refx sub VResolution Resolution div mul sub def"),
      measure(box.width, "ps: /pgf@right currentpoint pop def"),
      measure(box.depth > page.strutDepth ? box.depth : page.strutDepth, "ps: /pgf@bot pgf@refy currentpoint pop pgf@refx sub VResolution Resolution div mul add def"),
      special(`ps: gsave clippath pathbbox newpath pop pop translate systemdict /pdfmark known {pgf@refx neg pgf@top neg translate} {pgf@right neg pgf@bot neg translate} ifelse gsave pgf@refx pgf@refy translate mark /_objdef {pgfsmaskxform@${n}} /BBox [clippath pathbbox newpath] /BP pdfmark grestore`),
      zeroed(box),
      special("ps: mark /EP pdfmark grestore"),
    ])
    g.fadings.set(name, { x, y, id: n, ...size })
    return
  }
  if (!(d instanceof PdftexDriver)) throw new Unsupported("pgf: fadings under this driver")
  // pdftex.def 272–283: \pdfxform resources {…} #2
  g.fadings.set(name, { x, y, id: pdfXform(s, "fading", box, false, "", RESOURCES), ...size })
}

/** \pgfsys@usefading{#1}{a}{b}{c}{d}{e}{f} (dvips.def 512–547, pdftex.def 284–303): the mask installed under the transformation */
function sysUseFading(s: PgfState, d: PgfDriver, name: string, t: { aa: string; ab: string; ba: string; bb: string; x: number; y: number }) {
  const g = global(s)
  const f = g.fadings.get(name)
  if (!f) throw new Unsupported(`pgf: undefined fading "${name}"`)
  s.begingroup()
  let gs = ""
  if (d instanceof PdftexDriver) {
    let mask = g.masks.get(name)
    if (mask === undefined) {
      // \pgf@sys@pdf@install@mask (305–326): a transparency group of the fading's form, its ExtGState; two
      // ends of line are spaces
      s.space()
      mask = pdfXform(s, "mask", pdfRefXform(s, f.id), true, "/Group << /S /Transparency /CS /DeviceGray >>")
      addExtGState(s, `/pgfsmask${mask}`, `/pgfsmask${mask} << /SMask << /S /Luminosity /G ${mask} 0 R >> >>`)
      s.space()
      g.masks.set(name, mask)
    }
    gs = `/pgfsmask${mask} gs`
  } else if (!(d instanceof DvipsDriver)) throw new Unsupported("pgf: fadings under this driver")
  pgfTransformReset(s)
  pgfTransformCm(s, t.aa, t.ab, t.ba, t.bb, () => pgfPoint(s, `${toNumber(t.x)}pt`, `${toNumber(t.y)}pt`))
  pgfTransformCm(s, "1", "0", "0", "1", qpoint(f.x, f.y)) // \pgfsmasktrans@#1
  s.begingroup()
  pgfLowLevelSyncCm(s, d)
  if (d instanceof PdftexDriver) invokeText(s, d, gs)
  else s.special(`ps: /.begintransparencymaskgroup where {pop /pgf@sys@currentcolorspace currentcolorspace def /pgf@sys@currentcolor [currentcolor] cvx def /pgf@sys@OverrideICC currentuserparams /OverrideICC get def <</OverrideICC true>> setuserparams /DeviceGray setcolorspace true <</Subtype/Luminosity>> clippath pathbbox newpath .begintransparencymaskgroup gsave 72 Resolution div 72 VResolution div scale 1 DVImag div 1 DVImag div neg scale mark {pgfsmaskxform@${f.id}} /SP pdfmark grestore 0 .endtransparencymask <</OverrideICC pgf@sys@OverrideICC>> setuserparams pgf@sys@currentcolorspace setcolorspace pgf@sys@currentcolor setcolor /pgfsmaskinplace true def } if`)
  s.endgroup()
  s.setLocal({ transform: pgfTransformInvert(s.local.transform, s.units) })
  pgfLowLevelSyncCm(s, d)
  s.endgroup()
}

/**
 * \pgfsetfading{#1}{#2} (130–138): in a group, the transformation reset, `transform` (#2), and the mask
 * installed under it (\pgfgettransform's text read again)
 */
export function pgfSetFading(s: PgfState, d: PgfDriver, name: string, transform: () => void) {
  s.begingroup()
  pgfTransformReset(s)
  transform()
  sysUseFading(s, d, name, s.local.transform)
  s.endgroup()
}

/**
 * \pgfsetfadingforcurrentpath{#1}{#2} (176–203) and …stroked (219–248): the fading's 100bp square scaled to
 * the current path's extent (enlarged by the line width when stroked), centred on it, the path clipped to
 * first (\pgfsys@clipfading, dvips only); an empty path, the fading as it is
 */
export function pgfSetFadingForCurrentPath(s: PgfState, d: PgfDriver, name: string, transform: () => void, stroked = false) {
  const q = s.path
  if (q.minX === EMPTY_EXTENT) return pgfSetFading(s, d, name, transform)
  pgfSetFading(s, d, name, () => {
    const xb = mul(".5", q.maxX) + mul(".5", q.minX)
    const yb = mul(".5", q.maxY) + mul(".5", q.minY)
    const least = new TexArith(s.units).dimen("0.1pt")
    let xc = q.maxX - q.minX + (stroked ? s.lineWidth : 0)
    if (xc < least) xc = least
    let yc = q.maxY - q.minY + (stroked ? s.lineWidth : 0)
    if (yc < least) yc = least
    xc = mul(".02", xc)
    yc = mul(".02", yc)
    pgfTransformCm(s, "1", "0", "0", "1", qpoint(xb, yb))
    pgfTransformCm(s, toNumber(xc), "0", "0", toNumber(yc), pgfPointOrigin)
    if (d instanceof DvipsDriver) { invoke(s, d); d.clipnext(); d.discardpath() } // \pgfsys@clipfading (dvips.def 548–552)
    transform()
  })
}

/** an open transparency group: the list it is in, its options */
interface Group { outer: Node[]; isolated: boolean; knockout: boolean }
const groups = new WeakMap<PgfState, Group[]>()

/** \begin{pgftransparencygroup}[#1] (265–275): `isolated`, `knockout` (=true or =false); the content in an \hbox */
export function beginPgfTransparencyGroup(s: PgfState, options: string) {
  let isolated = false, knockout = false
  for (const item of options.split(",")) {
    const [k, v = "true"] = item.split("=").map((x) => x.trim())
    if (k === "") continue
    if ((k !== "isolated" && k !== "knockout") || (v !== "true" && v !== "false")) throw new Unsupported(`pgf: transparency group option ${item.trim()}`)
    if (k === "isolated") isolated = v === "true"
    else knockout = v === "true"
  }
  const stack = groups.get(s) ?? []
  groups.set(s, stack)
  s.begingroup()
  stack.push({ outer: s.out, isolated, knockout })
  s.out = []
  s.begingroup() // \hbox\bgroup
}

/**
 * \end{pgftransparencygroup} (282–307): with the picture empty so far, nothing; else the content in a box of
 * the picture's size and 1cm more each way, made a group by the driver and placed at the picture's corner
 */
export function endPgfTransparencyGroup(s: PgfState, d: PgfDriver) {
  const group = groups.get(s)?.pop()
  if (!group) throw new Unsupported("pgf: \\end{pgftransparencygroup} without a group")
  s.endgroup()
  const content = hpack(s.out)
  s.out = group.outer
  const p = s.picture
  if (p.minX !== EMPTY_EXTENT) {
    // (local \advance's of the global registers: back at the group's end)
    const cm = new TexArith(s.units).dimen("1cm")
    const minX = p.minX - cm, maxX = p.maxX + cm, minY = p.minY - cm, maxY = p.maxY + cm
    const box = hpack([{ kind: "rule", width: 0, height: maxY, depth: -minY }, glue(-minX), content, glue(maxX)])
    const made = transparencyGroupFromBox(s, d, box, minX, group)
    s.out.push(glue(minX), zeroed(made), glue(-minX))
  }
  s.endgroup()
}

/** \pgfsys@transparencygroupfrombox#1 (dvips.def 558–580, pdftex.def 331–341): the box the group leaves */
function transparencyGroupFromBox(s: PgfState, d: PgfDriver, box: BoxNode, minX: number, group: Group): BoxNode {
  const flags = `/I ${group.isolated} /K ${group.knockout}`
  if (d instanceof DvipsDriver) {
    const n = nextObjectCount(s)
    s.special(`ps: mark /_objdef {pgfxform@${n}} /BBox [clippath pathbbox newpath] /BP pdfmark gsave /pgf@sys@foa pgffoa def /pgf@sys@soa pgfsoa def /.setstrokeconstantalpha where {pop 1 .pgfsetfillopacityalpha 1 .pgfsetstrokeopacityalpha} if`)
    s.out.push(glue(minX), zeroed(box), glue(-minX))
    s.special(`ps: /pgffoa pgf@sys@foa def /pgfsoa pgf@sys@soa def grestore mark /EP pdfmark mark {pgfxform@${n}} << /Group << /S /Transparency ${flags} >> >> /PUT pdfmark`)
    return hpack([special(`ps: mark {pgfxform@${n}} /SP pdfmark`)])
  }
  if (!(d instanceof PdftexDriver)) throw new Unsupported("pgf: transparency groups under this driver")
  return pdfRefXform(s, pdfXform(s, "group", box, false, `/Group << /S /Transparency ${flags} >>`, RESOURCES))
}

/** the PDF names of pgf's blend modes (dvips.def 198–213, common-pdf 97–112) */
const BLEND_MODES: Record<string, string> = {
  normal: "Normal", multiply: "Multiply", screen: "Screen", overlay: "Overlay", darken: "Darken", lighten: "Lighten",
  "color dodge": "ColorDodge", "color burn": "ColorBurn", "hard light": "HardLight", "soft light": "SoftLight",
  difference: "Difference", exclusion: "Exclusion", saturation: "Saturation", color: "Color", hue: "Hue", luminosity: "Luminosity",
}

/** \pgfsetblendmode{#1} (70): \pgfsys@blend@mode, a literal (pdfTeX: an ExtGState named after the mode) */
export function pgfSetBlendMode(s: PgfState, d: PgfDriver, mode: string) {
  const m = BLEND_MODES[mode]
  if (m === undefined) throw new Unsupported(`pgf: unknown blend mode "${mode}"`)
  if (d instanceof DvipsDriver) return d.protocolLiteral(`/${m} .setblendmode`)
  if (!(d instanceof PdftexDriver)) throw new Unsupported("pgf: blend modes under this driver")
  addExtGState(s, `/pgf@bm${m}`, `/pgf@bm${m} << /BM /${m} >>`)
  d.protocolLiteral(`/pgf@bm${m} gs`)
}
