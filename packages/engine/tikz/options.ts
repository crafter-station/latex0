// TikZ's options (tikz.code.tex, tikzlibrarypositioning.code.tex) on a typed mirror of the state TikZ keeps
// in TeX macros and registers. Most options do not act at once: they append pgf calls to \tikz@options
// (run when a scope, path or node starts), mode switches to \tikz@mode (read when a path is used), and
// transformations to \tikz@transform, or apply them at once when it is \relax (a picture's and a scope's
// own options). Some act at once: \pgflinewidth, \pgfsetcornersarced, \pgfsetarrows, and the macros nodes
// read (\tikz@anchor, \tikz@shape, \tikz@node@distance, \tikz@node@at, …). Option values stay token lists
// where TeX keeps them as text; dimensions TeX computes when the option is given (above=…, positioning,
// rounded corners) go through pgfmath (pgf/mathparser.ts) with TeX's arithmetic. The subset modeled:
// draw, fill, colors and xcolor expressions, line widths, dash patterns, corners, node distance, auto and
// swap, anchors and placement (above=…, right of=…, positioning's right=of …, on grid), inner and outer
// sep, minimum sizes, text width, align, font, shapes, arrow specifications and >=, the transformations
// scale, xscale, yscale, xslant, yslant, shift, xshift, yshift and rotate, and what paths read: clip, use as
// bounding box, baseline, radius, x radius, y radius, and what nodes read: name, at, pos and the positions
// (midway …), sloped, allow upside down, transform shape, text, font. Other keys throw Unsupported.

import { printScaled } from "../layout/arith"
import { TexArith } from "../pgf/fixed"
import { pgfmathParse, pgfmathSetLength, type PgfUnits } from "../pgf/mathparser"
import { Unsupported } from "../latex/unsupported"
import type { Colors } from "../latex/xcolor"
import { arrowDb, setArrows, tipSequence, type ArrowDb, type Tip } from "./arrows"
import { chars, Keys, NOVALUE } from "./keys"
import { arg, contains, find, groupEnd, isCs, plain, same, str, type Tok, type Toks } from "./tokens"

/** a pgf call TikZ appends to \tikz@options */
export type OptionCall =
  /** \pgfsetlinewidth{arg} */
  | { op: "linewidth"; arg: Toks }
  /** \pgfsetdash{{on}{off}…}{phase}; a null phase is \tikz@dashphase, read when the call runs */
  | { op: "dash"; pattern: Toks[]; phase: Toks | null }
  /** \pgfsetstrokecolor{color} (draw=color) */
  | { op: "strokecolor"; color: Toks }
  /** \pgfsetfillcolor{color} (fill=color) */
  | { op: "fillcolor"; color: Toks }
  /** color=…: both colors reset (unless neither was set), `.` the color, \pgfsetcolor{.} */
  | { op: "color"; color: Toks }
  /** a color name as an option: \tikz@compat@color@set{name} */
  | { op: "compatcolor"; color: string }

/** \tikz@mode's switches, \tikz@mode@<name> */
export type ModeCall = "drawtrue" | "drawfalse" | "filltrue" | "fillfalse" | "cliptrue" | "boundarytrue"

/** a transformation, as TikZ hands it to pgf */
export type TransformCall =
  /** \tikz@scan@one@point\pgftransformshift<point>\relax */
  | { op: "shift"; point: Toks }
  /** \pgftransform<op>{arg} */
  | { op: "xshift" | "yshift" | "scale" | "xscale" | "yscale" | "xslant" | "yslant" | "rotate"; arg: Toks }
  /** right of=… and the like (\tikz@of): a shift by the node distance, read when the transformation runs */
  | { op: "of"; angle: string }
  /** positioning's \tikz@lib@pos@call, read when the transformation runs (each node's first) */
  | { op: "poscall" }

/** \tikz@text@action: how a node's text with a text width is set */
export type TextAction = "ragged" | "badly ragged" | "ragged left" | "badly ragged left" | "justified" | "centered" | "badly centered"

/** \tikz@node@at */
export type NodeAt =
  /** \pgfpointanchor{\tikz@pp@name{node}}{center} (right of=node) */
  | { kind: "of"; node: Toks }
  /** \pgfpointanchor{node}{anchor} (positioning's right=of node) */
  | { kind: "anchor"; node: string; anchor: string }
  /** a point TikZ scanned (at=…, `at (…)`), computed when the node is placed */
  | { kind: "point"; point: () => { x: number; y: number } }

