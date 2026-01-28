"use client"

import { useEffect, useRef, useCallback } from "react"
import Editor, { type OnMount, type Monaco } from "@monaco-editor/react"
import type { editor } from "monaco-editor"
import { diffLines } from "diff"
import { useFiles } from "@/hooks/use-files"
import { useRealtimeCursors } from "@/hooks/use-realtime-cursors"
import { latexLanguageConfig, latexTokensProvider } from "./latex-language"
import { latexDarkTheme } from "./latex-theme"

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
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const decorationsRef = useRef<string[]>([])
  const viewZoneIdsRef = useRef<string[]>([])
  const widgetsRef = useRef<editor.IContentWidget[]>([])
  const cursorDecorationsRef = useRef<string[]>([])
  const cursorWidgetsRef = useRef<editor.IContentWidget[]>([])

  // Handle remote content changes
  const handleRemoteContentChange = useCallback(
    (fileId: string, content: string) => {
      if (fileId === activeTabId) {
        updateFileContent(fileId, content)
      }
    },
    [activeTabId, updateFileContent]
  )

  // Realtime cursors and content sync
  const { cursors, broadcastPosition, broadcastContent, isApplyingRemote } = useRealtimeCursors(
    "latex0-playground",
    activeTabId || "default",
    handleRemoteContentChange
  )

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

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Register LaTeX language
    monaco.languages.register({ id: "latex" })
    monaco.languages.setLanguageConfiguration("latex", latexLanguageConfig)
    monaco.languages.setMonarchTokensProvider("latex", latexTokensProvider)

    // Register custom theme
    monaco.editor.defineTheme("latex-dark", latexDarkTheme)
    monaco.editor.setTheme("latex-dark")

    // Broadcast cursor position on change
    editor.onDidChangeCursorPosition((e) => {
      broadcastPosition({
        line: e.position.lineNumber,
        column: e.position.column,
      })
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

  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      monacoRef.current.editor.setTheme("latex-dark")
    }
  }, [activeTabId])

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

  // Render remote cursors as decorations and widgets
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return

    const editor = editorRef.current
    const monaco = monacoRef.current

    // Clear previous cursor widgets
    for (const widget of cursorWidgetsRef.current) {
      editor.removeContentWidget(widget)
    }
    cursorWidgetsRef.current = []

    // Create decorations and widgets for each remote cursor
    const decorations: editor.IModelDeltaDecoration[] = []
    const widgets: editor.IContentWidget[] = []

    for (const cursor of cursors) {
      const { position, odColor, odName, odId } = cursor

      // Add cursor line decoration
      decorations.push({
        range: new monaco.Range(
          position.line,
          position.column,
          position.line,
          position.column + 1
        ),
        options: {
          className: "remote-cursor",
          beforeContentClassName: "remote-cursor-line",
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })

      // Add whole line highlight with user's color
      decorations.push({
        range: new monaco.Range(position.line, 1, position.line, 1),
        options: {
          isWholeLine: true,
          className: `remote-cursor-line-highlight`,
          overviewRuler: {
            color: odColor,
            position: monaco.editor.OverviewRulerLane.Right,
          },
        },
      })

      // Create cursor label widget
      const widgetDomNode = document.createElement("div")
      widgetDomNode.className = "remote-cursor-label"
      widgetDomNode.style.backgroundColor = odColor
      widgetDomNode.style.color = "#000"
      widgetDomNode.textContent = odName

      const widgetId = `remote-cursor-${odId}`
      const widget: editor.IContentWidget = {
        getId: () => widgetId,
        getDomNode: () => widgetDomNode,
        getPosition: () => ({
          position: { lineNumber: position.line, column: position.column },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
        }),
        allowEditorOverflow: true,
      }

      editor.addContentWidget(widget)
      widgets.push(widget)
    }

    // Apply decorations
    cursorDecorationsRef.current = editor.deltaDecorations(
      cursorDecorationsRef.current,
      decorations
    )
    cursorWidgetsRef.current = widgets

    return () => {
      // Cleanup widgets on unmount or cursor change
      for (const widget of cursorWidgetsRef.current) {
        editor.removeContentWidget(widget)
      }
    }
  }, [cursors])

  if (!activeTabId) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-neutral-500">
        <p>Select a file to start editing</p>
      </div>
    )
  }

  return (
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
        <div className="flex h-full items-center justify-center bg-black text-neutral-500">
          Loading editor...
        </div>
      }
    />
  )
}
