// Colors in the layout: a group that starts with \color (its push goes on the vertical list before the
// paragraph starts), and the colors a listings style sets.

import type { Ctx } from "./context"
import { BODY_DECLARATIONS } from "./paragraph"
import { SIZE_COMMANDS } from "../layout/classdata"
import { COLOR_CMD, colorPush } from "./xcolor"

/** a group that starts a paragraph's text and reads \color in vertical mode still: first in it, or after font
 *  declarations and size commands only (none of them starts the paragraph); \LXcolornopop: one a \\ ends the
 *  paragraph in (vmode.ts) */
const LEAD = `^(\\s*\\{(?:\\s*\\\\(?:${[...BODY_DECLARATIONS, ...SIZE_COMMANDS].join("|")})(?![A-Za-z]))*\\s*\\\\)(color|LXcolornopop)(?![A-Za-z])`
export const LEADING_COLOR = new RegExp(LEAD)
const LEADING_COLOR_ARGS = new RegExp(`${LEAD}\\s*(?:\\[([^\\]{}]*)\\])?\\s*\\{([^{}]*)\\}`)

/** a group that starts with \color before its paragraph does: the push on the vertical list (\set@color's \special
 *  in vertical mode), and the text that knows it (its pop comes where the group ends, \aftergroup\reset@color) */
export function leadingColor(cx: Ctx, text: string): string {
  const { colorSpec, v } = cx
  const m = text.match(LEADING_COLOR_ARGS)!
  v.nodes.push(colorPush(colorSpec(m[4], m[3])))
  return text.replace(LEADING_COLOR, m[2] === "color" ? "$1LXcolorpushed" : "$1LXcolorcarried") // (a \\ in it ends the paragraph: no pop)
}

/** a listings style's \color commands, as their \special texts */
export function styleColors(cx: Ctx, style: string) {
  const { colorSpec } = cx
  return [...style.matchAll(COLOR_CMD)].map((m) => colorSpec(m[2], m[1]))
}
