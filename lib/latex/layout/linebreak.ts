// TeX's paragraph builder: line_break and post_line_break, "TeX: The Program"
// §§ 813–890. Integer-exact port. Delta nodes (§§ 843–844, 860–861) are
// replaced by prefix sums of the same integers, which yields identical widths.
// Inside a formula (between \mathon and \mathoff) glue is not a breakpoint and
// the following word is not hyphenated (auto_breaking, § 866); a formula can
// break at its own penalties, or after \mathoff when glue follows.

import { INF_PENALTY } from "./arith"
import { hyphenateFollowingWord, type HyphenContext } from "./hyphenpass"
import { glue as mkGlue, paramGlue, penalty as mkPenalty, FIL, type BoxNode, type DiscNode, type GlueNode, type Node } from "./nodes"
import { hpack } from "./pack"
import { bestFinal, type ActiveNode, type FeasibleBreak, type ParagraphTrace, type PassTrace } from "../trace/decisions"

const INF_BAD = 10000
const EJECT_PENALTY = -INF_PENALTY
const AWFUL_BAD = 0o7777777777
const VERY_LOOSE = 0, LOOSE = 1, DECENT = 2, TIGHT = 3

export interface LineBreakParams {
  hsize: number
  leftSkip: GlueNode
  rightSkip: GlueNode
  parFillSkip: GlueNode
  pretolerance: number
  tolerance: number
  emergencyStretch: number
  linePenalty: number
  adjDemerits: number
  doubleHyphenDemerits: number
  finalHyphenDemerits: number
  hangIndent: number
  hangAfter: number
  /** \parshape as [indent, length] pairs; empty = none. */
  parShape: [number, number][]
  interLinePenalty: number
  clubPenalty: number
  widowPenalty: number
  brokenPenalty: number
  /** \looseness: try for this many more (or fewer) lines than optimal (§ 875). */
  looseness: number
  /** \prevgraf before the paragraph (0 for a fresh paragraph). */
  prevGraf: number
  hyphenPenalty: number
  exHyphenPenalty: number
  /** Patterns and fonts for second-pass hyphenation; without it the second pass does not hyphenate. */
  hyphenation?: HyphenContext
}

/** LaTeX defaults (latex.ltx, article.cls) for a 10pt document. */
export function latexDefaults(hsize: number): LineBreakParams {
  return {
    hsize, leftSkip: paramGlue("leftskip", mkGlue(0)), rightSkip: paramGlue("rightskip", mkGlue(0)), parFillSkip: paramGlue("parfillskip", mkGlue(0, 65536, FIL)),
    pretolerance: 100, tolerance: 200, emergencyStretch: 0, linePenalty: 10, adjDemerits: 10000,
    doubleHyphenDemerits: 10000, finalHyphenDemerits: 5000, hangIndent: 0, hangAfter: 1, parShape: [],
    interLinePenalty: 0, clubPenalty: 150, widowPenalty: 150, brokenPenalty: 100, looseness: 0, prevGraf: 0,
    hyphenPenalty: 50, exHyphenPenalty: 50,
  }
}

/** badness(t, s), § 108. */
export function badness(t: number, s: number): number {
  if (t === 0) return 0
  if (s <= 0) return INF_BAD
  let r: number
  if (t <= 7230584) r = Math.floor((t * 297) / s)
  else if (s >= 1663497) r = Math.floor(t / Math.floor(s / 297))
  else r = t
  if (r > 1290) return INF_BAD
  return Math.floor((r * r * r + 0o400000) / 0o1000000)
}

// Six running totals, as TeX's do_all_six: [width, stretch normal, fil, fill, filll, shrink]
type Six = [number, number, number, number, number, number]
const zero6 = (): Six => [0, 0, 0, 0, 0, 0]

interface Active { serial: number; line: number; fitness: number; hyphenated: boolean; total: number; start: Six; passive: Passive | null }
interface Passive { serial: number; curBreak: number; prev: Passive | null }

export interface LineBreakResult {
  /** Packed lines, each with its \parshape / hang shift. */
  lines: BoxNode[]
  /** What goes onto the vertical list: lines interleaved with interline penalties (§ 890). */
  vlist: Node[]
  trace: ParagraphTrace
}

