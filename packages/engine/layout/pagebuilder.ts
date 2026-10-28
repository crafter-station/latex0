// TeX's page builder: build_page and fire_up, "TeX: The Program" §§ 980–1028,
// with insertions (§§ 1008–1010, 1018–1022) and the vertical breaking they
// use to split (vert_break and prune_page_top, §§ 968–979). Marks are not
// modeled. Each page is cut at the best break TeX would choose; insertions on
// it go to their boxes, held-over insertions and the rest of the list return
// to the contribution list, where leading glue, kerns and penalties are
// discarded.

import { printScaled } from "./arith"
import { badness } from "./linebreak"
import { glue as mkGlue, paramGlue, type GlueNode, type InsNode, type KernNode, type Node, type WhatsitNode } from "./nodes"
import { vpack } from "./pack"
import type { PageCandidate, PageTrace } from "../trace/decisions"

const INF_BAD = 10000, INF_PENALTY = 10000, EJECT_PENALTY = -10000
const AWFUL_BAD = 0o7777777777, DEPLORABLE = 100000, MAX_DIMEN = 0o7777777777

/** \\skip n, \\count n and \\dimen n of an insertion class. */
export interface InsertClass { skip: GlueNode; count: number; dimen: number }

export interface PageParams {
  /** \vsize when a page starts: a number, or what the output routine last left it at */
  vsize: number | (() => number)
  maxDepth: number
  topSkip: GlueNode
  /** insertion classes by box number (LaTeX's \\footins is 253) */
  inserts?: Record<number, InsertClass>
  /**
   * Called when the contribution list runs out, with the last page output so far:
   * what the output routine contributes next (LaTeX's \clearpage), or null to stop.
   */
  more?: (last: Page | undefined) => Node[] | null
  /**
   * A float marker reached on the current page: what LaTeX's output routine puts back on the
   * contribution list for the page so far (\@specialoutput with \@holdpg, \@addtocurcol). `boxes`
   * are the insertion boxes, which it may empty.
   */
  float?: (page: Node[], marker: WhatsitNode, boxes: Record<number, Node[]>) => Node[]
  /** An assignment the output routine sees, made when the page builder reaches it (a whatsit with a hook);
   *  what it returns goes on the contribution list in its place (a conditional on the output's state); `empty`: no box
   *  on the current page yet (\pagetotal is then below \topskip) */
  hook?: (hook: unknown, empty: boolean) => Node[] | void
  /** The output routine for each page cut at a break, called after the page is added to the result:
   *  what it returns goes on the contribution list after held-over insertions, before the rest. */
  output?: (page: Page) => Node[] | void
  /**
   * How far into `contrib` the builder has read (the index of the furthest of its nodes reached so far), called as it
   * advances: what TeX had contributed when the output routine fires there, which places the paragraphs it breaks
   * (fancyhdr's head and foot) among the document's own
   */
  reached?: (index: number) => void
}

export interface Page {
  /** what goes into \box255, in order */
  nodes: Node[]
  /** \pagegoal when the page was cut (best_size) */
  goal: number
  /** \outputpenalty: the penalty at the break, or 10000 for any other break (§ 1013) */
  outputPenalty: number
  /** the vertical lists of the insertion boxes this page filled (box n, packaged natural, § 1021) */
  inserts: Record<number, Node[]>
}

/** precedes_break (§ 148) for vertical lists: boxes, rules, insertions and whatsits */
const precedesBreak = (n: Node | undefined) => !!n && (n.kind === "hlist" || n.kind === "vlist" || n.kind === "rule" || n.kind === "whatsit" || n.kind === "ins")

/** A page insertion node (§ 981): what the current page holds of class n. */
interface PageIns {
  n: number
  splitUp: boolean
  /** natural height plus depth of the material so far */
  height: number
  lastIns: InsNode | null
  bestIns: InsNode | null
  /** for a split insertion: the insertion split, and the index in its list where it breaks (null: at the end) */
  brokenIns: InsNode | null
  brokenAt: number | null
}

const EMPTY = 0, INSERTS_ONLY = 1, BOX_THERE = 2

