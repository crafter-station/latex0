// Liang's hyphenation algorithm exactly as TeX applies it, §§ 919–934.
// Patterns and exceptions are data (packages/engine/data/hyphenation/*.json,
// generated from the pattern files LaTeX's format loads).

export interface HyphenationData {
  format: number
  source: string
  /** Raw patterns as in \patterns, e.g. ".ach4" or "4b1e". */
  patterns: string[]
  /** Raw exceptions as in \hyphenation, e.g. "ta-ble". */
  exceptions: string[]
}

export interface Hyphenator {
  /**
   * hc[1..hn] are lowercase letter codes (lc_code). Returns hyf[0..hn]:
   * odd(hyf[j]) means a hyphen is allowed after letter j (§ 923).
   */
  hyf(hc: number[], lHyf: number, rHyf: number): number[]
}

const BOUNDARY = 0 // TeX maps "." in patterns to 0 and puts 0 at both ends of the word

export function buildHyphenator(data: HyphenationData): Hyphenator {
  // pattern letters (as a string of char codes, "." → \0) → digit array (length letters + 1)
  const patterns = new Map<string, number[]>()
  const prefixes = new Set<string>()
  for (const raw of data.patterns) {
    let letters = ""
    const digits: number[] = [0]
    for (const ch of raw) {
      if (ch >= "0" && ch <= "9") digits[digits.length - 1] = Number(ch)
      else { letters += ch === "." ? "\0" : ch; digits.push(0) }
    }
    if (patterns.has(letters)) throw new Error(`duplicate pattern ${raw}`)
    patterns.set(letters, digits)
    for (let i = 1; i <= letters.length; i++) prefixes.add(letters.slice(0, i))
  }
  const exceptions = new Map<string, number[]>()
  for (const raw of data.exceptions) {
    const positions: number[] = []
    let word = ""
    for (const ch of raw) { if (ch === "-") positions.push(word.length); else word += ch }
    exceptions.set(word, positions)
  }

  return {
    hyf(hcIn, lHyf, rHyf) {
      const hn = hcIn.length - 1
      const hc = [BOUNDARY, ...hcIn.slice(1), BOUNDARY]
      const hyf = new Array<number>(hn + 1).fill(0)
      const word = String.fromCharCode(...hcIn.slice(1))
      const exc = exceptions.get(word)
      if (exc) for (const pos of exc) hyf[pos] = 1 // § 931–932
      else {
        // § 923: patterns may start at positions 0 .. hn - r_hyf + 1
        for (let j = 0; j <= hn - rHyf + 1; j++) {
          let key = ""
          for (let l = j; l <= hn + 1; l++) {
            key += String.fromCharCode(hc[l])
            if (!prefixes.has(key)) break
            const digits = patterns.get(key)
            if (!digits) continue
            for (let i = 0; i < digits.length; i++) {
              const at = j - 1 + i
              if (at >= 0 && at <= hn && digits[i] > hyf[at]) hyf[at] = digits[i]
            }
          }
        }
      }
      // found: (§ 923)
      for (let j = 0; j <= lHyf - 1 && j <= hn; j++) hyf[j] = 0
      for (let j = 0; j <= rHyf - 1 && hn - j >= 0; j++) hyf[hn - j] = 0
      return hyf
    },
  }
}

/** lc_code as LaTeX's format sets it: letters map to lowercase, the hyphen to itself (\lccode`\-=`\-), others to 0. */
export function lcCode(c: number): number {
  return LC_CODES[c] ?? 0
}

/**
 * \lccode as latex.ltx sets it for an 8-bit engine (pdfTeX): a–z and the T1 lowercase ranges "A0–"BC and
 * "E0–"FF are their own; A–Z and the uppercase ranges "80–"9C and "C0–"DF map "20 up; then the OT1 letters
 * ^^Y ^^Z ^^[ (ß æ œ), dotted I (^^9d → i), d-bar (^^9e), the hyphens - and 127, and T1's compound word
 * mark 23. Every character with a nonzero \lccode is a letter to the hyphenation pass, in any font (§ 896).
 */
const LC_CODES: Record<number, number> = (() => {
  const t: Record<number, number> = {}
  const own = (a: number, b: number) => { for (let c = a; c <= b; c++) t[c] = c }
  const up = (a: number, b: number) => { for (let c = a; c <= b; c++) t[c] = c + 0x20 }
  own(97, 122); own(0xa0, 0xbc); own(0xe0, 0xff)
  up(65, 90); up(0x80, 0x9c); up(0xc0, 0xdf)
  t[25] = 25; t[26] = 26; t[0x9d] = 105; t[0x9e] = 0x9e; t[27] = 27; t[45] = 45; t[127] = 127; t[23] = 23
  return t
})()

/** Convenience for tests and tooling: "hyphenation" → "hy-phen-ation". */
export function hyphenateWord(h: Hyphenator, word: string, lHyf = 2, rHyf = 3): string {
  const hc = [0, ...[...word].map((ch) => lcCode(ch.charCodeAt(0)))]
  const hyf = h.hyf(hc, lHyf, rHyf)
  let out = ""
  for (let j = 1; j <= word.length; j++) {
    out += word[j - 1]
    if (j >= lHyf && j <= word.length - rHyf && hyf[j] % 2 === 1) out += "-"
  }
  return out
}