/** precedes_break (§ 148): node types that may precede a glue breakpoint. */
function precedesBreak(n: Node): boolean {
  return n.kind === "char" || n.kind === "hlist" || n.kind === "vlist" || n.kind === "rule" || n.kind === "disc" || n.kind === "whatsit"
}

/** Width of a node inside a discretionary list (§§ 841–842, 870). */
function discItemWidth(n: Node): number {
  switch (n.kind) {
    case "char": case "hlist": case "vlist": case "kern": return n.width
    case "rule": return n.width ?? 0
    default: throw new Error(`discretionary list may not contain ${n.kind} (§ 841)`)
  }
}

/** Break `hlist` (a paragraph's horizontal list, without \parfillskip) into lines. */
export function lineBreak(hlist: Node[], p: LineBreakParams): LineBreakResult {
  // § 816: remove a final glue; append \penalty10000 \parfillskip.
  const list = hlist.slice()
  if (list.at(-1)?.kind === "glue") list.pop()
  list.push(mkPenalty(INF_PENALTY), { ...p.parFillSkip })

  // § 827: background = \leftskip + \rightskip
  const background: Six = zero6()
  for (const g of [p.leftSkip, p.rightSkip]) {
    if (g.shrinkOrder !== 0 && g.shrink !== 0) throw new Error("Infinite glue shrinkage found in \\leftskip or \\rightskip")
    background[0] += g.width; background[1 + g.stretchOrder] += g.stretch; background[5] += g.shrink
  }

  // §§ 848–849: line-length parameters
  let lastSpecialLine: number, firstWidth = 0, firstIndent = 0, secondWidth: number, secondIndent: number
  const shape = p.parShape
  if (shape.length === 0) {
    if (p.hangIndent === 0) { lastSpecialLine = 0; secondWidth = p.hsize; secondIndent = 0 }
    else {
      lastSpecialLine = Math.abs(p.hangAfter)
      if (p.hangAfter < 0) {
        firstWidth = p.hsize - Math.abs(p.hangIndent); firstIndent = p.hangIndent >= 0 ? p.hangIndent : 0
        secondWidth = p.hsize; secondIndent = 0
      } else {
        firstWidth = p.hsize; firstIndent = 0
        secondWidth = p.hsize - Math.abs(p.hangIndent); secondIndent = p.hangIndent >= 0 ? p.hangIndent : 0
      }
    }
  } else {
    lastSpecialLine = shape.length - 1
    secondWidth = shape[shape.length - 1][1]; secondIndent = shape[shape.length - 1][0]
  }
  const MAX_HALFWORD = 0xfffffff
  const easyLine = p.looseness === 0 ? lastSpecialLine : MAX_HALFWORD // § 848

  // contribution of a node to the running totals
  const add = (t: Six, n: Node, sign = 1) => {
    switch (n.kind) {
      case "char": case "hlist": case "vlist": case "kern": case "math": t[0] += sign * (n.width ?? 0); break
      case "rule": t[0] += sign * (n.width ?? 0); break
      case "glue":
        if (n.shrinkOrder !== 0 && n.shrink !== 0) throw new Error("Infinite glue shrinkage found in a paragraph")
        t[0] += sign * n.width; t[1 + n.stretchOrder] += sign * n.stretch; t[5] += sign * n.shrink; break
      case "penalty": case "disc": case "whatsit": break
    }
  }

  const passes: PassTrace[] = []
  let threshold = p.pretolerance
  let secondPass: boolean, finalPass: boolean
  let bg = background.slice() as Six
  let pass: PassTrace
  if (threshold >= 0) { secondPass = false; finalPass = false; pass = { pass: "first", feasible: [], nodes: [], text: "" } }
  else { threshold = p.tolerance; secondPass = true; finalPass = p.emergencyStretch <= 0; pass = { pass: "second", feasible: [], nodes: [], text: "" } }

  let bestBet: Active | null = null
  for (;;) {
    passes.push(pass)
    if (threshold > INF_BAD) threshold = INF_BAD
    void secondPass // hyphenation of the following word would start here (§ 891, #113)

    // § 864: the active list starts with one node for the beginning of the paragraph
    let active: Active[] = [{ serial: 0, line: p.prevGraf + 1, fitness: DECENT, hyphenated: false, total: 0, start: zero6(), passive: null }]
    let passNumber = 0
    const totals: Six = zero6() // contributions of nodes before cur_p
    const minimalDemerits = [AWFUL_BAD, AWFUL_BAD, AWFUL_BAD, AWFUL_BAD]
    const bestPlace: (Passive | null)[] = [null, null, null, null]
    const bestPlLine = [0, 0, 0, 0]
    let minimumDemerits = AWFUL_BAD

    // break_width (§ 837): totals at the start of the line that follows a break at cur
    const breakStart = (cur: number, hyphenated: boolean): Six => {
      const s = totals.slice() as Six
      let k = cur
      if (hyphenated && cur < list.length) {
        // § 840: the replaced nodes vanish and the post-break text starts the line
        const d = list[cur] as DiscNode
        for (let t = 1; t <= d.replaceCount; t++) s[0] += discItemWidth(list[cur + t])
        for (const n of d.post) s[0] -= discItemWidth(n)
        if (d.post.length) return s
        k = cur + d.replaceCount + 1 // nodes may be discardable after the break
      }
      for (; k < list.length; k++) {
        const n = list[k]
        if (n.kind === "glue" || n.kind === "penalty" || n.kind === "math") { add(s, n); continue }
        if (n.kind === "kern" && n.explicit) { add(s, n); continue }
        break
      }
      return s
    }

    // try_break (§ 829). `cur` is the index of the break node, or list.length for the end.
    const tryBreak = (pi: number, hyphenated: boolean, cur: number, discWidth = 0) => {
      if (Math.abs(pi) >= INF_PENALTY) { if (pi > 0) return; pi = EJECT_PENALTY }
      let noBreakYet = true
      let start: Six | null = null
      let oldL = 0
      let lineWidth = 0
      let i = 0
      const curWidth = (r: Active): Six => totals.map((t, k) => bg[k] + t - r.start[k] + (k === 0 ? discWidth : 0)) as Six
      for (;;) {
        const r = active[i] // undefined = last_active
        const l = r ? r.line : Infinity
        if (l > oldL) {
          // § 835–836: create new active nodes for the best feasible breaks just found
          if (minimumDemerits < AWFUL_BAD && (oldL !== easyLine || !r)) {
            if (noBreakYet) { noBreakYet = false; start = breakStart(cur, hyphenated) }
            if (Math.abs(p.adjDemerits) >= AWFUL_BAD - minimumDemerits) minimumDemerits = AWFUL_BAD - 1
            else minimumDemerits += Math.abs(p.adjDemerits)
            for (let fit = VERY_LOOSE; fit <= TIGHT; fit++) {
              if (minimalDemerits[fit] <= minimumDemerits) {
                const passive: Passive = { serial: ++passNumber, curBreak: cur, prev: bestPlace[fit] }
                const q: Active = { serial: passNumber, line: bestPlLine[fit] + 1, fitness: fit, hyphenated, total: minimalDemerits[fit], start: start!, passive }
                active.splice(i, 0, q); i++
                pass.nodes.push({ serial: passive.serial, line: q.line - 1, fitness: fit as 0 | 1 | 2 | 3, hyphenated, total: q.total, prev: passive.prev?.serial ?? 0 })
              }
              minimalDemerits[fit] = AWFUL_BAD
            }
            minimumDemerits = AWFUL_BAD
          }
          if (!r) return
          // § 850: line width for line l
          if (l > easyLine) { lineWidth = secondWidth; oldL = MAX_HALFWORD - 1 }
          else {
            oldL = l
            if (l > lastSpecialLine) lineWidth = secondWidth
            else if (shape.length === 0) lineWidth = firstWidth
            else lineWidth = shape[l - 1][1]
          }
        }
        // § 851: consider a line from r to cur
        const w = curWidth(r)
        let artificial = false
        let b: number, fit: number
        const shortfall = lineWidth - w[0]
        if (shortfall > 0) { // § 852
          if (w[2] !== 0 || w[3] !== 0 || w[4] !== 0) { b = 0; fit = DECENT }
          else if (shortfall > 7230584 && w[1] < 1663497) { b = INF_BAD; fit = VERY_LOOSE }
          else { b = badness(shortfall, w[1]); fit = b > 12 ? (b > 99 ? VERY_LOOSE : LOOSE) : DECENT }
        } else { // § 853
          b = -shortfall > w[5] ? INF_BAD + 1 : badness(-shortfall, w[5])
          fit = b > 12 ? TIGHT : DECENT
        }
        let stays: boolean
        let deactivate = false
        if (b > INF_BAD || pi === EJECT_PENALTY) { // § 854
          if (finalPass && minimumDemerits === AWFUL_BAD && active.length === 1 && i === 0) artificial = true
          else if (b > threshold) deactivate = true
          stays = false
        } else {
          stays = true
          if (b > threshold) { i++; continue }
        }
        if (!deactivate) {
          // § 855: record a new feasible break
          let d: number
          if (artificial) d = 0
          else { // § 859
            d = p.linePenalty + b
            d = Math.abs(d) >= 10000 ? 100000000 : d * d
            if (pi !== 0) { if (pi > 0) d += pi * pi; else if (pi > EJECT_PENALTY) d -= pi * pi }
            if (hyphenated && r.hyphenated) d += cur < list.length ? p.doubleHyphenDemerits : p.finalHyphenDemerits
            if (Math.abs(fit - r.fitness) > 1) d += p.adjDemerits
          }
          const at = list[cur]
          const kind: FeasibleBreak["kind"] = cur >= list.length ? "par" : at.kind === "penalty" ? "penalty" : at.kind === "kern" ? "kern" : at.kind === "disc" ? "disc" : at.kind === "math" ? "math" : "glue"
          pass.feasible.push({ kind, via: r.passive?.serial ?? 0, badness: b > INF_BAD ? null : b, penalty: pi, demerits: artificial ? null : d })
          d += r.total
          if (d <= minimalDemerits[fit]) {
            minimalDemerits[fit] = d; bestPlace[fit] = r.passive; bestPlLine[fit] = l
            if (d < minimumDemerits) minimumDemerits = d
          }
          if (stays) { i++; continue }
        }
        // § 860: deactivate r
        active.splice(i, 1)
      }
    }

    // § 866: main loop
    let prev: Node = list[0]
    let autoBreaking = true
    // kern_break: a kern or math node is a breakpoint when glue follows it
    const kernBreak = (k: number) => { const nx = list[k + 1]; if (autoBreaking && nx && nx.kind === "glue") tryBreak(0, false, k) }
    for (let k = 0; k < list.length && active.length > 0; k++) {
      const n = list[k]
      switch (n.kind) {
        case "glue": {
          if (autoBreaking && (precedesBreak(prev) || (prev.kind === "kern" && !prev.explicit))) tryBreak(0, false, k)
          add(totals, n)
          // § 894: in the second pass, hyphenate the word that follows this glue
          if (secondPass && autoBreaking && p.hyphenation) hyphenateFollowingWord(list, k, p.hyphenation)
          prev = n
          continue
        }
        case "kern": if (n.explicit) kernBreak(k); break
        case "penalty": tryBreak(n.penalty, false, k); break
        case "math": autoBreaking = !n.on; kernBreak(k); break
        case "disc": {
          // § 869: try to break after the pre-break text, then skip the replaced nodes
          if (n.pre.length === 0) tryBreak(p.exHyphenPenalty, true, k)
          else tryBreak(p.hyphenPenalty, true, k, n.pre.reduce((w, x) => w + discItemWidth(x), 0))
          for (let t = 1; t <= n.replaceCount; t++) add(totals, list[k + t])
          k += n.replaceCount
          prev = n
          continue
        }
        default: break
      }
      add(totals, n)
      prev = n
    }
    // § 873: try the final line break at the end of the paragraph
    if (active.length > 0) {
      tryBreak(EJECT_PENALTY, true, list.length)
      if (active.length > 0) {
        // §§ 874–875: fewest demerits, then the line count nearest \looseness
        bestBet = bestFinal(active, p.looseness)!
        if (p.looseness === 0 || bestBet.line - bestFinal(active)!.line === p.looseness || finalPass) break
      }
    }
    if (!secondPass) {
      threshold = p.tolerance; secondPass = true; finalPass = p.emergencyStretch <= 0
      pass = { pass: "second", feasible: [], nodes: [], text: "" }
    } else {
      bg = background.slice() as Six; bg[1] += p.emergencyStretch; finalPass = true
      pass = { pass: "emergency", feasible: [], nodes: [], text: "" }
    }
  }

  // chosen path, first line to last
  const breaks: Passive[] = []
  for (let q = bestBet!.passive; q; q = q.prev) breaks.unshift(q)
  const bestLine = bestBet!.line
  const trace: ParagraphTrace = { passes, chosen: breaks.map((b) => b.serial), ...(p.looseness ? { looseness: p.looseness } : {}) }
  return { ...postLineBreak(list, breaks, bestLine, p, { lastSpecialLine, firstWidth, firstIndent, secondWidth, secondIndent }), trace }
}

