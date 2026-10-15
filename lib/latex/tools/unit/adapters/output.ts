// LaTeX's output routine for one column (latex.ltx, ltoutput.dtx, LaTeX 2025-06-01 and later):
// what happens at every page break and at every float. Floats go "here" (\@addtocurcol), to the
// top or bottom of a page (\@addtotoporbot, \@addtobot), or wait in \@deferlist for the next page
// (\@startcolumn, \@addtonextcol) or for a page of floats (\@tryfcolumn); \clearpage puts every
// waiting float on float pages (\@doclearpage, \@makefcolumn). \@makecol then builds the column:
// top floats, the text, footnotes, bottom floats.

import type { ClassOptionData } from "../../../layout/classdata"
import type { GlueSpec } from "../../../layout/dimen"
import { xnOverD } from "../../../layout/arith"
import { roundDecimals } from "../../../layout/dimen"
import { emptyBox, FIL, glue, kern, NORMAL, paramGlue, penalty, type BoxNode, type GlueNode, type Node, type WhatsitNode } from "../../../layout/nodes"
import { vpack } from "../../../layout/pack"
import { buildPages, type Page } from "../../../layout/pagebuilder"
import { documentPages } from "../../../trace/decisions"

const MAX_DIMEN = 0o7777777777

/** A float as \end@float leaves it: its box, and \count\@currbox — the placement bits h (1), t (2), b (4), p (8), 16 unless !, plus 32 × \ftype. */
export interface Float {
  box: BoxNode
  count: number
  /** \if@nobreak when the float came (right after a heading) */
  nobreak: boolean
  /** its place among the document's floats, and whether the text after it was laid out as if it went here */
  index: number; here: boolean
}

/** What the output routine ships: a page of text with its top and bottom floats, or a page of floats. */
export type Shipped = { kind: "text"; page: Page; top: BoxNode[]; bot: BoxNode[] } | { kind: "floats"; floats: BoxNode[] }

/** Assignments the document makes to the output routine's state. */
export type OutputHook = "notop"

/** Thrown for what the output routine does that is not modeled yet. */
export class OutputUnsupported extends Error {}

/** A float right after a heading went elsewhere than the text after it assumed. */
export class NobreakFloat extends Error { constructor(readonly index: number) { super(`float ${index} placed elsewhere than assumed`) } }

const plain = (g: GlueSpec): GlueNode => glue(g.width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder)
const negate = (g: GlueSpec): GlueSpec => ({ ...g, width: -g.width, stretch: -g.stretch, shrink: -g.shrink })
const bit = (count: number, b: number) => Math.floor(count / b) % 2 === 1
/** \@currtype: 32 × \ftype */
const currtype = (f: Float) => f.count - (f.count % 32)
/** \@bitor: a float of the same type is in one of the lists */
const bitor = (type: number, ...lists: Float[][]) => lists.some((l) => l.some((f) => bit(f.count, type)))

export class LatexOutput {
  readonly shipped: Shipped[] = []
  private deferlist: Float[] = []
  private toplist: Float[] = []
  private botlist: Float[] = []
  private midlist: Float[] = []
  private colroom: number
  private topnum = 0; private toproom = 0; private botnum = 0; private botroom = 0; private colnum = 0
  private textfloatsheight = 0

  constructor(private k: ClassOptionData, private parskip: GlueSpec) {
    this.colroom = k.dimens.textheight
    this.vsizeNow = k.dimens.textheight
    this.floatplacement()
  }

  private get colht() { return this.k.dimens.textheight }

  /** \@floatplacement (\@fpmin is the class's \floatpagefraction\@colht) */
  private floatplacement() {
    const { ints, dimens } = this.k
    this.topnum = ints.topnumber; this.toproom = dimens.toproom
    this.botnum = ints.bottomnumber; this.botroom = dimens.botroom
    this.colnum = ints.totalnumber
  }

  /** \vsize after an output: \@colroom (a column left with less than 1.5\baselineskip gets \@emptycol) */
  vsize(): number { return this.vsizeNow }
  private vsizeNow: number