/** The macros and registers TikZ's options set, as they are inside a picture */
export interface TikzState {
  /** \pgflinewidth (sp) */
  lineWidth: number
  /** \tikz@options */
  options: OptionCall[]
  /** \tikz@mode */
  mode: ModeCall[]
  /** \tikz@transform; null for \relax (transformations apply at once) */
  transform: TransformCall[] | null
  /** \tikz@textcolor, \tikz@strokecolor, \tikz@fillcolor */
  textColor: Toks
  strokeColor: Toks
  fillColor: Toks
  /** \tikz@dashpattern (its items as typed) and \tikz@dashphase */
  dashPattern: Toks[]
  dashPhase: Toks
  /** \pgf@corner@arc (sp; null while undefined) and \ifpgf@arccorners */
  corner: { x: number; y: number } | null
  arcCorners: boolean
  /** \tikz@anchor */
  anchor: Toks
  /** \tikz@do@auto@anchor is \tikz@auto@anchor@on (else \relax), and \tikz@auto@anchor@direction */
  autoAnchor: boolean
  autoDirection: "left" | "right"
  /** \tikz@shape */
  shape: string
  /** \tikz@node@distance */
  nodeDistance: Toks
  /** \tikz@node@at (null while undefined) */
  nodeAt: NodeAt | null
  /** positioning's \tikz@lib@pos@call: \pgftransformshift{\pgfqpoint{x}{y}} (sp), or \relax */
  posCall: { x: number; y: number } | null
  /** positioning's \iftikz@lib@ignore@size (on grid) */
  onGrid: boolean
  /** \tikz@text@width, \tikz@textfont, \tikz@node@textfont, \tikz@text@action */
  textWidth: Toks
  textFont: Toks
  nodeFont: Toks
  textAction: TextAction
  /** \tikz@fig@name (name=…, a node's `(name)`) */
  figName: string
  /** \tikz@time: a label's position on its path (pos=…; "" while empty) */
  time: string
  /** \ifpgfslopedattime, \ifpgfallowupsidedownattime, \ifpgfresetnontranslationattime, \iftikz@fullytransformed */
  sloped: boolean
  upsideDown: boolean
  resetNonTranslations: boolean
  fullyTransformed: boolean
  /** \tikz@current@arrows, \pgf@start@tip@sequence, \pgf@end@tip@sequence */
  currentArrows: Toks
  startTips: Tip[]
  endTips: Tip[]
  /** \pgf@ar@means@> as >=… declared it (undefined: the package's, To) */
  arrowMeans?: Tip[]
}

const clone = (s: TikzState): TikzState => ({
  ...s,
  options: [...s.options],
  mode: [...s.mode],
  transform: s.transform && [...s.transform],
  dashPattern: [...s.dashPattern],
  startTips: [...s.startTips],
  endTips: [...s.endTips],
})

export interface TikzSetup {
  /** em and ex of the font pgfmath reads units in (\pgfmath@selectfont) */
  units: PgfUnits
  /** the document's colors (\pgfutil@doifcolorelse) */
  colors: Colors
  /** \usetikzlibrary{positioning}, \usetikzlibrary{arrows.meta} */
  positioning?: boolean
  arrowsMeta?: boolean
  /**
   * positioning's `of`: \tikz@scan@one@point(#2), the point and, for a node's name, the node whose border it
   * is on (\iftikz@shapeborder)
   */
  scanOf?: (target: Toks) => { point: () => { x: number; y: number }; border: string | null }
  /** at=…: the point scanned (\tikz@scan@one@point) */
  at?: (v: Toks, st: TikzState) => void
  /** a transformation applied at once (\tikz@transform is \relax): pgf's transformations */
  transform?: (t: TransformCall, st: TikzState) => void
  /** baseline=…: \pgfsetbaseline (pgf's picture) */
  baseline?: (v: Toks) => void
  /** rounded corners=…, sharp corners: \pgfsetcornersarced (pgf's picture), with \pgf@corner@arc set */
  corners?: (st: TikzState) => void
  /** an arrow specification: \pgfsetarrows (pgf's picture) */
  arrows?: (v: Toks, st: TikzState) => void
}

