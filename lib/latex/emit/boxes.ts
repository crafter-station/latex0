// Box-tree emitter: the layout tree in the shared \showbox-style schema.

import type { Node } from "../layout/nodes"
import type { BoxNode as BoxOut } from "../trace/schema"

export function emitBoxes(n: Node): BoxOut {
  switch (n.kind) {
    case "hlist": case "vlist":
      return { type: n.kind === "hlist" ? "hbox" : "vbox", width: n.width, height: n.height, depth: n.depth, shift: n.shift, glueSet: n.glueSet, glueSign: n.glueSign, glueOrder: n.glueOrder, children: n.list.map(emitBoxes) }
    case "char": return { type: "char", font: n.font, size: n.size, char: n.char }
    case "glue": return { type: "glue", width: n.width, stretch: n.stretch, stretchOrder: n.stretchOrder, shrink: n.shrink, shrinkOrder: n.shrinkOrder }
    case "kern": return { type: "kern", width: n.width }
    case "rule": return { type: "rule", width: n.width, height: n.height, depth: n.depth }
    case "penalty": return { type: "penalty", penalty: n.penalty }
    case "disc": return { type: "disc", pre: n.pre.map(emitBoxes), post: n.post.map(emitBoxes), replaceCount: n.replaceCount }
  }
}
