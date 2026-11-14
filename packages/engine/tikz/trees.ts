// TikZ's tree options (tikz.code.tex 1360–1447, line numbers cite it): the registers and macros the child
// operation reads (tikz/path.ts: \tikz@children … \tikz@childnode), on TikzState. `level distance` and
// `sibling distance` are \pgfmathsetlength'd when given; `grow` and `grow'` set the three angles
// (\tikz@set@growth) and the level whose children are not spread (\tikz@special@level); the edge from parent's
// path stays tokens, its \tikzparentnode, \tikzparentanchor, \tikzchildnode and \tikzchildanchor replaced when
// the edge is drawn. The growth function is always \tikz@grow@direction (the trees library is not modeled).

import { Unsupported } from "../latex/unsupported"
import { chars, NOVALUE, type Keys } from "./keys"
import { plain, same, type Tok, type Toks } from "./tokens"

/** the tree's state among TikZ's (TikzState) */
export interface TreeState {
  /** \tikzleveldistance, \tikzsiblingdistance (sp) */
  levelDistance: number
  siblingDistance: number
  /** \tikztreelevel, \tikznumberofchildren, \tikznumberofcurrentchild */
  treeLevel: number
  numberOfChildren: number
  currentChild: number
  /** \tikz@angle@grow, \tikz@angle@grow@left, \tikz@angle@grow@right, \tikz@special@level, \tikz@growth@anchor */
  growAngle: number
  growLeft: number
  growRight: number
  specialLevel: number
  growthAnchor: Toks
  /** \iftikz@child@missing */
  childMissing: boolean
  /** \tikz@edge@to@parent@path, \tikzparentanchor, \tikzchildanchor */
  edgeToParentPath: Toks
  parentAnchor: Toks
  childAnchor: Toks
  /** (the engine's) the edge from parent's path is being scanned, its anchors already replaced */
  edgePathOpen: boolean
}

/** \tikz@grow@direction@<name> (1419–1432) */
const GROW_DIRECTIONS: Record<string, number> = {
  down: -90, up: 90, left: 180, right: 0, south: -90, north: 90, west: 180, east: 0,
  "north east": 45, "north west": 135, "south east": -45, "south west": -135,
}

/** the default \tikz@edge@to@parent@path (1414) */
const EDGE_TO_PARENT: Tok[] = ["(", "\\tikzparentnode", "\\tikzparentanchor", ")", " ", "-", "-", " ", "(", "\\tikzchildnode", "\\tikzchildanchor", ")"]

/**
 * the registers and macros as tikz.code.tex leaves them: \tikzset{grow=down} at level 0 (1447); the two
 * distances (15mm: 1416–1417) are set by installTreeKeys
 */
export const treeState = (): TreeState => ({
  levelDistance: 0, siblingDistance: 0, treeLevel: 0, numberOfChildren: 0, currentChild: 0,
  growAngle: -90, growLeft: -180, growRight: 0, specialLevel: 0, growthAnchor: chars("center"),
  childMissing: false, edgeToParentPath: EDGE_TO_PARENT, parentAnchor: [], childAnchor: [], edgePathOpen: false,
})

/** TikZ's styles for trees (1565–1566, 1625; grow siblings on line: 1380) */
export const TREE_STYLES = `every child/.style={}, every child node/.style={}, edge from parent/.style={draw},
  grow siblings on line/.style={growth function=\\tikz@grow@direction}`

/** \tikz@set@growth (1397–1410): `\c@pgf@counta=#1\relax` for what is no direction's name */
function setGrowth(st: TreeState, v: Toks) {
  const name = plain(v, "grow")
  let angle = GROW_DIRECTIONS[name]
  if (angle === undefined) {
    // (anything but an integer leaves text after the number: not modeled)
    if (!/^-?\d{1,9}$/.test(name)) throw new Unsupported(`tikz: grow=${name}`)
    angle = Number(name)
  }
  st.growAngle = angle
  st.growLeft = angle - 90
  st.growRight = angle + 90
}

/** the tree options; `length` is \pgfmathsetlength */
export function installTreeKeys(k: Keys, st: () => TreeState, length: (v: Toks) => number) {
  const opt = (name: string, run: (v: Toks) => void, def?: string) => k.option(`/tikz/${name}`, (_k, v) => run(v ?? NOVALUE), def)
  st().levelDistance = st().siblingDistance = length(chars("15mm"))
  opt("level distance", (v) => { st().levelDistance = length(v) })
  opt("sibling distance", (v) => { st().siblingDistance = length(v) })
  opt("growth function", (v) => { if (!same(v, ["\\tikz@grow@direction"])) throw new Unsupported("tikz: growth function") })
  opt("growth parent anchor", (v) => { st().growthAnchor = v })
  opt("grow", (v) => { setGrowth(st(), v); st().specialLevel = st().treeLevel })
  opt("grow'", (v) => {
    const s = st()
    setGrowth(s, v)
    ;[s.growLeft, s.growRight] = [s.growRight, s.growLeft] // \tikz@swap@growth
    s.specialLevel = s.treeLevel
  })
  // missing/.is if=tikz@child@missing
  opt("missing", (v) => {
    const b = plain(v, "missing")
    if (b !== "true" && b !== "false") throw new Unsupported(`tikz: missing=${b}`)
    st().childMissing = b === "true"
  }, "true")
}