/** Break a main vertical list into pages; TeX's \tracingpages decisions come back as `trace`. */
export function buildPages(contrib: Node[], p: PageParams): { pages: Page[]; trace: PageTrace[] } {
  const pages: Page[] = []
  const trace: PageTrace[] = []
  let queue = contrib.slice()
  const indexOf = new Map<Node, number>() // (a node object used twice counts where it first stands)
  contrib.forEach((n, i) => { if (!indexOf.has(n)) indexOf.set(n, i) })
  let furthest = -1
  // insertion boxes (\box n) between outputs: an output routine that returns the page without
  // emptying them (a float's \@specialoutput) leaves their material there for the next page
  let regs: Record<number, Node[]> = {}
  const insClass = (n: number) => { const c = p.inserts?.[n]; if (!c) throw new Error(`page builder: no parameters for \\insert${n}`); return c }

  for (;;) {
    // § 991: an empty page
    const page: Node[] = []
    let contents = EMPTY
    let goal = 0, maxDepth = 0, total = 0, depth = 0, shrink = 0
    const stretch = [0, 0, 0, 0] // normal, fil, fill, filll
    let least = AWFUL_BAD, bestBreak = -1, bestSize = 0
    let insertPenalties = 0
    let pageTrace: PageTrace | null = null
    const pageIns: PageIns[] = [] // sorted by n
    let fired = false, restarted = false

    // § 987
    const freeze = (s: number) => {
      contents = s
      goal = typeof p.vsize === "number" ? p.vsize : p.vsize(); maxDepth = p.maxDepth; depth = 0; total = 0; shrink = 0; stretch.fill(0); least = AWFUL_BAD
      pageTrace = { goal, maxDepth, candidates: [], splits: [] }
      trace.push(pageTrace)
    }

    // § 1005: badness and cost of breaking at index i with penalty pi; true when the page is cut
    const consider = (pi: number, i: number): boolean => {
      let b: number
      if (total < goal) b = stretch[1] || stretch[2] || stretch[3] ? 0 : badness(goal - total, stretch[0])
      else if (total - goal > shrink) b = AWFUL_BAD
      else b = badness(total - goal, shrink)
      let c: number
      if (b < AWFUL_BAD) c = pi <= EJECT_PENALTY ? pi : b < INF_BAD ? b + pi + insertPenalties : DEPLORABLE
      else c = b
      if (insertPenalties >= 10000) c = AWFUL_BAD
      const best = c <= least
      pageTrace!.candidates.push(candidate(total, stretch, shrink, goal, b, pi, c, best))
      if (best) {
        bestBreak = i; bestSize = goal; least = c
        for (const r of pageIns) r.bestIns = r.lastIns
      }
      return c === AWFUL_BAD || pi <= EJECT_PENALTY
    }
    const refill = () => { const extra = p.more?.(pages[pages.length - 1]); if (!extra?.length) return false; queue.push(...extra); return true }
    for (let i = 0; ; i++) {
      if (i >= queue.length && !refill()) break
      const n = queue[i]
      const at = indexOf.get(n)
      if (at !== undefined && at > furthest) { furthest = at; p.reached?.(at) }
      if (n.kind === "whatsit" && n.hook) { queue.splice(i--, 1, ...(p.hook?.(n.hook, contents !== BOX_THERE) ?? [])); continue }
      if (n.kind === "whatsit" && n.float) {
        // the -\@Miv and -\@Miii penalties fire the output routine (their pages are not output, and
        // TeX's \tracingpages shows them with those penalties); what it returns comes first, then the
        // \penalty10000 left from the -\@Miii break, then the rest. On a page already too full the
        // -\@Miv break costs awful_bad: the page is cut at its best break, and the float comes after
        if (!p.float) throw new Error("page builder: a float, but no output routine for floats")
        if (contents === BOX_THERE && consider(-10004, i) && bestBreak !== i) { fire(); fired = true; break }
        // fire_up moves the page's insertions into their boxes first (§§ 1018–1021, all of them: the
        // break is at the end of the page)
        // fire_up at the float's penalty: the page's insertions go to their boxes, and \@holdpg keeps the
        // rest. A split insertion's remainder waits on the page of LaTeX's \vbox{} (\vsize is \maxdimen
        // there), and the \penalty-\@Miii break puts it in its box after the part already there
        for (const r of pageIns) { r.bestIns = r.lastIns; if (r.bestIns) regs[r.n] ??= [] }
        const { nodes: held, held: waiting } = takeInserts(page, regs)
        for (const w of waiting) {
          const box = regs[w.n] ??= []
          const b = vpack(box.slice())
          if (box.length && b.height + b.depth + w.height > insClass(w.n).dimen) throw new Error("page builder: a float's insertion split again")
          box.push(...w.list)
        }
        // (TeX's trace of this output stays when the break cost awful_bad, as the first break of a page already too
        // full: documentPages keeps such pages)
        if (pageTrace && trace[trace.length - 1]?.candidates.at(-1)?.cost !== null) trace.pop()
        queue = [...p.float(held, n, regs), { kind: "penalty", penalty: INF_PENALTY }, ...queue.slice(i + 1)]
        restarted = true
        break
      }
      let pi: number | null = null
      switch (n.kind) {
        case "hlist": case "vlist": case "rule":
          if (contents < BOX_THERE) {
            // § 1001: \topskip glue before the first box
            if (contents === EMPTY) freeze(BOX_THERE); else contents = BOX_THERE
            const h = n.height ?? 0
            const t = paramGlue("topskip", mkGlue(p.topSkip.width > h ? p.topSkip.width - h : 0, p.topSkip.stretch, p.topSkip.stretchOrder, p.topSkip.shrink, p.topSkip.shrinkOrder))
            queue.splice(i, 0, t)
            i--
            continue
          }
          total += depth + (n.height ?? 0); depth = n.depth ?? 0
          break
        case "whatsit": break
        case "glue":
          if (contents < BOX_THERE) { queue.splice(i--, 1); continue } // done1: discarded
          if (precedesBreak(page[page.length - 1])) pi = 0
          break
        case "kern":
          if (contents < BOX_THERE) { queue.splice(i--, 1); continue }
          if (i + 1 >= queue.length && !refill()) return finish() // § 1000: wait for what follows
          if (queue[i + 1].kind === "glue") pi = 0
          break
        case "penalty":
          if (contents < BOX_THERE) { queue.splice(i--, 1); continue }
          pi = n.penalty
          break
        case "ins": { // § 1008
          if (contents === EMPTY) freeze(INSERTS_ONLY)
          const c = insClass(n.n)
          let r = pageIns.find((x) => x.n === n.n)
          if (!r) { // § 1009: the glue correction for box n
            r = { n: n.n, splitUp: false, height: 0, lastIns: null, bestIns: null, brokenIns: null, brokenAt: null }
            if (regs[n.n]?.length) { const b = vpack(regs[n.n].slice()); r.height = b.height + b.depth } // box n is not void
            pageIns.push(r); pageIns.sort((a, b) => a.n - b.n)
            const h = c.count === 1000 ? r.height : xOverN(r.height, 1000) * c.count
            goal -= h + c.skip.width
            stretch[c.skip.stretchOrder] += c.skip.stretch; shrink += c.skip.shrink
            if (c.skip.shrinkOrder !== 0 && c.skip.shrink !== 0) throw new Error(`Infinite glue shrinkage inserted from \\skip${n.n}`)
          }
          if (r.splitUp) insertPenalties += n.floatCost
          else {
            r.lastIns = n
            const delta = goal - total - depth + shrink // this much room is left if we shrink the maximum
            const h = c.count === 1000 ? n.height : xOverN(n.height, 1000) * c.count // this much room is needed
            if ((h <= 0 || h <= delta) && n.height + r.height <= c.dimen) { goal -= h; r.height += n.height }
            else { // § 1010: split the insertion
              let w: number
              if (c.count <= 0) w = MAX_DIMEN
              else { w = goal - total - depth; if (c.count !== 1000) w = xOverN(w, c.count) * 1000 }
              if (w > c.dimen - r.height) w = c.dimen - r.height
              const vb = vertBreak(n.list, w, n.depth)
              r.height += vb.bestHeightPlusDepth
              pageTrace!.splits.push(`split${n.n} to ${printScaled(w)},${printScaled(vb.bestHeightPlusDepth)} p=${vb.at === null ? EJECT_PENALTY : n.list[vb.at].kind === "penalty" ? (n.list[vb.at] as { penalty: number }).penalty : 0}`)
              const bhd = c.count !== 1000 ? xOverN(vb.bestHeightPlusDepth, 1000) * c.count : vb.bestHeightPlusDepth
              goal -= bhd
              r.splitUp = true; r.brokenAt = vb.at; r.brokenIns = n
              if (vb.at === null) insertPenalties += EJECT_PENALTY
              else { const q = n.list[vb.at]; if (q.kind === "penalty") insertPenalties += q.penalty }
            }
          }
          break // contribute
        }
        default: throw new Error(`page builder: ${n.kind} in a vertical list`)
      }

      if (pi !== null && pi < INF_PENALTY && consider(pi, i)) { fire(); fired = true; break }

      if (n.kind === "glue" || n.kind === "kern") {
        // § 1004: update the heights
        if (n.kind === "glue") {
          stretch[n.stretchOrder] += n.stretch; shrink += n.shrink
          if (n.shrinkOrder !== 0 && n.shrink !== 0) throw new Error("Infinite glue shrinkage found on current page")
        }
        total += depth + n.width; depth = 0
      }
      // § 1003: contribute, keeping page_depth within page_max_depth
      if (depth > maxDepth) { total += depth - maxDepth; depth = maxDepth }
      page.push(n)
    }
    if (restarted) continue
    if (!fired) return finish()

    // §§ 1018–1022: insertions before the break go to their boxes, split if called for, or wait for the next page
    function takeInserts(list: Node[], boxes: Record<number, Node[]>) {
      const held: InsNode[] = []
      const nodes: Node[] = []
      for (const n of list) {
        if (n.kind !== "ins") { nodes.push(n); continue }
        const r = pageIns.find((x) => x.n === n.n)!
        let wait: boolean
        if (!r.bestIns) wait = true
        else {
          wait = false
          let material = n.list
          let ins = n
          if (r.bestIns === n) { // § 1021: wrap up box n, splitting n if called for
            if (r.splitUp && r.brokenIns === n && r.brokenAt !== null) {
              material = n.list.slice(0, r.brokenAt)
              const remainder = prunePageTop(n.list.slice(r.brokenAt), n.splitTopSkip)
              if (remainder.length) {
                const v = vpack(remainder)
                ins = { ...n, list: remainder, height: v.height + v.depth }
                wait = true
              }
            }
            r.bestIns = null
          }
          boxes[n.n].push(...material)
          if (wait) held.push(ins)
          continue
        }
        held.push(n)
      }
      return { nodes, held }
    }
    function fire() {
      // § 1013: the penalty at the best break becomes 10000 and is kept with the rest
      const bp = queue[bestBreak]
      const outputPenalty = bp && bp.kind === "penalty" ? bp.penalty : INF_PENALTY
      const rest = queue.slice(bestBreak)
      if (bp && bp.kind === "penalty") rest[0] = { kind: "penalty", penalty: INF_PENALTY }
      // §§ 1018–1022: insertions before the break go to their boxes or wait for the next page
      const boxes: Record<number, Node[]> = {}
      for (const [k, l] of Object.entries(regs)) if (l.length) boxes[Number(k)] = l.slice()
      for (const r of pageIns) if (r.bestIns) boxes[r.n] ??= []
      const { nodes, held } = takeInserts(queue.slice(0, bestBreak), boxes)
      const out: Page = { nodes, goal: bestSize, outputPenalty, inserts: boxes }
      pages.push(out)
      regs = {} // the output routine empties the insertion boxes
      const material = p.output?.(out) ?? []
      // § 1026: held-over insertions go back first, then the output routine's material, then the rest
      queue = [...held, ...material, ...rest]
    }
    function finish() {
      // material left without a break (whatsits alone, such as a \write put back at the very end, make no page)
      if (page.some((n) => n.kind !== "whatsit")) pages.push({ nodes: page, goal, outputPenalty: INF_PENALTY, inserts: {} })
      return { pages, trace }
    }
  }
}