  /**
   * The end of \output: \vsize becomes \@colroom, unless less than 1.5\baselineskip is left for text on a
   * page with floats; then \@emptycol (\vbox{}\penalty-\@M) ships it with no text, and \vsize stays.
   */
  private endOutput(): Node[] {
    const bs = this.k.sizes.normalsize.baselineskip.width
    if (this.colroom < bs + xnOverD(bs, 32768, 65536) && this.colroom < this.colht) return [emptyBox("vlist"), penalty(-10000)]
    this.vsizeNow = this.colroom
    return []
  }

  /**
   * \@specialoutput for a float from vertical mode (\penalty-\@Miii): `held` is the page so far
   * (\@holdpg), `boxes` the insertion boxes fire_up filled. Returns what goes back on the
   * contribution list: the page so far, \@reinserts, and the float if it goes here.
   */
  float(held: Node[], marker: WhatsitNode, boxes: Record<number, Node[]>): Node[] {
    const f = marker.float as Float
    const k = this.k
    const hp = vpack(held.slice())
    let pageht = hp.height + hp.depth // \advance\@pageht\@pagedp
    const foot = boxes[k.ints.footins]
    if (foot?.length) { const fb = vpack(foot.slice()); pageht += fb.height + k.glue.footinsskip.width + fb.depth } // \ifvoid\footins\else
    const out = held.slice()
    // \@reinserts: \insert\footins{\unvbox\footins}, with the output routine's \splittopskip (10pt),
    // \splitmaxdepth (\maxdimen) and \floatingpenalty (0)
    if (foot?.length) {
      const fb = vpack(foot.slice())
      out.push({ kind: "ins", n: k.ints.footins, height: fb.height + fb.depth, depth: MAX_DIMEN, splitTopSkip: glue(655360), floatCost: 0, list: foot.slice() })
      delete boxes[k.ints.footins]
    }
    const here = this.addtocurcol(f, pageht)
    if (f.nobreak && here !== f.here) throw new NobreakFloat(f.index)
    if (here) {
      if (f.nobreak) out.push(penalty(10000)) // \nobreak\@nobreakfalse
      else this.addpenalty(out)
      out.push(plain(k.glue.intextsep), f.box, penalty(k.ints.interlinepenalty), plain(k.glue.intextsep), plain(negate(this.parskip)))
    } else {
      // \outputpenalty is still -\@Miii: \nobreak (and \if@nobreak stays true), or \addpenalty\interlinepenalty
      if (f.nobreak) out.push(penalty(10000))
      else this.addpenalty(out)
    }
    return [...out, ...this.endOutput()]
  }

  /** \addpenalty\interlinepenalty after \unvbox\@holdpg, where \prevdepth is -1000pt */
  private addpenalty(out: Node[]) {
    const last = out[out.length - 1]
    const p = this.k.ints.interlinepenalty
    if (last?.kind === "glue" && last.width !== 0) out.push(plain(negate(last)), penalty(p), plain(last))
    else out.push(penalty(p))
  }

  /** \@addtocurcol: here, else top or bottom, else deferred; true when placed here. */
  private addtocurcol(f: Float, pageht: number): boolean {
    const k = this.k, t = f.count % 32, type = currtype(f)
    let inserted = false
    if (t !== 8 && t !== 24) {
      const textmin = (t < 16 ? 0 : k.dimens.textmin) + this.textfloatsheight // \@flsettextmin, \advance\@textmin\@textfloatsheight
      let req = Math.max(pageht, textmin) + f.box.height
      const saved = req
      if (this.colroom > req) {
        const colnum = t < 16 && this.colnum === 0 ? 1 : this.colnum // \@flsetnum\@colnum (local)
        if (colnum > 0 && !bitor(type, this.deferlist) && f.box.depth === 0) { // \@testwrongwidth
          if (bitor(type, this.botlist)) inserted = this.addtobot(f, saved, colnum)
          else {
            if (bit(f.count, 1)) {
              req += k.glue.intextsep.width
              if (this.colroom > req) {
                this.colnum = colnum - 1
                this.textfloatsheight += f.box.height + 2 * k.glue.intextsep.width
                this.midlist.push(f)
                return true
              }
            }
            inserted = this.addtotoporbot(f, saved, colnum)
          }
        }
      }
    }
    if (!inserted) {
      if (t === 1 || t === 17) f.count += 2 // \@resethfps: an h float that cannot go here may go at the top
      this.deferlist.push(f)
    }
    return false
  }

