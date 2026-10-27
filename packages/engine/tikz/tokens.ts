// TeX tokens as pgfkeys and TikZ's macros see them. pgfkeys works on token lists: it splits a key list at
// commas and each item at `=` as delimited macro arguments do (braces hide delimiters, a control sequence is
// one token), strips a group that is a whole argument, and removes one blank on each side (\pgfkeys@spdef).
// TikZ's own parsers (dash patterns, `of` in the positioning library, arrow specifications) are delimited
// arguments too. A token here is a string: a control sequence is `\` and its name, every other token one
// character (a space is " ", whatever produced it).

import { Unsupported } from "../latex/unsupported"

export type Tok = string
export type Toks = readonly Tok[]

const isLetter = (c: string, atLetter: boolean) => /^[A-Za-z]$/.test(c) || (atLetter && c === "@")

/**
 * TeX's input processor: a control word swallows the blanks after it, a run of blanks is one space, an end
 * of line is a space, `%` drops the rest of the line and the next line's leading blanks. `atLetter` is
 * \makeatletter (pgf's own sources). A blank line (\par) is not something an option list holds.
 */
export function tokenize(src: string, atLetter = false): Tok[] {
  const out: Tok[] = []
  // TeX's states (§ 303): M mid-line, S skipping blanks, N at the start of a line
  let state: "M" | "S" | "N" = "M"
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === "\\") {
      let j = i + 1
      if (j >= src.length) throw new Unsupported("tikz: a backslash ends the text")
      if (isLetter(src[j], atLetter)) {
        while (j < src.length && isLetter(src[j], atLetter)) j++
        out.push(src.slice(i, j))
        state = "S"
      } else {
        out.push(src.slice(i, j + 1))
        state = src[j] === " " ? "S" : "M"
        j++
      }
      i = j - 1
      continue
    }
    if (c === "%") {
      while (i + 1 < src.length && src[i + 1] !== "\n") i++
      i++ // the line end goes with the comment
      state = "N"
      continue
    }
    if (c === "\n") {
      if (state === "N") throw new Unsupported("tikz: a blank line in an option list")
      if (state === "M") out.push(" ")
      state = "N"
      continue
    }
    if (c === " " || c === "\t" || c === "\r") {
      if (state === "M") { out.push(" "); state = "S" }
      continue
    }
    state = "M"
    out.push(c)
  }
  return out
}

export const isCs = (t: Tok) => t.length > 1 && t[0] === "\\"

/** the tokens as a string (for text with no control sequences: numbers, names) */
export const str = (t: Toks) => t.join("")

/** the end of the group opened at `i` (`{` there), or -1 */
export function groupEnd(t: Toks, i: number): number {
  let depth = 0
  for (let j = i; j < t.length; j++) {
    if (t[j] === "{") depth++
    else if (t[j] === "}" && --depth === 0) return j
  }
  return -1
}

/** where `delim` begins at brace level 0 at or after `from`, or -1 (a delimited argument's end) */
export function find(t: Toks, delim: Toks, from = 0): number {
  for (let i = from; i < t.length; i++) {
    if (t[i] === "{") {
      const e = groupEnd(t, i)
      if (e < 0) throw new Unsupported("tikz: unbalanced braces")
      i = e
      continue
    }
    if (t[i] === "}") throw new Unsupported("tikz: unbalanced braces")
    if (delim.every((d, k) => t[i + k] === d)) return i
  }
  return -1
}

/** a delimited argument as TeX hands it over: without its braces when it is one group */
export function arg(t: Toks): Tok[] {
  if (t.length >= 2 && t[0] === "{" && groupEnd(t, 0) === t.length - 1) return t.slice(1, -1)
  return [...t]
}

/** the pieces between occurrences of `delim` at brace level 0 */
export function splitAll(t: Toks, delim: Toks): Tok[][] {
  const out: Tok[][] = []
  let from = 0
  for (;;) {
    const i = find(t, delim, from)
    if (i < 0) { out.push(t.slice(from)); return out }
    out.push(t.slice(from, i))
    from = i + delim.length
  }
}

/**
 * \pgfkeys@spdef: one leading blank and one trailing blank removed, and a group that is then the whole
 * text unbraced: twice when a trailing blank went (\pgfkeys@sp@b's argument, then \pgfkeys@sp@c's).
 */
export function spdef(t: Toks): Tok[] {
  let x: Tok[] = t[0] === " " ? t.slice(1) : [...t]
  if (x.length > 0 && x[x.length - 1] === " ") x = arg(x.slice(0, -1))
  return arg(x)
}

/** a macro's body with #1 replaced by the argument and ## by # (the replacement text of a one-parameter macro) */
export function substitute(body: Toks, a: Toks): Tok[] {
  const out: Tok[] = []
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "#") { out.push(body[i]); continue }
    const n = body[++i]
    if (n === "#") out.push("#")
    else if (n === "1") out.push(...a)
    else throw new Unsupported(`tikz: parameter #${n ?? ""} in a key's code`)
  }
  return out
}

/** the text as \meaning shows it: a control word followed by a space, a parameter character doubled */
export function meaning(t: Toks, atLetter = true): string {
  return t.map((x) => {
    if (x === "#") return "##"
    if (!isCs(x)) return x
    const name = x.slice(1)
    return name.length > 1 || isLetter(name, atLetter) ? `${x} ` : x
  }).join("")
}

export const same = (a: Toks, b: Toks) => a.length === b.length && a.every((x, i) => x === b[i])

/** pgf's \pgfutil@in@: whether `needle` occurs in the tokens at brace level 0 */
export const contains = (t: Toks, needle: Toks) => find(t, needle) >= 0

/** text with no control sequence or group, for pgfmath and names; anything else is not modeled */
export function plain(t: Toks, what: string): string {
  if (t.some((x) => isCs(x) || x === "{" || x === "}" || x === "#" || x === "~")) throw new Unsupported(`tikz: ${what} "${meaning(t, false)}"`)
  return str(t)
}
