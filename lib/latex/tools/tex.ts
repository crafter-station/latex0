// Where the dev tooling finds TeX. $TEXBIN wins; otherwise MacTeX's location if
// present; otherwise whatever is on PATH (Linux, CI).

import { existsSync } from "node:fs"

const MACTEX = "/Library/TeX/texbin"
export const TEXBIN = process.env.TEXBIN ?? (existsSync(MACTEX) ? MACTEX : "")

/** The fixed date the oracle compiles at (SOURCE_DATE_EPOCH), so \today never changes a reference. */
export const ORACLE_EPOCH = 1735689600

/** Environment with TeX first on PATH. */
export function texEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...(TEXBIN ? { PATH: `${TEXBIN}:${process.env.PATH ?? ""}` } : {}), ...extra }
}
