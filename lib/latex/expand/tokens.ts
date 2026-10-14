// TeX tokens and the input tokenizer, "TeX: The Program" §§ 289–365.
// Characters become (category, code) tokens; control sequences are named; the
// reader's states N/M/S decide what spaces and line ends turn into. Every token
// keeps the source offset it came from, for diagnostics.

export const ESCAPE = 0, LEFT_BRACE = 1, RIGHT_BRACE = 2, MATH_SHIFT = 3, TAB_MARK = 4, CAR_RET = 5, MAC_PARAM = 6,
  SUP_MARK = 7, SUB_MARK = 8, IGNORE = 9, SPACER = 10, LETTER = 11, OTHER_CHAR = 12, ACTIVE_CHAR = 13, COMMENT = 14, INVALID_CHAR = 15

/** A character token, or a control sequence (an active character is a control sequence named by its character). */
export type Tok =
  | { cat: number; c: number; cs?: undefined; active?: undefined; dontExpand?: undefined; pos?: number }
  | { cs: string; active?: boolean; cat?: undefined; c?: undefined; pos?: number; /** \\noexpand'ed (frozen_dont_expand, § 358) */ dontExpand?: boolean }

export const ch = (cat: number, c: number): Tok => ({ cat, c })
export const cs = (name: string): Tok => ({ cs: name })
export const SPACE: Tok = { cat: SPACER, c: 32 }

export function sameTok(a: Tok, b: Tok): boolean {
  if (a.cs !== undefined || b.cs !== undefined) return a.cs === b.cs && !!a.active === !!(b as { active?: boolean }).active
  return a.cat === b.cat && a.c === b.c
}

/** LaTeX's category codes (latex.ltx on top of INITEX, § 232). */
export function latexCatcodes(): Uint8Array {
  const t = new Uint8Array(256).fill(OTHER_CHAR)
  for (let c = 65; c <= 90; c++) t[c] = LETTER
  for (let c = 97; c <= 122; c++) t[c] = LETTER
  t[92] = ESCAPE; t[123] = LEFT_BRACE; t[125] = RIGHT_BRACE; t[36] = MATH_SHIFT; t[38] = TAB_MARK; t[13] = CAR_RET
  t[35] = MAC_PARAM; t[94] = SUP_MARK; t[95] = SUB_MARK; t[0] = IGNORE; t[32] = SPACER; t[9] = SPACER; t[126] = ACTIVE_CHAR
  t[37] = COMMENT; t[127] = INVALID_CHAR; t[12] = ACTIVE_CHAR // ^^L is \outer\par-like in plain; LaTeX makes it active
  return t
}

/** The input reader (§§ 343–356): one line at a time, \endlinechar appended, trailing spaces dropped. */
export class Tokenizer {
  private lines: string[]
  private offsets: number[]
  private line = -1
  private loc = 0
  private buf = ""
  private state: "N" | "M" | "S" = "N"
  constructor(src: string, public catcodes: Uint8Array = latexCatcodes(), public endlinechar = 13) {
    this.lines = src.split(/\r\n|\r|\n/)
    this.offsets = []
    let o = 0
    for (const l of this.lines) { this.offsets.push(o); o += l.length + 1 }
  }

  /** Source offset just past what has been read (the end of the last token, with any spaces a control word skipped). */
  get offset(): number {
    if (this.line < 0) return 0
    if (this.line >= this.lines.length) return this.offsets[this.lines.length - 1] + this.lines[this.lines.length - 1].length
    return this.offsets[this.line] + Math.min(this.loc, this.lines[this.line].length)
  }

  private nextLine(): boolean {
    if (++this.line >= this.lines.length) return false
    this.buf = this.lines[this.line].replace(/ +$/, "") // § 31: trailing spaces are removed
    if (this.endlinechar >= 0 && this.endlinechar < 256) this.buf += String.fromCharCode(this.endlinechar)
    this.loc = 0
    this.state = "N"
    return true
  }

  /** The character at loc after ^^ processing (§ 355): [code, length]. */
  private charAt(i: number): [number, number] {
    const c = this.buf.charCodeAt(i)
    if (this.catcodes[c] === SUP_MARK && this.buf.charCodeAt(i + 1) === c && i + 2 < this.buf.length) {
      const d = this.buf.charCodeAt(i + 2)
      const hex = (x: number) => (x >= 48 && x <= 57) || (x >= 97 && x <= 102)
      if (hex(d) && i + 3 < this.buf.length && hex(this.buf.charCodeAt(i + 3))) return [parseInt(this.buf.slice(i + 2, i + 4), 16), 4]
      if (d < 128) return [d < 64 ? d + 64 : d - 64, 3]
    }
    return [c, 1]
  }

  next(): Tok | null {
    for (;;) {
      if (this.line < 0 || this.loc >= this.buf.length) { if (!this.nextLine()) return null; continue }
      const pos = this.offsets[this.line] + this.loc
      const [c, n] = this.charAt(this.loc)
      this.loc += n
      const cat = this.catcodes[c] ?? OTHER_CHAR
      switch (cat) {
        case ESCAPE: return { ...this.controlSequence(), pos }
        case ACTIVE_CHAR: this.state = "M"; return { cs: String.fromCharCode(c), active: true, pos }
        case CAR_RET: { // § 347: rest of the line is ignored
          const st = this.state
          this.loc = this.buf.length
          if (st === "N") return { cs: "par", pos }
          if (st === "M") return { ...SPACE, pos }
          continue
        }
        case SPACER:
          if (this.state === "M") { this.state = "S"; return { ...SPACE, pos } }
          continue
        case IGNORE: continue
        case COMMENT: this.loc = this.buf.length; continue
        case INVALID_CHAR: throw new Error(`Text line contains an invalid character (line ${this.line + 1})`)
        default:
          this.state = "M"
          return { cat, c, pos }
      }
    }
  }

  /** § 354: a control word swallows the spaces after it; a control symbol does not (unless it is \\ followed by a space char). */
  private controlSequence(): Tok {
    if (this.loc >= this.buf.length) { this.state = "S"; return { cs: "" } } // \ at the very end: empty name (§ 354)
    const [c, n] = this.charAt(this.loc)
    if (this.catcodes[c] !== LETTER) {
      this.loc += n
      this.state = this.catcodes[c] === SPACER ? "S" : "M"
      return { cs: String.fromCharCode(c) }
    }
    let name = ""
    while (this.loc < this.buf.length) {
      const [d, m] = this.charAt(this.loc)
      if (this.catcodes[d] !== LETTER) break
      name += String.fromCharCode(d); this.loc += m
    }
    this.state = "S"
    return { cs: name }
  }
}

/** print_cs (§ 262): \\name, then a space after a control word or a single letter. */
export function printCs(name: string, active = false, escapechar = 92, catcodes = latexCatcodes()): string {
  if (active) return name
  const esc = escapechar >= 0 && escapechar < 256 ? String.fromCharCode(escapechar) : ""
  if (name.length === 0) return esc + "csname" + esc + "endcsname "
  if (name.length === 1) return esc + name + (catcodes[name.charCodeAt(0)] === LETTER ? " " : "")
  return esc + name + " "
}

/** show_token_list (§ 294) for a plain token list: what \\detokenize and \\write print. Parameter chars double. */
export function showTokens(toks: Tok[]): string {
  let out = ""
  for (const t of toks) {
    if (t.cs !== undefined) out += printCs(t.cs, t.active)
    else if (t.cat === MAC_PARAM) out += String.fromCharCode(t.c, t.c)
    else out += String.fromCharCode(t.c)
  }
  return out
}