/** pgf's styles and keys that TikZ's options reach (pgfmoduleshapes.code.tex 887–897) */
const PGF_KEYS = `inner xsep/.initial=.3333em, inner ysep/.initial=.3333em,
  inner sep/.style={/pgf/inner xsep={#1},/pgf/inner ysep={#1}},
  outer xsep/.initial=.5\\pgflinewidth, outer ysep/.initial=.5\\pgflinewidth,
  minimum width/.initial=1pt, minimum height/.initial=1pt,
  minimum size/.style={/pgf/minimum width={#1},/pgf/minimum height={#1}}`

/** TikZ's styles (tikz.code.tex 952–953, 975, 1110, 1174–1184, 1558–1601, 1614–1620) */
const TIKZ_STYLES = `nodes/.code=\\tikzset{every node/.append style={#1}},
  name prefix/.initial=, name suffix/.initial=,
  at start/.style={pos=0}, very near start/.style={pos=0.125}, near start/.style={pos=0.25}, midway/.style={pos=0.5},
  near end/.style={pos=0.75}, very near end/.style={pos=0.875}, at end/.style={pos=1},
  '/.style=swap,
  node halign header/.initial=,
  align/.is choice,
  align/left/.style={text ragged,node halign header=\\tikz@align@left@header},
  align/flush left/.style={text badly ragged,node halign header=\\tikz@align@left@header},
  align/right/.style={text ragged left,node halign header=\\tikz@align@right@header},
  align/flush right/.style={text badly ragged left,node halign header=\\tikz@align@right@header},
  align/center/.style={text centered,node halign header=\\tikz@align@center@header},
  align/flush center/.style={text badly centered,node halign header=\\tikz@align@center@header},
  align/justify/.style={text justified,node halign header=\\tikz@align@left@header},
  align/none/.style={text justified,node halign header=},
  help lines/.style={color=gray,line width=0.2pt},
  style/.style={#1}, every to/.style={},
  x radius/.initial=0pt, y radius/.initial=0pt,
  every picture/.style={}, every path/.style={}, every scope/.style={}, every node/.style={},
  every label/.style={draw=none,fill=none}, every pin/.style={draw=none,fill=none},
  ultra thin/.style={line width=0.1pt}, very thin/.style={line width=0.2pt}, thin/.style={line width=0.4pt},
  semithick/.style={line width=0.6pt}, thick/.style={line width=0.8pt}, very thick/.style={line width=1.2pt},
  ultra thick/.style={line width=1.6pt},
  solid/.style={dash pattern=},
  dotted/.style={dash pattern=on \\pgflinewidth off 2pt},
  densely dotted/.style={dash pattern=on \\pgflinewidth off 1pt},
  loosely dotted/.style={dash pattern=on \\pgflinewidth off 4pt},
  dashed/.style={dash pattern=on 3pt off 3pt},
  densely dashed/.style={dash pattern=on 3pt off 2pt},
  loosely dashed/.style={dash pattern=on 3pt off 6pt},
  dashdotted/.style={dash pattern=on 3pt off 2pt on \\the\\pgflinewidth off 2pt},
  dash dot/.style={dash pattern=on 3pt off 2pt on \\the\\pgflinewidth off 2pt},
  densely dashdotted/.style={dash pattern=on 3pt off 1pt on \\the\\pgflinewidth off 1pt},
  densely dash dot/.style={dash pattern=on 3pt off 1pt on \\the\\pgflinewidth off 1pt},
  loosely dashdotted/.style={dash pattern=on 3pt off 4pt on \\the\\pgflinewidth off 4pt},
  loosely dash dot/.style={dash pattern=on 3pt off 4pt on \\the\\pgflinewidth off 4pt},
  dashdotdotted/.style={dash pattern=on 3pt off 2pt on \\the\\pgflinewidth off 2pt on \\the\\pgflinewidth off 2pt},
  densely dashdotdotted/.style={dash pattern=on 3pt off 1pt on \\the\\pgflinewidth off 1pt on \\the\\pgflinewidth off 1pt},
  loosely dashdotdotted/.style={dash pattern=on 3pt off 4pt on \\the\\pgflinewidth off 4pt on \\the\\pgflinewidth off 4pt},
  dash dot dot/.style={dash pattern=on 3pt off 2pt on \\the\\pgflinewidth off 2pt on \\the\\pgflinewidth off 2pt},
  densely dash dot dot/.style={dash pattern=on 3pt off 1pt on \\the\\pgflinewidth off 1pt on \\the\\pgflinewidth off 1pt},
  loosely dash dot dot/.style={dash pattern=on 3pt off 4pt on \\the\\pgflinewidth off 4pt on \\the\\pgflinewidth off 4pt}`

