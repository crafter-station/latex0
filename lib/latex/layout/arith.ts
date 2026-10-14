// TeX's integer arithmetic, bit-exact. "TeX: The Program" §§ 99–108, 571–572.

export const UNITY = 65536 // 1pt in sp
export const INF_PENALTY = 10000

/** Pascal/web2c round: halves go away from zero (zround in texmfmp.c). */
export function texRound(r: number): number {
  if (r > 2147483647) return 2147483647
  if (r < -2147483647) return -2147483647
  return r >= 0 ? Math.floor(r + 0.5) : -Math.floor(-r + 0.5)
}

/** x * n / d with TeX's truncation (§ 107). Throws on arithmetic overflow. */
export function xnOverD(x: number, n: number, d: number): number {
  const positive = x >= 0
  if (!positive) x = -x
  const t = (x % 32768) * n
  let u = Math.floor(x / 32768) * n + Math.floor(t / 32768)
  const v = (u % d) * 32768 + (t % 32768)
  if (Math.floor(u / d) >= 32768) throw new Error("xn_over_d: arithmetic overflow")
  u = 32768 * Math.floor(u / d) + Math.floor(v / d)
  return positive ? u : -u
}

/** Convert a TFM fix_word to sp for a font at size `s` sp (§ 572 store_scaled). */
export function scaled(fix: number, s: number): number {
  let z = s
  let alpha = 16
  while (z >= 0o40000000) { z = Math.floor(z / 2); alpha += alpha }
  const beta = Math.floor(256 / alpha)
  alpha *= z
  const u = fix >>> 0
  const a = u >>> 24, b = (u >>> 16) & 255, c = (u >>> 8) & 255, d = u & 255
  const sw = Math.floor((Math.floor((Math.floor((d * z) / 256) + c * z) / 256) + b * z) / beta)
  if (a === 0) return sw
  if (a === 255) return sw - alpha
  throw new Error(`bad fix_word ${fix}`)
}

/** vet_glue (§ 625): clamp the glue product to ±10^9 before rounding. */
export function vetGlue(g: number): number {
  const BILLION = 1e9
  return g > BILLION ? BILLION : g < -BILLION ? -BILLION : g
}
