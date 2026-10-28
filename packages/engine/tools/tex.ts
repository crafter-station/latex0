// Where the dev tooling finds TeX. $TEXBIN wins; otherwise the pinned TeX Live
// that packages/engine/tools/install-tex.sh puts in .cache/texlive (what CI uses); otherwise
// MacTeX's location if present; otherwise whatever is on PATH.

import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const MACTEX = "/Library/TeX/texbin"

/** The TeX Live every reference comes from: the final, frozen edition of this year (tools/TEXLIVE). */
export const TEXLIVE = readFileSync(resolve(process.cwd(), "packages/engine/tools/TEXLIVE"), "utf8").trim()
/** Where install-tex.sh puts it. */
const PINNED = resolve(process.cwd(), `.cache/texlive/${TEXLIVE}`)

function pinned(): string {
  const bin = join(PINNED, "bin")
  if (!existsSync(bin)) return ""
  const arch = readdirSync(bin).find((a) => existsSync(join(bin, a, "latex")))
  return arch ? join(bin, arch) : ""
}

export const TEXBIN = process.env.TEXBIN ?? (pinned() || (existsSync(MACTEX) ? MACTEX : ""))

/** The fixed date the oracle compiles at (SOURCE_DATE_EPOCH), so \today never changes a reference. */
export const ORACLE_EPOCH = 1735689600

/** Environment with TeX first on PATH. */
export function texEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...(TEXBIN ? { PATH: `${TEXBIN}:${process.env.PATH ?? ""}` } : {}), ...extra }
}

/** kpsewhich's answer. It sometimes prints nothing while the machine is heavily loaded (seen with several
 *  checks running at once), so an empty answer is asked again a few times before it counts as "not found". */
export function kpsewhich(args: string[], env: NodeJS.ProcessEnv = texEnv()): string {
  for (let attempt = 0; ; attempt++) {
    const out = execFileSync("kpsewhich", args, { env, encoding: "utf8" }).trim()
    if (out || attempt === 4) return out
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * (attempt + 1))
  }
}
