// The state pgf's system layer keeps in TeX: the protocol it accumulates literals in (global), its
// switches (\newif's, local to TeX's groups) and the horizontal list a picture's commands append to. A
// picture is typeset under \nullfont (pgfcorescopes.code.tex), so every stray space in pgf's macros (an
// end of line without %) becomes a \glue 0.0 node: the drivers emit each one where TeX does.

import { Unsupported } from "../latex/unsupported"
import { glue, type BoxNode, type Node } from "../layout/nodes"

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

export class PgfState {
  /** the horizontal list the picture's commands append to */
  readonly out: Node[] = []
  /** \pgfsysprotocol@currentprotocol: the literals not yet invoked, each followed by a space (global) */
  protocol = ""
  sw: SysSwitches = { ...SWITCHES }
  private readonly groups: SysSwitches[] = []

  /** \begingroup (or {): the switches as they are */
  begingroup() { this.groups.push({ ...this.sw }) }
  /** \endgroup (or }): the switches as they were */
  endgroup() {
    const saved = this.groups.pop()
    if (!saved) throw new Unsupported("pgf: a group ends that did not begin")
    this.sw = saved
  }

  /** \special{text} */
  special(text: string) { this.out.push({ kind: "whatsit", text: `\\special{${text}}` }) }
  /** a space token: \nullfont's interword glue, 0pt */
  space() { this.out.push(glue(0)) }
  /** \box: the box, or nothing for a void register */
  box(b: BoxNode | null) { if (b) this.out.push(b) }
}