  /** \@addtonextcol: a deferred float at the start of a column, to its top or bottom, or deferred again. */
  private addtonextcol(f: Float) {
    const t = f.count % 32
    let inserted = false
    if (t !== 8 && t !== 24) {
      const req = f.box.height + (t < 16 ? 0 : this.k.dimens.textmin)
      if (this.colroom > req) {
        const colnum = t < 16 && this.colnum === 0 ? 1 : this.colnum
        if (colnum > 0 && !bitor(currtype(f), this.deferlist) && f.box.depth === 0) inserted = this.addtotoporbot(f, req, colnum)
      }
    }
    if (!inserted) this.deferlist.push(f)
  }

  private addtotoporbot(f: Float, saved: number, colnum: number): boolean {
    const t = f.count % 32
    if (bit(f.count, 2)) {
      const topnum = t < 16 && this.topnum === 0 ? 1 : this.topnum
      if (topnum > 0 && this.checkspace(f, this.toproom, this.toplist, saved) && !bitor(currtype(f), this.midlist, this.botlist)) {
        const d = this.updates(f, this.toplist, colnum)
        this.topnum = topnum - 1; this.toproom -= d
        return true
      }
    }
    return this.addtobot(f, saved, colnum)
  }

  private addtobot(f: Float, saved: number, colnum: number): boolean {
    const t = f.count % 32
    if (!bit(f.count, 4)) return false
    const botnum = t < 16 && this.botnum === 0 ? 1 : this.botnum
    if (!(botnum > 0) || !this.checkspace(f, this.botroom, this.botlist, saved)) return false
    const d = this.updates(f, this.botlist, colnum)
    this.botnum = botnum - 1; this.botroom -= d
    return true
  }

  /** \@flcheckspace: room on the page with the separation, and in the top or bottom area unless ! */
  private checkspace(f: Float, room: number, list: Float[], saved: number): boolean {
    const req = saved + (list.length ? this.k.glue.floatsep.width : this.k.glue.textfloatsep.width)
    return this.colroom > req && (room > f.box.height || f.count % 32 < 16)
  }

  /** \@flupdates: the float joins the list; the room it takes, with its separation */
  private updates(f: Float, list: Float[], colnum: number): number {
    const d = f.box.height + (list.length ? this.k.glue.floatsep.width : this.k.glue.textfloatsep.width)
    this.colnum = colnum - 1
    this.colroom -= d
    list.push(f)
    return d
  }