/** the shapes pgf declares (pgfmoduleshapes.code.tex: \pgf@sh@s@<name>) */
const SHAPES = new Set(["coordinate", "rectangle", "circle"])

/** positioning's placements (tikzlibrarypositioning.code.tex 15–26): anchor, x and y factors, anchor of the `of` node, factor of a single distance */
const PLACEMENTS: Record<string, [string, string, string, string, string]> = {
  above: ["south", "0", "1", "north", "1"],
  "above left": ["south east", "-1", "1", "north west", "0.707106781"],
  "above right": ["south west", "1", "1", "north east", "0.707106781"],
  "base left": ["base east", "-1", "0", "base west", "1"],
  "base right": ["base west", "1", "0", "base east", "1"],
  below: ["north", "0", "-1", "south", "1"],
  "below left": ["north east", "-1", "-1", "south west", "0.707106781"],
  "below right": ["north west", "1", "-1", "south east", "0.707106781"],
  left: ["east", "-1", "0", "west", "1"],
  "mid left": ["mid east", "-1", "0", "mid west", "1"],
  "mid right": ["mid west", "1", "0", "mid east", "1"],
  right: ["west", "1", "0", "east", "1"],
}

/** the core's placements (tikz.code.tex 1006–1021): anchor and the shifts (axis and sign) a distance makes */
const CORE_PLACEMENTS: Record<string, [string, ...[string, string][]]> = {
  left: ["east", ["x", "-"]],
  right: ["west", ["x", ""]],
  above: ["south", ["y", ""]],
  below: ["north", ["y", "-"]],
  "above left": ["south east", ["x", "-"], ["y", ""]],
  "above right": ["south west", ["x", ""], ["y", ""]],
  "below left": ["north east", ["x", "-"], ["y", "-"]],
  "below right": ["north west", ["x", ""], ["y", "-"]],
}

/** the old placements (tikz.code.tex 1028–1035) and their angles */
const OF: Record<string, string> = {
  "above of": "90", "below of": "-90", "left of": "180", "right of": "0",
  "above left of": "135", "below left of": "-135", "above right of": "45", "below right of": "-45",
}

const TEXT_ACTIONS: TextAction[] = ["ragged", "badly ragged", "ragged left", "badly ragged left", "justified", "centered", "badly centered"]

const pt = (sp: number): Tok[] => chars(`${printScaled(sp)}pt`)

/** TikZ inside a picture: its keys and its state, both local to TeX's groups */
export class Tikz {
  readonly keys = new Keys()
  st: TikzState
  private readonly stack: TikzState[] = []
  /** the arrow tips (>=… changes what > means, not that it is a shorthand) */
  private readonly db: ArrowDb
  private readonly setup: TikzSetup

  /** \usetikzlibrary{positioning} */
  get positioning(): boolean { return !!this.setup.positioning }

  constructor(setup: TikzSetup) {
    this.setup = setup
    this.db = arrowDb(!!setup.arrowsMeta)
    this.st = {
      lineWidth: 0x6666, // 0.4pt
      options: [], mode: [], transform: null,
      textColor: [], strokeColor: [], fillColor: [],
      dashPattern: [], dashPhase: chars("0pt"),
      corner: null, arcCorners: false,
      anchor: chars("center"), autoAnchor: false, autoDirection: "left",
      shape: "rectangle",
      nodeDistance: chars(setup.positioning ? "1cm and 1cm" : "1cm"),
      nodeAt: null, posCall: null, onGrid: false,
      textWidth: [], textFont: [], nodeFont: [], textAction: "ragged",
      figName: "", time: "", sloped: false, upsideDown: false, resetNonTranslations: true, fullyTransformed: false,
      currentArrows: chars("-"), startTips: [], endTips: [],
    }
    this.install()
  }

  /** \tikzset{list} */
  set(list: Toks | string) { this.keys.pgfqkeys("/tikz", list) }

  /** a global assignment to \pgflinewidth (pgf's \pgfsetlinewidth, \endpgfscope): the groups' saved values go too */
  globalLineWidth(w: number) {
    this.st.lineWidth = w
    for (const s of this.stack) s.lineWidth = w
  }