/** x_over_n (§ 106), quotient only, truncating toward zero */
const xOverN = (x: number, n: number) => Math.trunc(x / n)

/**
 * vert_break (§§ 970–977): the best place to break a vertical list for height h
 * and maximum depth d. `at` is the index of the break node, or null for the
 * end of the list; `bestHeightPlusDepth` is the natural size above it.
 */
export function vertBreak(list: Node[], h: number, d: number): { at: number | null; bestHeightPlusDepth: number } {
  const active = [0, 0, 0, 0, 0, 0] // height, stretch normal/fil/fill/filll, shrink
  let prevDp = 0, leastCost = AWFUL_BAD, bestPlace: number | null = null, bestHPD = 0
  let prev: Node | undefined // an initial glue node is not a legal breakpoint
  for (let i = 0; ; i++) {
    const n = list[i]
    let pi: number | null
    let glueOrKern = false
    if (!n) pi = EJECT_PENALTY
    else {
      pi = null
      switch (n.kind) {
        case "hlist": case "vlist": case "rule": active[0] += prevDp + (n.height ?? 0); prevDp = n.depth ?? 0; break
        case "whatsit": case "ins": break
        case "glue": if (precedesBreak(prev)) pi = 0; glueOrKern = true; break
        case "kern": { const nx = list[i + 1]; if (!nx || nx.kind === "glue") pi = nx ? 0 : null; glueOrKern = true; break }
        case "penalty": pi = n.penalty; break
        default: throw new Error(`vert_break: ${n.kind} in a vertical list`)
      }
    }
    // § 974
    if (pi !== null && pi < INF_PENALTY) {
      let b: number
      if (active[0] < h) b = active[2] || active[3] || active[4] ? 0 : badness(h - active[0], active[1])
      else if (active[0] - h > active[5]) b = AWFUL_BAD
      else b = badness(active[0] - h, active[5])
      if (b < AWFUL_BAD) b = pi <= EJECT_PENALTY ? pi : b < INF_BAD ? b + pi : DEPLORABLE
      if (b <= leastCost) { bestPlace = n ? i : null; leastCost = b; bestHPD = active[0] + prevDp }
      if (b === AWFUL_BAD || pi <= EJECT_PENALTY) break
    }
    if (n && glueOrKern) { // § 976
      if (n.kind === "glue") {
        active[1 + n.stretchOrder] += n.stretch; active[5] += n.shrink
        if (n.shrinkOrder !== 0 && n.shrink !== 0) throw new Error("Infinite glue shrinkage found in box being split")
      }
      active[0] += prevDp + (n as GlueNode | KernNode).width; prevDp = 0
    }
    if (prevDp > d) { active[0] += prevDp - d; prevDp = d } // not_found
    prev = n
  }
  return { at: bestPlace, bestHeightPlusDepth: bestHPD }
}