  /**
   * \@tryfcolumn: a page of floats from the deferred list, the first float that can start one and
   * the ones after it that fit, when they fill more than \@fpmin. \@makefcolumn tries with any fill
   * and floats without p.
   */
  private tryfcolumn(fpmin: number, testfp: boolean): BoxNode[] | null {
    const list = this.deferlist, colht = this.colht, fpsep = this.k.glue.fpsep.width
    const failed: Float[] = []
    const noP = (f: Float) => testfp && !bit(f.count, 8)
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      if (bitor(currtype(f), failed) || noP(f) || f.box.depth !== 0 || f.box.height > colht) { failed.push(f); continue }
      const succeed = [f], fail: Float[] = []
      let h = f.box.height
      for (const g of list.slice(i + 1)) {
        const hb = h + g.box.height + fpsep
        if (bitor(currtype(g), failed, fail) || noP(g) || g.box.depth !== 0 || hb > colht) fail.push(g)
        else { succeed.push(g); h = hb }
      }
      if (h > fpmin) { this.deferlist = [...failed, ...fail]; return succeed.map((s) => s.box) }
      failed.push(f)
    }
    return null
  }

  /** \@opcol after a page is shipped: \@textfloatsheight cleared, \@floatplacement */
  private opcol() { this.textfloatsheight = 0; this.floatplacement() }

  /** \@startcolumn, repeated while it makes float pages; then each deferred float tries the new column */
  private startcolumn() {
    for (;;) {
      this.colroom = this.colht
      const floats = this.tryfcolumn(this.k.dimens.fpmin, true)
      if (!floats) break
      this.shipped.push({ kind: "floats", floats })
      this.opcol()
    }
    const waiting = this.deferlist
    this.deferlist = []
    for (const f of waiting) this.addtonextcol(f)
  }

  /** The output routine at a page break (\outputpenalty ≥ -\@Mi): \@makecol\@opcol\@startcolumn, or \@doclearpage. */
  output(page: Page): Node[] | void {
    const top = this.toplist.map((f) => f.box), bot = this.botlist.map((f) => f.box)
    if (page.outputPenalty === -10001) {
      if (!page.inserts[this.k.ints.footins]?.length) {
        // the page (\write and \vbox{}) is dropped, all but what \vsplit\@cclv to\z@ splits off, the
        // whatsits before its first box, which \unvbox puts back; every waiting float goes on float pages
        this.deferlist = [...this.toplist, ...this.botlist, ...this.deferlist]
        this.toplist = []; this.botlist = []; this.midlist = []
        this.colroom = this.colht
        for (let floats; (floats = this.tryfcolumn(-MAX_DIMEN, false)); ) { this.shipped.push({ kind: "floats", floats }); this.opcol() }
        if (this.deferlist.length) throw new OutputUnsupported("floats left after \\clearpage")
        const first = page.nodes.findIndex((n) => n.kind !== "whatsit")
        return [...page.nodes.slice(0, first < 0 ? page.nodes.length : first), ...this.endOutput()]
      }
      // footnotes still held over: \vbox{\box\@cclv\vfil}, \@makecol\@opcol, and \clearpage again
      // (its \newpage falls on an empty page: \write\m@ne{}\vbox{}\penalty-\@Mi)
      this.shipped.push({ kind: "text", page, top, bot })
      this.toplist = []; this.botlist = []; this.midlist = []
      this.opcol()
      return [...clearRest(), ...this.endOutput()]
    }
    this.shipped.push({ kind: "text", page, top, bot })
    this.toplist = []; this.botlist = []; this.midlist = []
    this.opcol()
    this.startcolumn()
    return this.endOutput()
  }

  /** An assignment from the document: article's \maketitle sets \@topnum to 0 for its page */
  hook(h: OutputHook) { if (h === "notop") this.topnum = 0 }

  /** At the end: floats still waiting were never output. */
  done() { if (this.deferlist.length || this.toplist.length || this.botlist.length) throw new OutputUnsupported("floats lost at the end of the document") }
}

/** The rest of \clearpage after its \newpage: \write\m@ne{}\vbox{}\penalty-\@Mi */
const clearRest = (): Node[] => [{ kind: "whatsit", text: "\\write-{}" }, emptyBox("vlist"), penalty(-10001)]

/** \end{document} after the main vertical list `contrib`: the pages TeX's page builder cuts and LaTeX's output routine ships. */
export function endDocument(contrib: Node[], k: ClassOptionData, parskip: GlueSpec = k.glue.parskip) {
  // \clearpage: its \newpage (\vfil\penalty-10000; since LaTeX 2025-06-01 the last line's depth is backed
  // up in the output routine, \@outputbox@reinsertbskip, not here), then \write\m@ne{}\vbox{}\penalty-\@Mi,
  // whose output routine (\@doclearpage) ships a page only for footnotes still held over, and then
  // clears the page again
  contrib.push(glue(0, 65536, FIL), penalty(-10000), ...clearRest())
  const out = new LatexOutput(k, parskip)
  const fs = k.glue.footinsskip
  const built = buildPages(contrib, {
    vsize: () => out.vsize(), maxDepth: k.dimens.maxdepth, topSkip: paramGlue("topskip", plain(k.glue.topskip)),
    inserts: { [k.ints.footins]: { skip: glue(fs.width, fs.stretch, fs.stretchOrder, fs.shrink, fs.shrinkOrder), count: k.ints.footinscount, dimen: k.dimens.footinsdimen } },
    float: (held, marker, boxes) => out.float(held, marker, boxes),
    hook: (h) => out.hook(h as OutputHook),
    output: (page) => out.output(page),
  })
  out.done()
  return { pages: out.shipped, pageTrace: documentPages(built.trace) }
}

