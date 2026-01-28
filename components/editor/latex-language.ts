import type { languages } from "monaco-editor"

export const latexLanguageConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: "%",
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "$", close: "$" },
    { open: "\\begin{", close: "\\end{" },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "$", close: "$" },
  ],
}

export const latexTokensProvider: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".tex",

  brackets: [
    { open: "{", close: "}", token: "delimiter.curly" },
    { open: "[", close: "]", token: "delimiter.square" },
    { open: "(", close: ")", token: "delimiter.parenthesis" },
  ],

  keywords: [
    "documentclass",
    "usepackage",
    "begin",
    "end",
    "newcommand",
    "renewcommand",
    "newenvironment",
    "renewenvironment",
    "input",
    "include",
    "includegraphics",
    "bibliographystyle",
    "bibliography",
    "cite",
    "ref",
    "label",
    "caption",
    "title",
    "author",
    "date",
    "maketitle",
    "tableofcontents",
    "section",
    "subsection",
    "subsubsection",
    "paragraph",
    "chapter",
    "part",
    "item",
    "textbf",
    "textit",
    "underline",
    "emph",
    "text",
    "frac",
    "sqrt",
    "sum",
    "prod",
    "int",
    "lim",
    "infty",
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "theta",
    "lambda",
    "mu",
    "pi",
    "sigma",
    "omega",
  ],

  environments: [
    "document",
    "figure",
    "table",
    "equation",
    "align",
    "itemize",
    "enumerate",
    "description",
    "abstract",
    "quote",
    "quotation",
    "verse",
    "center",
    "flushleft",
    "flushright",
    "minipage",
    "tabular",
    "array",
    "matrix",
    "pmatrix",
    "bmatrix",
    "cases",
    "verbatim",
    "lstlisting",
  ],

  tokenizer: {
    root: [
      // Comments
      [/%.*$/, "comment"],

      // Math mode (display)
      [/\\\[/, { token: "keyword", next: "@mathDisplay" }],
      [/\$\$/, { token: "keyword", next: "@mathDisplay" }],

      // Math mode (inline)
      [/\$/, { token: "keyword", next: "@mathInline" }],

      // Commands with arguments
      [
        /\\(documentclass|usepackage|begin|end|input|include|bibliographystyle|bibliography)(\s*\[)?/,
        ["keyword", "delimiter.square"],
      ],

      // Section commands
      [
        /\\(section|subsection|subsubsection|paragraph|chapter|part)\*?/,
        "keyword",
      ],

      // Text formatting commands
      [/\\(textbf|textit|underline|emph|text)\b/, "keyword"],

      // Other commands
      [/\\[a-zA-Z@]+\*?/, "keyword"],

      // Special characters
      [/\\[{}$&#%_^~]/, "string.escape"],

      // Braces
      [/[{}]/, "delimiter.curly"],
      [/[\[\]]/, "delimiter.square"],
      [/[()]/, "delimiter.parenthesis"],

      // Numbers
      [/\d+/, "number"],

      // Whitespace
      [/\s+/, "white"],
    ],

    mathDisplay: [
      [/\\\]/, { token: "keyword", next: "@pop" }],
      [/\$\$/, { token: "keyword", next: "@pop" }],
      [/%.*$/, "comment"],
      [/\\[a-zA-Z@]+/, "keyword.math"],
      [/[{}]/, "delimiter.curly"],
      [/[\[\]]/, "delimiter.square"],
      [/[_^]/, "operator"],
      [/[a-zA-Z]/, "variable"],
      [/\d+/, "number"],
      [/./, "string.math"],
    ],

    mathInline: [
      [/\$/, { token: "keyword", next: "@pop" }],
      [/%.*$/, "comment"],
      [/\\[a-zA-Z@]+/, "keyword.math"],
      [/[{}]/, "delimiter.curly"],
      [/[\[\]]/, "delimiter.square"],
      [/[_^]/, "operator"],
      [/[a-zA-Z]/, "variable"],
      [/\d+/, "number"],
      [/./, "string.math"],
    ],
  },
}