/** prune_page_top (§ 968): drop glue, kerns and penalties before the first box, which gets \\splittopskip glue. */
export function prunePageTop(list: Node[], splitTopSkip: GlueNode): Node[] {
  const out: Node[] = []
  for (let i = 0; i < list.length; i++) {
    const n = list[i]
    if (n.kind === "hlist" || n.kind === "vlist" || n.kind === "rule") {
      const h = n.height ?? 0
      out.push(paramGlue("splittopskip", mkGlue(splitTopSkip.width > h ? splitTopSkip.width - h : 0, splitTopSkip.stretch, splitTopSkip.stretchOrder, splitTopSkip.shrink, splitTopSkip.shrinkOrder)), ...list.slice(i))
      return out
    }
    if (n.kind === "whatsit" || n.kind === "ins") out.push(n)
    else if (n.kind !== "glue" && n.kind !== "kern" && n.kind !== "penalty") throw new Error("pruning")
  }
  return out
}

/** "% t=… g=… b=… p=… c=…#" (§§ 985, 1006). */
function candidate(total: number, stretch: number[], shrink: number, goal: number, b: number, pi: number, c: number, best: boolean): PageCandidate {
  const plus = [["", 0], ["fil", 1], ["fill", 2], ["filll", 3]].filter(([, o]) => stretch[o as number] !== 0).map(([s, o]) => `plus ${printScaled(stretch[o as number])}${s}`).join(" ")
  return {
    t: total, tPlus: plus, tMinus: shrink !== 0 ? `minus ${printScaled(shrink)}` : "", goal,
    badness: b >= AWFUL_BAD ? null : b, penalty: pi, cost: c >= AWFUL_BAD ? null : c, best,
  }
}
