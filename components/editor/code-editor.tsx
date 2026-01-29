"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import Editor, { type OnMount, type Monaco } from "@monaco-editor/react"
import type { editor } from "monaco-editor"
import { diffLines } from "diff"
import { useFiles } from "@/hooks/use-files"
import { useRealtimeCursors } from "@/hooks/use-realtime-cursors"
import { latexLanguageConfig, latexTokensProvider } from "./latex-language"
import { latexDarkTheme, latexLightTheme } from "./latex-theme"
import { useTheme } from "next-themes"
import { PresenceIndicator } from "./presence-indicator"
import { CursorOverlay } from "./cursor-overlay"
import { useSelectionContext } from "@/stores/selection-context-store"

interface DiffHunk {
  oldLines: string[]
  newStartLine: number
  newLineCount: number
}

function computeDiffHunks(oldContent: string, newContent: string): DiffHunk[] {
  const changes = diffLines(oldContent, newContent)
  const hunks: DiffHunk[] = []

  let newLine = 1
  let i = 0

  while (i < changes.length) {
    const change = changes[i]

    if (change.added || change.removed) {
      const hunk: DiffHunk = {
        oldLines: [],
        newStartLine: newLine,
        newLineCount: 0,
      }

      // Collect consecutive removed then added
      while (i < changes.length && changes[i].removed) {
        const c = changes[i]
        const lines = c.value.endsWith('\n') ? c.value.slice(0, -1).split('\n') : c.value.split('\n')
        hunk.oldLines.push(...lines)
        i++
      }

      while (i < changes.length && changes[i].added) {
        const c = changes[i]
        const count = c.count || c.value.split('\n').length - (c.value.endsWith('\n') ? 1 : 0)
        hunk.newLineCount += count
        newLine += count
        i++
      }

      if (hunk.oldLines.length > 0 || hunk.newLineCount > 0) {
        hunks.push(hunk)
      }
    } else {
      const count = change.count || 0
      newLine += count
      i++
    }
  }

  return hunks
}

