// Single-pass, char-code based tokenizer. No regex in the hot path, no
// per-character token objects: ordinary text is accumulated into one Text
// token per run. This is the foundation of "super fast".

import { Tok, type Token } from "./types"

// Char codes — comparing numbers beats string comparison in the inner loop.
const BACKSLASH = 92 // \
const OPEN_BRACE = 123 // {
const CLOSE_BRACE = 125 // }
const DOLLAR = 36 // $
const AMP = 38 // &
const PERCENT = 37 // %
const CARET = 94 // ^
const UNDERSCORE = 95 // _
const TILDE = 126 // ~
const NEWLINE = 10 // \n
const CR = 13 // \r
const SPACE = 32
const TAB = 9

function isLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
}

function isSpace(c: number): boolean {
  return c === SPACE || c === TAB || c === NEWLINE || c === CR
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  const len = src.length
  let i = 0
  // Start of the current pending text run; -1 means none open.
  let textStart = -1

  const flushText = (end: number) => {
    if (textStart >= 0 && end > textStart) {
      tokens.push({ kind: Tok.Text, value: src.slice(textStart, end), pos: textStart })
    }
    textStart = -1
  }

  while (i < len) {
    const c = src.charCodeAt(i)

    switch (c) {
      case BACKSLASH: {
        flushText(i)
        const start = i
        i++ // consume backslash
        if (i >= len) {
          tokens.push({ kind: Tok.Command, value: "\\", pos: start })
          break
        }
        const next = src.charCodeAt(i)
        if (isLetter(next)) {
          // \name — greedy letters, then swallow trailing spaces (LaTeX rule).
          let j = i + 1
          while (j < len && isLetter(src.charCodeAt(j))) j++
          const name = src.slice(i, j)
          while (j < len && (src.charCodeAt(j) === SPACE || src.charCodeAt(j) === TAB)) j++
          tokens.push({ kind: Tok.Command, value: name, pos: start })
          i = j
        } else {
          // Control symbol: \\ \{ \} \$ \% \& \_ \# \, \; \! \  \[ \] \( \) etc.
          tokens.push({ kind: Tok.Command, value: src[i], pos: start })
          i++
        }
        break
      }

      case OPEN_BRACE:
        flushText(i)
        tokens.push({ kind: Tok.OpenBrace, value: "", pos: i })
        i++
        break

      case CLOSE_BRACE:
        flushText(i)
        tokens.push({ kind: Tok.CloseBrace, value: "", pos: i })
        i++
        break

      case DOLLAR: {
        flushText(i)
        const start = i
        if (i + 1 < len && src.charCodeAt(i + 1) === DOLLAR) {
          tokens.push({ kind: Tok.Dollar, value: "$$", n: 2, pos: start })
          i += 2
        } else {
          tokens.push({ kind: Tok.Dollar, value: "$", n: 1, pos: start })
          i++
        }
        break
      }

      case AMP:
        flushText(i)
        tokens.push({ kind: Tok.Amp, value: "", pos: i })
        i++
        break

      case CARET:
        flushText(i)
        tokens.push({ kind: Tok.Sup, value: "", pos: i })
        i++
        break

      case UNDERSCORE:
        flushText(i)
        tokens.push({ kind: Tok.Sub, value: "", pos: i })
        i++
        break

      case TILDE:
        // Non-breaking space: emit as a text token carrying a NBSP.
        flushText(i)
        tokens.push({ kind: Tok.Text, value: " ", pos: i })
        i++
        break

      case PERCENT: {
        // Comment to end of line; the newline is consumed too.
        flushText(i)
        let j = i + 1
        while (j < len && src.charCodeAt(j) !== NEWLINE) j++
        // skip the newline itself
        if (j < len) j++
        i = j
        break
      }

      case CR:
      case NEWLINE: {
        // Detect a paragraph break: a blank line (>= 2 newlines, ignoring
        // intervening spaces). Otherwise treat as ordinary inter-word space.
        const runStart = i
        let newlines = 0
        let j = i
        while (j < len) {
          const cc = src.charCodeAt(j)
          if (cc === NEWLINE) {
            newlines++
            j++
          } else if (cc === CR || cc === SPACE || cc === TAB) {
            j++
          } else {
            break
          }
        }
        if (newlines >= 2) {
          flushText(runStart)
          tokens.push({ kind: Tok.ParBreak, value: "", pos: runStart })
          i = j
        } else {
          // Keep a single separating space inside the text run.
          if (textStart < 0) textStart = runStart
          i++ // advance one; the rest collapses naturally as text
        }
        break
      }

      default:
        // Ordinary character — extend (or open) the pending text run.
        if (textStart < 0) textStart = i
        i++
        break
    }
  }

  flushText(len)
  tokens.push({ kind: Tok.EOF, value: "", pos: len })
  return tokens
}
