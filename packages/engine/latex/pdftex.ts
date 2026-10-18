// pdfTeX's driver where it only renames what dvips's writes: xcolor's color stack. Under dvips a color is a
// \special{color push <model> <values>} and \special{color pop} (dvips.def, xcolor.sty); under pdfTeX the same
// node is \pdfcolorstack 0 push {<fill operator> <stroke operator>} and \pdfcolorstack 0 pop (pdftex.def's
// \set@color and \reset@color, xcolor's PDF color operators), with the boxes around them unchanged. The engine
// builds dvips's and renames them in the pages it ships.

import type { Node } from "../layout/nodes"
import { Unsupported } from "./unsupported"

/** The PDF operators of a dvips color: rgb r g b, gray g, cmyk c m y k */
function operators(spec: string): string {
  const [model, ...v] = spec.trim().split(/\s+/)
  const values = v.join(" ")
  if (model === "rgb" && v.length === 3) return `${values} rg ${values} RG`
  if (model === "gray" && v.length === 1) return `${values} g ${values} G`
  if (model === "cmyk" && v.length === 4) return `${values} k ${values} K`
  throw new Unsupported(`the color ${spec} with the pdftex driver`)
}

/** The color specials in a shipped page as pdfTeX's color stack nodes, in place */
export function pdftexColors(n: Node): void {
  switch (n.kind) {
    case "whatsit": {
      const push = n.text.match(/^\\special\{color push (.*)\}$/)
      if (push) n.text = `\\pdfcolorstack 0 push {${operators(push[1])}}`
      else if (n.text === "\\special{color pop}") n.text = "\\pdfcolorstack 0 pop"
      else if (/^\\special\{color/.test(n.text)) throw new Unsupported(`${n.text} with the pdftex driver`)
      break
    }
    case "hlist": case "vlist": case "ins": case "adjust": n.list.forEach(pdftexColors); break
    case "glue": if (n.leaders && n.leaders.box.kind !== "rule") pdftexColors(n.leaders.box); break
    case "disc": n.pre.forEach(pdftexColors); n.post.forEach(pdftexColors); break
  }
}
