// TeX's page builder: build_page and fire_up, "TeX: The Program" §§ 980–1028,
// for main vertical lists without insertions or marks (tracked in #115). Each
// page is cut at the best break TeX would choose; the rest returns to the
// contribution list, where leading glue, kerns and penalties are discarded.

import { printScaled } from "./arith"
import { badness } from "./linebreak"
import { glue as mkGlue, paramGlue, type GlueNode, type Node } from "./nodes"
import type { PageCandidate, PageTrace } from "../trace/decisions"

const INF_BAD = 10000, INF_PENALTY = 10000, EJECT_PENALTY = -10000
const AWFUL_BAD = 0o7777777777, DEPLORABLE = 100000

export interface PageParams {
  vsize: number
  maxDepth: number
  topSkip: GlueNode
}

export interface Page {
  /** what goes into \box255, in order */
  nodes: Node[]
  /** \pagegoal when the page was cut (best_size) */
  goal: number
  /** \outputpenalty: the penalty at the break, or 10000 for any other break (§ 1013) */
  outputPenalty: number
}

/** precedes_break (§ 148) for vertical lists */
const precedesBreak = (n: Node | undefined) => !!n && (n.kind === "hlist" || n.kind === "vlist" || n.kind === "rule" || n.kind === "whatsit")

/** Break a main vertical list into pages; TeX's \tracingpages decisions come back as `trace`. */
export function buildPages(contrib: Node[], p: PageParams): { pages: Page[]; trace: PageTrace[] } {
  const pages: Page[] = []
  const trace: PageTrace[] = []
  let queue = contrib.slice()

  for (;;) {
    // § 991: an empty page
    const page: Node[] = []
    let boxThere = false
    let goal = 0, maxDepth = 0, total = 0, depth = 0, shrink = 0
    const stretch = [0, 0, 0, 0] // normal, fil, fill, filll
    let least = AWFUL_BAD, bestBreak = -1, bestSize = 0
    let pageTrace: PageTrace | null = null
    let fired = false

    let i = 0
    for (; i < queue.length; i++) {
      const n = queue[i]
      let pi: number | null = null
      switch (n.kind) {
        case "hlist": case "vlist": case "rule":
          if (!boxThere) {
            // § 987 freeze_page_specs, then § 1001: \topskip glue before the first box
            boxThere = true
            goal = p.vsize; maxDepth = p.maxDepth; depth = 0; total = 0; shrink = 0; stretch.fill(0); least = AWFUL_BAD
            pageTrace = { goal, maxDepth, candidates: [], splits: [] }
            trace.push(pageTrace)
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
          if (!boxThere) { queue.splice(i--, 1); continue } // done1: discarded
          if (precedesBreak(page[page.length - 1])) pi = 0
          break
        case "kern":
          if (!boxThere) { queue.splice(i--, 1); continue }
          if (i + 1 >= queue.length) return finish() // § 1000: wait for what follows
          if (queue[i + 1].kind === "glue") pi = 0
          break
        case "penalty":
          if (!boxThere) { queue.splice(i--, 1); continue }
          pi = n.penalty
          break
        default: throw new Error(`page builder: ${n.kind} in a vertical list`)
      }

      if (pi !== null && pi < INF_PENALTY) {
        // § 1005: badness and cost of breaking here
        let b: number
        if (total < goal) b = stretch[1] || stretch[2] || stretch[3] ? 0 : badness(goal - total, stretch[0])
        else if (total - goal > shrink) b = AWFUL_BAD
        else b = badness(total - goal, shrink)
        let c: number
        if (b < AWFUL_BAD) c = pi <= EJECT_PENALTY ? pi : b < INF_BAD ? b + pi : DEPLORABLE
        else c = b
        const best = c <= least
        pageTrace!.candidates.push(candidate(total, stretch, shrink, goal, b, pi, c, best))
        if (best) { bestBreak = i; bestSize = goal; least = c }
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
      // § 1017: the page is everything before the best break; the rest goes back
      const bp = queue[bestBreak]
      const outputPenalty = bp && bp.kind === "penalty" ? bp.penalty : INF_PENALTY
      const rest = queue.slice(bestBreak)
      if (bp && bp.kind === "penalty") rest[0] = { kind: "penalty", penalty: INF_PENALTY }
      pages.push({ nodes: queue.slice(0, bestBreak), goal: bestSize, outputPenalty })
      queue = rest
    }
    function finish() {
      if (page.length) pages.push({ nodes: page, goal, outputPenalty: INF_PENALTY }) // material left without a break
      return { pages, trace }
    }
  }
}

/** "% t=… g=… b=… p=… c=…#" (§§ 985, 1006). */
function candidate(total: number, stretch: number[], shrink: number, goal: number, b: number, pi: number, c: number, best: boolean): PageCandidate {
  const plus = [["", 0], ["fil", 1], ["fill", 2], ["filll", 3]].filter(([, o]) => stretch[o as number] !== 0).map(([s, o]) => `plus ${printScaled(stretch[o as number])}${s}`).join(" ")
  return {
    t: total, tPlus: plus, tMinus: shrink !== 0 ? `minus ${printScaled(shrink)}` : "", goal,
    badness: b >= AWFUL_BAD ? null : b, penalty: pi, cost: c >= AWFUL_BAD ? null : c, best,
  }
}
