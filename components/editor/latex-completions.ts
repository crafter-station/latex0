import type { Monaco } from "@monaco-editor/react"
import type { editor, Position } from "monaco-editor"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompletionEntry {
  label: string
  insertText: string
  detail: string
  documentation?: string
  isSnippet?: boolean
}

// ---------------------------------------------------------------------------
// Command completions
// ---------------------------------------------------------------------------

const sectioningCommands: CompletionEntry[] = [
  { label: "section", insertText: "section{$1}", detail: "Section heading", isSnippet: true },
  { label: "subsection", insertText: "subsection{$1}", detail: "Subsection heading", isSnippet: true },
  { label: "subsubsection", insertText: "subsubsection{$1}", detail: "Sub-subsection heading", isSnippet: true },
  { label: "paragraph", insertText: "paragraph{$1}", detail: "Paragraph heading", isSnippet: true },
  { label: "chapter", insertText: "chapter{$1}", detail: "Chapter heading", isSnippet: true },
  { label: "part", insertText: "part{$1}", detail: "Part heading", isSnippet: true },
]

const formattingCommands: CompletionEntry[] = [
  { label: "textbf", insertText: "textbf{$1}", detail: "Bold text", isSnippet: true },
  { label: "textit", insertText: "textit{$1}", detail: "Italic text", isSnippet: true },
  { label: "underline", insertText: "underline{$1}", detail: "Underlined text", isSnippet: true },
  { label: "emph", insertText: "emph{$1}", detail: "Emphasized text", isSnippet: true },
  { label: "texttt", insertText: "texttt{$1}", detail: "Monospace text", isSnippet: true },
  { label: "textsc", insertText: "textsc{$1}", detail: "Small caps text", isSnippet: true },
  { label: "textrm", insertText: "textrm{$1}", detail: "Roman (serif) text", isSnippet: true },
  { label: "textsf", insertText: "textsf{$1}", detail: "Sans-serif text", isSnippet: true },
]

const mathCommands: CompletionEntry[] = [
  { label: "frac", insertText: "frac{$1}{$2}", detail: "Fraction", isSnippet: true },
  { label: "sqrt", insertText: "sqrt{$1}", detail: "Square root", isSnippet: true },
  { label: "sum", insertText: "sum_{$1}^{$2}", detail: "Summation", isSnippet: true },
  { label: "prod", insertText: "prod_{$1}^{$2}", detail: "Product", isSnippet: true },
  { label: "int", insertText: "int_{$1}^{$2}", detail: "Integral", isSnippet: true },
  { label: "lim", insertText: "lim_{$1}", detail: "Limit", isSnippet: true },
  { label: "infty", insertText: "infty", detail: "Infinity symbol" },
  { label: "partial", insertText: "partial", detail: "Partial derivative symbol" },
  { label: "nabla", insertText: "nabla", detail: "Nabla (gradient) symbol" },
  { label: "forall", insertText: "forall", detail: "For all quantifier" },
  { label: "exists", insertText: "exists", detail: "Exists quantifier" },
]

const greekLowercase: CompletionEntry[] = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma",
  "tau", "upsilon", "phi", "chi", "psi", "omega",
].map((name) => ({
  label: name,
  insertText: name,
  detail: `Greek letter \\${name}`,
}))

const greekUppercase: CompletionEntry[] = [
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma",
  "Upsilon", "Phi", "Psi", "Omega",
].map((name) => ({
  label: name,
  insertText: name,
  detail: `Greek letter \\${name}`,
}))

const referenceCommands: CompletionEntry[] = [
  { label: "label", insertText: "label{$1}", detail: "Define a label", isSnippet: true },
  { label: "ref", insertText: "ref{$1}", detail: "Reference a label", isSnippet: true },
  { label: "cite", insertText: "cite{$1}", detail: "Citation", isSnippet: true },
  { label: "eqref", insertText: "eqref{$1}", detail: "Equation reference (with parentheses)", isSnippet: true },
  { label: "pageref", insertText: "pageref{$1}", detail: "Page reference", isSnippet: true },
  { label: "footnote", insertText: "footnote{$1}", detail: "Footnote", isSnippet: true },
]

const structureCommands: CompletionEntry[] = [
  { label: "documentclass", insertText: "documentclass{$1}", detail: "Set document class", isSnippet: true },
  { label: "usepackage", insertText: "usepackage{$1}", detail: "Import a package", isSnippet: true },
  {
    label: "begin",
    insertText: "begin{$1}\n\t$0\n\\\\end{$1}",
    detail: "Begin an environment",
    documentation: "Creates a \\begin{...} ... \\end{...} block",
    isSnippet: true,
  },
  { label: "end", insertText: "end{$1}", detail: "End an environment", isSnippet: true },
  { label: "title", insertText: "title{$1}", detail: "Document title", isSnippet: true },
  { label: "author", insertText: "author{$1}", detail: "Document author", isSnippet: true },
  { label: "date", insertText: "date{$1}", detail: "Document date", isSnippet: true },
  { label: "maketitle", insertText: "maketitle", detail: "Render title block" },
  { label: "tableofcontents", insertText: "tableofcontents", detail: "Insert table of contents" },
  { label: "bibliography", insertText: "bibliography{$1}", detail: "Include bibliography file", isSnippet: true },
  { label: "bibliographystyle", insertText: "bibliographystyle{$1}", detail: "Set bibliography style", isSnippet: true },
]

