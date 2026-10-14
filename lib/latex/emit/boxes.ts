// Box-tree emitter: the layout tree in the shared \showbox-style schema.

import type { Node } from "../layout/nodes"
import type { BoxNode as BoxOut } from "../trace/schema"

export function emitBoxes(n: Node): BoxOut {
  switch (n.kind) {
    case "hlist": case "vlist":
      return { type: n.kind === "hlist" ? "hbox" : "vbox", width: n.width, height: n.height, depth: n.depth, shift: n.shift, glueSet: n.glueSet, glueSign: n.glueSign, glueOrder: n.glueOrder, children: n.list.map(emitBoxes) }
    case "char": {
      const lig = n.text.length !== 1 || n.text.charCodeAt(0) !== n.char
      return lig ? { type: "char", font: n.font, size: n.size, char: n.char, lig: n.text } : { type: "char", font: n.font, size: n.size, char: n.char }
    }
    case "glue": {
      const g = { type: "glue" as const, width: n.width, stretch: n.stretch, stretchOrder: n.stretchOrder, shrink: n.shrink, shrinkOrder: n.shrinkOrder }
      return n.param ? { ...g, param: n.param } : g
    }
    case "kern": return n.explicit ? { type: "kern", width: n.width, explicit: true } : { type: "kern", width: n.width }
    case "rule": return { type: "rule", width: n.width, height: n.height, depth: n.depth }
    case "penalty": return { type: "penalty", penalty: n.penalty }
    case "disc": return { type: "disc", pre: n.pre.map(emitBoxes), post: n.post.map(emitBoxes), replaceCount: n.replaceCount }
  }
}
