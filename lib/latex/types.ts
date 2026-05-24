// Zero-dependency LaTeX engine — shared types.
// The pipeline is: tokenize() -> parse() -> render().

/** Token kinds emitted by the lexer. Kept as a const-object union for speed. */
export const Tok = {
  Text: 0, // run of ordinary characters
  Command: 1, // \name  or control symbol like \\ \{ \, \[
  OpenBrace: 2, // {
  CloseBrace: 3, // }
  Dollar: 4, // $   (lexer reports n: 1 = inline, 2 = display)
  Amp: 5, // &   column separator
  Sup: 6, // ^
  Sub: 7, // _
  Comment: 8, // % ... (kept only so positions stay accurate; renderer ignores)
  ParBreak: 9, // one or more blank lines
  EOF: 10,
} as const

export type TokKind = (typeof Tok)[keyof typeof Tok]

export interface Token {
  kind: TokKind
  /** Text value, command name, or "$"/"$$" — empty for structural tokens. */
  value: string
  /** For Dollar: 1 (inline) or 2 (display). Unused otherwise. */
  n?: number
  /** Byte offset in the source — powers source-mapped errors later. */
  pos: number
}

/** AST node union. The renderer pattern-matches on `kind`. */
export type Node =
  | TextNode
  | GroupNode
  | CommandNode
  | EnvironmentNode
  | MathNode
  | ScriptNode
  | LineBreakNode
  | ParBreakNode
  | AlignNode

export interface TextNode {
  kind: "text"
  value: string
}

export interface GroupNode {
  kind: "group"
  body: Node[]
}

export interface CommandNode {
  kind: "command"
  name: string
  /** True for the starred form, e.g. \section*. */
  star?: boolean
  /** Optional [..] argument, if present. */
  optional?: Node[]
  /** Mandatory {..} arguments in order. */
  args: Node[][]
}

export interface EnvironmentNode {
  kind: "environment"
  name: string
  optional?: Node[]
  args: Node[][]
  body: Node[]
  /** Verbatim source of the body, for "raw" environments (tikzcd, verbatim). */
  raw?: string
}

export interface MathNode {
  kind: "math"
  display: boolean
  body: Node[]
}

/** Superscript (^) or subscript (_) carrying a single atom. */
export interface ScriptNode {
  kind: "sup" | "sub"
  body: Node
}

export interface LineBreakNode {
  kind: "linebreak"
}

export interface ParBreakNode {
  kind: "parbreak"
}

/** Column separator (&) inside tabular/align. */
export interface AlignNode {
  kind: "align"
}
