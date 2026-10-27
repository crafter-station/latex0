// The main vertical list, with the state LaTeX's vertical-mode macros look at
// (\lastskip, \prevdepth, \if@nobreak, \clubpenalty, \@doendpe), and the
// kernel's \addvspace, \addpenalty and \endtrivlist on it.

import type { ClassOptionData } from "../layout/classdata"
import type { GlueSpec } from "../layout/dimen"
import { glue, paramGlue, penalty, type BoxNode, type GlueNode, type Node } from "../layout/nodes"
import { appendToVlist, spec } from "./paragraph"
import { Unsupported } from "./unsupported"

export const LOW_PENALTY = 51 // \@lowpenalty: \@beginparpenalty, \@itempenalty and \@endparpenalty are its negation
export const IGNORE_DEPTH = null // \prevdepth = -1000pt

/** Glue arithmetic as \advance does it, for finite glue (§ 1239). */
export const addGlue = (a: GlueSpec, b: GlueSpec): GlueSpec => {
  if (a.stretchOrder || b.stretchOrder || a.shrinkOrder || b.shrinkOrder) throw new Unsupported("infinite glue in \\addvspace")
  return { width: a.width + b.width, stretch: a.stretch + b.stretch, stretchOrder: 0, shrink: a.shrink + b.shrink, shrinkOrder: 0 }
}
export const negate = (g: GlueSpec): GlueSpec => ({ ...g, width: -g.width, stretch: -g.stretch, shrink: -g.shrink })
export const plain = (g: GlueSpec): GlueNode => glue(g.width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder)
export const dimen = (w: number): GlueSpec => ({ width: w, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 })

/** The main vertical list, with what LaTeX's vertical-mode macros look at. */
export class VerticalList {
  nodes: Node[] = [{ kind: "whatsit", text: "\\write-{}" }] // \begin{document}'s \write
  /** \prevdepth is 0pt when the document begins (the first line's interline glue goes at the top of the page) */
  prevDepth: number | null = 0
  /** \if@nobreak: right after a heading (\@afterheading), until the next paragraph starts */
  nobreak = false
  /** \if@afterindent: whether that paragraph keeps its indentation (always, when spanish.ldf's layout has made
   *  \@afterindentfalse \@afterindenttrue) */
  get afterindent() { return this.indentAfter || this.alwaysIndent }
  set afterindent(x: boolean) { this.indentAfter = x }
  private indentAfter = true
  alwaysIndent = false
  /** \clubpenalty at the outer level: \@afterheading's \everypar sets \@M, which lasts until a later paragraph resets it */
  club = 150
  /** \@afterheading's \everypar is still in force (it clears itself in the first paragraph after the one it set up) */
  afterheadingEverypar = false
  /** \@doendpe has redefined \par: the next \par resets \clubpenalty */
  endpePar = false
  /** \@doendpe ran at the outer level: its \par is pending */
  doendpe = false
  /** and its \everypar (which drops the indent box) has not run yet */
  endpeEverypar = false
  /** a \par at the outer level */
  par() { if (this.endpePar) { this.club = this.k.ints.clubpenalty; this.endpePar = this.doendpe = this.endpeEverypar = false; this.afterheadingEverypar = false } }
  constructor(private k: ClassOptionData) {}

  /** \lastskip: the last node's glue, or 0pt (a hook stands for an assignment, not a node) */
  get lastSkip(): GlueSpec {
    const n = this.nodes.findLast((x) => !(x.kind === "whatsit" && x.hook))
    return n?.kind === "glue" ? n : dimen(0)
  }
  vskip(g: GlueSpec) { this.nodes.push(plain(g)) }
  /** \endtrivlist in vertical mode: a skip at the end is redone with the list's \parskip taken out,
   *  then \@endparenv: \addpenalty\@endparpenalty \addvspace\@topsepadd */
  endtrivlist(parskip: GlueSpec, outerParskip: GlueSpec, topsepadd: GlueSpec) {
    const last = this.lastSkip
    if (last.width > 0) { this.vskip(negate(last)); this.vskip(addGlue(addGlue(last, parskip), negate(outerParskip))) }
    this.addpenalty(-LOW_PENALTY)
    this.addvspace(topsepadd)
  }
  /** a box appended in vertical mode, after interline glue */
  box(b: BoxNode, baselineskip: GlueSpec) { this.prevDepth = appendToVlist(this.nodes, b, this.prevDepth, baselineskip, this.k.glue.lineskip, this.k.dimens.lineskiplimit) }

  /** \addvspace (latex.ltx): the larger of the skip and the one already there */
  addvspace(g: GlueSpec) {
    const last = this.lastSkip
    if (last.width === 0) { this.vskip(g); return }
    if (last.width < g.width) { this.vskip(negate(last)); this.vskip(g); return } // \@xaddvskip
    if (g.width < 0 && last.width >= 0) { const b = addGlue(g, last); this.vskip(negate(last)); this.vskip(b) }
  }

  /** \addpenalty (latex.ltx): a penalty placed before the skip that ends the list */
  addpenalty(p: number) {
    if (this.nobreak) return
    const last = this.lastSkip
    if (last.width === 0) { this.nodes.push(penalty(p)); return }
    const a = last
    const pd = this.prevDepth === IGNORE_DEPTH ? 0 : this.prevDepth > this.k.dimens.maxdepth ? this.k.dimens.maxdepth : this.prevDepth
    const b = addGlue(a, dimen(pd))
    this.vskip(negate(b))
    this.nodes.push(penalty(p))
    if (a.width !== b.width) this.vskip(addGlue(b, negate(a)))
    this.vskip(a)
  }

  /** A paragraph's lines (and what follows them: penalties, insertions) after \parskip. */
  paragraph(vlist: Node[], parskip: GlueSpec, baselineskip = this.k.sizes.normalsize.baselineskip, lineskip = this.k.glue.lineskip, lineskiplimit = this.k.dimens.lineskiplimit) {
    this.nodes.push(spec("parskip", parskip), paramGlue("parskip", glue(0))) // new_graf, then LaTeX's zero \parskip
    this.lines(vlist, baselineskip, lineskip, lineskiplimit)
  }
  /** where the last paragraph's lines (or, after a display, the rest of them) went on the list: all the page builder
   *  had seen while that paragraph was read (up to its \parskip, or to the display) */
  paraStart = 0
  /** lines of a paragraph (no \parskip: the part after a display) */
  lines(vlist: Node[], baselineskip = this.k.sizes.normalsize.baselineskip, lineskip = this.k.glue.lineskip, lineskiplimit = this.k.dimens.lineskiplimit) {
    this.paraStart = this.nodes.length
    for (const n of vlist) {
      if (n.kind === "hlist") this.prevDepth = appendToVlist(this.nodes, n, this.prevDepth, baselineskip, lineskip, lineskiplimit)
      else this.nodes.push(n)
    }
  }
}
