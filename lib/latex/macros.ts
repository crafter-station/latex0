// Macro expansion pre-pass. Runs on the raw source before tokenization:
// collects \newcommand / \renewcommand / \providecommand / \def definitions,
// removes them, then expands uses (with #1..#9 substitution) until stable.
//
// Deliberately source-level and pragmatic — it handles the common forms, not
// TeX's full \def delimiter machinery.

interface Macro {
  nargs: number
  optional?: string // default for the first arg, if it is optional
  body: string
}

const MAX_PASSES = 50
const MAX_LEN = 5_000_000 // runaway guard

const isLetter = (c: string) => c >= "a" && c <= "z" || c >= "A" && c <= "Z"
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r"
const isDigit = (c: string) => c >= "0" && c <= "9"

function skipSpaces(s: string, i: number): number {
  while (i < s.length && isSpace(s[i])) i++
  return i
}

/** Read a control sequence starting at a backslash: \name or \<symbol>. */
function readCtrl(s: string, i: number): { name: string; end: number } {
  let j = i + 1
  if (j < s.length && isLetter(s[j])) {
    while (j < s.length && isLetter(s[j])) j++
    return { name: s.slice(i + 1, j), end: j }
  }
  return { name: s[i + 1] ?? "", end: Math.min(i + 2, s.length) }
}

/** Read a brace group; s[i] must be '{'. Returns inner content + index past '}'. */
function readGroup(s: string, i: number): { content: string; end: number } {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") {
      j++ // skip escaped char
      continue
    }
    if (s[j] === "{") depth++
    else if (s[j] === "}" && --depth === 0) return { content: s.slice(i + 1, j), end: j + 1 }
  }
  return { content: s.slice(i + 1), end: s.length }
}

/** Read a bracket group [..]; s[i] must be '['. */
function readBracket(s: string, i: number): { content: string; end: number } {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === "[") depth++
    else if (s[j] === "]" && --depth === 0) return { content: s.slice(i + 1, j), end: j + 1 }
  }
  return { content: s.slice(i + 1), end: s.length }
}

function parseNewcommand(s: string, pos: number): { name: string; macro: Macro; end: number } | null {
  let i = skipSpaces(s, pos)
  if (s[i] === "*") i = skipSpaces(s, i + 1)
  // name as {\foo} or \foo
  let name = ""
  if (s[i] === "{") {
    const g = readGroup(s, i)
    const cw = readCtrl(g.content.trim(), 0)
    name = cw.name
    i = g.end
  } else if (s[i] === "\\") {
    const cw = readCtrl(s, i)
    name = cw.name
    i = cw.end
  } else return null

  i = skipSpaces(s, i)
  let nargs = 0
  let optional: string | undefined
  if (s[i] === "[") {
    const o = readBracket(s, i)
    nargs = parseInt(o.content, 10) || 0
    i = skipSpaces(s, o.end)
    if (s[i] === "[") {
      const d = readBracket(s, i)
      optional = d.content
      i = skipSpaces(s, d.end)
    }
  }
  if (s[i] !== "{") return null
  const b = readGroup(s, i)
  return { name, macro: { nargs, optional, body: b.content }, end: b.end }
}

function parseDef(s: string, pos: number): { name: string; macro: Macro; end: number } | null {
  let i = skipSpaces(s, pos)
  if (s[i] !== "\\") return null
  const cw = readCtrl(s, i)
  i = cw.end
  // param text up to '{': count #N (delimited params unsupported)
  let nargs = 0
  while (i < s.length && s[i] !== "{") {
    if (s[i] === "#" && isDigit(s[i + 1])) {
      nargs = Math.max(nargs, +s[i + 1])
      i += 2
    } else i++
  }
  if (s[i] !== "{") return null
  const b = readGroup(s, i)
  return { name: cw.name, macro: { nargs, body: b.content }, end: b.end }
}

/** Copy a '%' comment (to end of line) verbatim without parsing it. */
function copyComment(s: string, i: number): { text: string; end: number } {
  let j = i
  while (j < s.length && s[j] !== "\n") j++
  return { text: s.slice(i, j), end: j }
}

const DEF_CMDS = new Set(["newcommand", "renewcommand", "providecommand"])

function extractDefs(src: string, macros: Record<string, Macro>): string {
  let out = ""
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === "%") {
      const cm = copyComment(src, i)
      out += cm.text
      i = cm.end
      continue
    }
    if (c === "\\") {
      const cw = readCtrl(src, i)
      if (DEF_CMDS.has(cw.name)) {
        const def = parseNewcommand(src, cw.end)
        if (def) {
          macros[def.name] = def.macro
          i = def.end
          continue
        }
      } else if (cw.name === "def") {
        const def = parseDef(src, cw.end)
        if (def) {
          macros[def.name] = def.macro
          i = def.end
          continue
        }
      }
      out += src.slice(i, cw.end)
      i = cw.end
      continue
    }
    out += c
    i++
  }
  return out
}

function substitute(body: string, args: string[]): string {
  let out = ""
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "#") {
      const nx = body[i + 1]
      if (nx === "#") {
        out += "#"
        i++
      } else if (nx >= "1" && nx <= "9") {
        out += args[+nx - 1] ?? ""
        i++
      } else out += "#"
    } else out += body[i]
  }
  return out
}

function expandOnce(s: string, macros: Record<string, Macro>): { out: string; changed: boolean } {
  let out = ""
  let i = 0
  let changed = false
  while (i < s.length) {
    const c = s[i]
    if (c === "%") {
      const cm = copyComment(s, i)
      out += cm.text
      i = cm.end
      continue
    }
    if (c === "\\") {
      const cw = readCtrl(s, i)
      const m = macros[cw.name]
      if (m) {
        let j = cw.end
        const args: string[] = []
        let start = 0
        if (m.optional !== undefined) {
          j = skipSpaces(s, j)
          if (s[j] === "[") {
            const o = readBracket(s, j)
            args.push(o.content)
            j = o.end
          } else args.push(m.optional)
          start = 1
        }
        for (let k = start; k < m.nargs; k++) {
          j = skipSpaces(s, j)
          if (s[j] === "{") {
            const g = readGroup(s, j)
            args.push(g.content)
            j = g.end
          } else if (s[j] === "\\") {
            const c2 = readCtrl(s, j)
            args.push(s.slice(j, c2.end))
            j = c2.end
          } else if (j < s.length) {
            args.push(s[j])
            j++
          } else args.push("")
        }
        if (m.nargs === 0) j = skipSpaces(s, j) // control words gobble trailing space
        out += substitute(m.body, args)
        i = j
        changed = true
        continue
      }
      out += s.slice(i, cw.end)
      i = cw.end
      continue
    }
    out += c
    i++
  }
  return { out, changed }
}

/** Expand user macros in LaTeX source. Returns source with defs removed. */
export function expandMacros(src: string): string {
  const macros: Record<string, Macro> = {}
  let s = extractDefs(src, macros)
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const { out, changed } = expandOnce(s, macros)
    s = out
    if (!changed || s.length > MAX_LEN) break
  }
  return s
}