interface Widths { lastSpecialLine: number; firstWidth: number; firstIndent: number; secondWidth: number; secondIndent: number }

/** post_line_break, §§ 877–890. */
function postLineBreak(list: Node[], breaks: Passive[], bestLine: number, p: LineBreakParams, w: Widths): { lines: BoxNode[]; vlist: Node[] } {
  const lines: BoxNode[] = []
  const vlist: Node[] = []
  let pos = 0
  let carry: Node[] = [] // post-break text that starts the next line (§ 884)
  let curLine = p.prevGraf + 1
  breaks.forEach((brk, bi) => {
    // § 881: modify the end of the line
    let line: Node[] = carry
    carry = []
    let discBreak = false, postDiscBreak = false
    if (brk.curBreak < list.length) {
      const q = list[brk.curBreak]
      line = [...line, ...list.slice(pos, brk.curBreak)]
      if (q.kind === "glue") { line.push({ ...p.rightSkip }); pos = brk.curBreak + 1 }
      else if (q.kind === "disc") {
        // §§ 882–885: the discretionary becomes compulsory
        line.push({ kind: "disc", pre: [], post: [], replaceCount: 0 }, ...q.pre, { ...p.rightSkip })
        carry = [...q.post]
        postDiscBreak = q.post.length > 0
        discBreak = true
        pos = brk.curBreak + 1 + q.replaceCount
      } else {
        line.push(q.kind === "kern" || q.kind === "math" ? { ...q, width: 0 } : q, { ...p.rightSkip })
        pos = brk.curBreak + 1
      }
    } else {
      line = [...line, ...list.slice(pos), { ...p.rightSkip }]
      pos = list.length
    }
    // § 880: \leftskip
    if (p.leftSkip.width !== 0 || p.leftSkip.stretch !== 0 || p.leftSkip.shrink !== 0) line.unshift({ ...p.leftSkip })
    // § 889: width and indent for this line
    let curWidth: number, curIndent: number
    if (curLine > w.lastSpecialLine) { curWidth = w.secondWidth; curIndent = w.secondIndent }
    else if (p.parShape.length === 0) { curWidth = w.firstWidth; curIndent = w.firstIndent }
    else { curWidth = p.parShape[curLine - 1][1]; curIndent = p.parShape[curLine - 1][0] }
    const box = hpack(line, { exactly: curWidth })
    box.shift = curIndent
    lines.push(box)
    vlist.push(box)
    // § 890: interline penalty
    if (curLine + 1 !== bestLine) {
      let pen = p.interLinePenalty
      if (curLine === p.prevGraf + 1) pen += p.clubPenalty
      if (curLine + 2 === bestLine) pen += p.widowPenalty
      if (discBreak) pen += p.brokenPenalty
      if (pen !== 0) vlist.push(mkPenalty(pen))
    }
    curLine++
    // § 879: prune unwanted nodes at the beginning of the next line (not after a post-break text)
    if (!postDiscBreak) {
      const next = breaks[bi + 1]
      while (pos < list.length && (!next || pos !== next.curBreak)) {
        const n = list[pos]
        if (n.kind === "glue" || n.kind === "penalty" || n.kind === "math" || (n.kind === "kern" && n.explicit)) { pos++; continue }
        break
      }
    }
  })
  return { lines, vlist }
}