  /** how many groups are open */
  get depth(): number { return this.stack.length }
  begingroup() { this.stack.push(clone(this.st)); this.keys.begingroup() }
  endgroup() {
    const s = this.stack.pop()
    if (!s) throw new Unsupported("tikz: a group ends that did not begin")
    this.st = s
    this.keys.endgroup()
  }

  /**
   * \tikzstyle (tikz.code.tex 1524–1549), the old syntax: `{name}=[options]`, `{name}+=[options]`,
   * `{name}[default]=[options]`, or a name up to `=` without braces. Returns the tokens it read.
   */
  tikzstyle(t: Toks): number {
    let i = 0
    while (t[i] === " ") i++
    let name: Toks
    let between: Toks
    let at: number
    if (t[i] === "{") {
      // the brace group: \tikz@style@parseA#1#2=#3[#4]
      const end = groupEnd(t, i)
      if (end < 0) throw new Unsupported("tikz: unbalanced braces")
      name = t.slice(i + 1, end)
      const eq = find(t, ["="], end + 1)
      if (eq < 0) throw new Unsupported("tikz: \\tikzstyle without =")
      between = t.slice(end + 1, eq)
      at = eq + 1
    } else {
      // \tikz@style@parseB#1=
      const eq = find(t, ["="], i)
      if (eq < 0) throw new Unsupported("tikz: \\tikzstyle without =")
      name = arg(t.slice(i, eq))
      between = []
      at = eq + 1
    }
    const open = find(t, ["["], at)
    if (open < 0) throw new Unsupported("tikz: \\tikzstyle without [")
    const close = find(t, ["]"], open + 1)
    if (close < 0) throw new Unsupported("tikz: \\tikzstyle without ]")
    const body = arg(t.slice(open + 1, close))
    let def: Toks | null = null
    let rest = between
    if (contains(between, ["["])) {
      // \tikz@style@parseC#1[#2]#3=#4
      const a = find(between, ["["]), b = find(between, ["]"], a + 1)
      if (b < 0) throw new Unsupported("tikz: \\tikzstyle default without ]")
      def = arg(between.slice(a + 1, b))
      rest = between.slice(b + 1)
    }
    const key = [...chars("/tikz/"), ...name]
    if (def) this.keys.pgfkeys([...key, ...chars("/.default="), "{", ...def, "}"])
    this.keys.pgfkeys([...key, ...chars(contains(rest, ["+"]) ? "/.append style=" : "/.style="), "{", ...body, "}"])
    return close + 1
  }

  /** \pgfmathsetlength: TeX's errors are not modeled */
  private length(v: Toks): number {
    const r = pgfmathSetLength(plain(v, "dimension"), this.setup.units)
    if (r.errors.length) throw new Unsupported(`tikz: ${r.errors[0]}`)
    return r.value
  }
  private parse(v: string): { result: string; units: boolean } {
    const r = pgfmathParse(v, this.setup.units)
    if (r.errors.length) throw new Unsupported(`tikz: ${r.errors[0]}`)
    return { result: r.result, units: r.unitsDeclared }
  }

  /** \tikz@addtransform: appended to \tikz@transform, or applied at once when it is \relax */
  private addTransform(t: TransformCall) {
    if (this.st.transform) { this.st.transform.push(t); return }
    if (!this.setup.transform) throw new Unsupported("tikz: a transformation applied at once")
    this.setup.transform(t, this.st)
  }

  /**
   * \edef of an option's value: plain text, `\pgflinewidth` (a register, kept) and `\the\pgflinewidth`
   * (its value now). Other control sequences are not modeled.
   */
  private expand(v: Toks): Tok[] {
    const out: Tok[] = []
    for (let i = 0; i < v.length; i++) {
      const t = v[i]
      if (t === "\\the" && v[i + 1] === "\\pgflinewidth") { out.push(...pt(this.st.lineWidth)); i++; continue }
      if (t === "\\pgflinewidth" || !isCs(t)) { out.push(t); continue }
      throw new Unsupported(`tikz: ${t} in an option`)
    }
    return out
  }