const environmentDefCommands: CompletionEntry[] = [
  {
    label: "newcommand",
    insertText: "newcommand{\\\\$1}[$2]{$3}",
    detail: "Define a new command",
    isSnippet: true,
  },
  {
    label: "renewcommand",
    insertText: "renewcommand{\\\\$1}[$2]{$3}",
    detail: "Redefine an existing command",
    isSnippet: true,
  },
  {
    label: "newenvironment",
    insertText: "newenvironment{$1}{$2}{$3}",
    detail: "Define a new environment",
    isSnippet: true,
  },
]

const otherCommands: CompletionEntry[] = [
  { label: "includegraphics", insertText: "includegraphics[${1:width=\\\\textwidth}]{$2}", detail: "Include an image", isSnippet: true },
  { label: "caption", insertText: "caption{$1}", detail: "Figure or table caption", isSnippet: true },
  { label: "centering", insertText: "centering", detail: "Center content in environment" },
  { label: "hline", insertText: "hline", detail: "Horizontal line in tables" },
  { label: "item", insertText: "item $0", detail: "List item", isSnippet: true },
  { label: "newpage", insertText: "newpage", detail: "Start a new page" },
  { label: "clearpage", insertText: "clearpage", detail: "Flush floats and start new page" },
  { label: "appendix", insertText: "appendix", detail: "Start appendix section" },
  { label: "input", insertText: "input{$1}", detail: "Input a TeX file", isSnippet: true },
  { label: "include", insertText: "include{$1}", detail: "Include a TeX file (with \\clearpage)", isSnippet: true },
]

const allCommands: CompletionEntry[] = [
  ...sectioningCommands,
  ...formattingCommands,
  ...mathCommands,
  ...greekLowercase,
  ...greekUppercase,
  ...referenceCommands,
  ...structureCommands,
  ...environmentDefCommands,
  ...otherCommands,
]

// ---------------------------------------------------------------------------
// Environment completions
// ---------------------------------------------------------------------------

interface EnvironmentEntry {
  label: string
  detail: string
  documentation?: string
  body?: string
}

const environments: EnvironmentEntry[] = [
  { label: "document", detail: "Main document environment" },
  { label: "figure", detail: "Floating figure", body: "\\\\centering\n\t$0\n\t\\\\caption{${1:Caption}}\n\t\\\\label{fig:$2}" },
  { label: "table", detail: "Floating table", body: "\\\\centering\n\t$0\n\t\\\\caption{${1:Caption}}\n\t\\\\label{tab:$2}" },
  { label: "equation", detail: "Numbered equation", body: "$0" },
  { label: "align", detail: "Aligned equations (numbered)", body: "$0" },
  { label: "align*", detail: "Aligned equations (unnumbered)", body: "$0" },
  { label: "itemize", detail: "Bulleted list", body: "\\\\item $0" },
  { label: "enumerate", detail: "Numbered list", body: "\\\\item $0" },
  { label: "description", detail: "Description list", body: "\\\\item[$1] $0" },
  { label: "abstract", detail: "Abstract" },
  { label: "quote", detail: "Short quotation" },
  { label: "quotation", detail: "Long quotation with indentation" },
  { label: "verse", detail: "Poetry / verse" },
  { label: "center", detail: "Centered content" },
  { label: "flushleft", detail: "Left-aligned content" },
  { label: "flushright", detail: "Right-aligned content" },
  { label: "minipage", detail: "Minipage box", body: "$0" },
  { label: "tabular", detail: "Table with column spec", body: "$0" },
  { label: "array", detail: "Math array", body: "$0" },
  { label: "matrix", detail: "Matrix (no delimiters)", body: "$0" },
  { label: "pmatrix", detail: "Matrix with parentheses", body: "$0" },
  { label: "bmatrix", detail: "Matrix with brackets", body: "$0" },
  { label: "vmatrix", detail: "Matrix with vertical bars (determinant)", body: "$0" },
  { label: "cases", detail: "Piecewise cases", body: "$1 & $2 \\\\\\\\\n\t$3 & $0" },
  { label: "verbatim", detail: "Verbatim (monospace) text" },
  { label: "lstlisting", detail: "Code listing (requires listings)" },
  { label: "theorem", detail: "Theorem environment" },
  { label: "lemma", detail: "Lemma environment" },
  { label: "proof", detail: "Proof environment" },
  { label: "definition", detail: "Definition environment" },
  { label: "corollary", detail: "Corollary environment" },
]

// ---------------------------------------------------------------------------
// Package completions
// ---------------------------------------------------------------------------

interface PackageEntry {
  label: string
  detail: string
}

