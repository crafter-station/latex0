// Colors in the layout: a group that starts with \color (its push goes on the vertical list before the
// paragraph starts), and the colors a listings style sets.

import type { Ctx } from "./context"
import { COLOR_CMD, colorPush } from "./xcolor"

/** a group that starts with \color before its paragraph does: the push on the vertical list, and the text that knows it */
export function leadingColor(cx: Ctx, text: string): string {
  const { colorSpec, v } = cx
  const m = text.match(/^\s*\{\\color(?![A-Za-z])\s*(?:\[([^\]{}]*)\])?\s*\{([^{}]*)\}/)!
  v.nodes.push(colorPush(colorSpec(m[2], m[1])))
  return text.replace(/^(\s*\{\\)color/, "$1LXcolorpushed")
}

/** a listings style's \color commands, as their \special texts */
export function styleColors(cx: Ctx, style: string) {
  const { colorSpec } = cx
  return [...style.matchAll(COLOR_CMD)].map((m) => colorSpec(m[2], m[1]))
}
