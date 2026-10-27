// TikZ's pictures, scopes and paths (tikz.code.tex, line numbers cite it) on pgf/: the path syntax read token
// by token as \tikz@scan@next@command and \tikz@handle read it, each operation calling pgf's path commands
// where TikZ's macros do, \tikz@finish using the path, and the TeX groups TikZ opens around pictures, scopes,
// paths and the graphic state. A picture is typeset under \nullfont, so the spaces TikZ's own macros leave
// (an end of line without %) are \glue 0.0 nodes on the picture's list: each is emitted where TeX's is. The
// subset modeled: \path, \draw, \fill, \filldraw, \clip, \useasboundingbox, \coordinate, the scope
// environment, \tikzset, options anywhere (tikz/options.ts), the coordinates (x,y) with and without units,
// (a:r), +(…), ++(…), (a |- b), (a -| b), named coordinates and nodes (a line to a node ends on its
// border), and the operations --, -|, |-, rectangle, circle, ellipse, cycle and to, with arrow tips
// (pgf/arrows.ts, instantiated once a document) and rounded corners (pgf/round.ts). Nodes (\node, node and
// coordinate on a path, labels on its last operation placed by the operation's timer) go through
// \tikz@normal@fig … \tikz@node@finish onto pgf's shapes (pgf/shapes.ts), their text typeset by the engine
// (TikzText). Every other construct throws Unsupported.

