// TeX's page builder: build_page and fire_up, "TeX: The Program" §§ 980–1028,
// with insertions (§§ 1008–1010, 1018–1022) and the vertical breaking they
// use to split (vert_break and prune_page_top, §§ 968–979). Marks are not
// modeled. Each page is cut at the best break TeX would choose; insertions on
// it go to their boxes, held-over insertions and the rest of the list return
// to the contribution list, where leading glue, kerns and penalties are
// discarded.

import { printScaled } from "./arith"
import { badness } from "./linebreak"
import { glue as mkGlue, paramGlue, type GlueNode, type InsNode, type KernNode, type Node } from "./nodes"
import { vpack } from "./pack"
import type { PageCandidate, PageTrace } from "../trace/decisions"

const INF_BAD = 10000, INF_PENALTY = 10000, EJECT_PENALTY = -10000
const AWFUL_BAD = 0o7777777777, DEPLORABLE = 100000, MAX_DIMEN = 0o7777777777

/** \\skip n, \\count n and \\dimen n of an insertion class. */
export interface InsertClass { skip: GlueNode; count: number; dimen: number }

export interface PageParams {
  vsize: number
  maxDepth: number
  topSkip: GlueNode
  /** insertion classes by box number (LaTeX's \\footins is 253) */
  inserts?: Record<number, InsertClass>
  /**
   * Called when the contribution list runs out, with the last page output so far:
   * what the output routine contributes next (LaTeX's \clearpage), or null to stop.
   */
  more?: (last: Page | undefined) => Node[] | null
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
    let fired = false

    // § 987
    const freeze = (s: number) => {
      contents = s
      goal = p.vsize; maxDepth = p.maxDepth; depth = 0; total = 0; shrink = 0; stretch.fill(0); least = AWFUL_BAD
      pageTrace = { goal, maxDepth, candidates: [], splits: [] }
      trace.push(pageTrace)
    }

    const refill = () => { const extra = p.more?.(pages[pages.length - 1]); if (!extra?.length) return false; queue.push(...extra); return true }
    for (let i = 0; ; i++) {
      if (i >= queue.length && !refill()) break
      const n = queue[i]
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

      if (pi !== null && pi < INF_PENALTY) {
        // § 1005: badness and cost of breaking here
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
        if (c === AWFUL_BAD || pi <= EJECT_PENALTY) { fire(); fired = true; break }
      }

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
    if (!fired) return finish()

    function fire() {
      // § 1013: the penalty at the best break becomes 10000 and is kept with the rest
      const bp = queue[bestBreak]
      const outputPenalty = bp && bp.kind === "penalty" ? bp.penalty : INF_PENALTY
      const rest = queue.slice(bestBreak)
      if (bp && bp.kind === "penalty") rest[0] = { kind: "penalty", penalty: INF_PENALTY }
      // §§ 1018–1022: insertions before the break go to their boxes or wait for the next page
      const boxes: Record<number, Node[]> = {}
      for (const r of pageIns) if (r.bestIns) boxes[r.n] ??= []
      const held: InsNode[] = []
      const nodes: Node[] = []
      for (const n of queue.slice(0, bestBreak)) {
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
      pages.push({ nodes, goal: bestSize, outputPenalty, inserts: boxes })
      // § 1026: held-over insertions go back first, then the rest of the contributions
      queue = [...held, ...rest]
    }
    function finish() {
      if (page.length) pages.push({ nodes: page, goal, outputPenalty: INF_PENALTY, inserts: {} }) // material left without a break
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
