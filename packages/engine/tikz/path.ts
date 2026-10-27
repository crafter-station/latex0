// TikZ's pictures, scopes and paths (tikz.code.tex, line numbers cite it) on pgf/: the path syntax read token
// by token as \tikz@scan@next@command and \tikz@handle read it, each operation calling pgf's path commands
// where TikZ's macros do, \tikz@finish using the path, and the TeX groups TikZ opens around pictures, scopes,
// paths and the graphic state. A picture is typeset under \nullfont, so the spaces TikZ's own macros leave
// (an end of line without %) are \glue 0.0 nodes on the picture's list: each is emitted where TeX's is. The
// subset modeled: \path, \draw, \fill, \filldraw, \clip, \useasboundingbox, \coordinate, the scope
// environment, \tikzset, options anywhere (tikz/options.ts), the coordinates (x,y) with and without units,
// (a:r), +(…), ++(…), (a |- b), (a -| b) and named coordinates, and the operations --, -|, |-, rectangle,
// circle, ellipse, cycle and to, with arrow tips (pgf/arrows.ts, instantiated once a document) and rounded
// corners (pgf/round.ts). Nodes go through TikzHooks, which refuse until they are modeled; every other
// construct throws Unsupported.

import { printScaled } from "../layout/arith"
import type { Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { Unsupported } from "../latex/unsupported"
import type { Colors } from "../latex/xcolor"
import type { PgfDriver } from "../pgf/drivers"
import { TexArith, toNumber } from "../pgf/fixed"
import { isColorName, pgfSetColor, pgfSetDash, pgfSetFillColor, pgfSetLineWidth, pgfSetStrokeColor } from "../pgf/graphicstate"
import { pgfmathParse } from "../pgf/mathparser"
import { pgfPathClose, pgfPathEllipse, pgfPathLineTo, pgfPathMoveTo, pgfUsePath, resetPathSizes } from "../pgf/paths"
import { pgfPoint, pgfPointAdd, pgfPointOrigin, pgfPointPolar, pgfPointXY, parse, qpoint, setLength, trig, type PgfPoint, type PgfPointMacro } from "../pgf/points"
import { beginPgfPicture, endPgfPicture, pgfSetBaseline } from "../pgf/scopes"
import type { PgfState, PgfTransform } from "../pgf/state"
import { mul, pgfTransformResetNonTranslations, pgfTransformRotate, pgfTransformScale, pgfTransformShift, pgfTransformXScale, pgfTransformXShift, pgfTransformXSlant, pgfTransformYScale, pgfTransformYShift, pgfTransformYSlant, transformPoint } from "../pgf/transformations"
import { reciprocal } from "../pgf/mathfunctions"
import { chars } from "./keys"
import { Tikz, type OptionCall, type TikzSetup, type TikzState, type TransformCall } from "./options"
import { pgfArrowsMeta, pgfSetArrows, shareArrows } from "../pgf/arrows"
import { arg, contains, find, groupEnd, isCs, plain, str, tokenize, type Tok, type Toks } from "./tokens"

/**
 * What a path reaches that other units model: each throws Unsupported until it is plugged in. `node` is a
 * node on or as a path (\tikz@fig ode, node on a path, \node).
 */
export interface TikzHooks {
  node?: (p: TikzPicture) => void
}

/** TikZ's macros and registers a path changes, local to TeX's groups */
interface Locals {
  /** \tikz@lastx, \tikz@lasty, \tikz@lastxsaved, \tikz@lastysaved */
  lastx: number; lasty: number; lastxsaved: number; lastysaved: number
  /**
   * \iftikz@updatecurrent, \iftikz@updatenext, \iftikz@auto@end@path (\iftikz@shapeborder and
   * \tikz@moveto@waiting are for points on a node's border: no node is modeled but coordinates, which have none)
   */
  updatecurrent: boolean; updatenext: boolean; autoEndPath: boolean
  /** \tikz@path@do@at@end, when it is more than \tikz@lib@scope@check (\tikz's single path) */
  doAtEnd: (() => void) | null
  /** xcolor's current color ".", as the driver's text */
  dot: string
  /** \tikz@figbox: the list of the box a path's nodes go in, null while void */
  figbox: Node[] | null
}

/** the anchors of the shape coordinate, each its center (pgfmoduleshapes.code.tex 847–875) */
const COORDINATE_ANCHORS = new Set(["center", "north", "north west", "north east", "west", "east", "mid", "mid west", "mid east", "base", "base west", "base east", "south", "south west", "south east"])

/** the special token \pgfextra{\tikz@updatenexttrue\tikz@updatecurrenttrue} after a to path (3097) */
const UPDATE = "\\pgfextra@tikz@update"

/** \tikz@polar@dir@<name> (5320–5333) */
const POLAR_DIRS: Record<string, string> = {
  up: "90", down: "-90", left: "180", right: "0", north: "90", south: "-90", east: "0", west: "180",
  "north east": "45", "north west": "135", "south east": "-45", "south west": "-135",
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

export interface TikzPictureSetup {
  s: PgfState
  d: PgfDriver
  tz: Tikz
  colors: Colors
  /** xcolor's current color where the picture starts (the driver's text) */
  color: string
  hooks?: TikzHooks
}

/** One picture: \begin{tikzpicture} or \tikz, with what the picture's commands do on pgf. */
export class TikzPicture {
  readonly s: PgfState
  readonly d: PgfDriver
  readonly tz: Tikz
  private readonly colors: Colors
  private readonly hooks: TikzHooks
  private L: Locals
  private readonly groups: { saved: Locals; after: (() => void)[] }[] = []
  /** \pgfsyssoftpath@lastmoveto (global): the last moveto's coordinates */
  private lastMoveTo = { x: 0, y: 0 }
  /** \pgfscope@stroke@color and \pgfscope@fill@color of each open \pgfscope (and of \tikz@finish's options) */
  private readonly colorScopes: [string, string][] = []
  /** the coordinates named in the picture (\pgf@sh@ns@<name> is coordinate): \pgf@sh@nt@<name>'s translation */
  private readonly coordinates = new Map<string, PgfPoint>()

  constructor(setup: TikzPictureSetup) {
    this.s = setup.s
    this.d = setup.d
    this.tz = setup.tz
    this.colors = setup.colors
    this.hooks = setup.hooks ?? {}
    this.L = {
      lastx: 0, lasty: 0, lastxsaved: 0, lastysaved: 0,
      updatecurrent: true, updatenext: true, autoEndPath: false, doAtEnd: null, dot: setup.color, figbox: null,
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
  private endIdScope() {
    this.s.space()
    this.end()
    this.end()
  }

  /** a picture's or scope's commands, up to \end{<env>} (or the } that ends \tikz's braces) */
  private body(inp: Input, until: string) {
    for (;;) {
      const t = inp.peek()
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
      if (t === "\\tikzstyle") { inp.next(); inp.i += this.tz.tikzstyle(inp.t.slice(inp.i)); continue }
      if (this.command(inp)) {
        if (until !== "}") throw new Unsupported("tikz: } ends a path")
        return
      }
    }
  }

  /** a path command (\path and the commands \tikz@installcommands defines); true when its } ended \tikz's braces */
  private command(inp: Input): boolean {
    const t = inp.next()!
    if (t in PATH_COMMANDS) {
      const options = PATH_COMMANDS[t]
      if (options !== null) inp.insert(["[", ...chars(options), "]"])
    } else if (t === "\\coordinate") inp.insert(chars(" coordinate"))
    else if (t === "\\node" || t === "\\pic" || t === "\\matrix") return this.node()
    else throw new Unsupported(`tikz: ${t} in a picture`)
    // \tikz@command@path (2071–2078): [options] go back, <…> (beamer's overlays) are not modeled
    if (inp.ifNext("[")) {
      const j = find(inp.t, ["]"], inp.i)
      if (j >= 0 && inp.t.slice(j + 1).find((x) => x !== " ") === "<") throw new Unsupported("tikz: overlay specification")
    } else if (inp.ifNext("<")) throw new Unsupported("tikz: overlay specification")
    return this.path(inp)
  }

  private node(): never {
    if (this.hooks.node) this.hooks.node(this)
    throw new Unsupported("tikz: nodes")
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
      case "of": this.node()
    }
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
    Object.assign(this.L, { lastx: 0, lasty: 0, lastxsaved: 0, lastysaved: 0 })
    this.tz.set("every path/.try")
    return this.scan(inp, lineWidth)
  }

  /** \tikz@scan@next@command and \tikz@handle (2120–2167), up to the path's end; true when a } ended it and \tikz's braces */
  private scan(inp: Input, lineWidth: number): boolean {
    for (;;) {
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
          if (!inp.ifNext("l")) throw new Unsupported("tikz: edge")
          inp.literal("llipse")
          this.circle(inp)
          continue
        case "t": this.to(inp); continue
        case "n": this.node(); continue
        case "[": this.tz.set(inp.delimited(["]"])); continue
        case "{": this.begin(); this.L.autoEndPath = false; continue
        case "}":
          // \tikz@finish\egroup: no blank taken after the path
          if (this.L.autoEndPath) { this.finish(inp, lineWidth, false); this.end(); return true }
          this.endPathScope()
          continue
        case ";": this.finish(inp, lineWidth, true); return false
        case UPDATE: this.L.updatenext = true; this.L.updatecurrent = true; continue
        case "\\par": case "\\relax": continue
      }
      throw new Unsupported(`tikz: ${t} on a path`)
    }
  }

  /** \tikz@@endscope (2526–2557): the current point (and, unless it is local, the rest) kept */
  private endPathScope() {
    const L = this.L
    this.end()
    Object.assign(this.L, {
      lastx: L.lastx, lasty: L.lasty, lastxsaved: L.lastxsaved, lastysaved: L.lastysaved,
      figbox: L.figbox,
    })
  }

  /** \tikz@finish (2207–2440) */
  private finish(inp: Input, lineWidth: number, blank: boolean) {
    const st = this.tz.st
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
    else if (blank && inp.peek() === " ") inp.next()
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

  /**
   * \tikz@@movetosave (2670–2680): \pgfpathmoveto (the point it saves first, \tikz@lastmovetox and …y, only
   * labels on a path read)
   */
  private movetoSave(p: PgfPointMacro) {
    pgfPathMoveTo(this.s, p)
  }

  /** \tikz@path@lineto (2843–2856), not snaked */
  private pathLineto(p: PgfPointMacro) {
    pgfPathLineTo(this.s, p)
  }

  /** \tikz@moveto, \tikz@@moveto (2654–2668) */
  private moveto(inp: Input) {
    const p = this.scanPoint(inp)
    this.makeLast(p)
    this.movetoSave(this.last)
  }

  /** \tikz@lineto, \tikz@lineto@mid (2809–2818): -- or -| */
  private lineto(inp: Input) {
    if (inp.ifNext("|")) { inp.next(); return this.hvLineto(inp) }
    // \expandafter\tikz@lineto@mid\pgfutil@gobble
    if (inp.undelimited().join("") !== "-") throw new Unsupported("tikz: - on a path")
    if (inp.ifNext("n")) return this.node()
    if (inp.ifNext("c")) return this.close(inp)
    if (inp.ifNext("p")) throw new Unsupported("tikz: plot or pic on a path")
    const p = this.scanPoint(inp)
    // \tikz@@lineto (2823–2846): the end of line after \edef\tikz@timer@start{…} is a space
    this.s.space()
    this.makeLast(p)
    this.pathLineto(this.last)
  }

  /** \tikz@hv@lineto, \tikz@@hv@lineto (2875–2907): -| */
  private hvLineto(inp: Input) {
    if (inp.ifNext("n") || inp.ifNext("p") || inp.ifNext("c")) return this.node()
    const p = this.scanPoint(inp)
    const yc = this.L.lasty
    this.makeLast(p)
    this.pathLineto(qpoint(this.L.lastx, yc))
    this.pathLineto(this.last)
  }

  /** \tikz@vh@lineto, \tikz@@vh@lineto (2909–2941): |- */
  private vhLineto(inp: Input) {
    inp.literal("-")
    if (inp.ifNext("n") || inp.ifNext("p") || inp.ifNext("c")) return this.node()
    const p = this.scanPoint(inp)
    const xc = this.L.lastx
    this.makeLast(p)
    this.pathLineto(qpoint(xc, this.L.lasty))
    this.pathLineto(this.last)
  }

  /** \tikz@close, \tikz@@close (2944–2959): -- cycle */
  private close(inp: Input) {
    inp.literal("c")
    if (inp.ifNext("o")) return this.node() // a coordinate on the path
    inp.literal("ycle")
    this.s.space() // the end of line after \edef\tikz@timer@start{…}
    // \pgfsyssoftpath@lastmoveto, the soft path's (transformed) coordinates
    for (let k = this.s.softPath.length - 1; k >= 0; k--) {
      const i = this.s.softPath[k]
      if (i.op === "moveto") { this.lastMoveTo = { x: i.x, y: i.y }; break }
    }
    this.makeLast(qpoint(this.lastMoveTo.x, this.lastMoveTo.y))
    pgfPathClose(this.s)
  }

  /** \tikz@rect, \tikz@@rect, \tikz@rectB (3260–3290) */
  private rect(inp: Input) {
    inp.literal("ectangle")
    if (inp.ifNext("n") || inp.ifNext("p") || inp.ifNext("c")) return this.node()
    this.s.space() // the end of line after the { of \tikz@@rect's last branch
    const xa = this.L.lastx, ya = this.L.lasty
    const p = this.scanPoint(inp)
    this.makeLast(p)
    this.movetoSave(qpoint(xa, ya))
    this.pathLineto(qpoint(xa, this.L.lasty))
    this.pathLineto(qpoint(this.L.lastx, this.L.lasty))
    this.pathLineto(qpoint(this.L.lastx, ya))
    pgfPathClose(this.s)
    this.movetoSave(qpoint(this.L.lastx, this.L.lasty))
  }

  /** \tikz@cchar (2168–2172): circle, coordinate */
  private cchar(inp: Input) {
    if (inp.ifNext("i")) { inp.literal("ircle"); return this.circle(inp) }
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
    else pgfPathEllipse(this.s, pgfPointOrigin, () => pgfPointXY(x, "0", this.s.units), () => pgfPointXY("0", x, this.s.units))
  }

  /** \tikz@do@ellipse (3600–3626), its body beginning with a space */
  private ellipse(rx: Toks, ry: Toks) {
    this.s.space()
    const x = this.checkUnit(rx)
    const y = this.checkUnit(ry)
    if (x.units !== y.units) throw new Unsupported("tikz: dimensions and dimensionless values mixed in an ellipse")
    if (x.units) pgfPathEllipse(this.s, pgfPointOrigin, qpoint(new TexArith(this.s.units).dimen(`${x.result}pt`), 0), () => pgfPoint(this.s, "0pt", `${y.result}pt`))
    else pgfPathEllipse(this.s, pgfPointOrigin, () => pgfPointXY(x.result, "0", this.s.units), () => pgfPointXY("0", y.result, this.s.units))
  }

  /** \tikz@to, \tikz@to@or@edge, \tikz@do@to (2983–3101), with the default to path `-- (\tikztotarget) \tikztonodes` */
  private to(inp: Input) {
    inp.literal("o")
    const local: Tok[] = []
    for (;;) {
      if (inp.ifNext("[")) { inp.next(); local.push(",", ...inp.delimited(["]"])); continue }
      if (inp.ifNext(":")) throw new Unsupported("tikz: animation")
      break
    }
    let target: Tok[]
    if (inp.ifNext("(")) {
      inp.next()
      if (inp.ifNext("$") || inp.ifNext("[")) { inp.insert(["("]); target = this.toMath(inp) }
      else target = inp.delimited([")"])
    } else if (inp.ifNext("n") || inp.ifNext("p") || inp.ifNext("c")) return this.node()
    else if (inp.ifNext("+")) target = this.toMath(inp)
    else throw new Unsupported("tikz: (, +, coordinate, pic, or node expected")
    // \tikz@do@to: the to path scanned in a group of its own, then the current point updated again
    inp.insert(["{", "[", ...chars("style=every to"), "]", "[", ...local, "]", "-", "-", " ", "(", ...target, ")", " ", "{", "}", "}", UPDATE])
  }

  /**
   * \tikz@@to@or@edge@math (3027–3034): the target as text (\tikz@updatenextfalse after +(…) only reaches the
   * to path's own group, which the default to path does not read)
   */
  private toMath(inp: Input): Tok[] {
    const q = this.scanPoint(inp)()
    return chars(`${pt(q.x)},${pt(q.y)}`)
  }

  // coordinates (the shape coordinate: pgfmoduleshapes.code.tex 847–857)

  /**
   * \tikz@coordinate (3749–3770): coordinate[options](name) at (point), a node of shape coordinate; `at`'s
   * point computed at once and handed on as text
   */
  private coordinate(inp: Input) {
    const options = inp.ifNext("[") ? (inp.next(), inp.delimited(["]"])) : []
    if (!inp.ifNext("(")) return this.coordinateNode(options, null, null)
    inp.next()
    const name = text(inp.delimited([")"]), "coordinate name").trim()
    if (!inp.ifNext("a")) return this.coordinateNode(options, name, null)
    inp.next()
    if (!inp.ifNext("t")) throw new Unsupported("tikz: a node text after a coordinate")
    inp.next()
    // at#3(: what lies before the ( goes
    const j = find(inp.t, ["("], inp.i)
    if (j < 0) throw new Unsupported("tikz: ( expected after at")
    inp.i = j
    const q = this.scanPoint(inp)() // \tikz@@coordinate@at@math
    const at = chars(`${pt(q.x)},${pt(q.y)}`)
    this.coordinateNode(options, name, this.coordinateText(at))
  }

  /**
   * \tikz@normal@fig … \tikz@node@finish (3790–4185) for `node[shape=coordinate,<options>](name) at(…){}`: the
   * node's transformations, then a box in \tikz@figbox with the node's scope (pgf's \pgfmultipartnode of the
   * shape coordinate draws nothing and saves the transformation: pgfmoduleshapes.code.tex 1–100)
   */
  private coordinateNode(options: Toks, name: string | null, at: PgfPointMacro | null) {
    const st = this.tz.st
    const lineWidth = st.lineWidth // \tikz@save@line@width
    this.begin()
    this.begin()
    st.options = []
    this.tz.st.transform = []
    this.tz.st.mode = []
    const nodeAt = at ?? qpoint(this.L.lastx, this.L.lasty)
    this.tz.set("every node/.try")
    this.tz.set([...chars("shape=coordinate,"), ...options])
    if (this.tz.st.shape !== "coordinate") throw new Unsupported(`tikz: the shape ${this.tz.st.shape}`)
    this.tz.set("every coordinate node/.try")
    if (this.tz.st.textWidth.length) throw new Unsupported("tikz: text width")
    // \tikz@node@transformations: at the node's position, without what is not a translation (transform shape
    // off), then the node's own transformations
    pgfTransformShift(this.s, nodeAt)
    pgfTransformResetNonTranslations(this.s)
    for (const t of this.tz.st.transform) this.transform(t)
    const figbox = this.L.figbox ?? []
    const outer = this.s.out
    this.s.out = []
    this.begin() // \hbox{{
    // \pgfinterruptpath (pgfcorescopes.code.tex 452–463)
    this.begin()
    // (the soft path, \pgfsyssoftpath@lastmoveto, \pgf@path@lastx and …lasty saved: pgf's scope empties the
    // path, and a coordinate moves nowhere)
    const path = { soft: this.s.softPath, extent: { ...this.s.path } }
    this.begin()
    this.pgfscope()
    this.runOptions()
    this.begin() // \pgfidscope
    this.begin()
    // \pgfmultipartnode: the text box is empty (\centerpoint is its middle, the origin), the anchor shifted
    // to the origin, the transformation saved (\pgf@sh@nt@<name>): its translation is the coordinate
    if (name) this.coordinates.set(name, { x: this.s.local.transform.x, y: this.s.local.transform.y })
    this.endIdScope()
    this.endpgfscope()
    // \endpgfinterruptpath (464–473)
    this.end()
    this.s.softPath = path.soft
    this.s.path = path.extent
    this.end()
    this.end() // }}
    figbox.push(hpack(this.s.out))
    this.s.out = outer
    // \tikz@node@finish: the box goes out of the groups
    this.end()
    this.end()
    this.L.figbox = figbox
    this.s.lineWidth = lineWidth
    this.globalLineWidth()
  }

  // points

  /** \tikz@scan@one@point (5181–5186) and \tikz@scan@relative (5482–5498) */
  private scanPoint(inp: Input): PgfPointMacro {
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
    if (inp.ifNext("[")) throw new Unsupported("tikz: coordinate options")
    if (inp.ifNext("$")) throw new Unsupported("tikz: coordinate calculation")
    return this.coordinateText(inp.delimited([")"]))
  }

  /** \tikz@@scan@@no@calculator (5242–5266): a coordinate's text, \edef'd, by its kind */
  private coordinateText(t: Toks): PgfPointMacro {
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
    // (in a group, which keeps \pgf@xa and \pgf@ya)
    const x = this.coordinateText(arg(mid))().x
    const y = this.coordinateText(arg(end))().y
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

  /** \pgfpointpolarxy (pgfcorepoints.code.tex 692–713), on pgf's default vectors */
  private polarXY(angle: string, radius: string): PgfPoint {
    const and = radius.indexOf("and ")
    const [rx, ry] = and < 0 ? [radius, radius] : [radius.slice(0, and), radius.slice(and + 4)]
    let xa = setLength(rx, this.s), ya = setLength(ry, this.s)
    const a = parse(angle, this.s.units)
    xa = mul(trig("cos", a, this.s.units), xa)
    ya = mul(trig("sin", a, this.s.units), ya)
    const cm = new TexArith(this.s.units).dimen("1cm")
    return { x: mul(toNumber(xa), cm) + mul(toNumber(ya), 0), y: mul(toNumber(xa), 0) + mul(toNumber(ya), cm) }
  }

  /** \tikz@parse@regular … \tikz@@@parse@regular (5341–5374) */
  private regular(t: Toks): PgfPointMacro {
    const c = find(t, [","])
    const xt = arg(t.slice(0, c))
    let rest = t.slice(c + 1)
    // \pgfutil@ifnextchar\bgroup: the blanks before the y coordinate go
    while (rest[0] === " ") rest = rest.slice(1)
    if (rest[0] === "{") throw new Unsupported("tikz: a braced y coordinate")
    const yt = arg(rest)
    if (contains(yt, [","])) throw new Unsupported("tikz: xyz coordinates")
    const x = this.checkUnit(xt), y = this.checkUnit(yt)
    const xs = text(xt, "x"), ys = text(yt, "y")
    const s = this.s
    if (x.units && y.units) return () => pgfPoint(s, xs, ys)
    if (x.units) return () => { const a = pgfPoint(s, xs, "0pt"); return pgfPointAdd(a, pgfPointXY("0", ys, s.units)) }
    if (y.units) return () => { const a = pgfPoint(s, "0pt", ys); return pgfPointAdd(a, pgfPointXY(xs, "0", s.units)) }
    return () => pgfPointXY(xs, ys, s.units)
  }

  /**
   * \tikz@parse@node (5382–5406): a named coordinate's anchor (\pgfpointanchor, pgfmoduleshapes.code.tex
   * 1011–1040): its center through the coordinate's transformation, then through the inverse of the current
   * one; computed at once
   */
  private named(t: Toks): PgfPointMacro {
    const full = text(t, "node name")
    const dot = full.indexOf(".")
    const [name, anchor] = dot < 0 ? [full, "center"] : [full.slice(0, dot), full.slice(dot + 1)]
    const c = this.coordinates.get(name)
    if (!c) throw new Unsupported(`tikz: no coordinate named ${name}`)
    if (!COORDINATE_ANCHORS.has(anchor)) throw new Unsupported(`tikz: anchor ${anchor} of a coordinate`)
    const s = this.s
    const saved = s.local
    s.setLocal({ transform: this.inverse(s.local.transform) })
    const q = transformPoint(s, c)
    s.local = saved
    return qpoint(q.x, q.y)
  }

  /** \pgftransforminvert (pgfcoretransformations.code.tex 267–316) */
  private inverse(t: PgfTransform): PgfTransform {
    // (\ifpgf@pt@identity's shortcut gives what the rest gives the identity)
    let x = -t.x, y = -t.y
    const a = new TexArith(this.s.units)
    const m = { a, error: (message: string) => { throw new Unsupported(`pgf: ${message}`) } }
    let { aa, ab, ba, bb } = t
    if (`${ab},${ba}` === "0.0,0.0") {
      aa = reciprocal(m, aa)
      bb = reciprocal(m, bb)
    } else {
      let da = mul(bb, a.dimen(`${aa}pt`))
      da -= mul(ab, a.dimen(`${ba}pt`))
      da = a.dimen(`${reciprocal(m, toNumber(da))}pt`)
      const naa = toNumber(mul(bb, da)), nbb = toNumber(mul(aa, da))
      da = -da
      const nba = toNumber(mul(ba, da)), nab = toNumber(mul(ab, da))
      ;[aa, ab, ba, bb] = [naa, nab, nba, nbb]
    }
    if (a.errors.length) throw new Unsupported(`pgf: ${a.errors[0]}`)
    const temp = x
    x = mul(aa, x) + mul(ba, y)
    y = mul(bb, y) + mul(ab, temp)
    return { aa, ab, ba, bb, x, y, identity: false }
  }
}

/** TikZ in a document: the keys and styles (\tikzset in the preamble too), and its pictures, one at a time */
export class TikzDocument {
  readonly tz: Tikz
  private current: TikzPicture | null = null
  /** the state the document's arrow tips live in (its first picture's; another TikzDocument's for the same document) */
  arrows: PgfState | null = null

  constructor(private readonly setup: Omit<TikzSetup, "transform" | "baseline">, private readonly hooks?: TikzHooks) {
    this.tz = new Tikz({
      ...setup,
      transform: (t) => this.at("a transformation").transform(t),
      baseline: (v) => this.at("baseline").baseline(v),
      arrows: (v, st) => this.at("arrows").arrows(v, st),
      corners: (st) => this.at("rounded corners").corners(st),
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
    const p = new TikzPicture({ s, d, tz: this.tz, colors: this.setup.colors, color, hooks: this.hooks })
    // the arrow tips declared and instantiated so far (global in TeX)
    if (this.arrows) shareArrows(this.arrows, s)
    else {
      this.arrows = s
      if (this.setup.arrowsMeta) pgfArrowsMeta(s)
    }
    this.current = p
    try { return p.run(src) } finally { this.current = null }
  }
}
