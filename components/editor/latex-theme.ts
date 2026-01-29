import type { editor } from "monaco-editor"

// Light theme for the editor
export const latexLightTheme: editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    // Comments - subtle gray
    { token: "comment", foreground: "6a737d", fontStyle: "italic" },

    // Keywords/Commands - warm brown/orange
    { token: "keyword", foreground: "b35900" },
    { token: "keyword.math", foreground: "b35900" },

    // Strings and math content - green
    { token: "string.math", foreground: "22863a" },
    { token: "string.escape", foreground: "0550ae" },

    // Delimiters/Brackets
    { token: "delimiter.curly", foreground: "cf222e" }, // Red
    { token: "delimiter.square", foreground: "8250df" }, // Purple
    { token: "delimiter.parenthesis", foreground: "0550ae" }, // Blue

    // Variables in math mode
    { token: "variable", foreground: "24292f" },

    // Numbers
    { token: "number", foreground: "953800" },

    // Operators
    { token: "operator", foreground: "0550ae" },

    // Default text
    { token: "", foreground: "24292f" },
  ],
  colors: {
    // Light background
    "editor.background": "#ffffff",
    // Dark text for contrast
    "editor.foreground": "#24292f",
    // Subtle line highlight
    "editor.lineHighlightBackground": "#f6f8fa",
    "editor.lineHighlightBorder": "#e8e8e8",
    // Selection
    "editor.selectionBackground": "#add6ff",
    "editor.inactiveSelectionBackground": "#add6ff80",
    // Line numbers
    "editorLineNumber.foreground": "#8c959f",
    "editorLineNumber.activeForeground": "#24292f",
    // Cursor
    "editorCursor.foreground": "#24292f",
    // Find matches
    "editor.findMatchBackground": "#ffdf5d",
    "editor.findMatchHighlightBackground": "#ffdf5d66",
    // Bracket matching
    "editorBracketMatch.background": "#c8e1ff",
    "editorBracketMatch.border": "#0969da",
    // Indent guides
    "editorIndentGuide.background": "#e8e8e8",
    "editorIndentGuide.activeBackground": "#d0d0d0",
    // Gutter
    "editorGutter.background": "#ffffff",
    // Widgets
    "editorWidget.background": "#f6f8fa",
    "editorWidget.border": "#d0d7de",
    // Input
    "input.background": "#ffffff",
    "input.border": "#d0d7de",
    "input.foreground": "#24292f",
    // Dropdown
    "dropdown.background": "#ffffff",
    "dropdown.border": "#d0d7de",
    "dropdown.foreground": "#24292f",
    // List
    "list.activeSelectionBackground": "#e8e8e8",
    "list.activeSelectionForeground": "#24292f",
    "list.hoverBackground": "#f3f4f6",
    // Scrollbar
    "scrollbar.shadow": "#00000010",
    "scrollbarSlider.background": "#8c959f40",
    "scrollbarSlider.hoverBackground": "#8c959f80",
    "scrollbarSlider.activeBackground": "#8c959f",
    // Minimap
    "minimap.background": "#ffffff",
    // Ruler
    "editorRuler.foreground": "#e8e8e8",
  },
}

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
