// The state pgf keeps in TeX: the system layer's protocol (global) and switches (\newif's, local to TeX's
// groups), the basic layer's registers and macros (the coordinate transformation, the bounding boxes, the
// soft path, the line width) and the horizontal list a picture's commands append to. A picture is typeset
// under \nullfont (pgfcorescopes.code.tex), so every stray space in pgf's macros (an end of line without %)
// becomes a \glue 0.0 node: the drivers emit each one where TeX does.

import { Unsupported } from "../latex/unsupported"
import { glue, type BoxNode, type Node } from "../layout/nodes"
import type { PgfTipSequence } from "./arrows"
import type { PgfUnits } from "./mathparser"
import type { ShadingMacros } from "./shade"

/** the system layer's switches, saved and restored by TeX's groups */
export interface SysSwitches {
  /** \ifpgf@strokecolor, \ifpgf@fillcolor (pgfsys-common-postscript.def): /pgfsc, /pgffc set since the last reset */
  strokeColor: boolean
  fillColor: boolean
  /** \ifpgfsys@@clipnext: the next path usage also clips */
  clipNext: boolean
  /** \ifpgfsys@eorule: fills and clips by the even-odd rule */
  eoRule: boolean
  /** \ifpgfsys@ps@boxmode (dvips): literals go to `ps:` (inside text boxes), not `ps::` */
  psBoxMode: boolean
  /** \ifpgfsysprotocol@buffered: literals stay in the protocol until it is invoked */
  buffered: boolean
  /** \ifpgfsys@color@reset@inorder (true from pgfsys.code.tex on) */
  colorResetInOrder: boolean
}

const SWITCHES: SysSwitches = { strokeColor: false, fillColor: false, clipNext: false, eoRule: false, psBoxMode: false, buffered: false, colorResetInOrder: true }

/**
 * The coordinate transformation (pgfcoretransformations.code.tex): \pgf@pt@aa, …ab, …ba, …bb as the macros
 * hold them (`1.0`, \pgf@sys@tonumber's text), \pgf@pt@x and \pgf@pt@y in sp, and \ifpgf@pt@identity.
 */
export interface PgfTransform { aa: string; ab: string; ba: string; bb: string; x: number; y: number; identity: boolean }

/** \pgftransformreset */
export const IDENTITY: PgfTransform = { aa: "1.0", ab: "0.0", ba: "0.0", bb: "1.0", x: 0, y: 0, identity: true }

/** what the basic layer assigns locally: TeX's groups save and restore it */
export interface PgfLocal {
  transform: PgfTransform
  /** \ifpgf@relevantforpicturesize: path points enlarge the picture */
  relevant: boolean
  /** \pgf@baseline, \pgf@trimleft, \pgf@trimright: the coordinate given (\pgfsetbaseline …), or the default */
  baseline: string | null
  trimLeft: string | null
  trimRight: string | null
  /** \pgf@start@tip@sequence, \pgf@end@tip@sequence (pgfcorearrows.code.tex): the arrow tips at the path's ends */
  startTips: PgfTipSequence
  endTips: PgfTipSequence
  /** \pgf@shorten@start@additional, \pgf@shorten@end@additional (pgfcorepathusage.code.tex) */
  shortenStart: number
  shortenEnd: number
  /** \pgf@corner@arc while \ifpgf@arccorners (\pgfsetcornersarced): the next corners rounded */
  cornerArc: { x: number; y: number } | null
  /** the shading layer's local macros (shade.ts) */
  shadings: ShadingMacros
}

const LOCAL: PgfLocal = { transform: IDENTITY, relevant: false, baseline: null, trimLeft: null, trimRight: null, startTips: [], endTips: [], shortenStart: 0, shortenEnd: 0, cornerArc: null, shadings: {} }

/** a box's extent, as pgf's four registers (\pgf@picminx …, \pgf@pathminx …) */
export interface PgfExtent { minX: number; maxX: number; minY: number; maxY: number }

/** 16000pt: an extent's registers before any point (\pgfresetboundingbox, \pgf@resetpathsizes) */
export const EMPTY_EXTENT = 16000 * 65536
export const emptyExtent = (): PgfExtent => ({ minX: EMPTY_EXTENT, maxX: -EMPTY_EXTENT, minY: EMPTY_EXTENT, maxY: -EMPTY_EXTENT })

/** the soft path's tokens (pgfsyssoftpath.code.tex), the coordinates in sp (each written with \the) */
export type SoftPathItem =
  | { op: "moveto" | "lineto"; x: number; y: number }
  | { op: "curveto"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "rect"; x: number; y: number; w: number; h: number }
  /** (its coordinates: \pgfsyssoftpath@lastmoveto when added) */
  | { op: "closepath"; x: number; y: number }
  /** \pgfsyssoftpath@specialround: the corner at the end of the next item rounded (\pgfprocessround) */
  | { op: "specialround"; x: number; y: number }

export class PgfState {
  /** the horizontal list the picture's commands append to */
  out: Node[] = []
  /** \pgfsysprotocol@currentprotocol: the literals not yet invoked, each followed by a space (global) */
  protocol = ""
  sw: SysSwitches = { ...SWITCHES }
  local: PgfLocal = { ...LOCAL }
  private readonly groups: [SysSwitches, PgfLocal][] = []

  /** \pgf@picminx … (global): the picture's bounding box */
  picture = emptyExtent()
  /** \pgf@pathminx … (global): the current path's */
  path = emptyExtent()
  /** \pgflinewidth (global) */
  lineWidth = 0
  /** \pgf@strokecolor@global, \pgf@fillcolor@global: the colours last set, as graphicstate.ts keys them (for arrow tips) */
  strokeColor = ""
  fillColor = ""
  /** \pgfsyssoftpath@thepath (global) */
  softPath: SoftPathItem[] = []
  /** \pgf@path@lastx, \pgf@path@lasty (global) */
  last = { x: 0, y: 0 }
  /** \pgfsyssoftpath@lastmoveto (global) */
  lastMoveTo = { x: 0, y: 0 }
  /** \ifpgfpicture: inside a pgfpicture */
  inPicture = false
  /** \pgfscope@linewidth of each open pgfscope */
  readonly scopes: number[] = []
  /** the document font's quad and x-height: pgfmath's em and ex (\pgfmath@selectfont, LaTeX's \selectfont, restores the font);
   *  a document's state follows the font where pgf is used */
  constructor(public units: PgfUnits = { em: 0, ex: 0 }) {}

  /** \begingroup (or {): the switches and local values as they are */
  begingroup() { this.groups.push([{ ...this.sw }, this.local]) }
  /** \endgroup (or }): the switches and local values as they were */
  endgroup() {
    const saved = this.groups.pop()
    if (!saved) throw new Unsupported("pgf: a group ends that did not begin")
    ;[this.sw, this.local] = saved
  }
  /** a local assignment: the values of the enclosing group stay saved */
  setLocal(values: Partial<PgfLocal>) { this.local = { ...this.local, ...values } }

  /** \special{text} */
  special(text: string) { this.out.push({ kind: "whatsit", text: `\\special{${text}}` }) }
  /** a space token: \nullfont's interword glue, 0pt */
  space() { this.out.push(glue(0)) }
  /** \box: the box, or nothing for a void register */
  box(b: BoxNode | null) { if (b) this.out.push(b) }
}
