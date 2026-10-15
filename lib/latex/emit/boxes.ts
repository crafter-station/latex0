// Box-tree emitter: the layout tree in the shared \showbox-style schema.

import { printScaled } from "../layout/arith"
import type { Node } from "../layout/nodes"
import type { BoxNode as BoxOut } from "../trace/schema"

export function emitBoxes(n: Node): BoxOut {
  switch (n.kind) {
    case "hlist": case "vlist":
      return { type: n.kind === "hlist" ? "hbox" : "vbox", width: n.width, height: n.height, depth: n.depth, shift: n.shift, glueSet: n.glueSet, glueSign: n.glueSign, glueOrder: n.glueOrder, children: n.list.map(emitBoxes), ...(n.display ? { display: true } : {}) }
    case "char": {
      // show_box (§ 193): "(ligature |ff|)", with | for the left and right boundary
      const lig = n.ligature || n.text.length !== 1 || n.text.charCodeAt(0) !== n.char
      const hits = n.ligHits ?? 0
      return lig ? { type: "char", font: n.font, size: n.size, char: n.char, lig: (hits > 1 ? "|" : "") + n.text + (hits % 2 ? "|" : "") } : { type: "char", font: n.font, size: n.size, char: n.char }
    }
    case "glue": {
      if (n.leaders) { // § 189: \leaders and the spec, then the box
        const spec = printScaled(n.width) + (n.stretch ? ` plus ${printScaled(n.stretch)}${["", "fil", "fill", "filll"][n.stretchOrder]}` : "") + (n.shrink ? ` minus ${printScaled(n.shrink)}${["", "fil", "fill", "filll"][n.shrinkOrder]}` : "")
        return { type: "other", text: `\\${n.leaders.kind} ${spec}`, children: [emitBoxes(n.leaders.box)] }
      }
      const g = { type: "glue" as const, width: n.width, stretch: n.stretch, stretchOrder: n.stretchOrder, shrink: n.shrink, shrinkOrder: n.shrinkOrder }
      return n.param ? { ...g, param: n.param } : g
    }
    case "kern": return n.explicit ? { type: "kern", width: n.width, explicit: true } : { type: "kern", width: n.width }
    case "rule": return { type: "rule", width: n.width, height: n.height, depth: n.depth }
    case "penalty": return { type: "penalty", penalty: n.penalty }
    case "whatsit": return { type: "other", text: n.text }
    case "ins": { // § 188
      const g = n.splitTopSkip, spec = printScaled(g.width) + (g.stretch ? ` plus ${printScaled(g.stretch)}${["", "fil", "fill", "filll"][g.stretchOrder]}` : "") + (g.shrink ? ` minus ${printScaled(g.shrink)}${["", "fil", "fill", "filll"][g.shrinkOrder]}` : "")
      return { type: "other", text: `\\insert${n.n}, natural size ${printScaled(n.height)}; split(${spec},${printScaled(n.depth)}); float cost ${n.floatCost}`, children: n.list.map(emitBoxes) }
    }
    case "math": return { type: "other", text: (n.on ? "\\mathon" : "\\mathoff") + (n.width ? ", surrounded " + printScaled(n.width) : "") }
    case "disc": return { type: "disc", pre: n.pre.map(emitBoxes), post: n.post.map(emitBoxes), replaceCount: n.replaceCount }
    case "adjust": return { type: "other", text: "\\vadjust", children: n.list.map(emitBoxes) } // § 197
  }
}