  /** \tikz@scandashon/\tikz@scandashoff on `#1o\@nil` after \pgfutil@gobble (tikz.code.tex 144–149) */
  private scanDash(v: Toks): Tok[][] {
    const items: Tok[][] = []
    if (v[0] === "{" || v[0] === " " || v[0] === undefined) throw new Unsupported("tikz: dash pattern")
    let rest: Tok[] = [...v.slice(1), "o"]
    let expect = ["n"]
    for (;;) {
      if (!expect.every((c, k) => rest[k] === c)) throw new Unsupported(`tikz: dash pattern does not alternate on and off`)
      rest = rest.slice(expect.length)
      const o = find(rest, ["o"])
      items.push(arg(rest.slice(0, o)))
      rest = rest.slice(o + 1)
      // \pgfutil@ifnextchar\@nil: blanks skipped
      while (rest[0] === " ") rest = rest.slice(1)
      if (rest.length === 0) return items
      expect = expect.length === 1 ? ["f", "f"] : ["n"]
    }
  }

  /** \tikz@of (tikz.code.tex 1036–1045) */
  private of(v: Toks, angle: string) {
    this.st.anchor = chars("center")
    this.st.autoAnchor = false
    this.addTransform({ op: "of", angle })
    this.st.nodeAt = { kind: "of", node: [...v] }
  }

  /** \tikz@possibly@transform{axis}{sign}{distance} (1070–1081) */
  private possiblyTransform(axis: string, sign: string, v: Toks) {
    this.st.autoAnchor = false
    if (v.length === 0) return
    let x = this.length(v)
    if (sign === "-") x = -x
    this.addTransform({ op: axis === "x" ? "xshift" : "yshift", arg: pt(x) })
  }

  /** positioning's \tikz@lib@place@handle@ (29–53) */
  private place(v: Toks, [anchor, xf, yf, ofAnchor, factor]: [string, string, string, string, string]) {
    this.st.anchor = chars(anchor)
    this.st.autoAnchor = false
    const temp = this.expand(v)
    let nums: Toks
    if (contains(temp, chars("of "))) {
      // \tikz@lib@place@of#1of #2\tikz@stop
      const i = find(temp, chars("of "))
      const dist = arg(temp.slice(0, i))
      const target = arg(temp.slice(i + 3))
      // \tikz@lib@place@of@ (98–110): the point scanned; a node's name makes it the node's anchor
      if (!this.setup.scanOf) throw new Unsupported("tikz: positioning outside a picture")
      const { point, border } = this.setup.scanOf(target)
      this.st.nodeAt = { kind: "point", point }
      if (border !== null) {
        if (this.st.onGrid) {
          this.st.nodeAt = { kind: "anchor", node: border, anchor: "center" }
          this.st.anchor = chars("center")
        } else this.st.nodeAt = { kind: "anchor", node: border, anchor: ofAnchor }
      }
      nums = dist.length === 0 ? this.expand(this.st.nodeDistance) : dist
    } else nums = temp
    if (nums.length === 0) return
    const a = new TexArith(this.setup.units)
    let { x, y } = this.placeNums(nums, a)
    if (!contains(nums, chars("and"))) {
      x = a.times(factor, x)
      y = a.times(factor, y)
    }
    x = a.times(xf, x)
    y = a.times(yf, y)
    if (a.errors.length) throw new Unsupported(`tikz: ${a.errors[0]}`)
    this.st.posCall = { x, y }
  }

  /** \tikz@lib@place@parse@nums@#1and#2 (62–88): the second distance is the horizontal one */
  private placeNums(nums: Toks, a: TexArith): { x: number; y: number } {
    let first: Toks, second: Toks
    if (contains(nums, chars("and"))) {
      const i = find(nums, chars("and"))
      first = arg(nums.slice(0, i))
      second = arg(nums.slice(i + 3))
    } else first = second = arg(nums)
    // \pgfpointxy with pgf's default vectors (1cm, 0pt) and (0pt, 1cm); its \pgfmathparse of a
    // \pgfmathresult gives it back as it is
    const cm = pgfmathSetLength("1cm", this.setup.units).value
    const h = this.parse(plain(second, "distance"))
    let xa: number, ya: number
    if (h.units) { xa = a.dimen(`${h.result}pt`); ya = 0 }
    else { xa = a.times(h.result, cm); ya = 0 }
    const v = this.parse(plain(first, "distance"))
    if (v.units) ya += a.dimen(`${v.result}pt`)
    else ya += a.times(v.result, cm)
    return { x: xa, y: ya }
  }

  /** \tikz@processarrows (1201–1208) */
  private arrows(v: Toks) {
    this.st.currentArrows = [...v]
    if (v.length === 0) return
    const { start, end } = setArrows(v, this.db)
    this.st.startTips = start
    this.st.endTips = end
    this.setup.arrows?.(v, this.st)
  }

