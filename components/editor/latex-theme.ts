import type { editor } from "monaco-editor"

// Super black editor theme
export const latexDarkTheme: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    // Comments - subtle gray
    { token: "comment", foreground: "555555", fontStyle: "italic" },

    // Keywords/Commands - warm yellow
    { token: "keyword", foreground: "e5a855" },
    { token: "keyword.math", foreground: "e5a855" },

    // Strings and math content - green
    { token: "string.math", foreground: "7ec699" },
    { token: "string.escape", foreground: "56B6C2" },

    // Delimiters/Brackets
    { token: "delimiter.curly", foreground: "e06c75" }, // Coral
    { token: "delimiter.square", foreground: "c678dd" }, // Purple
    { token: "delimiter.parenthesis", foreground: "61afef" }, // Blue

    // Variables in math mode
    { token: "variable", foreground: "e0e0e0" },

    // Numbers
    { token: "number", foreground: "d19a66" },

    // Operators
    { token: "operator", foreground: "56B6C2" },

    // Default text - bright white for contrast
    { token: "", foreground: "e0e0e0" },
  ],
  colors: {
    // Super black background
    "editor.background": "#000000",
    // Bright text for contrast
    "editor.foreground": "#e0e0e0",
    // Subtle line highlight
    "editor.lineHighlightBackground": "#0a0a0a",
    "editor.lineHighlightBorder": "#1a1a1a",
    // Selection
    "editor.selectionBackground": "#264f78",
    "editor.inactiveSelectionBackground": "#264f7840",
    // Line numbers
    "editorLineNumber.foreground": "#444444",
    "editorLineNumber.activeForeground": "#888888",
    // Cursor - bright white
    "editorCursor.foreground": "#ffffff",
    // Find matches
    "editor.findMatchBackground": "#515c6a",
    "editor.findMatchHighlightBackground": "#314365",
    // Bracket matching
    "editorBracketMatch.background": "#0d293e",
    "editorBracketMatch.border": "#888888",
    // Indent guides - very subtle
    "editorIndentGuide.background": "#1a1a1a",
    "editorIndentGuide.activeBackground": "#333333",
    // Gutter - matches editor
    "editorGutter.background": "#000000",
    // Widgets
    "editorWidget.background": "#0a0a0a",
    "editorWidget.border": "#1a1a1a",
    // Input
    "input.background": "#0a0a0a",
    "input.border": "#1a1a1a",
    "input.foreground": "#e0e0e0",
    // Dropdown
    "dropdown.background": "#0a0a0a",
    "dropdown.border": "#1a1a1a",
    "dropdown.foreground": "#e0e0e0",
    // List
    "list.activeSelectionBackground": "#1a1a1a",
    "list.activeSelectionForeground": "#ffffff",
    "list.hoverBackground": "#0f0f0f",
    // Scrollbar - very subtle
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": "#33333380",
    "scrollbarSlider.hoverBackground": "#444444",
    "scrollbarSlider.activeBackground": "#555555",
    // Minimap
    "minimap.background": "#000000",
    // Ruler
    "editorRuler.foreground": "#1a1a1a",
  },
}