import { printScaled } from "../layout/arith"
import type { BoxNode, Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { Unsupported } from "../latex/unsupported"
import type { Colors } from "../latex/xcolor"
import type { PgfDriver } from "../pgf/drivers"
import { TexArith, toNumber } from "../pgf/fixed"
import { isColorName, pgfSetColor, pgfSetDash, pgfSetFillColor, pgfSetLineWidth, pgfSetMiterLimit, pgfSetStrokeColor } from "../pgf/graphicstate"
import { pgfSetFillOpacity, pgfSetStrokeOpacity } from "../pgf/objects"
import { pgfmathParse, pgfmathSetLength, type PgfUnits } from "../pgf/mathparser"
import { pgfPathClose, pgfPathCurveTo, pgfPathEllipse, pgfPathLineTo, pgfPathMoveTo, pgfUsePath, resetPathSizes } from "../pgf/paths"
import { pgfPoint, pgfPointAdd, pgfPointDiff, pgfPointNormalised, pgfPointOrigin, pgfPointScale, pgfPointPolar, pgfPointXY, parse, qpoint, setLength, trig, type PgfPoint, type PgfPointMacro } from "../pgf/points"
import { beginPgfPicture, endPgfPicture, pgfSetBaseline } from "../pgf/scopes"
import { pgfMultipartNode, pgfPointAnchor, pgfPointShapeBorder, usePgfNodes, type PgfNodeRecord, type PgfShapeKeys } from "../pgf/shapes"
import type { PgfState } from "../pgf/state"
import { applyTransform, mul, pgfTransformArcAxesAtTime, pgfTransformCm, pgfTransformCurveAtTime, pgfTransformInvert, pgfTransformReset, transformPoint, pgfTransformLineAtTime, pgfTransformResetNonTranslations, pgfTransformRotate, pgfTransformScale, pgfTransformShift, pgfTransformXScale, pgfTransformXShift, pgfTransformXSlant, pgfTransformYScale, pgfTransformYShift, pgfTransformYSlant, type AtTime } from "../pgf/transformations"
import { chars } from "./keys"
import { alignLines, type AlignLine, type Baselines } from "./text"
import { readForeach, sampleValues, substitute } from "./foreach"
import { LABEL_RESTORE, LABEL_SAVE, PIN_SAVE, Tikz, type OptionCall, type TextAction, type TikzSetup, type TikzState, type TransformCall } from "./options"
import { pgfArrowsMeta, pgfSetArrows, shareArrows } from "../pgf/arrows"
import { pgfPathArc, pgfPathArcAxes } from "../pgf/arcs"
import { pgfPathGrid } from "../pgf/grid"
import { pgfUsePathQFillStroke, pgfUsePathQStroke } from "../pgf/quick"
import { arg, contains, find, groupEnd, isCs, plain, spdef, str, tokenize, type Tok, type Toks } from "./tokens"

/**
 * What a node's text needs of the engine: the list of \hbox{<font><text>} (the font option's commands, then the
 * text) in the font where the picture stands.
 */
export interface TikzText {
  hlist(text: string, font: string): Node[]
  /** \baselineskip, \lineskip and \lineskiplimit after the font option's commands */
  baselines(font: string): Baselines
  /** em and ex after the font option's commands */
  units(font: string): PgfUnits
  /** the text in a minipage of a text width: its \vtop; `before` and `after` the text in its paragraph */
  minipage(text: string, nodeFont: string, textFont: string, width: number, action: TextAction, before: Node[], after: Node[]): BoxNode
}

/** \tikz@timer: how a label on the last operation is placed, between \tikz@timer@start and …end */
interface Timer {
  kind: "line" | "hv" | "vh" | "curve" | "arc"; start: PgfPoint; end: PgfPoint; /** a curve's supports */ c1?: PgfPoint; c2?: PgfPoint
  /** an arc's angles (\tikz@timer@start@angle, …end…) and axes (\tikz@timer@zero@axis, …ninety…) */
  arc?: { start: string; end: string; zero: PgfPoint; ninety: PgfPoint }
}

/** TikZ's macros and registers a path changes, local to TeX's groups */
interface Locals {
  /** \tikz@lastx, \tikz@lasty, \tikz@lastxsaved, \tikz@lastysaved */
  lastx: number; lasty: number; lastxsaved: number; lastysaved: number
  /** \iftikz@updatecurrent, \iftikz@updatenext, \iftikz@auto@end@path */
  updatecurrent: boolean; updatenext: boolean; autoEndPath: boolean
  /** \iftikz@shapeborder with \tikz@shapeborder@name: the point scanned last is a node's, its border still to find */
  shapeborder: string | null
  /** \tikz@moveto@waiting: the node whose border the path's last move goes to, once the next point is known */
  movetoWaiting: string | null
  /** \tikz@lastmovetox, \tikz@lastmovetoy: the last move's point, untransformed */
  lastMoveTo: PgfPoint
  /** \tikz@timer (null: \relax) */
  timer: Timer | null
  /** \tikz@collected@onpath: the labels an operation collected, typeset once it is done */
  collected: Tok[]
  /** \iftikz@node@is@a@label */
  isLabel: boolean
  /** \tikzscope@linewidth: the line width where the path began */
  scopeLineWidth: number
  /** \tikz@path@do@at@end, when it is more than \tikz@lib@scope@check (\tikz's single path) */
  doAtEnd: (() => void) | null
  /** xcolor's current color ".", as the driver's text */
  dot: string
  /** \tikz@figbox: the list of the box a path's nodes go in, null while void */
  figbox: Node[] | null
  /** \tikzlastnode: the node made last (its name), and \tikz@save@last@fig@name around a label's node */
  lastNode: string
  savedLastFig: string
  /** \tikz@save@last@node: the node a pin is of */
  savedPinNode: string
  /** \tikztostart, \tikztotarget (text) and \tikz@tonodes of the to path being scanned */
  to: { start: Tok[]; target: Tok[]; nodes: Tok[] } | null
  /** \tikz@to@use@whom: what an edge starts at, the last point scanned or the last node (undefined: neither yet) */
  toUseWhom: "coordinate" | "node" | null
}

/** the special token \pgfextra{\tikz@updatenexttrue\tikz@updatecurrenttrue} after a to path (3097) */
const UPDATE = "\\pgfextra@tikz@update"
/** \pgfextra{\tikz@node@is@a@labeltrue}: what \tikztonodes begins with (3062) */
const LABEL = "\\pgfextra@tikz@label"
/** \tikz@to@path where the to path's options are read, and topaths' \pgfextra{…\tikz@to@compute…} */
const TO_PATH = "\\tikz@to@path", TO_COMPUTE = "\\pgfextra@tikz@to@compute"
/** \pgf@stop, which ends the labels \tikz@invoke@collected@onpath scans (2777–2783) */
const STOP = "\\pgf@stop"

/** \tikz@polar@dir@<name> (5320–5333) */
const POLAR_DIRS: Record<string, string> = {
  up: "90", down: "-90", left: "180", right: "0", north: "90", south: "-90", east: "0", west: "180",
  "north east": "45", "north west": "135", "south east": "-45", "south west": "-135",
}

/** the plot marks of pgflibraryplothandlers (972–1000) and plotmarks' o */
const MARKS = new Set(["*", "+", "x", "o"])

/** \pgfuseplotmark{mark} at the origin, \pgfplotmarksize `r` */
function drawMark(s: PgfState, d: PgfDriver, mark: string, r: number) {
  const q = (x: number, y: number) => qpoint(x, y)
  if (mark === "*" || mark === "o") {
    pgfPathEllipse(s, pgfPointOrigin, q(r, 0), q(0, r))
    return mark === "*" ? pgfUsePathQFillStroke(s, d) : pgfUsePathQStroke(s, d)
  }
  const a = mark === "x" ? mul(".70710678", r) : r
  if (mark === "+") {
    pgfPathMoveTo(s, q(-r, 0)); pgfPathLineTo(s, q(r, 0)); pgfPathMoveTo(s, q(0, r)); pgfPathLineTo(s, q(0, -r))
  } else {
    const b = mul("-.70710678", r)
    pgfPathMoveTo(s, q(b, b)); pgfPathLineTo(s, q(a, a)); pgfPathMoveTo(s, q(b, a)); pgfPathLineTo(s, q(a, b))
  }
  pgfUsePathQStroke(s, d)
}

/** the commands \tikz@installcommands makes path commands (1940–1963): the options they put in front */
const PATH_COMMANDS: Record<string, string | null> = {
  "\\path": null, "\\draw": "draw", "\\fill": "fill", "\\filldraw": "fill,draw", "\\clip": "clip", "\\useasboundingbox": "use as bounding box",
}

/** the commands \tikz's single-command form takes as a path (\tikz@protected@command, 1777–1791) */
const PROTECTED = new Set(["\\draw", "\\pattern", "\\fill", "\\filldraw", "\\shade", "\\shadedraw", "\\clip", "\\graph", "\\useasboundingbox", "\\node", "\\coordinate", "\\matrix", "\\datavisualization", "\\path", "\\pic"])

const pt = (sp: number) => `${printScaled(sp)}pt`

/** the input: tokens and a position; what macros put back goes in front */
class Input {
  i = 0
  constructor(public t: Tok[]) {}
  peek(): Tok | undefined { return this.t[this.i] }
  next(): Tok | undefined { return this.t[this.i++] }
  insert(toks: Toks) { this.t.splice(this.i, 0, ...toks) }
  skipSpaces() { while (this.t[this.i] === " ") this.i++ }
  /** \pgfutil@ifnextchar: blanks skipped (and gone) */
  ifNext(c: Tok): boolean { this.skipSpaces(); return this.t[this.i] === c }
  /** the characters of a macro's parameter text, one by one, with nothing between */
  literal(s: string) {
    for (const c of s) if (this.next() !== c) throw new Unsupported(`tikz: "${s}" expected`)
  }
  /** an undelimited argument: blanks skipped, a group without its braces or one token */
  undelimited(): Tok[] {
    this.skipSpaces()
    const t = this.t[this.i]
    if (t === undefined) throw new Unsupported("tikz: an argument expected")
    if (t !== "{") { this.i++; return [t] }
    const e = groupEnd(this.t, this.i)
    if (e < 0) throw new Unsupported("tikz: unbalanced braces")
    const out = this.t.slice(this.i + 1, e)
    this.i = e + 1
    return out
  }
  /** a delimited argument (up to `delim` at brace level 0, which goes too), a whole group unbraced */
  delimited(delim: Toks): Tok[] {
    const j = find(this.t, delim, this.i)
    if (j < 0) throw new Unsupported(`tikz: "${str(delim)}" expected`)
    const out = arg(this.t.slice(this.i, j))
    this.i = j + delim.length
    return out
  }
}

/** a delimited argument's split at the first `delim` at brace level 0: the two arguments unbraced */
function split(t: Toks, delim: Toks): [Tok[], Tok[]] {
  const j = find(t, delim)
  if (j < 0) throw new Unsupported(`tikz: "${str(delim)}" expected`)
  return [arg(t.slice(0, j)), arg(t.slice(j + delim.length))]
}

/** text for pgfmath: plain characters (an \edef of what TikZ hands on) */
const text = (t: Toks, what: string) => plain(t, what)

/** tokens as source text again: a control word followed by a letter gets back the blank that ended it */
const source = (t: Toks) => t.map((x, i) => (/^\\[A-Za-z@]+$/.test(x) && /^[A-Za-z@]$/.test(t[i + 1] ?? "") ? `${x} ` : x)).join("")

export interface TikzPictureSetup {
  s: PgfState
  d: PgfDriver
  tz: Tikz
  colors: Colors
  /** xcolor's current color where the picture starts (the driver's text) */
  color: string
  /** the nodes' text: TeX's \hbox{…} in the font the picture began in */
  text?: TikzText
  /** the named nodes (global in TeX: a document's) */
  nodes: Map<string, PgfNodeRecord>
  /** TikZ's global counters */
  counts?: { fig: number }
}

/** One picture: \begin{tikzpicture} or \tikz, with what the picture's commands do on pgf. */
export class TikzPicture {
  readonly s: PgfState
  readonly d: PgfDriver
  readonly tz: Tikz
  private readonly colors: Colors
  private readonly text: TikzText | null
  private readonly nodes: Map<string, PgfNodeRecord>
  private L: Locals
  private readonly groups: { saved: Locals; after: (() => void)[] }[] = []
  /** \pgfsyssoftpath@lastmoveto (global): the last moveto's coordinates */
  private lastMoveTo = { x: 0, y: 0 }
  /** \tikz@last@fig@name (global) */
  private lastFigName = ""
  /** \tikz@fig@count (global): the nodes named tikz@f@<n> */
  private readonly counts: { fig: number }
  /** \pgfscope@stroke@color and \pgfscope@fill@color of each open \pgfscope (and of \tikz@finish's options) */
  private readonly colorScopes: [string, string][] = []

  constructor(setup: TikzPictureSetup) {
    this.s = setup.s
    this.d = setup.d
    this.tz = setup.tz
    this.colors = setup.colors
    this.text = setup.text ?? null
    this.nodes = setup.nodes
    this.counts = setup.counts ?? { fig: 0 }
    usePgfNodes(this.s, this.nodes)
    this.L = {
      lastx: 0, lasty: 0, lastxsaved: 0, lastysaved: 0,
      updatecurrent: true, updatenext: true, autoEndPath: false, doAtEnd: null, dot: setup.color, figbox: null,
      shapeborder: null, movetoWaiting: null, lastMoveTo: { x: 0, y: 0 }, timer: null, collected: [], isLabel: false, scopeLineWidth: 0,
      lastNode: "", savedLastFig: "", savedPinNode: "", to: null, toUseWhom: null,
    }
  }

  // TeX's groups: pgf's state, TikZ's keys and options, and the macros above, with \aftergroup

  private begin() {
    this.s.begingroup()
    this.tz.begingroup()
    this.groups.push({ saved: { ...this.L }, after: [] })
  }
  private end() {
    const g = this.groups.pop()
    if (!g) throw new Unsupported("tikz: a group ends that did not begin")
    this.s.endgroup()
    this.tz.endgroup()
    this.L = g.saved
    for (const f of g.after) f()
  }
  private afterGroup(f: () => void) {
    const g = this.groups[this.groups.length - 1]
    if (!g) throw new Unsupported("tikz: \\aftergroup outside a group")
    g.after.push(f)
  }

  /** \pgflinewidth as pgf reads it (tikz/options.ts keeps the register; pgf's assignments are global) */
  private syncLineWidth() { this.s.lineWidth = this.tz.st.lineWidth }
  private globalLineWidth() { this.tz.globalLineWidth(this.s.lineWidth) }

  /** a color expression as the driver's text: "." is xcolor's current color */
  private colorSpec(t: Toks): string {
    const e = text(t, "color").trim()
    if (e === ".") return this.L.dot
    if (e.includes(".")) throw new Unsupported(`tikz: color ${e}`)
    return this.colors.spec(e)
  }

  // the picture

  /**
   * A picture's source: `\begin{tikzpicture}[options] … \end{tikzpicture}` or `\tikz[options]{…}` /
   * `\tikz[options] <path command>…;`. Returns how much of it the picture took.
   */
  run(src: Toks | string): number {
    const inp = new Input(typeof src === "string" ? tokenize(src, false, true) : [...src])
    const first = inp.next()
    if (first === "\\begin") {
      const env = inp.undelimited()
      if (str(env) !== "tikzpicture") throw new Unsupported(`tikz: \\begin{${str(env)}}`)
      this.begin() // \begin
      this.picture(inp)
      this.body(inp, "tikzpicture")
      this.endPicture()
      this.end() // \end
      return inp.i
    }
    if (first === "\\tikz") {
      this.tikz(inp)
      return inp.i
    }
    throw new Unsupported(`tikz: a picture begins with ${first}`)
  }

  /** \tikz (1766–1800) */
  private tikz(inp: Input) {
    this.begin()
    this.picture(inp)
    if (inp.ifNext("{")) {
      // \tikz@: \bgroup, auto end of path, \aftergroup\endtikzpicture\aftergroup\endgroup, the { taken by \let
      inp.next()
      this.begin()
      this.L.autoEndPath = true
      this.afterGroup(() => { this.endPicture(); this.end() })
      this.body(inp, "}")
      return
    }
    const cmd = inp.peek()
    if (cmd === undefined || !PROTECTED.has(cmd)) throw new Unsupported(`tikz: \\tikz ${cmd ?? ""}`)
    // \begingroup\def\tikz@path@do@at@end{\endgroup\endtikzpicture\endgroup}
    this.begin()
    this.L.doAtEnd = () => { this.end(); this.endPicture(); this.end() }
    this.command(inp)
  }

  /** \tikzpicture (1719–1737) after its \begingroup: [options], \pgfpicture, the picture's scope */
  private picture(inp: Input) {
    this.begin()
    const options = inp.ifNext("[") ? (inp.next(), inp.delimited(["]"])) : []
    beginPgfPicture(this.s, this.d, this.L.dot)
    this.globalLineWidth()
    this.tz.st.transform = null
    this.tz.st.time = ".5"
    this.beginScope(["every picture", ",", ...options])
  }

  /** \endtikzpicture (1738–1754): the baseline and trims the picture's scope set, kept */
  private endPicture() {
    const { baseline, trimLeft, trimRight } = this.s.local
    this.endScope()
    this.s.setLocal({ baseline, trimLeft, trimRight })
    this.syncLineWidth()
    endPgfPicture(this.s, this.d)
    this.end()
  }

  /** \pgfscope (pgfcorescopes.code.tex 48–55): a graphic scope, the soft path emptied, a group */
  private pgfscope() {
    this.s.softPath = []
    this.d.beginscope()
    resetPathSizes(this.s)
    this.s.scopes.push(this.tz.st.lineWidth)
    this.colorScopes.push([this.s.strokeColor, this.s.fillColor])
    this.begin()
  }

  /** \endpgfscope (56–61): the line width back (globally) */
  private endpgfscope() {
    this.end()
    const w = this.s.scopes.pop()
    if (w === undefined) throw new Unsupported("pgf: \\endpgfscope without a scope")
    this.s.lineWidth = w
    this.globalLineWidth()
    ;[this.s.strokeColor, this.s.fillColor] = this.colorScopes.pop()!
    this.d.endscope()
  }

  /** \tikz@scope@env and \tikz@scope@opt (1830–1857) with the options given */
  private beginScope(options: Toks) {
    this.pgfscope()
    this.begin()
    this.tz.st.options = []
    this.tz.st.mode = []
    this.tz.set("every scope/.try")
    this.tz.set(options)
    this.runOptions()
    // \pgfidscope (pgfsys.code.tex 572–591), then \begingroup
    this.begin()
    this.begin()
    this.begin()
  }

  /** \endtikz@scope@env (1858–1866) */
  private endScope() {
    this.end()
    this.endIdScope()
    this.end()
    this.endpgfscope()
  }

  /** \endpgfidscope: \pgfsys@end@idscope (pgfsys.code.tex 600–610) with no id, its body beginning with a space */
  private endIdScope(blank = true) {
    if (blank) this.s.space()
    this.end()
    this.end()
  }

  /** a picture's or scope's commands, up to \end{<env>} (or the } that ends \tikz's braces) */
  private body(inp: Input, until: string | null) {
    for (;;) {
      const t = inp.peek()
      if (t === undefined && until === null) return
      if (t === undefined) throw new Unsupported(`tikz: no end of ${until}`)
      if (t === " ") { inp.next(); this.s.space(); continue }
      if (t === "\\par" || t === "\\relax") { inp.next(); continue }
      if (t === "}" && until === "}") { inp.next(); this.end(); return }
      if (t === "{") { inp.next(); this.begin(); this.body(inp, "}"); continue }
      if (t === "\\end") {
        inp.next()
        const env = str(inp.undelimited())
        if (env !== until) throw new Unsupported(`tikz: \\end{${env}} in ${until}`)
        return
      }
      if (t === "\\begin") {
        inp.next()
        const env = str(inp.undelimited())
        if (env !== "scope") throw new Unsupported(`tikz: \\begin{${env}} in a picture`)
        this.begin() // \begin
        const options = inp.ifNext("[") ? (inp.next(), inp.delimited(["]"])) : []
        this.beginScope(options)
        this.body(inp, "scope")
        this.endScope()
        this.end() // \end
        continue
      }
      if (t === "\\tikzset") { inp.next(); this.tz.set(inp.undelimited()); continue }
      if (t === "\\foreach") { inp.next(); this.foreach(inp); continue }
      if (t === "\\tikzstyle") { inp.next(); inp.i += this.tz.tikzstyle(inp.t.slice(inp.i)); continue }
      if (this.command(inp)) {
        if (until !== "}") throw new Unsupported("tikz: } ends a path")
        return
      }
    }
  }

  /**
   * \foreach (tikz/foreach.ts): the loop in a group (\pgffor@atbeginforeach), each iteration's body run as the
   * picture's commands in a group of its own, its variables replaced by their values
   */
  private foreach(inp: Input) {
    const r = { t: inp.t, i: inp.i }
    const f = readForeach(r, this.s.units, new Map())
    inp.i = r.i
    this.begin()
    for (const vars of f.iterations) {
      this.begin()
      this.body(new Input(substitute(f.body, vars)), null)
      this.end()
    }
    this.end()
  }

  /** a path command (\path and the commands \tikz@installcommands defines); true when its } ended \tikz's braces */
  private command(inp: Input): boolean {
    const t = inp.next()!
    if (t in PATH_COMMANDS) {
      const options = PATH_COMMANDS[t]
      if (options !== null) inp.insert(["[", ...chars(options), "]"])
    } else if (t === "\\coordinate") inp.insert(chars(" coordinate"))
    else if (t === "\\node") inp.insert(chars(" node"))
    else throw new Unsupported(`tikz: ${t} in a picture`)
    // \tikz@command@path (2071–2078): [options] go back, <…> (beamer's overlays) are not modeled
    if (inp.ifNext("[")) {
      const j = find(inp.t, ["]"], inp.i)
      if (j >= 0 && inp.t.slice(j + 1).find((x) => x !== " ") === "<") throw new Unsupported("tikz: overlay specification")
    } else if (inp.ifNext("<")) throw new Unsupported("tikz: overlay specification")
    return this.path(inp)
  }


  // the options

  /** \tikz@options: the pgf calls the options appended, in order */
  private runOptions() {
    for (const o of this.tz.st.options) this.option(o)
  }

  private option(o: OptionCall) {
    const st = this.tz.st
    switch (o.op) {
      case "linewidth":
        pgfSetLineWidth(this.s, this.d, text(o.arg, "line width"))
        this.globalLineWidth()
        return
      case "dash": {
        // \pgfsetdash{pattern}{phase}: \pgflinewidth read when it runs
        const lw = (t: Toks) => str(t.map((x) => (x === "\\pgflinewidth" ? pt(st.lineWidth) : x)))
        const items = o.pattern.map((p) => { if (p.some((x) => isCs(x) && x !== "\\pgflinewidth")) throw new Unsupported("tikz: dash pattern"); return lw(p) })
        pgfSetDash(this.s, this.d, items, text(o.phase ?? st.dashPhase, "dash phase"))
        return
      }
      case "strokecolor": pgfSetStrokeColor(this.d, this.colorSpec(o.color), isColorName(str(o.color))); return
      case "fillcolor": pgfSetFillColor(this.d, this.colorSpec(o.color), isColorName(str(o.color))); return
      case "color": {
        // tikz.code.tex 257–275
        if (st.fillColor.length || st.strokeColor.length) {
          this.s.sw.colorResetInOrder = false
          st.strokeColor = []
          st.fillColor = []
        }
        this.L.dot = this.colorSpec(o.color)
        pgfSetColor(this.d, this.L.dot, true) // \pgfsetcolor{.}
        this.s.sw.colorResetInOrder = true
        return
      }
      case "cap": this.d.cap(o.kind); return
      case "join": this.d.join(o.kind); return
      case "miterlimit": pgfSetMiterLimit(this.s, this.d, text(o.arg, "miter limit")); return
      case "strokeopacity": pgfSetStrokeOpacity(this.s, this.d, text(o.arg, "opacity")); return
      case "fillopacity": pgfSetFillOpacity(this.s, this.d, text(o.arg, "opacity")); return
      case "compatcolor": {
        // \tikz@compat@color@set (1689–1695): xcolor's \color (\XC@bcolor is \pgfsys@color@reset), then pgffillcolor;
        // \color{.} pushes what dvips.def's driver makes of xcolor's name for it (not modeled)
        if (o.color === ".") throw new Unsupported("tikz: the color . as an option")
        const spec = this.colorSpec(chars(o.color))
        this.d.colorReset()
        this.L.dot = spec
        this.s.out.push({ kind: "whatsit", text: `\\special{color push ${spec}}` })
        this.afterGroup(() => this.s.out.push({ kind: "whatsit", text: "\\special{color pop}" }))
        // \pgfutil@colorlet{pgffillcolor}{#1}: both globals (for arrow tips) pgffillcolor's definition
        this.s.strokeColor = this.s.fillColor = (isColorName(o.color) && this.d.namedColors ? "named pgffillcolor" : "") + `|${spec}`
        return
      }
    }
  }

  /** a transformation as pgf runs it (\tikz@transform's calls, or at once when it is \relax) */
  transform(t: TransformCall) {
    const s = this.s
    switch (t.op) {
      case "shift": {
        // \tikz@scan@one@point\pgftransformshift#1\relax
        const inp = new Input([...t.point])
        const p = this.scanPoint(inp)
        if (inp.t.slice(inp.i).some((x) => x !== " ")) throw new Unsupported("tikz: text after the shift's point")
        pgfTransformShift(s, p)
        return
      }
      case "xshift": pgfTransformXShift(s, text(t.arg, "xshift")); return
      case "yshift": pgfTransformYShift(s, text(t.arg, "yshift")); return
      case "scale": pgfTransformScale(s, text(t.arg, "scale")); return
      case "xscale": pgfTransformXScale(s, text(t.arg, "xscale")); return
      case "yscale": pgfTransformYScale(s, text(t.arg, "yscale")); return
      case "xslant": pgfTransformXSlant(s, text(t.arg, "xslant")); return
      case "yslant": pgfTransformYSlant(s, text(t.arg, "yslant")); return
      case "rotate": pgfTransformRotate(s, text(t.arg, "rotate")); return
      case "of": {
        // \tikz@extract@node@dist\tikz@node@distance and\pgf@stop: the distance before `and`
        const d = this.tz.st.nodeDistance
        const j = find(d, chars("and"))
        const dist = text(j < 0 ? d : d.slice(0, j), "node distance")
        pgfTransformShift(s, () => pgfPointPolar(s, t.angle, dist))
        return
      }
      case "poscall": {
        const c = this.tz.st.posCall
        if (c) pgfTransformShift(s, qpoint(c.x, c.y))
        return
      }
      case "point": pgfTransformShift(s, t.point)
    }
  }

  /** positioning's `of` (tikzlibrarypositioning.code.tex 98–99): \tikz@scan@one@point(#2) */
  scanOf(target: Toks): { point: PgfPointMacro; border: string | null } {
    const point = this.scanPoint(new Input(["(", ...target, ")"]))
    return { point, border: this.L.shapeborder }
  }

  /** at=… (tikz.code.tex 969–970): \tikz@scan@one@point\tikz@set@at */
  atOption(v: Toks, st: TikzState) {
    const inp = new Input([...v])
    const p = this.scanPoint(inp)
    if (inp.t.slice(inp.i).some((x) => x !== " ")) throw new Unsupported("tikz: text after at's point")
    st.nodeAt = { kind: "point", point: p }
  }

  /**
   * x=…, y=… (tikz.code.tex 306–315): \pgfsetxvec of a point, or of \pgfpoint{#1}{0pt} (\pgfpoint{0pt}{#1})
   * (pgfcorepoints.code.tex 489–498)
   */
  vector(axis: "x" | "y", v: Toks) {
    const t = v.filter((x, i) => x !== " " || i > 0)
    const p = t[0] === "(" ? this.scanPoint(new Input([...t]))() : axis === "x" ? pgfPoint(this.s, text(t, "x"), "0pt") : pgfPoint(this.s, "0pt", text(t, "y"))
    const vs = this.s.local.vectors
    this.s.setLocal({ vectors: axis === "x" ? { ...vs, xx: p.x, xy: p.y } : { ...vs, yx: p.x, yy: p.y } })
  }

  /** baseline=…: \pgfsetbaseline */
  baseline(v: Toks) { pgfSetBaseline(this.s, text(v, "baseline")) }

  /** \pgfsetcornersarced{\pgfpoint{#1}{#1}} (tikz.code.tex 279–280): pgf rounds the corners the path makes from here on (pgf/round.ts) */
  corners(st: TikzState) { this.s.setLocal({ cornerArc: st.arcCorners && st.corner ? { ...st.corner } : null }) }

  /** \tikz@processarrows (1201–1208): \pgfsetarrows{#1}, as pgf reads it (pgf/arrows.ts); >=… is not modeled there */
  arrows(v: Toks, st: TikzState) {
    if (st.arrowMeans) throw new Unsupported("tikz: >= with an arrow specification")
    // (a braced tip name is the name: \pgfarrows@parser takes it as an argument)
    pgfSetArrows(this.s, text(v.filter((t) => t !== "{" && t !== "}"), "arrows"))
  }

  // the path

  /** \tikz@@command@path (2092–2118) */
  private path(inp: Input): boolean {
    const lineWidth = this.tz.st.lineWidth // \tikzscope@linewidth
    this.begin()
    const st = this.tz.st
    st.options = []
    st.mode = []
    this.L.doAtEnd = null
    this.L.figbox = null
    Object.assign(this.L, { lastx: 0, lasty: 0, lastxsaved: 0, lastysaved: 0, movetoWaiting: null, timer: null, collected: [], isLabel: false, scopeLineWidth: lineWidth })
    this.tz.set("every path/.try")
    return this.scan(inp)
  }

  /** \tikz@scan@next@command and \tikz@handle (2120–2167), up to the path's end; true when a } ended it and \tikz's braces */
  private scan(inp: Input): boolean {
    for (;;) {
      // \tikz@invoke@collected@onpath (2777–2783): the labels the last operation collected, up to \pgf@stop
      if (this.L.collected.length) {
        inp.insert([...this.L.collected, STOP])
        this.L.collected = []
        this.L.isLabel = true
      }
      // \let\pgf@let@token= takes one blank; \tikz@expand passes over the others
      inp.skipSpaces()
      const t = inp.next()
      switch (t) {
        case undefined: throw new Unsupported("tikz: a path without ;")
        case "(": inp.insert(["("]); this.moveto(inp); continue
        case "+": inp.insert(["+"]); this.moveto(inp); continue
        case "-": this.lineto(inp); continue
        case "|": this.vhLineto(inp); continue
        case "r": this.rect(inp); continue
        case "c": this.cchar(inp); continue
        case "e":
          if (!inp.ifNext("l")) { this.edge(inp); continue }
          inp.literal("llipse")
          this.flushMoveto()
          this.circle(inp)
          continue
        case "t": this.to(inp); continue
        case ".": this.dot(inp); continue
        case "a": this.arc(inp); continue
        case "g": this.grid(inp); continue
        case "p":
          if (inp.ifNext("l")) { this.plot(inp, "move"); continue }
          throw new Unsupported(inp.ifNext("i") ? "tikz: pic" : "tikz: parabola")
        case "n": this.fig(inp); continue
        case "[": this.tz.set(inp.delimited(["]"])); continue
        case "{": this.begin(); this.L.autoEndPath = false; continue
        case "}":
          // \tikz@finish\egroup: no blank taken after the path
          if (this.L.autoEndPath) { this.finish(inp, false); this.end(); return true }
          this.endPathScope()
          continue
        case ";": this.finish(inp, true); return false
        case UPDATE: this.L.updatenext = true; this.L.updatecurrent = true; continue
        case TO_PATH: this.toPath(inp); continue
        case TO_COMPUTE: this.toCompute(inp); continue
        case LABEL: this.L.isLabel = true; continue
        case STOP: this.L.isLabel = false; continue
        case LABEL_SAVE: this.L.savedLastFig = this.lastFigName; this.L.isLabel = false; continue
        case LABEL_RESTORE: this.lastFigName = this.L.savedLastFig; continue
        case PIN_SAVE: this.L.savedPinNode = this.L.lastNode; this.L.isLabel = false; continue
        case "\\par": case "\\relax": continue
      }
      throw new Unsupported(`tikz: ${t} on a path`)
    }
  }

  /** \tikz@@endscope (2526–2557): the current point (and, unless it is local, the rest) kept */
  private endPathScope() {
    const L = this.L
    const local = this.tz.st.currentPointLocal
    this.end()
    Object.assign(this.L, { lastx: L.lastx, lasty: L.lasty, figbox: L.figbox })
    if (!local) Object.assign(this.L, { lastxsaved: L.lastxsaved, lastysaved: L.lastysaved, movetoWaiting: L.movetoWaiting, shapeborder: L.shapeborder })
  }

  /** \tikz@finish (2207–2440); `inp` null for a node's path */
  private finish(inp: Input | null, blank: boolean) {
    const st = this.tz.st
    const lineWidth = this.L.scopeLineWidth
    // Step 4: the modes
    let fill = false, draw = false, clip = false, boundary = false
    for (const m of st.mode) {
      if (m === "filltrue" || m === "fillfalse") fill = m === "filltrue"
      else if (m === "drawtrue" || m === "drawfalse") draw = m === "drawtrue"
      else if (m === "cliptrue") clip = true
      else boundary = true
    }
    // Step 5': the options, in a graphic scope and a group
    const options = st.options.length > 0
    if (options) {
      this.d.beginscope()
      this.colorScopes.push([this.s.strokeColor, this.s.fillColor])
      this.begin()
      this.runOptions()
    }
    if (!clip) { this.begin(); this.begin(); this.begin() } // \pgfidscope, \begingroup
    // Step 10: \pgfusepath{fill,draw,clip}
    this.syncLineWidth()
    pgfUsePath(this.s, this.d, [...(fill ? ["fill"] : []), ...(draw ? ["draw"] : []), ...(clip ? ["clip"] : [])])
    // Step 13: \box\tikz@figbox
    if (this.L.figbox) this.s.out.push(hpack(this.L.figbox))
    // Step 14
    if (!clip) { this.end(); this.endIdScope() }
    if (options) {
      this.end()
      ;[this.s.strokeColor, this.s.fillColor] = this.colorScopes.pop()!
      this.d.endscope()
      if (clip) throw new Unsupported("tikz: extra options not allowed for clipping path command")
    }
    if (clip || boundary) this.afterGroup(() => this.s.setLocal({ relevant: false }))
    this.end()
    // \global\pgflinewidth=\tikzscope@linewidth, then \tikz@path@do@at@end: when that is empty, the scan
    // for the dimension's optional space takes a blank
    this.s.lineWidth = lineWidth
    this.globalLineWidth()
    if (this.L.doAtEnd) this.L.doAtEnd()
    else if (blank && inp?.peek() === " ") inp.next()
  }

  // the operations

  /** \tikz@make@last@position (5165–5177) */
  private makeLast(p: PgfPointMacro) {
    const q = p() // \pgf@process
    this.L.lastx = q.x
    this.L.lasty = q.y
    if (this.L.updatecurrent) { this.L.lastxsaved = q.x; this.L.lastysaved = q.y }
    if (this.L.updatenext) this.L.updatecurrent = true
  }

  private get last(): PgfPointMacro { return qpoint(this.L.lastx, this.L.lasty) }
  private get lastPoint(): PgfPoint { return { x: this.L.lastx, y: this.L.lasty } }

  /** \tikz@@movetosave (2670–2680): \tikz@lastmovetox and …y (the point untransformed), then \pgfpathmoveto */
  private movetoSave(p: PgfPointMacro) {
    this.L.lastMoveTo = p()
    pgfPathMoveTo(this.s, p)
  }

  /** \tikz@flush@moveto (2685–2691): the move waiting for a node's border goes to the node's centre */
  private flushMoveto() {
    if (this.L.movetoWaiting) this.movetoSave(this.last)
    this.L.movetoWaiting = null
  }

  /**
   * \tikz@flush@moveto@toward (2694–2708): the move waiting goes to the node's border towards `p`; that
   * point (the new \tikz@timer@start), or null when nothing waited
   */
  private flushTowards(p: PgfPoint): PgfPoint | null {
    const name = this.L.movetoWaiting
    this.L.movetoWaiting = null
    if (!name) return null
    const q = pgfPointShapeBorder(this.s, name, qpoint(p.x, p.y))
    this.movetoSave(qpoint(q.x, q.y))
    return q
  }

  /** \tikz@path@lineto (2843–2856), not snaked */
  private pathLineto(p: PgfPointMacro) {
    pgfPathLineTo(this.s, p)
  }

  /** \tikz@moveto, \tikz@@moveto (2654–2668): a node's point waits for the next one */
  private moveto(inp: Input) {
    const p = this.scanPoint(inp)
    this.makeLast(p)
    if (this.L.shapeborder) this.L.movetoWaiting = this.L.shapeborder
    else {
      this.movetoSave(this.last)
      this.L.movetoWaiting = null
    }
  }

  /** \tikz@lineto (2809–2814): -- or -| */
  private lineto(inp: Input) {
    if (inp.ifNext("|")) { inp.next(); return this.hvLineto(inp) }
    // \expandafter\tikz@lineto@mid\pgfutil@gobble
    if (inp.undelimited().join("") !== "-") throw new Unsupported("tikz: - on a path")
    // \tikz@lineto@mid (2815–2818)
    for (;;) {
      if (inp.ifNext("n")) { this.collectLabel(inp); continue }
      if (inp.ifNext("c")) {
        // \tikz@close (2944–2946): a coordinate, or cycle
        inp.next()
        if (inp.ifNext("o")) { this.collectCoordinate(inp); continue }
        return this.close(inp)
      }
      if (inp.ifNext("p")) {
        // \tikz@lineto@plot@or@pic: a plot whose first point a line goes to
        inp.next()
        if (inp.ifNext("i")) throw new Unsupported("tikz: pic on a path")
        return this.plot(inp, "line")
      }
      break
    }
    const p = this.scanPoint(inp)
    // \tikz@@lineto (2823–2846): the end of line after \edef\tikz@timer@start{…} is a space
    let start = this.lastPoint
    this.s.space()
    const name = this.L.shapeborder
    if (name) {
      // the line ends on the node's border, towards where it comes from
      const b = pgfPointShapeBorder(this.s, name, this.last)
      this.makeLast(qpoint(b.x, b.y))
      start = this.flushTowards(this.lastPoint) ?? start
      this.pathLineto(this.last)
      const end = this.lastPoint
      this.makeLast(p)
      this.L.movetoWaiting = name
      this.L.timer = { kind: "line", start, end }
    } else {
      this.makeLast(p)
      start = this.flushTowards(this.lastPoint) ?? start
      this.pathLineto(this.last)
      this.L.timer = { kind: "line", start, end: this.lastPoint }
    }
  }

  /** the labels before an operation's point (`node`, `coordinate`), collected; false when none */
  private collectBefore(inp: Input): boolean {
    if (inp.ifNext("n")) { this.collectLabel(inp); return true }
    if (inp.ifNext("p")) throw new Unsupported("tikz: pic on a path")
    if (inp.ifNext("c")) { inp.next(); this.collectCoordinate(inp); return true }
    return false
  }

  /** \tikz@hv@lineto, \tikz@@hv@lineto (2875–2907): -| */
  private hvLineto(inp: Input) {
    while (this.collectBefore(inp));
    const p = this.scanPoint(inp)
    let start = this.lastPoint
    let yc = this.L.lasty
    this.makeLast(p)
    const q = this.flushTowards({ x: this.L.lastx, y: yc })
    if (q) { start = q; yc = q.y }
    const name = this.L.shapeborder
    let end: PgfPoint
    if (name) {
      this.begin()
      const b = pgfPointShapeBorder(this.s, name, qpoint(this.L.lastx, yc))
      this.makeLast(qpoint(b.x, b.y))
      this.pathLineto(qpoint(this.L.lastx, yc))
      this.pathLineto(this.last)
      end = this.lastPoint
      this.end()
      this.L.movetoWaiting = name
    } else {
      this.pathLineto(qpoint(this.L.lastx, yc))
      this.pathLineto(this.last)
      end = this.lastPoint
    }
    this.L.timer = { kind: "hv", start, end }
  }

  /** \tikz@vh@lineto, \tikz@@vh@lineto (2909–2941): |- */
  private vhLineto(inp: Input) {
    inp.literal("-")
    while (this.collectBefore(inp));
    const p = this.scanPoint(inp)
    let start = this.lastPoint
    let xc = this.L.lastx
    this.makeLast(p)
    const q = this.flushTowards({ x: xc, y: this.L.lasty })
    if (q) { start = q; xc = q.x }
    const name = this.L.shapeborder
    let end: PgfPoint
    if (name) {
      this.begin()
      const b = pgfPointShapeBorder(this.s, name, qpoint(xc, this.L.lasty))
      this.makeLast(qpoint(b.x, b.y))
      this.pathLineto(qpoint(xc, this.L.lasty))
      this.pathLineto(this.last)
      end = this.lastPoint
      this.end()
      this.L.movetoWaiting = name
    } else {
      this.pathLineto(qpoint(xc, this.L.lasty))
      this.pathLineto(this.last)
      end = this.lastPoint
    }
    this.L.timer = { kind: "vh", start, end }
  }

  /** \tikz@@close (2947–2959): -- cycle, its c taken */
  private close(inp: Input) {
    inp.literal("ycle")
    this.flushMoveto()
    const start = this.lastPoint
    this.s.space() // the end of line after \edef\tikz@timer@start{…}
    // \pgfsyssoftpath@lastmoveto, the soft path's (transformed) coordinates
    for (let k = this.s.softPath.length - 1; k >= 0; k--) {
      const i = this.s.softPath[k]
      if (i.op === "moveto") { this.lastMoveTo = { x: i.x, y: i.y }; break }
    }
    this.makeLast(qpoint(this.lastMoveTo.x, this.lastMoveTo.y))
    pgfPathClose(this.s)
    this.L.timer = { kind: "line", start, end: this.L.lastMoveTo }
  }

  /** \tikz@dot … \tikz@curveC (3165–3255): `.. controls (a) and (b) .. (c)`, `.. controls (a) .. (c)` */
  private dot(inp: Input) {
    inp.literal(".")
    // \tikz@@dot: labels before the controls
    for (;;) {
      if (inp.ifNext("n")) { this.collectLabel(inp); continue }
      if (inp.ifNext("p")) throw new Unsupported("tikz: pic on a path")
      break
    }
    if (!inp.ifNext("c")) throw new Unsupported("tikz: .. without controls")
    inp.literal("co")
    if (inp.ifNext("o")) throw new Unsupported("tikz: coordinate before controls")
    inp.literal("ntrols")
    // \tikz@curveA: the first support, computed in a group with the current point the last one
    const p1 = this.scanPoint(inp)
    const start = this.lastPoint
    const support = (p: PgfPointMacro): PgfPoint => {
      const saved = { ...this.L }
      this.L.lastxsaved = this.L.lastx
      this.L.lastysaved = this.L.lasty
      this.makeLast(p)
      const q = this.lastPoint
      this.L = saved
      return q
    }
    const first = support(p1)
    let second: PgfPointMacro = qpoint(first.x, first.y)
    if (inp.ifNext("a")) { inp.literal("and"); second = this.scanPoint(inp) }
    // \tikz@curveCdots: \let\pgfutil@next= takes a blank and the first dot, then the second
    if (inp.peek() === " ") inp.next()
    inp.literal("..")
    if (this.L.updatenext) this.L.updatecurrent = true
    // \tikz@curveCcheck; `cycle` is \tikz@cycle@expander@add's `(current subpath start)--cycle`
    for (;;) {
      if (inp.ifNext("n")) { this.collectLabel(inp); continue }
      if (inp.ifNext("p")) throw new Unsupported("tikz: pic on a path")
      if (inp.ifNext("c")) {
        inp.next()
        if (inp.ifNext("y")) { inp.literal("ycle"); inp.insert(["(", ...chars("current subpath start"), ")", "-", "-", ...chars("cycle")]); break }
        this.collectCoordinate(inp)
        continue
      }
      break
    }
    const p3 = this.scanPoint(inp)
    // \tikz@curveC: the end, then the second support relative to it
    this.makeLast(p3)
    let third = this.lastPoint
    const c2 = support(second)
    let timerStart = start
    const waiting = this.L.movetoWaiting
    if (waiting) {
      const b = pgfPointShapeBorder(this.s, waiting, qpoint(first.x, first.y))
      timerStart = b
      this.movetoSave(qpoint(b.x, b.y))
    }
    const name = this.L.shapeborder
    if (name) {
      // the end on the target's border, towards the second support (the current point stays the node's centre)
      third = pgfPointShapeBorder(this.s, name, qpoint(c2.x, c2.y))
      pgfPathCurveTo(this.s, qpoint(first.x, first.y), qpoint(c2.x, c2.y), qpoint(third.x, third.y))
      this.L.movetoWaiting = name
    } else {
      pgfPathCurveTo(this.s, qpoint(first.x, first.y), qpoint(c2.x, c2.y), qpoint(third.x, third.y))
      this.L.movetoWaiting = null
    }
    this.L.timer = { kind: "curve", start: timerStart, c1: first, c2, end: third }
  }

  /**
   * \tikz@plot … \tikz@@@plot (tikz.code.tex 3330–3420) on pgfmoduleplot.code.tex: `plot[options] coordinates {…}` or
   * `plot[options] (expression)` sampled over the domain (\pgfplotfunction: a \foreach over \tikz@plot@samplesat),
   * each point streamed to the line handler (the first one moved or lined to); the last point is the current one
   */
  private plot(inp: Input, first: "move" | "line") {
    inp.literal("lot")
    this.flushMoveto()
    const options = inp.ifNext("[") ? (inp.next(), inp.delimited(["]"])) : []
    this.begin()
    this.tz.st.afterPath = []
    this.tz.st.options = []
    this.tz.set(["every plot/.try"])
    this.tz.set(options)
    const st = this.tz.st
    if (st.plotHandler !== "lineto" && st.plotHandler !== "discard") throw new Unsupported(`tikz: plot handler ${st.plotHandler}`)
    const mark = str(st.plotMark).trim()
    if (mark && !MARKS.has(mark)) throw new Unsupported(`tikz: plot mark ${mark}`)
    if (mark === "o" && !this.tz.plotmarks) throw new Unsupported("tikz: plot mark o without plotmarks")
    // \tikz@plot@data: the stream of points, run once for the path and once more for the marks
    let data: (point: (p: PgfPoint) => void) => void
    if (inp.ifNext("c")) {
      inp.literal("coordinates")
      // (\pgfplothandlerrecord: the points scanned once, then the record replayed)
      const coords = inp.undelimited()
      let record: PgfPoint[] | null = null
      data = (point) => {
        if (record) { record.forEach(point); return }
        record = []
        const inner = new Input([...coords])
        for (;;) {
          inner.skipSpaces()
          if (inner.peek() === undefined) break
          const p = this.scanPoint(inner)()
          record.push(p)
          point(p)
        }
      }
    } else if (inp.ifNext("(")) {
      inp.next()
      const expr = inp.delimited([")"])
      const samples = sampleValues(st.plotSamplesAt, this.s.units)
      data = (point) => {
        for (const v of samples) {
          // \foreach: \x the value, in a group
          this.begin()
          point(this.scanPoint(new Input(["(", ...substitute(expr, new Map([[st.plotVar, v]])), ")"]))())
          this.end()
        }
        this.s.space() // (the end of line after \pgfplotfunction's \foreach body)
      }
    } else throw new Unsupported("tikz: plot data")
    let started = false, last: PgfPoint = { x: 0, y: 0 }
    data((p) => {
      last = p
      if (st.plotHandler === "discard") return
      if (!started && first === "move") pgfPathMoveTo(this.s, qpoint(p.x, p.y))
      else pgfPathLineTo(this.s, qpoint(p.x, p.y))
      started = true
    })
    if (mark) {
      // the marks after the path: a box in \tikz@figbox, in \pgfinterruptpath and a scope, each mark shifted to its point
      const figbox = this.L.figbox ?? []
      const outer = this.s.out
      this.s.out = []
      this.begin() // \hbox{{
      this.begin()
      const saved = this.interruptPath()
      this.pgfscope()
      this.tz.st.options = []
      this.tz.st.transform = []
      this.tz.set("every mark")
      this.runOptions()
      const transforms = this.tz.st.transform
      const size = this.tz.st.plotMarkSize
      data((p) => {
        this.begin()
        pgfTransformShift(this.s, qpoint(p.x, p.y))
        for (const t of transforms) this.transform(t)
        drawMark(this.s, this.d, mark, size)
        this.end()
      })
      this.endpgfscope()
      this.endInterruptPath(saved)
      this.end()
      this.end()
      figbox.push(hpack(this.s.out))
      this.s.out = outer
      this.L.figbox = figbox
    }
    if (st.afterPath.length) throw new Unsupported("tikz: a plot's after path")
    const figbox = this.L.figbox
    this.end()
    this.L.figbox = figbox
    this.makeLast(qpoint(last.x, last.y))
  }

  /** \tikz@grid, \tikz@gridA, \tikz@gridB (3294–3326): `grid[options] (corner)` */
  private grid(inp: Input) {
    if (!inp.ifNext("r")) throw new Unsupported("tikz: grid expected")
    inp.literal("rid")
    this.flushMoveto()
    const a = this.lastPoint
    const options = inp.ifNext("[") ? (inp.next(), inp.delimited(["]"])) : []
    if (inp.ifNext("c")) throw new Unsupported("tikz: grid to cycle")
    this.makeLast(this.scanPoint(inp))
    const b = this.lastPoint
    this.begin()
    this.tz.set(options)
    this.s.space() // (the \tikzset line's end)
    const st = this.tz.st
    const gx = st.gridX, gy = st.gridY
    // the steps' vectors added: \pgfpoint{x}{0pt} or \pgfpointxy{x}{0}, then the y step's
    const vec = (t: Toks, axis: "x" | "y"): PgfPoint => {
      const u = this.checkUnit(t)
      if (u.units) return axis === "x" ? pgfPoint(this.s, `${u.result}pt`, "0pt") : pgfPoint(this.s, "0pt", `${u.result}pt`)
      return axis === "x" ? pgfPointXY(text(t, "step"), "0", this.s.units, this.s.local.vectors) : pgfPointXY("0", text(t, "step"), this.s.units, this.s.local.vectors)
    }
    const vx = vec(gx, "x"), vy = vec(gy, "y")
    pgfPathGrid(this.s, vx.x + vy.x, vx.y + vy.y, a, b, () => this.s.space())
    this.end()
  }

  /** \tikz@arcA, \tikz@arc@cont, \tikz@arc@opt, \tikz@@arcto (3628–3678): `arc (s:e:r)`, `arc (s:e:rx and ry)`, `arc[keys]` */
  private arc(inp: Input) {
    if (!inp.ifNext("r")) throw new Unsupported("tikz: arc expected")
    inp.literal("rc")
    this.flushMoveto()
    if (inp.ifNext("(")) {
      inp.next()
      const t = inp.delimited([")"])
      const [sa, rest] = split(t, [":"])
      const [ea, r] = split(rest, [":"])
      const [rx, ry] = contains(r, chars(" and ")) ? split(r, chars(" and ")) : [r, r]
      this.doArc(text(sa, "angle"), text(ea, "angle"), rx, ry)
      return this.arcFinal()
    }
    const options = inp.ifNext("[") ? (inp.next(), inp.delimited(["]"])) : []
    // in a group: the keys, the missing angle from the delta (\pgfmathsetmacro on a line of its own: a blank)
    this.begin()
    this.tz.set(["every arc/.try", ",", ...options])
    const value = (k: string) => str(this.tz.keys.valueOf(`/tikz/${k}`) ?? [])
    let sa = value("start angle"), ea = value("end angle")
    const d = value("delta angle")
    if (sa === "") { sa = this.checkUnit(chars(`${ea}-${d}`)).result; this.s.space() }
    else if (ea === "") { ea = this.checkUnit(chars(`${sa}+${d}`)).result; this.s.space() }
    const rx = this.tz.keys.valueOf("/tikz/x radius") ?? [], ry = this.tz.keys.valueOf("/tikz/y radius") ?? []
    this.end()
    this.doArc(sa, ea, rx, ry)
    this.arcFinal()
  }

  /** the arc's ends relative to its centre, for \tikz@arcfinal, and its timer's angles and axes */
  private arcEnds: [PgfPoint, PgfPoint] = [{ x: 0, y: 0 }, { x: 0, y: 0 }]
  private arcTimer: NonNullable<Timer["arc"]> = { start: "0", end: "0", zero: { x: 0, y: 0 }, ninety: { x: 0, y: 0 } }

  /** \tikz@do@arc (3680–3716) and \tikz@@@arcfinal (3718–3729), each line its blank */
  private doArc(sa: string, ea: string, rx: Toks, ry: Toks) {
    const s = this.s
    // \tikz@timer@start@angle, …end… (\pgfmathsetmacro)
    const start = this.checkUnit(chars(sa)).result, end = this.checkUnit(chars(ea)).result
    const x = this.checkUnit(rx), y = this.checkUnit(ry)
    if (x.units !== y.units) throw new Unsupported("tikz: dimensions and dimensionless values mixed in an arc")
    const space = () => s.space()
    if (x.units) {
      const r = `${x.result}pt and ${y.result}pt`
      pgfPathArc(s, start, end, r, space)
      s.space()
      const a = pgfPointPolar(s, start, r)
      s.space()
      this.arcEnds = [a, pgfPointPolar(s, end, r)]
      s.space() // (the timer's axes, each \edef on a line)
      s.space()
      const ax = new TexArith(s.units)
      this.arcTimer = { start, end, zero: { x: ax.dimen(`${x.result}pt`), y: 0 }, ninety: { x: 0, y: ax.dimen(`${y.result}pt`) } }
    } else {
      pgfPathArcAxes(s, start, end, pgfPointXY(x.result, "0", s.units, s.local.vectors), pgfPointXY("0", y.result, s.units, s.local.vectors), space)
      s.space()
      const a = this.polarXY(start, `${x.result} and ${y.result}`)
      s.space()
      this.arcEnds = [a, this.polarXY(end, `${x.result} and ${y.result}`)]
      // the timer's axes, each \pgf@process and \edef on a line
      for (let k = 0; k < 4; k++) s.space()
      this.arcTimer = { start, end, zero: pgfPointXY(x.result, "0", s.units, s.local.vectors), ninety: pgfPointXY("0", y.result, s.units, s.local.vectors) }
    }
  }

  /** \tikz@arcfinal (3732–3743): the current point moved by the arc */
  private arcFinal() {
    const [a, b] = this.arcEnds
    const start = this.lastPoint
    this.L.lastx += b.x - a.x
    this.L.lasty += b.y - a.y
    this.L.lastxsaved = this.L.lastx
    this.L.lastysaved = this.L.lasty
    this.L.timer = { kind: "arc", start, end: this.lastPoint, arc: this.arcTimer }
  }

  /** \tikz@rect, \tikz@@rect, \tikz@rectB (3260–3290) */
  private rect(inp: Input) {
    inp.literal("ectangle")
    this.flushMoveto()
    const start = this.lastPoint
    while (this.collectBefore(inp));
    this.s.space() // the end of line after the { of \tikz@@rect's last branch
    const xa = this.L.lastx, ya = this.L.lasty
    const p = this.scanPoint(inp)
    this.makeLast(p)
    this.L.timer = { kind: "line", start, end: this.lastPoint }
    this.movetoSave(qpoint(xa, ya))
    this.pathLineto(qpoint(xa, this.L.lasty))
    this.pathLineto(qpoint(this.L.lastx, this.L.lasty))
    this.pathLineto(qpoint(this.L.lastx, ya))
    pgfPathClose(this.s)
    this.movetoSave(qpoint(this.L.lastx, this.L.lasty))
  }

  /** \tikz@cchar (2168–2172): circle, coordinate */
  private cchar(inp: Input) {
    if (inp.ifNext("i")) { inp.literal("ircle"); this.flushMoveto(); return this.circle(inp) }
    if (inp.ifNext("h")) throw new Unsupported("tikz: child")
    inp.literal("o")
    if (!inp.ifNext("o")) throw new Unsupported("tikz: cos")
    inp.literal("ordinate")
    this.coordinate(inp)
  }

  /** \tikz@circle, \tikz@ellipse, \tikz@@circle (3542–3585) */
  private circle(inp: Input) {
    if (inp.ifNext("(")) {
      inp.next()
      const r = inp.delimited([")"])
      this.begin()
      pgfTransformShift(this.s, this.last)
      if (contains(r, chars(" and "))) {
        const [a, b] = split(r, chars(" and "))
        this.ellipse(a, b)
      } else this.circleRadius(r)
      this.end()
      return
    }
    let options: Toks = []
    if (inp.ifNext("[")) { inp.next(); options = inp.delimited(["]"]) }
    else if (isCs(inp.peek() ?? "")) throw new Unsupported(`tikz: ${inp.peek()} after circle`)
    // \tikz@circle@opt (3560–3570)
    this.begin()
    this.tz.st.transform = []
    this.tz.set(["every circle/.try", ",", ...options])
    pgfTransformShift(this.s, this.last)
    for (const t of this.tz.st.transform) this.transform(t)
    const value = (k: string) => this.tz.keys.valueOf(`/tikz/${k}`) ?? []
    this.ellipse(value("x radius"), value("y radius"))
    this.s.space() // the end of line after \tikz@do@ellipse{…}{…}
    this.end()
  }

  /** \pgfmathparse: the result and whether it has units (\tikz@checkunit) */
  private checkUnit(t: Toks): { result: string; units: boolean } {
    const r = pgfmathParse(text(t, "number"), this.s.units)
    if (r.errors.length) throw new Unsupported(`tikz: ${r.errors[0]}`)
    return { result: r.result, units: r.unitsDeclared }
  }

  /** \tikz@do@circle (3587–3598) */
  private circleRadius(r: Toks) {
    const { result: x, units } = this.checkUnit(r)
    const a = new TexArith(this.s.units)
    if (units) pgfPathEllipse(this.s, pgfPointOrigin, qpoint(a.dimen(`${x}pt`), 0), () => pgfPoint(this.s, "0pt", `${x}pt`))
    else pgfPathEllipse(this.s, pgfPointOrigin, () => pgfPointXY(x, "0", this.s.units, this.s.local.vectors), () => pgfPointXY("0", x, this.s.units, this.s.local.vectors))
  }

  /** \tikz@do@ellipse (3600–3626), its body beginning with a space */
  private ellipse(rx: Toks, ry: Toks) {
    this.s.space()
    const x = this.checkUnit(rx)
    const y = this.checkUnit(ry)
    if (x.units !== y.units) throw new Unsupported("tikz: dimensions and dimensionless values mixed in an ellipse")
    if (x.units) pgfPathEllipse(this.s, pgfPointOrigin, qpoint(new TexArith(this.s.units).dimen(`${x.result}pt`), 0), () => pgfPoint(this.s, "0pt", `${y.result}pt`))
    else pgfPathEllipse(this.s, pgfPointOrigin, () => pgfPointXY(x.result, "0", this.s.units, this.s.local.vectors), () => pgfPointXY("0", y.result, this.s.units, this.s.local.vectors))
  }

  /** \tikz@to, \tikz@to@or@edge, \tikz@do@to (2983–3101), with the default to path `-- (\tikztotarget) \tikztonodes` */
  private to(inp: Input) {
    inp.literal("o")
    // \tikz@to@use@last@coordinate (3103–3108)
    const start = this.lastCoordinate()
    const { local, target, nodes } = this.toOrEdge(inp)
    // \tikz@do@to: the to path scanned in a group of its own, then the current point updated again
    this.L.to = { start, target, nodes }
    inp.insert(["{", "[", ...chars("style=every to"), "]", "[", ...local, "]", TO_PATH, "}", UPDATE])
  }

  /** \tikz@to@use@last@coordinate (3103–3108): the node the last point was on, or the point */
  private lastCoordinate(): Tok[] { return chars(this.L.shapeborder ?? `${pt(this.L.lastx)},${pt(this.L.lasty)}`) }

  /** \tikz@to@or@edge … \tikz@@to@or@edge@@coordinate (2990–3039): local options, the labels (\tikz@tonodes) and the target */
  private toOrEdge(inp: Input): { local: Tok[]; target: Tok[]; nodes: Tok[] } {
    const local: Tok[] = []
    for (;;) {
      if (inp.ifNext("[")) { inp.next(); local.push(",", ...inp.delimited(["]"])); continue }
      if (inp.ifNext(":")) throw new Unsupported("tikz: animation")
      break
    }
    // \tikz@@to@collect (3005–3015): the labels go to \tikztonodes
    let target: Tok[]
    for (;;) {
      if (inp.ifNext("(")) {
        inp.next()
        if (inp.ifNext("$") || inp.ifNext("[")) { inp.insert(["("]); target = this.toMath(inp) }
        else target = inp.delimited([")"])
        break
      }
      if (this.collectBefore(inp)) continue
      if (inp.ifNext("+")) { target = this.toMath(inp); break }
      throw new Unsupported("tikz: (, +, coordinate, pic, or node expected")
    }
    const nodes = this.L.collected
    this.L.collected = []
    // (\tikztotarget, \edef'd where a node's name is looked up)
    return { local, target: this.nodeNames(target), nodes }
  }

  /**
   * \tikz@edge@plain, \tikz@do@edge (2971–2977, 3040–3082): in a group, a path of its own, `\path[every edge][local
   * options](\tikztostart)` and the to path, in a box added to \tikz@figbox, in \pgfinterruptpath and a scope
   */
  private edge(inp: Input) {
    inp.literal("dge")
    if (inp.ifNext("f")) throw new Unsupported("tikz: edge from parent")
    this.begin()
    const whom = this.L.toUseWhom
    if (!whom) throw new Unsupported("tikz: an edge from nowhere")
    // (\tikz@to@last@fig@name, \let where \tikzlastnode is: a pin's node does not change it)
    const start = whom === "node" ? chars(this.L.lastNode) : this.lastCoordinate()
    const { local, target, nodes } = this.toOrEdge(inp)
    const figbox = this.L.figbox ?? []
    const outer = this.s.out
    this.s.out = []
    this.begin() // \setbox\tikz@whichbox=\hbox\bgroup
    this.begin() // \hbox\bgroup
    this.begin() // \bgroup
    const saved = this.interruptPath()
    this.pgfscope()
    this.tz.st.transform = []
    this.tz.st.options = []
    this.begin() // \pgfidscope
    this.begin()
    this.tz.st.transform = null
    this.tz.st.afterPath = []
    this.L.to = { start, target, nodes }
    this.command(new Input(["\\path", "[", ...chars("style=every edge"), "]", "[", ...local, "]", "(", ...start, ")", TO_PATH, ";"]))
    // (the path's \tikz@finish, scanning \pgflinewidth's optional blank, takes the one \endpgfidscope begins with)
    this.endIdScope(false)
    this.endpgfscope()
    this.endInterruptPath(saved)
    this.end()
    this.end()
    this.end()
    figbox.push(hpack(this.s.out))
    this.s.out = outer
    this.end()
    this.L.figbox = figbox
  }

  /**
   * \tikz@to@path once the options are read: `-- (\tikztotarget) \tikztonodes`, or topaths' \tikz@to@curve@path
   * (tikzlibrarytopaths.code.tex 141–147)
   */
  private toPath(inp: Input) {
    const to = this.L.to
    if (!to) throw new Unsupported("tikz: a to path outside to")
    const nodes = ["{", LABEL, ...to.nodes, "}"]
    if (!this.tz.st.toCurve) inp.insert(["-", "-", " ", "(", ...to.target, ")", " ", ...nodes])
    else inp.insert(["[", ...chars("every curve to"), "]", TO_COMPUTE, UPDATE, ...nodes])
  }

  /** \tikz@to@compute, \tikz@to@compute@relative (149–330): the curve's path, scanned next */
  private toCompute(inp: Input) {
    const to = this.L.to!
    const st = this.tz.st
    const s = this.s
    const out = source(st.toOut), into = source(st.toIn)
    const isNode = (t: Toks) => this.nodes.has(str(t))
    const point = (t: Toks): PgfPoint => this.scanPoint(new Input(["(", ...t, ")"]))()
    if (!st.toRelative) {
      // \tikz@to@modify: a node's anchor at the angle (each leaves the blank that ends a line of it)
      const from = isNode(to.start) ? [...to.start, ".", ...chars(out)] : to.start
      s.space()
      const toto = isNode(to.target) ? [...to.target, ".", ...chars(into)] : to.target
      s.space()
      const first = point(from)
      const second = point(toto)
      const [d1, d2] = this.toDistances(first, second)
      s.space() // (the end of the line of \edef\tikz@computed@path)
      inp.insert(tokenize(`.. controls ([shift=({${out}}:${pt(d1)})]${source(from)}) and ([shift=({${into}}:${pt(d2)})]${source(toto)}) .. (${source(to.target)})`))
      return
    }
    const fromP = point(to.start), toP = point(to.target)
    /** p rotated by the angles about c (in a group: the transformation reset) */
    const rotated = (c: PgfPoint, angles: string[], p: PgfPoint): PgfPoint => {
      s.begingroup()
      pgfTransformReset(s)
      pgfTransformShift(s, qpoint(c.x, c.y))
      for (const a of angles) pgfTransformRotate(s, a)
      pgfTransformShift(s, qpoint(-c.x, -c.y))
      const q = transformPoint(s, p)
      s.endgroup()
      return q
    }
    let first = fromP, second = toP, startText = ""
    if (isNode(to.start)) {
      const q = rotated(fromP, [out], toP)
      first = pgfPointShapeBorder(s, str(to.start), qpoint(q.x, q.y))
      s.space() // (the end of the line of \xdef\tikz@tofrom@smuggle)
      startText = `(${pt(first.x)},${pt(first.y)})`
    }
    if (isNode(to.target)) {
      const q = rotated(toP, ["180", into], fromP)
      second = pgfPointShapeBorder(s, str(to.target), qpoint(q.x, q.y))
      s.space() // (\xdef\tikz@toto@smuggle's)
    }
    const [d1, d2] = this.toDistances(first, second)
    // the start at the origin, the target on the x axis
    const n = pgfPointNormalised({ x: second.x - first.x, y: second.y - first.y }, s.units)
    const control = (at: PgfPoint, angle: string, d: number): PgfPoint => {
      s.begingroup()
      pgfTransformReset(s)
      pgfTransformShift(s, qpoint(at.x, at.y))
      pgfTransformCm(s, toNumber(n.x), toNumber(n.y), toNumber(-n.y), toNumber(n.x), pgfPointOrigin)
      const q = transformPoint(s, pgfPointPolar(s, angle, pt(d)))
      s.endgroup()
      return q
    }
    const a = control(first, out, d1)
    s.space() // (after each support's group)
    const b = control(second, into, d2)
    s.space()
    inp.insert(tokenize(` ${startText} .. controls (${pt(a.x)},${pt(a.y)}) and (${pt(b.x)},${pt(b.y)}) .. (${pt(second.x)},${pt(second.y)})`))
  }

  /** \tikz@to@compute@distance@main (163–220): the supports' distances from the ends, by looseness and bounds */
  private toDistances(first: PgfPoint, second: PgfPoint): [number, number] {
    const units = this.s.units
    let xa = Math.abs(second.x - first.x), ya = Math.abs(second.y - first.y)
    const n = pgfPointNormalised({ x: xa, y: ya }, units)
    if (n.x > n.y) {
      const c = Math.trunc(n.x / 255)
      if (n.x !== 0) xa = 16 * Math.trunc((16 * xa) / c)
    } else {
      const c = Math.trunc(n.y / 255)
      if (n.y !== 0) { ya = Math.trunc((16 * ya) / c); xa = 16 * ya }
    }
    if (Math.abs(xa) >= 0x40000000) throw new Unsupported("tikz: a to path too long")
    const x = mul("0.3915", xa)
    const l = this.tz.st.toLooseness
    let d1 = mul(l.out, x), d2 = mul(l.in, x)
    const len = (v: string) => {
      const r = pgfmathSetLength(v, units)
      if (r.errors.length) throw new Unsupported(`tikz: ${r.errors[0]}`)
      return r.value
    }
    d1 = Math.min(Math.max(d1, len(l.outMin)), len(l.outMax))
    d2 = Math.min(Math.max(d2, len(l.inMin)), len(l.inMax))
    return [d1, d2]
  }

  /**
   * \tikz@@to@or@edge@math (3027–3034): the target as text (\tikz@updatenextfalse after +(…) only reaches the
   * to path's own group, which the default to path does not read)
   */
  private toMath(inp: Input): Tok[] {
    const q = this.scanPoint(inp)()
    if (!this.L.updatecurrent) this.L.updatenext = false
    return chars(`${pt(q.x)},${pt(q.y)}`)
  }

  // nodes

  /**
   * \tikz@collect@label@onpath (2729–2770): `node` and its name, options and text, kept in
   * \tikz@collected@onpath until the operation is done
   */
  private collectLabel(inp: Input) {
    inp.literal("node")
    // (a copy: a group's saved state keeps its own)
    const c = [...this.L.collected, ...chars("node")]
    this.L.collected = c
    for (;;) {
      if (inp.ifNext("f")) throw new Unsupported("tikz: node foreach")
      if (inp.ifNext(":")) throw new Unsupported("tikz: animation")
      for (const [open, close] of [["(", ")"], ["[", "]"]]) {
        if (!inp.ifNext(open)) continue
        const j = find(inp.t, [close], inp.i)
        if (j < 0) throw new Unsupported(`tikz: "${close}" expected`)
        c.push(...inp.t.slice(inp.i, j + 1))
        inp.i = j + 1
      }
      if (inp.ifNext("(") || inp.ifNext("[")) continue
      if (inp.ifNext("{")) c.push("{", ...inp.undelimited(), "}")
      return
    }
  }

  /** \tikz@collect@coordinate@onpath (2716–2726), its c taken: `coordinate[options](name)`, collected as a node */
  private collectCoordinate(inp: Input) {
    if (inp.ifNext("y")) throw new Unsupported("tikz: cycle after this operation")
    inp.literal("oordinate")
    const options = inp.ifNext("[") ? (inp.next(), inp.delimited(["]"])) : []
    const head = [...chars("node[shape=coordinate,"), ...options, "]"]
    if (inp.ifNext("(")) { inp.next(); inp.insert([...head, "(", ...inp.delimited([")"]), ")", "{", "}"]) }
    else inp.insert([...head, "{", "}"])
    this.collectLabel(inp)
  }

  /**
   * \tikz@coordinate (3749–3770): coordinate[options](name) at (point), a node of shape coordinate; `at`'s
   * point computed at once and handed on as text
   */
  private coordinate(inp: Input) {
    const options = inp.ifNext("[") ? (inp.next(), inp.delimited(["]"])) : []
    const head = [...chars("ode[shape=coordinate,"), ...options, "]"]
    if (!inp.ifNext("(")) { inp.insert([...head, "{", "}"]); return this.fig(inp) }
    inp.next()
    const name = inp.delimited([")"])
    if (!inp.ifNext("a")) { inp.insert([...head, "(", ...name, ")", "{", "}"]); return this.fig(inp) }
    inp.next()
    // \tikz@@coordinate@at: `a` not followed by `t` is what comes after the node (an arc)
    if (!inp.ifNext("t")) { inp.insert([...head, "(", ...name, ")", "{", "}", "a"]); return this.fig(inp) }
    inp.next()
    // at#3(: what lies before the ( goes
    const j = find(inp.t, ["("], inp.i)
    if (j < 0) throw new Unsupported("tikz: ( expected after at")
    inp.i = j
    const q = this.scanPoint(inp)() // \tikz@@coordinate@at@math
    inp.insert([...head, "(", ...name, ")", "a", "t", "(", ...chars(`${pt(q.x)},${pt(q.y)}`), ")", "{", "}"])
    this.fig(inp)
  }

  /** \tikz@fig ode (3783–3789), the n taken */
  private fig(inp: Input) {
    inp.literal("ode")
    if (inp.ifNext("a")) {
      // \tikz@test@also
      inp.next()
      const also = inp.ifNext("l")
      inp.insert(["a"])
      if (also) throw new Unsupported("tikz: node also")
    } else if (inp.ifNext("f")) throw new Unsupported("tikz: node foreach")
    this.normalFig(inp)
  }

  /**
   * \tikz@normal@fig … \tikz@node@finish (3790–4185): a node's name, options, position and text read; its
   * text box made; the node placed by its transformations and made by pgf (\pgfmultipartnode, its
   * background path used by \tikz@finish) in a box added to \tikz@figbox, which the path's \tikz@finish puts
   * in the picture
   */
  private normalFig(inp: Input) {
    const lineWidth = this.tz.st.lineWidth // \tikz@save@line@width
    this.begin()
    this.tz.st.figName = ""
    this.begin()
    let st = this.tz.st
    st.options = []
    st.transform = []
    st.mode = []
    st.afterPath = []
    const at = this.lastPoint
    st.nodeAt = { kind: "point", point: () => at }
    if (!this.L.isLabel) st.time = ""
    // positioning's \tikz@node@reset@hook: \tikz@lib@pos@call, read when the transformations run, comes first
    if (this.tz.positioning) {
      st.transform.push({ op: "poscall" })
      st.posCall = null
    }
    this.tz.set("every node/.try")
    // \tikz@@scan@fig (3818–3840)
    for (;;) {
      if (inp.ifNext("a")) {
        inp.literal("at")
        const p = this.scanPoint(inp)
        this.tz.st.nodeAt = { kind: "point", point: p }
        continue
      }
      if (inp.ifNext("(")) { inp.next(); this.tz.set([...chars("name="), "{", ...inp.delimited([")"]), "}"]); continue }
      if (inp.ifNext("[")) {
        inp.next()
        const options = inp.delimited(["]"])
        if (options.includes("\"")) throw new Unsupported("tikz: quotes in a node's options")
        this.tz.set(options)
        continue
      }
      if (inp.ifNext(":")) throw new Unsupported("tikz: animation")
      if (inp.ifNext("{")) break
      throw new Unsupported("tikz: a node must have a (possibly empty) label text")
    }
    const content = inp.undelimited()
    // \tikz@@fig@main (3847–3863)
    if (!this.tz.hasShape(this.tz.st.shape)) throw new Unsupported(`tikz: the shape ${this.tz.st.shape}`)
    this.tz.set(`every ${this.tz.st.shape} node/.try`)
    st = this.tz.st
    if (!this.tz.hasShape(st.shape)) throw new Unsupported(`tikz: the shape ${st.shape}`)
    // \tikz@node@textfont: the node's font, which pgfmath's em and ex are in from here on
    const units = this.s.units
    if (st.nodeFont.length) {
      if (!this.text) throw new Unsupported("tikz: node font outside a document")
      this.s.units = this.text.units(source(st.nodeFont))
    }
    const textBox = this.textBox(content)
    st = this.tz.st
    // \tikz@fig@mustbenamed (4144–4151): a node with something after it, or followed by c, [, t or e, gets a name
    const follows = ["c", "[", "t", "e"].some((c) => inp.ifNext(c))
    if ((st.afterPath.length || follows) && st.figName === "") st.figName = `tikz@f@${++this.counts.fig}`
    // \tikz@fig@continue (4081–4145): the transformations, then the node in a box of its own
    this.nodeTransformations()
    st = this.tz.st
    const figbox = this.L.figbox ?? []
    const outer = this.s.out
    this.s.out = []
    this.begin() // \hbox{{
    this.begin()
    const saved = this.interruptPath()
    this.pgfscope()
    this.runOptions()
    this.begin() // \pgfidscope
    this.begin()
    this.L.figbox = null
    const box = this.wrapText(textBox)
    st = this.tz.st
    const value = (k: string) => str(this.tz.keys.valueOf(`/pgf/${k}`) ?? [])
    const keys: PgfShapeKeys = {
      innerXSep: value("inner xsep"), innerYSep: value("inner ysep"), outerXSep: value("outer xsep"), outerYSep: value("outer ysep"),
      minimumWidth: value("minimum width"), minimumHeight: value("minimum height"),
    }
    this.syncLineWidth()
    pgfMultipartNode(this.s, this.d, st.shape, text(st.anchor, "anchor"), st.figName, () => this.nodePath(), keys, box)
    this.endIdScope()
    this.endpgfscope()
    this.endInterruptPath(saved)
    this.end()
    this.end() // }}
    figbox.push(hpack(this.s.out))
    this.s.out = outer
    // \tikz@node@finish (4171–4205): the box goes out of the groups, then what comes after the node
    this.lastFigName = st.figName
    const after = st.afterPath
    this.end()
    this.end()
    this.s.units = units
    this.L.figbox = figbox
    this.s.lineWidth = lineWidth
    this.globalLineWidth()
    // \tikz@do@after@path@smuggle: \tikz@scan@next@command{…}\pgf@stop, scanned here
    this.L.lastNode = this.lastFigName
    this.L.toUseWhom = "node"
    if (after.length) inp.insert(["{", ...after, "}"])
  }

  /**
   * tikz@label@post (tikz.code.tex 770–820): a label's node at the anchor of \tikzlastnode its angle names,
   * shifted away from the node's centre by the label distance; with anchor=@auto its anchor faces the node
   */
  labelPost(distance: Toks, st: TikzState) {
    const s = this.s
    s.space() // (the code begins with the end of its first line)
    // \edef\tikz@label@angle{\tikz@label@angle}, then \pgfkeys@spdef
    const defaults: Record<string, Toks> = { "\\tikz@label@default@pos": st.labelPosition, "\\tikz@pin@default@pos": st.pinPosition }
    let angle = plain(spdef(st.labelAngle.flatMap((t) => defaults[t] ?? [t])), "label position")
    angle = LABEL_ANGLES[angle] ?? angle
    const node = this.L.lastNode
    if (!this.nodes.has(node)) throw new Unsupported("tikz: a label of no node")
    if (angle === "center") {
      st.nodeAt = { kind: "anchor", node, anchor: "center" }
      st.anchor = chars("center")
      return
    }
    if (st.absolute) throw new Unsupported("tikz: absolute label positions")
    const dist = text(distance, "label distance")
    const b = pgfPointAnchor(s, node, angle)
    st.nodeAt = { kind: "point", point: () => b }
    const c = pgfPointAnchor(s, node, "center")
    if (c.x === b.x && c.y === b.y) {
      this.computeDirection(angle, st)
      this.tz.addTransform({ op: "point", point: () => pgfPointPolar(s, angle, dist) })
      return
    }
    const n = pgfPointNormalised(pgfPointDiff(transformPoint(s, c), transformPoint(s, b)), s.units)
    // \pgftransformshift{\pgfpointscale{distance}{ \pgfqpoint{x}{y}}}: \pgf@process typesets the blank
    this.tz.addTransform({ op: "point", point: () => { s.space(); return pgfPointScale(dist, n, s.units) } })
    if (str(st.anchor) === "@auto") st.anchor = chars(autoAnchorOf({ x: n.y, y: -n.x }, true))
  }

  /** \tikz@compute@direction (916–946): with anchor=@auto, the anchor facing the angle */
  private computeDirection(angle: string, st: TikzState) {
    if (str(st.anchor) !== "@auto") return
    st.autoAnchor = false
    const r = pgfmathParse(angle, this.s.units)
    if (r.errors.length) throw new Unsupported(`tikz: ${r.errors[0]}`)
    let a = Math.trunc(Number(r.result))
    if (a < 0) a += 360
    if (a > 359) a -= 360
    st.anchor = chars(a < 4 ? "west" : a < 87 ? "south west" : a < 94 ? "south" : a < 177 ? "south east" : a < 184 ? "east"
      : a < 267 ? "north east" : a < 274 ? "north" : a < 357 ? "north west" : "west")
  }

  /**
   * \tikz@do@fig … \tikz@fig@boxdone (3866–3938): \pgfnodeparttextbox, the text in an \hbox (after
   * \ignorespaces, before \unskip) in the picture's font and the font option's, in the text color when one
   * is set
   */
  private textBox(content: Toks): BoxNode {
    const st = this.tz.st
    const body = source(content).replace(/^\s+/, "")
    const header = this.tz.keys.valueOf("/tikz/node halign header") ?? []
    // \pgfutil@colorlet{.}{color}\pgfutil@color{color}: xcolor's \color (\pgfsys@color@reset first, under
    // \pgfsys@begin@text), its color popped when the group ends; the color `.` so defined is, under dvips,
    // xcolor's named color XC@.
    const outer = this.s.out
    let head: Node[] = [], before: Node[] = [], after: Node[] = []
    if (st.textColor.length) {
      const dot = plain(st.textColor, "color").trim() === "."
      const spec = dot && this.d.namedColors ? " XC@." : this.colorSpec(st.textColor)
      this.s.out = []
      this.begin()
      this.d.beginText()
      head = this.s.out
      this.s.out = []
      this.d.colorReset()
      before = [...this.s.out, { kind: "whatsit", text: `\\special{color push ${spec}}` }]
      after = [{ kind: "whatsit", text: "\\special{color pop}" }]
    }
    let list: Node[] = []
    if (st.textWidth.length) {
      // the text in a minipage, the color's specials in its paragraph
      if (!this.text) throw new Unsupported("tikz: a node's text outside a document")
      const w = pgfmathSetLength(text(st.textWidth, "text width"), this.s.units)
      if (w.errors.length) throw new Unsupported(`tikz: ${w.errors[0]}`)
      list = [this.text.minipage(body, source(st.nodeFont), source(st.textFont), w.value, st.textAction, before, after)]
      before = after = []
    } else if (header.length) list = [this.alignedText(content, str(header))]
    else if (body !== "" || st.textFont.length || st.nodeFont.length) {
      if (!this.text) throw new Unsupported("tikz: a node's text outside a document")
      // (\\ is \@normalcr: LaTeX's error in LR mode)
      if (content.includes("\\\\")) throw new Unsupported("tikz: \\\\ in a node's text without align or a text width")
      list = this.text.hlist(body, this.font())
      if (list.at(-1)?.kind === "glue") list.pop()
    }
    // (\tikz@fig@continue's \wd\pgfnodeparttextbox= the text width: the minipage is as wide)
    const box = hpack([...head, ...before, ...list, ...after])
    if (st.textColor.length) {
      this.end()
      this.s.out = outer
    }
    return box
  }

  /** \pgfinterruptpath (pgfcorescopes.code.tex 452–473): the path so far kept aside, an empty one, a group */
  private interruptPath() {
    const saved = { soft: this.s.softPath, extent: { ...this.s.path }, last: this.s.last, lastMoveTo: this.s.lastMoveTo }
    this.s.softPath = []
    this.begin()
    return saved
  }
  private endInterruptPath(saved: ReturnType<TikzPicture["interruptPath"]>) {
    this.end()
    this.s.softPath = saved.soft
    this.s.path = saved.extent
    this.s.last = saved.last
    this.s.lastMoveTo = saved.lastMoveTo
  }

  /** the node's font commands, then the text's: \tikz@node@textfont, \tikz@textfont */
  private font(): string { return `${source(this.tz.st.nodeFont)} ${source(this.tz.st.textFont)}`.trim() }

  /**
   * \tikz@halign@check (4222–4229): the text's lines, each ended by `\\` or `\\[skip]` (\tikz@align@newline@:
   * \unskip, the skip \pgfmathparse'd), in the aligned box (tikz/text.ts)
   */
  private alignedText(content: Toks, header: string): BoxNode {
    if (!this.text) throw new Unsupported("tikz: a node's text outside a document")
    const font = this.font()
    const lines: AlignLine[] = []
    let rest = [...content]
    for (;;) {
      const j = rest.indexOf("\\\\")
      const line = j < 0 ? rest : rest.slice(0, j)
      // (a `\\` in a group would end the line's group, not the line)
      if (find(line, ["\\\\"]) >= 0 || (j >= 0 && find(rest, ["\\\\"]) !== j)) throw new Unsupported("tikz: \\\\ in a group in a node")
      const list = this.text.hlist(source(line).replace(/^\s+/, ""), font)
      if (j < 0) { lines.push({ list, skip: 0 }); break }
      if (list.at(-1)?.kind === "glue") list.pop()
      rest = rest.slice(j + 1)
      let skip = "0pt"
      // \pgfutil@ifnextchar[: blanks skipped
      let k = 0
      while (rest[k] === " ") k++
      if (rest[k] === "[") {
        const e = find(rest, ["]"], k + 1)
        if (e < 0) throw new Unsupported("tikz: ] expected after \\\\[")
        skip = text(rest.slice(k + 1, e), "line skip")
        rest = rest.slice(e + 1)
      }
      // (pgfmath reads em and ex in the text's font)
      const r = pgfmathParse(skip, font ? this.text.units(font) : this.s.units)
      if (r.errors.length) throw new Unsupported(`tikz: ${r.errors[0]}`)
      lines.push({ list, skip: new TexArith(this.s.units).dimen(`${r.result}pt`) })
    }
    return alignLines(lines, header, this.text.baselines(font))
  }

  /** \tikz@fig@continue (4117–4130): the text box again, in the text color (pgf's) and an id scope */
  private wrapText(box: BoxNode): BoxNode {
    const st = this.tz.st
    const outer = this.s.out
    this.s.out = []
    this.begin() // \hbox{{
    this.d.beginText()
    const dot = st.textColor.length ? this.colorSpec(st.textColor) : this.L.dot
    pgfSetColor(this.d, dot, true) // \pgfsetcolor{.}
    this.begin() // \pgfidscope
    this.begin()
    this.s.out.push(box)
    this.endIdScope()
    this.d.endText()
    this.end() // }}
    const wrapped = hpack(this.s.out)
    this.s.out = outer
    return wrapped
  }

  /**
   * the node's path (#4 of \pgfmultipartnode): \tikz@finish in a group (\pgflinewidth, which it sets to the
   * path's, put back after it is not read again before \endpgfscope restores it)
   */
  private nodePath() {
    this.begin() // {
    this.begin() // \begingroup, which \tikz@finish ends
    this.finish(null, false)
    this.end() // }
  }

  /** \tikz@node@transformations (4157–4170): at the node's position, or by the timer for a label */
  private nodeTransformations() {
    const st = this.tz.st
    if (st.time === "") {
      pgfTransformShift(this.s, this.nodeAt())
      if (!st.fullyTransformed) pgfTransformResetNonTranslations(this.s)
    } else {
      if (st.autoAnchor) this.autoAnchor()
      this.timer({ resetNonTranslations: st.resetNonTranslations, sloped: st.sloped, upsideDown: st.upsideDown })
    }
    for (const t of st.transform ?? []) this.transform(t)
  }

  /** \tikz@node@at */
  private nodeAt(): PgfPointMacro {
    const at = this.tz.st.nodeAt
    const s = this.s
    if (!at) throw new Unsupported("tikz: a node with no position")
    if (at.kind === "point") return at.point
    if (at.kind === "of") {
      const name = text(at.node, "node name")
      return () => pgfPointAnchor(s, name, "center")
    }
    return () => pgfPointAnchor(s, at.node, at.anchor)
  }

  /** \tikz@timer: the label's place at \tikz@time on the last operation (4894–4955) */
  private timer(o: AtTime) {
    const t = this.L.timer
    if (!t) return
    const s = this.s, time = this.tz.st.time
    const start = qpoint(t.start.x, t.start.y), end = qpoint(t.end.x, t.end.y)
    if (t.kind === "line") return pgfTransformLineAtTime(s, time, start, end, o)
    if (t.kind === "curve") return pgfTransformCurveAtTime(s, time, t.start, t.c1!, t.c2!, t.end, o) // \tikz@timer@curve (4948–4950)
    if (t.kind === "arc") {
      // \tikz@timer@arc (4953–4971): the centre the start less the start angle's point on the axes
      const c = t.arc!, cos = trig("cos", c.start, s.units), sin = trig("sin", c.start, s.units)
      const p0 = pgfPointScale(cos, c.zero, s.units), p1 = pgfPointScale(sin, c.ninety, s.units)
      const center = { x: t.start.x - (p0.x + p1.x), y: t.start.y - (p0.y + p1.y) }
      return pgfTransformArcAxesAtTime(s, time, center, c.zero, c.ninety, c.start, c.end, o, () => s.space())
    }
    // \tikz@timer@vhline, \tikz@timer@hvline: each half of the way a line of its own, through the corner
    const a = new TexArith(s.units)
    const corner = t.kind === "vh" ? qpoint(t.start.x, t.end.y) : qpoint(t.end.x, t.start.y)
    let xb = mul("2", a.dimen(`${time}pt`))
    if (a.dimen(`${time}pt`) < a.dimen("0.5pt")) pgfTransformLineAtTime(s, toNumber(xb), start, corner, o)
    else {
      xb -= 65536
      pgfTransformLineAtTime(s, toNumber(xb), corner, end, o)
    }
    if (a.errors.length) throw new Unsupported(`tikz: ${a.errors[0]}`)
  }

  /**
   * \tikz@auto@anchor@on (4464–4545): the label's anchor from the direction of its line, the timer run in a
   * group (sloped the other way, upside down allowed): left of it, or right of it for swap
   */
  private autoAnchor() {
    const st = this.tz.st
    const s = this.s
    s.begingroup()
    this.timer({ resetNonTranslations: false, sloped: !st.sloped, upsideDown: true })
    const a = new TexArith(s.units)
    const t = s.local.transform
    const n = pgfPointNormalised({ x: a.dimen(`${t.aa}pt`), y: a.dimen(`${t.ab}pt`) }, s.units)
    s.endgroup()
    st.anchor = chars(autoAnchorOf(n, st.autoDirection === "left"))
  }

  // points

  /** \tikz@scan@one@point (5181–5186) and \tikz@scan@relative (5482–5498) */
  private scanPoint(inp: Input): PgfPointMacro {
    this.L.shapeborder = null
    this.L.toUseWhom = "coordinate"
    if (!inp.ifNext("+")) return this.scanAbsolute(inp)
    inp.next()
    if (inp.ifNext("+")) inp.next()
    else this.L.updatecurrent = false
    const p = this.scanAbsolute(inp)
    // \tikz@add: \pgfpointadd{#1}{\tikz@last@position@saved}
    return () => { const a = p(); return pgfPointAdd(a, { x: this.L.lastxsaved, y: this.L.lastysaved }) }
  }

  /** \tikz@scan@absolute … \tikz@scan@no@calculator (5187–5240) */
  private scanAbsolute(inp: Input): PgfPointMacro {
    if (!inp.ifNext("(")) throw new Unsupported(`tikz: a coordinate expected, not ${inp.peek() ?? "the end"}`)
    inp.next()
    if (inp.ifNext("[")) {
      // \tikz@scan@options, \tikz@scan@handle@options (5204–5226): the point, then in a group the transformation reset
      // and the options' transformations applied to it
      inp.next()
      const options = inp.delimited(["]"])
      const q = inp.ifNext("$") ? this.calc(inp)() : this.coordinateText(inp.delimited([")"]))()
      this.begin()
      pgfTransformReset(this.s)
      this.tz.st.transform = []
      this.tz.set(options)
      for (const t of this.tz.st.transform) this.transform(t)
      const r = transformPoint(this.s, q)
      this.end()
      return qpoint(r.x, r.y)
    }
    if (inp.ifNext("$")) return this.calc(inp)
    return this.coordinateText(inp.delimited([")"]))
  }

  /**
   * calc's \tikz@parse@calculator … \tikz@cc@end (tikzlibrarycalc.code.tex 67–330), its `(` taken: `$` terms
   * `±factor*(point)!modifiers!` `$)`, summed in a group
   */
  private calc(inp: Input): PgfPointMacro {
    if (!this.tz.calc) throw new Unsupported("tikz: coordinate calculation without the calc library")
    inp.literal("$")
    const s = this.s
    this.begin()
    let xa = 0, ya = 0
    let sign = "1"
    for (let first = true; ; first = false) {
      inp.skipSpaces()
      if (inp.peek() === "$") {
        // \tikz@cc@end$#1)
        inp.next()
        inp.delimited([")"])
        break
      }
      if (!first || inp.peek() === "+" || inp.peek() === "-") {
        const t = inp.next()
        if (t !== "+" && t !== "-") throw new Unsupported("tikz: + or - expected in a calculation")
        sign = t === "+" ? "1" : "-1"
      } else sign = "1"
      let factor = sign
      inp.skipSpaces()
      if (inp.peek() !== "(") {
        // \tikz@cc@parse@factor#1*(
        const j = find(inp.t, ["*", "("], inp.i)
        if (j < 0) throw new Unsupported("tikz: *( expected in a calculation")
        const f = inp.t.slice(inp.i, j)
        inp.i = j + 1
        factor = this.checkUnit([...f, "*", ...chars(sign)]).result
      }
      // \tikz@scan@absolute
      let b = this.scanAbsolute(inp)()
      // \tikz@cc@mid@checks: partway, distance, projection modifiers
      while (inp.ifNext("!")) {
        inp.next()
        if (inp.ifNext("(")) {
          // `!(c)!(p)`: the second ! taken first (\tikz@cc@scan@ex)
          const c = this.scanPoint(inp)()
          if (!inp.ifNext("!")) throw new Unsupported("tikz: ! expected in a calculation")
          inp.next()
          const p = this.calcRot(inp, b)
          // \tikz@cc@after@project: b plus the projection of c − b on the direction of p − b
          const n = pgfPointNormalised({ x: p.x - b.x, y: p.y - b.y }, s.units)
          const xc = mul(toNumber(c.x - b.x), n.x) + mul(toNumber(c.y - b.y), n.y)
          b = { x: b.x + mul(toNumber(xc), n.x), y: b.y + mul(toNumber(xc), n.y) }
          continue
        }
        const j = find(inp.t, ["!"], inp.i)
        if (j < 0) throw new Unsupported("tikz: ! expected in a calculation")
        const m = this.checkUnit(inp.t.slice(inp.i, j))
        inp.i = j + 1
        const p = this.calcRot(inp, b)
        if (m.units) {
          // \tikz@cc@after@unit: the distance towards p
          const n = pgfPointNormalised({ x: p.x - b.x, y: p.y - b.y }, s.units)
          b = { x: b.x + mul(m.result, n.x), y: b.y + mul(m.result, n.y) }
        } else {
          // \tikz@cc@after@num: (1 − f)·b + f·p
          const one = this.checkUnit(chars(`1-${m.result}`)).result
          b = { x: mul(one, b.x) + mul(m.result, p.x), y: mul(one, b.y) + mul(m.result, p.y) }
        }
      }
      // (\advance by<factor>\pgf@xb takes the end of its line as the dimension's optional blank)
      xa += mul(factor, b.x)
      ya += mul(factor, b.y)
    }
    this.end()
    return qpoint(xa, ya)
  }

  /** \tikz@cc@scan@rot (288–330): a point, or `angle:point` rotated by the angle about `b` */
  private calcRot(inp: Input, b: PgfPoint): PgfPoint {
    if (inp.ifNext("(")) return this.scanPoint(inp)()
    const j = find(inp.t, [":"], inp.i)
    if (j < 0) throw new Unsupported("tikz: a point or angle:point expected in a calculation")
    const angle = text(inp.t.slice(inp.i, j), "angle")
    inp.i = j + 1
    const c = this.scanPoint(inp)()
    const s = this.s
    s.begingroup()
    pgfTransformReset(s)
    pgfTransformShift(s, qpoint(b.x, b.y))
    pgfTransformRotate(s, angle)
    pgfTransformShift(s, qpoint(-b.x, -b.y))
    const q = transformPoint(s, c)
    s.endgroup()
    return q
  }

  /** the macros a pin's edge names its nodes by, expanded */
  private nodeNames(t: Toks): Tok[] {
    const names: Record<string, string> = { "\\tikz@save@last@node": this.L.savedPinNode, "\\tikzlastnode": this.L.lastNode }
    return t.flatMap((x) => (x in names ? chars(names[x]) : [x]))
  }

  /** \tikz@@scan@@no@calculator (5242–5266): a coordinate's text, \edef'd, by its kind */
  private coordinateText(t: Toks): PgfPointMacro {
    t = this.nodeNames(t)
    if (t.some((x) => isCs(x))) throw new Unsupported(`tikz: macros in a coordinate`)
    if (contains(t, chars("cs:"))) throw new Unsupported("tikz: coordinate systems")
    if (contains(t, chars("intersection "))) throw new Unsupported("tikz: intersections")
    if (contains(t, ["|"])) return contains(t, chars("-|")) ? this.perpendicular(t, "-|") : this.perpendicular(t, "|-")
    if (contains(t, [":"])) return this.polar(t)
    if (contains(t, [","])) return this.regular(t)
    return this.named(t)
  }

  /** \tikz@parse@hv, \tikz@parse@vh, \tikz@parse@vhdone (5418–5471): both points computed at once */
  private perpendicular(t: Toks, op: "-|" | "|-"): PgfPointMacro {
    // the blanks around the operator go with it
    let a: Tok[] = [], b: Tok[] = []
    for (const d of [` ${op} `, ` ${op}`, `${op} `, op]) {
      if (contains(t, chars(d))) { [a, b] = split(t, chars(d)); break }
    }
    const [mid, end] = op === "-|" ? [b, a] : [a, b]
    // (in a group, which keeps \pgf@xa and \pgf@ya: a node's point there is not on its border)
    const shapeborder = this.L.shapeborder
    const x = this.coordinateText(arg(mid))().x
    const y = this.coordinateText(arg(end))().y
    this.L.shapeborder = shapeborder
    return qpoint(x, y)
  }

  /** \tikz@parse@polar … \tikz@@@parse@polar (5288–5319) */
  private polar(t: Toks): PgfPointMacro {
    let [angle, radius] = split(t, [":"])
    const dir = POLAR_DIRS[str(angle)]
    if (dir !== undefined) angle = chars(dir)
    let rx: Tok[], ry: Tok[]
    if (contains(radius, chars(" and "))) [rx, ry] = split(radius, chars(" and "))
    else rx = ry = radius
    const x = this.checkUnit(rx).units
    const y = this.checkUnit(ry).units
    if (x !== y) throw new Unsupported("tikz: dimension and dimensionless values mixed in polar coordinates")
    const a = text(angle, "angle"), r = `${text(rx, "radius")} and ${text(ry, "radius")}`
    return x ? () => pgfPointPolar(this.s, a, r) : () => this.polarXY(a, r)
  }

  /** \pgfpointpolarxy (pgfcorepoints.code.tex 692–713) */
  private polarXY(angle: string, radius: string): PgfPoint {
    const and = radius.indexOf("and ")
    const [rx, ry] = and < 0 ? [radius, radius] : [radius.slice(0, and), radius.slice(and + 4)]
    let xa = setLength(rx, this.s), ya = setLength(ry, this.s)
    const a = parse(angle, this.s.units)
    xa = mul(trig("cos", a, this.s.units), xa)
    ya = mul(trig("sin", a, this.s.units), ya)
    const v = this.s.local.vectors
    return { x: mul(toNumber(xa), v.xx) + mul(toNumber(ya), v.yx), y: mul(toNumber(xa), v.xy) + mul(toNumber(ya), v.yy) }
  }

  /** \tikz@parse@regular … \tikz@@@parse@regular (5341–5374) */
  private regular(t: Toks): PgfPointMacro {
    const c = find(t, [","])
    const xt = arg(t.slice(0, c))
    let rest = t.slice(c + 1)
    // \pgfutil@ifnextchar\bgroup: the blanks before the y coordinate go
    while (rest[0] === " ") rest = rest.slice(1)
    // \tikz@@parse@regular: a braced y coordinate is its group (pgfmath reads the braces as parentheses)
    while (rest.at(-1) === " ") rest = rest.slice(0, -1)
    const yt = arg(rest)
    if (contains(yt, [","])) throw new Unsupported("tikz: xyz coordinates")
    const x = this.checkUnit(xt), y = this.checkUnit(yt)
    const xs = text(xt, "x"), ys = text(yt, "y")
    const s = this.s
    if (x.units && y.units) return () => pgfPoint(s, xs, ys)
    if (x.units) return () => { const a = pgfPoint(s, xs, "0pt"); return pgfPointAdd(a, pgfPointXY("0", ys, s.units, s.local.vectors)) }
    if (y.units) return () => { const a = pgfPoint(s, "0pt", ys); return pgfPointAdd(a, pgfPointXY(xs, "0", s.units, s.local.vectors)) }
    return () => pgfPointXY(xs, ys, s.units, s.local.vectors)
  }

  /**
   * \tikz@parse@node (5382–5406): a named node's anchor (\pgfpointanchor), computed at once; without an
   * anchor, a node's centre (not a coordinate's) is a point on its border, which the next point decides
   */
  private named(t: Toks): PgfPointMacro {
    const full = text(t, "node name")
    if (full === "current subpath start") {
      // pgfmoduleshapes.code.tex 1107–1112: a coordinate at \pgfsyssoftpath@lastmoveto, the identity its transformation
      const m = [...this.s.softPath].reverse().find((i) => i.op === "moveto")
      const q = m && m.op === "moveto" ? { x: m.x, y: m.y } : this.lastMoveTo
      const p = applyTransform(pgfTransformInvert(this.s.local.transform, this.s.units), q)
      return qpoint(p.x, p.y)
    }
    const dot = full.indexOf(".")
    const name = dot < 0 ? full : full.slice(0, dot)
    const n = this.nodes.get(name)
    if (!n) throw new Unsupported(`tikz: no node named ${name}`)
    const q = pgfPointAnchor(this.s, name, dot < 0 ? "center" : full.slice(dot + 1))
    if (dot < 0 && n.shape !== "coordinate") this.L.shapeborder = name
    return qpoint(q.x, q.y)
  }
}

/** \tikz@label@angle@is@<position> (907–914) */
const LABEL_ANGLES: Record<string, string> = {
  right: "0", "above right": "45", above: "90", "above left": "135", left: "180", "below left": "225", below: "270", "below right": "315",
}

/**
 * \tikz@auto@anchor (`left`), \tikz@auto@anchor@prime (4485–4529): the anchor for the direction (\pgf@x, \pgf@y),
 * south east for a line up and to the right
 */
function autoAnchorOf(n: PgfPoint, left: boolean): string {
  const e = new TexArith({ em: 0, ex: 0 }).dimen("0.05pt")
  const sx = n.x > e ? 1 : n.x < -e ? -1 : 0
  const sy = n.y > e ? 1 : n.y < -e ? -1 : 0
  if (sx !== 0) {
    const h = (sx > 0) === left ? "south" : "north"
    return sy === 0 ? h : `${h} ${(sy > 0) === left ? "east" : "west"}`
  }
  return (n.y > 0) === left ? "east" : "west"
}

/** what a document gives TikZ besides its keys: the nodes' text, and the named nodes so far (TeX's are global) */
export interface TikzDocumentSetup extends Omit<TikzSetup, "transform" | "baseline" | "scanOf" | "at"> {
  text?: TikzText
  nodes?: Map<string, PgfNodeRecord>
}

/** TikZ in a document: the keys and styles (\tikzset in the preamble too), and its pictures, one at a time */
export class TikzDocument {
  readonly tz: Tikz
  private current: TikzPicture | null = null
  /** the state the document's arrow tips live in (its first picture's; another TikzDocument's for the same document) */
  arrows: PgfState | null = null
  /** the named nodes and coordinates */
  readonly nodes: Map<string, PgfNodeRecord>

  constructor(private readonly setup: TikzDocumentSetup) {
    this.nodes = setup.nodes ?? new Map()
    this.tz = new Tikz({
      ...setup,
      scanOf: (target) => this.at("positioning").scanOf(target),
      transform: (t) => this.at("a transformation").transform(t),
      baseline: (v) => this.at("baseline").baseline(v),
      arrows: (v, st) => this.at("arrows").arrows(v, st),
      corners: (st) => this.at("rounded corners").corners(st),
      at: (v, st) => this.at("at").atOption(v, st),
      labelPost: (v, st) => this.at("label").labelPost(v, st),
      vector: (axis, v) => this.at("a vector").vector(axis, v),
      vectors: () => this.at("vectors").s.local.vectors,
      space: () => this.at("a blank").s.space(),
    })
  }

  private at(what: string): TikzPicture {
    if (!this.current) throw new Unsupported(`tikz: ${what} outside a picture`)
    return this.current
  }

  /**
   * A picture (tikzpicture environment or \tikz) at the start of `src`, typeset on `s` (pgf's state, its list
   * the picture's) with the driver; `color` is xcolor's current color there. Returns how many tokens it took.
   */
  picture(src: Toks | string, s: PgfState, d: PgfDriver, color: string): number {
    const p = new TikzPicture({ s, d, tz: this.tz, colors: this.setup.colors, color, text: this.setup.text, nodes: this.nodes })
    // the arrow tips declared and instantiated so far (global in TeX)
    if (this.arrows) shareArrows(this.arrows, s)
    else {
      this.arrows = s
      if (this.setup.arrowsMeta) pgfArrowsMeta(s)
    }
    this.current = p
    const depth = this.tz.depth
    try { return p.run(src) } catch (e) {
      // (what a refused picture left open closes: the keys and styles are the document's)
      while (this.tz.depth > depth) this.tz.endgroup()
      throw e
    } finally { this.current = null }
  }
}