  /** the color options of /tikz/.unknown: \tikz@compat@color@set and the text color */
  private compatColor(name: string) {
    this.st.options.push({ op: "compatcolor", color: name })
    this.st.textColor = chars(name)
  }

  /** /tikz/.unknown (tikz.code.tex 1653–1688) */
  private unknown(k: Keys, v: Toks | undefined) {
    const name = k.name
    k.success = false
    k.pgfkeys([...chars(`/pgf/${name}/.try=`), "{", ...(v ?? NOVALUE), "}"])
    if (k.success) return
    const key = chars(name)
    if (contains(key, ["!"])) return this.compatColor(name)
    // (xcolor's current color "." is a color too)
    if (name === "." || this.setup.colors.has(name)) return this.compatColor(name)
    if (contains(key, ["-"])) return this.arrows(key)
    if (SHAPES.has(name)) { this.st.shape = name; return }
    throw new Unsupported(`tikz: I do not know the key '/tikz/${name}'`)
  }

  private install() {
    const k = this.keys
    const opt = (name: string, run: (v: Toks) => void, def?: string) =>
      k.option(`/tikz/${name}`, (_k, v) => run(v ?? NOVALUE), def)
    const st = () => this.st

    k.pgfkeys("/tikz/.is family")
    k.pgfqkeys("/pgf", PGF_KEYS)
    // \pgf@handle@outer@sep (pgfmoduleshapes.code.tex 900–914)
    k.define("/pgf/outer sep", [{ kind: "native", run: (_k, v) => {
      const val = v ?? NOVALUE
      if (same(val, chars("auto"))) throw new Unsupported("tikz: outer sep=auto")
      k.setValue("/pgf/outer xsep", val)
      k.setValue("/pgf/outer ysep", val)
    } }])

    opt("line width", (v) => {
      st().options.push({ op: "linewidth", arg: v })
      st().lineWidth = this.length(v)
    })
    opt("dash pattern", (v) => {
      if (v.length === 0) {
        st().dashPattern = []
        st().options.push({ op: "dash", pattern: [], phase: chars("0pt") })
        return
      }
      st().dashPattern = this.scanDash(v)
      st().options.push({ op: "dash", pattern: st().dashPattern.map((x) => this.expand(x)), phase: null })
    })
    opt("dash phase", (v) => {
      st().dashPhase = v
      st().options.push({ op: "dash", pattern: st().dashPattern.map((x) => this.expand(x)), phase: null })
    })
    opt("color", (v) => {
      st().options.push({ op: "color", color: v })
      st().textColor = v
    })
    for (const [name, on, off, op, field] of [
      ["fill", "filltrue", "fillfalse", "fillcolor", "fillColor"],
      ["draw", "drawtrue", "drawfalse", "strokecolor", "strokeColor"],
    ] as const) {
      opt(name, (v) => {
        const temp = str(this.expand(v))
        if (temp === "none") { st().mode.push(off); return }
        if (temp !== "") {
          st().options.push({ op, color: v })
          st()[field] = v
        }
        st().mode.push(on)
      }, "")
    }
    opt("rounded corners", (v) => {
      // \pgfsetcornersarced{\pgfpoint{#1}{#1}}
      const x = this.length(v), y = this.length(v)
      st().corner = { x, y }
      st().arcCorners = x !== 0 || y !== 0
      this.setup.corners?.(st())
    }, "4pt")
    opt("sharp corners", () => { st().corner = { x: 0, y: 0 }; st().arcCorners = false; this.setup.corners?.(st()) }, "")
    // tikz.code.tex 533–534
    opt("clip", () => { st().mode.push("cliptrue") }, "")
    opt("use as bounding box", () => { st().mode.push("boundarytrue") }, "")
    // baseline (88–94): \pgfsetbaseline{#1}, or a coordinate (not modeled)
    opt("baseline", (v) => {
      if (v[0] === "(" || !this.setup.baseline) throw new Unsupported("tikz: baseline at a coordinate")
      this.setup.baseline(v)
    }, "0pt")
    // radius (285–295): \pgfmathparse'd, with pt when it has units
    opt("radius", (v) => {
      const r = this.parse(plain(v, "radius"))
      const value = chars(r.units ? `${r.result}pt` : r.result)
      k.setValue("/tikz/x radius", value)
      k.setValue("/tikz/y radius", value)
    })
    for (const op of ["scale", "xscale", "yscale", "xslant", "yslant", "rotate", "xshift", "yshift"] as const) opt(op, (v) => this.addTransform({ op, arg: v }))
    opt("shift", (v) => this.addTransform({ op: "shift", point: v }))

    opt("shape", (v) => { st().shape = plain(this.expand(v), "shape") })
    opt("anchor", (v) => { st().anchor = v; st().autoAnchor = false })
    // centered/.code (1022): the anchor alone
    k.define("/tikz/centered", [{ kind: "native", run: () => { st().anchor = chars("center") } }])
    for (const [name, [anchor, ...shifts]] of Object.entries(CORE_PLACEMENTS)) {
      opt(name, (v) => {
        st().anchor = chars(anchor)
        for (const [axis, sign] of shifts) this.possiblyTransform(axis, sign, v)
      }, "")
    }
    opt("node distance", (v) => { st().nodeDistance = v })
    for (const [name, angle] of Object.entries(OF)) opt(name, (v) => this.of(v, angle))
    opt("auto", (v) => {
      // \csname tikz@install@auto@anchor@#1\endcsname: another value is \relax, nothing
      const how = plain(v, "auto")
      if (how === "" || how === "left" || how === "right") st().autoAnchor = true
      if (how === "left" || how === "right") st().autoDirection = how
      if (how === "false") st().autoAnchor = false
    }, "")
    opt("swap", () => { st().autoDirection = st().autoDirection === "left" ? "right" : "left" }, "")
    opt("text width", (v) => { st().textWidth = v })
    opt("font", (v) => { st().textFont = v })
    opt("text", (v) => { st().textColor = v })
    opt("node font", (v) => { st().nodeFont = v })
    // name (951): \tikz@pp@name, with no prefix or suffix
    opt("name", (v) => {
      if (k.valueOf("/tikz/name prefix")?.length || k.valueOf("/tikz/name suffix")?.length) throw new Unsupported("tikz: name prefix and suffix")
      st().figName = plain(this.expand(v), "node name")
    })
    opt("at", (v) => {
      if (!this.setup.at) throw new Unsupported("tikz: at outside a picture")
      this.setup.at(v, st())
    })
    // pos (1099): \pgfmathsetmacro
    opt("pos", (v) => {
      const t = plain(this.expand(v), "pos")
      st().time = t === "" ? "" : this.parse(t).result
    })
    // (1086–1087) .is if-like: \csname pgfslopedattime#1\endcsname
    const ifKey = (name: string, set: (b: boolean) => void) => opt(name, (v) => {
      const b = plain(v, name)
      if (b !== "true" && b !== "false") throw new Unsupported(`tikz: ${name}=${b}`)
      set(b === "true")
    }, "true")
    ifKey("sloped", (b) => { st().sloped = b })
    ifKey("allow upside down", (b) => { st().upsideDown = b })
    // transform shape (1050–1057)
    ifKey("transform shape", (b) => { st().fullyTransformed = b; st().resetNonTranslations = !b })
    for (const a of TEXT_ACTIONS) opt(`text ${a}`, () => { st().textAction = a }, "")
    opt("arrows", (v) => this.arrows(v))
    // >=… (1195): \pgfdeclarearrow{name=<->,means={#1}}
    opt(">", (v) => {
      if (v.length && (same(v, ["["]) || same(v, ["]"]))) throw new Unsupported("pgf: arrow tip means a bracket")
      st().arrowMeans = tipSequence(v, this.db, false)
    })
    k.pgfqkeys("/tikz", TIKZ_STYLES)
    k.define("/tikz/.unknown", [{ kind: "native", run: (kk, v) => this.unknown(kk, v) }])

    if (this.setup.positioning) {
      for (const [name, p] of Object.entries(PLACEMENTS)) {
        // without a value (base left, mid right: no default) the \edef makes \pgfkeysnovalue empty
        k.define(`/tikz/${name}`, [{ kind: "native", run: (_k, v) => this.place(v ?? [], p) }])
      }
      opt("on grid", (v) => {
        // .is if: \csname tikz@lib@ignore@size#1\endcsname
        const b = plain(v, "on grid")
        if (b !== "true" && b !== "false") throw new Unsupported(`tikz: on grid=${b}`)
        st().onGrid = b === "true"
      }, "true")
    }
  }
}