const packages: PackageEntry[] = [
  { label: "amsmath", detail: "Advanced math typesetting" },
  { label: "amssymb", detail: "AMS math symbols" },
  { label: "amsthm", detail: "AMS theorem environments" },
  { label: "graphicx", detail: "Enhanced graphics support" },
  { label: "hyperref", detail: "Hyperlinks and PDF metadata" },
  { label: "geometry", detail: "Page layout and margins" },
  { label: "babel", detail: "Multilingual support" },
  { label: "inputenc", detail: "Input encoding (e.g. UTF-8)" },
  { label: "fontenc", detail: "Font encoding" },
  { label: "tikz", detail: "Programmatic graphics and diagrams" },
  { label: "pgfplots", detail: "Publication-quality plots" },
  { label: "listings", detail: "Source code listings" },
  { label: "booktabs", detail: "Professional-quality tables" },
  { label: "multirow", detail: "Multi-row cells in tables" },
  { label: "xcolor", detail: "Extended color support" },
  { label: "fancyhdr", detail: "Custom headers and footers" },
  { label: "natbib", detail: "Flexible bibliography citations" },
  { label: "biblatex", detail: "Modern bibliography management" },
  { label: "algorithm", detail: "Algorithm float environment" },
  { label: "algorithmic", detail: "Pseudocode typesetting" },
  { label: "float", detail: "Improved float positioning" },
  { label: "subcaption", detail: "Sub-figures and sub-tables" },
  { label: "enumitem", detail: "Customizable list environments" },
  { label: "cleveref", detail: "Intelligent cross-referencing" },
  { label: "siunitx", detail: "SI units and number formatting" },
  { label: "url", detail: "URL typesetting" },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all `\label{...}` values from the full text of a Monaco model. */
function extractLabels(text: string): string[] {
  const labels: string[] = []
  const re = /\\label\{([^}]+)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    labels.push(match[1])
  }
  return labels
}

/** Extract all `\bibitem{...}` values from the full text of a Monaco model. */
function extractBibitems(text: string): string[] {
  const items: string[] = []
  const re = /\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    items.push(match[1])
  }
  return items
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerLatexCompletions(monaco: Monaco): void {
  monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: ["\\", "{"],

    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const textUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })

      const wordInfo = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: wordInfo.endColumn,
      }

      // ---------------------------------------------------------------
      // Context: \ref{ or \eqref{ -- offer labels from the document
      // ---------------------------------------------------------------
      if (/\\(?:ref|eqref)\{[^}]*$/.test(textUntilPosition)) {
        const labels = extractLabels(model.getValue())
        return {
          suggestions: labels.map((label) => ({
            label,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: label,
            range,
            detail: "Label reference",
          })),
        }
      }

      // ---------------------------------------------------------------
      // Context: \cite{ -- offer bibitems from the document
      // ---------------------------------------------------------------
      if (/\\cite\{[^}]*$/.test(textUntilPosition)) {
        const bibitems = extractBibitems(model.getValue())
        return {
          suggestions: bibitems.map((key) => ({
            label: key,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: key,
            range,
            detail: "Citation key",
          })),
        }
      }

      // ---------------------------------------------------------------
      // Context: \begin{ or \end{ -- offer environments
      // ---------------------------------------------------------------
      if (/\\(?:begin|end)\{[^}]*$/.test(textUntilPosition)) {
        const isBegin = /\\begin\{[^}]*$/.test(textUntilPosition)

        return {
          suggestions: environments.map((env) => {
            const body = env.body ?? "$0"
            const snippet = isBegin
              ? `${env.label}}\n\t${body}\n\\\\end{${env.label}}`
              : `${env.label}}`

            return {
              label: env.label,
              kind: monaco.languages.CompletionItemKind.Module,
              insertText: isBegin ? snippet : `${env.label}}`,
              insertTextRules: isBegin
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              range,
              detail: env.detail,
              documentation: env.documentation,
            }
          }),
        }
      }

      // ---------------------------------------------------------------
      // Context: \usepackage{ or \usepackage[...]{ -- offer packages
      // ---------------------------------------------------------------
      if (/\\usepackage(?:\[[^\]]*\])?\{[^}]*$/.test(textUntilPosition)) {
        return {
          suggestions: packages.map((pkg) => ({
            label: pkg.label,
            kind: monaco.languages.CompletionItemKind.Unit,
            insertText: pkg.label,
            range,
            detail: pkg.detail,
          })),
        }
      }

      // ---------------------------------------------------------------
      // Context: after \ -- offer commands
      // ---------------------------------------------------------------
      if (/\\[a-zA-Z]*$/.test(textUntilPosition)) {
        return {
          suggestions: allCommands.map((cmd) => ({
            label: `\\${cmd.label}`,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: cmd.insertText,
            insertTextRules: cmd.isSnippet
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            range: {
              ...range,
              // Include the backslash in the replacement range
              startColumn: range.startColumn - 1,
            },
            detail: cmd.detail,
            documentation: cmd.documentation,
          })),
        }
      }

      return { suggestions: [] }
    },
  })
}