/**
 * \@makecol as of LaTeX 2025-06-01 (its default footnotes-floats-legacy plug), and \@vtryfc for
 * float pages. \@outputbox@removebskip: a list ending in fil glue loses it, and
 * \@outputbox@reinsertbskip puts it back, after \vskip-\@outputbox@depth (the list's depth, at most
 * \maxdepth) when there are neither footnotes nor bottom floats. \@outputbox@appendfootnotes adds
 * \vskip\skip\footins \footnoterule \unvbox\footins, where \footnoterule is \kern-3pt \hrule width
 * .4\columnwidth \kern2.6pt. \@cflt puts the top floats above, each followed by \floatsep, then
 * \vskip-\floatsep \vskip\textfloatsep; \@cflb the bottom floats below, after \textfloatsep. Then
 * \vbox to\@colht{\unvbox the output box, \vskip-its depth, \@textbottom}. `column` is that box's
 * list from \topskip on, or null for a page of floats.
 */
export function makeColumns(pages: Shipped[], k: ClassOptionData): { outputbox: BoxNode; column: Node[] | null }[] {
  const textbottom: Node[] = k.ints.raggedbottom ? [glue(0, 7, FIL)] : [] // \vskip\z@\@plus.0001fil
  const rule: Node = { kind: "rule", width: xnOverD(k.dimens.columnwidth, roundDecimals([4]), 65536), height: 26214, depth: 0 }
  const fs = k.glue.footinsskip, maxDepth = k.dimens.maxdepth, { floatsep, textfloatsep, fptop, fpsep, fpbot } = k.glue
  return pages.map((sh) => {
    if (sh.kind === "floats") {
      const list: Node[] = [plain(fptop), plain(negate(fpsep))]
      for (const b of sh.floats) list.push(plain(fpsep), b)
      list.push(plain(fpbot))
      return { outputbox: vpack(list, { exactly: k.dimens.textheight }), column: null }
    }
    const pg = sh.page
    let box255 = vpack(pg.nodes.slice(), { exactly: pg.goal }, maxDepth)
    const first = box255
    if (pg.outputPenalty === -10001) box255 = vpack([box255, glue(0, 65536, FIL)]) // \@doclearpage: \vbox{\box\@cclv\vfil}
    const foot = pg.inserts[k.ints.footins]
    let list = box255.list.slice()
    const last = list[list.length - 1]
    if (last?.kind === "glue" && last.stretchOrder !== NORMAL) {
      list.pop()
      const d = vpack(list.slice(), { additional: 0 }, maxDepth).depth
      if (!foot && !sh.bot.length && d > 0) list.push(glue(-Math.min(d, maxDepth)))
      list.push(plain(last))
    }
    if (foot) list.push(plain(fs), kern(-196608, true), rule, kern(170394, true), ...vpack(foot).list)
    if (sh.top.length) list = [...sh.top.flatMap((b) => [b, plain(floatsep)]), plain(negate(floatsep)), plain(textfloatsep), ...list]
    if (sh.bot.length) list = [...list, plain(textfloatsep), ...sh.bot.flatMap((b) => [b, plain(floatsep)]), plain(negate(floatsep))]
    const out = vpack(list.slice(), { additional: 0 }, sh.bot.length ? MAX_DIMEN : maxDepth)
    const col = [...list, glue(-out.depth), ...textbottom]
    const column = first === box255 ? col : first.list
    return { outputbox: vpack(col, { exactly: k.dimens.textheight }), column: column.slice(column.findIndex((n) => n.kind === "glue" && n.param === "topskip")) }
  })
}