export function CodeEditor() {
  const { activeTabId, activeContent, updateFileContent, pendingChange, acceptChange, rejectChange } = useFiles()
  const { resolvedTheme } = useTheme()
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  // State to trigger re-render when editor is ready (refs don't trigger re-renders)
  const [editorReady, setEditorReady] = useState<editor.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<string[]>([])
  const viewZoneIdsRef = useRef<string[]>([])
  const widgetsRef = useRef<editor.IContentWidget[]>([])
  const cursorDecorationsRef = useRef<string[]>([])

  // Handle remote content changes - apply directly to editor model to preserve cursor
  const handleRemoteContentChange = useCallback(
    (fileId: string, content: string) => {
      if (fileId !== activeTabId) return

      const ed = editorRef.current
      const model = ed?.getModel()

      if (ed && model) {
        // Get current content to avoid unnecessary updates
        const currentContent = model.getValue()
        if (currentContent === content) return

        // Save cursor position
        const position = ed.getPosition()
        const selections = ed.getSelections()

        // Apply edit directly to model (preserves undo stack and cursor better)
        model.pushEditOperations(
          selections,
          [
            {
              range: model.getFullModelRange(),
              text: content,
            },
          ],
          () => selections
        )

        // Restore cursor position (clamped to valid range)
        if (position) {
          const maxLine = model.getLineCount()
          const safeLine = Math.min(position.lineNumber, maxLine)
          const maxCol = model.getLineMaxColumn(safeLine)
          const safeCol = Math.min(position.column, maxCol)
          ed.setPosition({ lineNumber: safeLine, column: safeCol })
        }
      }

      // Also update React state to keep it in sync
      updateFileContent(fileId, content)
    },
    [activeTabId, updateFileContent]
  )

  // Realtime cursors and content sync
  const { cursors, onlineUsers, broadcastPosition, broadcastContent, isApplyingRemote, localUser } = useRealtimeCursors(
    "latex0-playground",
    activeTabId || "default",
    handleRemoteContentChange
  )

  // Ref for injected cursor styles
  const cursorStylesRef = useRef<HTMLStyleElement | null>(null)

  const clearDiffVisualization = useCallback(() => {
    if (!editorRef.current) return

    const ed = editorRef.current

    // Clear decorations
    if (decorationsRef.current.length > 0) {
      ed.deltaDecorations(decorationsRef.current, [])
      decorationsRef.current = []
    }

    // Clear view zones
    if (viewZoneIdsRef.current.length > 0) {
      ed.changeViewZones((accessor) => {
        for (const id of viewZoneIdsRef.current) {
          accessor.removeZone(id)
        }
      })
      viewZoneIdsRef.current = []
    }

    // Clear widgets
    for (const widget of widgetsRef.current) {
      ed.removeContentWidget(widget)
    }
    widgetsRef.current = []
  }, [])

  const applyDiffVisualization = useCallback(() => {
    if (!editorRef.current || !monacoRef.current || !pendingChange || pendingChange.fileId !== activeTabId) {
      clearDiffVisualization()
      return
    }

    const ed = editorRef.current
    const monaco = monacoRef.current
    const hunks = computeDiffHunks(pendingChange.originalContent, pendingChange.currentContent)

    if (hunks.length === 0) {
      clearDiffVisualization()
      return
    }

    const decorations: editor.IModelDeltaDecoration[] = []
    const viewZoneIds: string[] = []

    ed.changeViewZones((accessor) => {
      for (const hunk of hunks) {
        // Add view zone for deleted lines (shown in red above the new lines)
        if (hunk.oldLines.length > 0) {
          const domNode = document.createElement("div")
          domNode.className = "diff-deleted-zone"

          for (const line of hunk.oldLines) {
            const lineDiv = document.createElement("div")
            lineDiv.className = "diff-deleted-line"
            lineDiv.textContent = line || " "
            domNode.appendChild(lineDiv)
          }

          const zoneId = accessor.addZone({
            afterLineNumber: Math.max(0, hunk.newStartLine - 1),
            heightInLines: hunk.oldLines.length,
            domNode,
            suppressMouseDown: true,
          })
          viewZoneIds.push(zoneId)
        }

        // Add decorations for added lines (shown in green)
        for (let i = 0; i < hunk.newLineCount; i++) {
          const lineNum = hunk.newStartLine + i
          decorations.push({
            range: new monaco.Range(lineNum, 1, lineNum, 1),
            options: {
              isWholeLine: true,
              className: "diff-line-added",
              glyphMarginClassName: "diff-glyph-added",
            },
          })
        }
      }
    })

    viewZoneIdsRef.current = viewZoneIds
    decorationsRef.current = ed.deltaDecorations(decorationsRef.current, decorations)

    // Add action widget for each hunk, positioned at end of line
    const widgets: editor.IContentWidget[] = []

    for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
      const hunk = hunks[hunkIndex]
      const lineNumber = hunk.newStartLine

      const widgetDomNode = document.createElement("div")
      widgetDomNode.className = "diff-action-widget"
      widgetDomNode.innerHTML = `
        <button class="diff-btn diff-btn-reject" title="Undo (⌘N)">
          Undo
        </button>
        <button class="diff-btn diff-btn-accept" title="Keep (⌘Y)">
          Keep
        </button>
      `

      // Add event listeners
      const rejectBtn = widgetDomNode.querySelector(".diff-btn-reject")
      const acceptBtn = widgetDomNode.querySelector(".diff-btn-accept")

      rejectBtn?.addEventListener("click", (e) => {
        e.stopPropagation()
        rejectChange()
      })

      acceptBtn?.addEventListener("click", (e) => {
        e.stopPropagation()
        acceptChange()
      })

      const widgetId = `diff-action-widget-${hunkIndex}`
      const widget: editor.IContentWidget = {
        getId: () => widgetId,
        getDomNode: () => widgetDomNode,
        getPosition: () => ({
          position: { lineNumber, column: Number.MAX_SAFE_INTEGER },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.EXACT,
          ],
        }),
        allowEditorOverflow: true,
      }

      ed.addContentWidget(widget)
      widgets.push(widget)
    }

    widgetsRef.current = widgets
  }, [pendingChange, activeTabId, acceptChange, rejectChange, clearDiffVisualization])

  // Keyboard shortcuts
  useEffect(() => {
    if (!pendingChange) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault()
        acceptChange()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault()
        rejectChange()
      }
      if (e.key === "Escape") {
        e.preventDefault()
        rejectChange()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [pendingChange, acceptChange, rejectChange])

  // Selection context store
  const setSelectionContext = useSelectionContext((state) => state.setContext)

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    setEditorReady(editor) // Trigger re-render so CursorOverlay gets the editor

    // Register LaTeX language
    monaco.languages.register({ id: "latex" })
    monaco.languages.setLanguageConfiguration("latex", latexLanguageConfig)
    monaco.languages.setMonarchTokensProvider("latex", latexTokensProvider)

    // Register custom themes
    monaco.editor.defineTheme("latex-dark", latexDarkTheme)
    monaco.editor.defineTheme("latex-light", latexLightTheme)
    // Set initial theme based on current resolved theme
    monaco.editor.setTheme(resolvedTheme === "light" ? "latex-light" : "latex-dark")

    // Broadcast cursor position on change
    editor.onDidChangeCursorPosition((e) => {
      broadcastPosition({
        line: e.position.lineNumber,
        column: e.position.column,
      })
    })

    // Capture text selection for AI context
    editor.onDidChangeCursorSelection((e) => {
      const selection = e.selection
      if (selection.isEmpty()) {
        // Don't clear immediately - let the chat input decide when to use it
        return
      }

      const model = editor.getModel()
      if (!model) return

      const selectedText = model.getValueInRange(selection)
      if (selectedText.trim()) {
        setSelectionContext({
          text: selectedText,
          startLine: selection.startLineNumber,
          endLine: selection.endLineNumber,
          fileName: activeTabId || "document",
        })
      }
    })

    // Focus the editor
    editor.focus()
  }

  const handleChange = (value: string | undefined) => {
    if (activeTabId && value !== undefined) {
      updateFileContent(activeTabId, value)
      // Broadcast content to other users (only if not applying remote change)
      if (!isApplyingRemote.current) {
        broadcastContent(activeTabId, value)
      }
    }
  }

  // Update editor theme when system theme changes
  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      monacoRef.current.editor.setTheme(resolvedTheme === "light" ? "latex-light" : "latex-dark")
    }
  }, [resolvedTheme])

  // Apply diff visualization when pendingChange changes
  useEffect(() => {
    // Small delay to ensure editor is ready
    const timer = setTimeout(() => {
      applyDiffVisualization()
    }, 50)

    return () => {
      clearTimeout(timer)
      clearDiffVisualization()
    }
  }, [pendingChange, activeTabId, applyDiffVisualization, clearDiffVisualization])

  // Inject dynamic CSS for cursor line highlights
  useEffect(() => {
    // Create style element if it doesn't exist
    if (!cursorStylesRef.current) {
      cursorStylesRef.current = document.createElement("style")
      cursorStylesRef.current.id = "remote-cursor-styles"
      document.head.appendChild(cursorStylesRef.current)
    }

    // Generate CSS for line highlights only (cursor widgets handle the rest)
    const cssRules = cursors.map((cursor) => {
      const safeId = cursor.odId.replace(/[^a-zA-Z0-9]/g, "")
      return `
        .cursor-line-${safeId} {
          background-color: ${cursor.odColor}15 !important;
        }
      `
    }).join("\n")

    cursorStylesRef.current.textContent = cssRules

    return () => {
      if (cursorStylesRef.current) {
        cursorStylesRef.current.textContent = ""
      }
    }
  }, [cursors])

  // Render line highlight decorations for remote cursors
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return

    const ed = editorRef.current
    const monaco = monacoRef.current

    console.log("[Cursors] Rendering line highlights for", cursors.length, "remote cursors")

    const decorations: editor.IModelDeltaDecoration[] = []

    for (const cursor of cursors) {
      const { position, odId } = cursor
      const safeId = odId.replace(/[^a-zA-Z0-9]/g, "")

      // Line highlight decoration
      decorations.push({
        range: new monaco.Range(position.line, 1, position.line, 1),
        options: {
          isWholeLine: true,
          className: `cursor-line-${safeId}`,
        },
      })
    }

    // Apply line highlight decorations
    cursorDecorationsRef.current = ed.deltaDecorations(cursorDecorationsRef.current, decorations)

    return () => {
      if (editorRef.current) {
        cursorDecorationsRef.current = editorRef.current.deltaDecorations(cursorDecorationsRef.current, [])
      }
    }
  }, [cursors])

  if (!activeTabId) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-neutral-500 dark:bg-black">
        <p>Select a file to start editing</p>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      {/* Presence indicator */}
      <div className="absolute top-2 right-2 z-50">
        <PresenceIndicator
          users={onlineUsers}
          localUser={localUser}
        />
      </div>
      {/* Remote cursors overlay */}
      <CursorOverlay
        cursors={cursors}
        editor={editorReady}
      />
      <Editor
      height="100%"
      language="latex"
      theme="latex-dark"
      value={activeContent || ""}
      onChange={handleChange}
      onMount={handleEditorMount}
      options={{
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        lineNumbers: "on",
        wordWrap: "on",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 16, bottom: 16 },
        renderLineHighlight: "line",
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        smoothScrolling: true,
        bracketPairColorization: { enabled: true },
        tabSize: 2,
        insertSpaces: true,
        folding: true,
        foldingStrategy: "indentation",
        showFoldingControls: "mouseover",
        lineDecorationsWidth: 8,
        renderWhitespace: "selection",
        contextmenu: true,
        quickSuggestions: true,
        suggestOnTriggerCharacters: true,
        glyphMargin: true,
      }}
      loading={
        <div className="flex h-full items-center justify-center bg-white text-neutral-500 dark:bg-black">
          Loading editor...
        </div>
      }
    />
    </div>
  )
}
