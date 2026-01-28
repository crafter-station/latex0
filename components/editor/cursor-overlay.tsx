"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { motion } from "motion/react"
import type { editor } from "monaco-editor"

interface CursorData {
  odId: string
  odName: string
  odColor: string
  position: { line: number; column: number }
}

interface CursorOverlayProps {
  cursors: CursorData[]
  editor: editor.IStandaloneCodeEditor | null
}

interface PixelPosition {
  top: number
  left: number
  visible: boolean
  odId: string
  odName: string
  odColor: string
}

function getContrastColor(hexColor: string): string {
  if (hexColor.startsWith("hsl")) {
    const match = hexColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/)
    if (match) {
      const lightness = parseInt(match[3], 10)
      return lightness > 50 ? "#1a1a1a" : "#ffffff"
    }
    return "#1a1a1a"
  }

  const hex = hexColor.replace("#", "")
  if (hex.length !== 6) return "#1a1a1a"

  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? "#1a1a1a" : "#ffffff"
}

export function CursorOverlay({ cursors, editor }: CursorOverlayProps) {
  const [positions, setPositions] = useState<PixelPosition[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  const updatePositions = useCallback(() => {
    if (!editor || cursors.length === 0) {
      setPositions([])
      return
    }

    const newPositions: PixelPosition[] = []

    for (const cursor of cursors) {
      try {
        // getScrolledVisiblePosition returns position relative to editor's content area
        const scrollPos = editor.getScrolledVisiblePosition({
          lineNumber: cursor.position.line,
          column: cursor.position.column,
        })

        if (scrollPos) {
          newPositions.push({
            // scrollPos is relative to the editor's visible content area
            top: scrollPos.top,
            left: scrollPos.left,
            visible: true,
            odId: cursor.odId,
            odName: cursor.odName,
            odColor: cursor.odColor,
          })

          console.log(
            "[CursorOverlay]",
            cursor.odName,
            "line:",
            cursor.position.line,
            "col:",
            cursor.position.column,
            "-> top:",
            scrollPos.top,
            "left:",
            scrollPos.left
          )
        } else {
          console.log("[CursorOverlay]", cursor.odName, "position not visible")
        }
      } catch (e) {
        console.error("[CursorOverlay] Error:", e)
      }
    }

    setPositions(newPositions)
  }, [editor, cursors])

  useEffect(() => {
    if (!editor) {
      console.log("[CursorOverlay] No editor instance")
      return
    }

    console.log("[CursorOverlay] Setting up with", cursors.length, "cursors")

    // Initial update
    updatePositions()
    const initialTimer = setTimeout(updatePositions, 100)

    // Subscribe to editor events
    const scrollDisposable = editor.onDidScrollChange(updatePositions)
    const layoutDisposable = editor.onDidLayoutChange(updatePositions)
    const contentDisposable = editor.onDidChangeModelContent(updatePositions)

    // Periodic update
    const interval = setInterval(updatePositions, 100)

    return () => {
      clearTimeout(initialTimer)
      scrollDisposable.dispose()
      layoutDisposable.dispose()
      contentDisposable.dispose()
      clearInterval(interval)
    }
  }, [editor, updatePositions])

  useEffect(() => {
    updatePositions()
  }, [cursors, updatePositions])

  console.log("[CursorOverlay] Render - positions:", positions.length, "cursors:", cursors.length, "editor:", !!editor)

  if (!editor || positions.length === 0) return null

  // Get the editor's DOM node to find the content area
  const editorDom = editor.getDomNode()
  if (!editorDom) return null

  // Find the editor's lines content container for positioning reference
  const linesContent = editorDom.querySelector(".view-lines") as HTMLElement
  if (!linesContent) {
    console.log("[CursorOverlay] Could not find .view-lines")
    return null
  }

  const linesRect = linesContent.getBoundingClientRect()
  const editorRect = editorDom.getBoundingClientRect()

  // Calculate offset from editor container to lines content
  const offsetLeft = linesRect.left - editorRect.left
  const offsetTop = linesRect.top - editorRect.top

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 10 }}
    >
      {positions.map((pos) => (
        <motion.div
          key={pos.odId}
          className="absolute pointer-events-none"
          initial={false}
          animate={{
            x: pos.left + offsetLeft,
            y: pos.top + offsetTop,
          }}
          transition={{
            type: "spring",
            damping: 30,
            mass: 0.8,
            stiffness: 350,
          }}
        >
          {/* Cursor caret */}
          <div
            className="w-0.5 rounded-sm"
            style={{
              height: "18px",
              backgroundColor: pos.odColor,
              boxShadow: `0 0 8px ${pos.odColor}, 0 0 4px ${pos.odColor}`,
            }}
          />
          {/* User label */}
          <div
            className="absolute -top-5 left-0 px-1.5 py-0.5 text-[10px] font-semibold rounded-sm whitespace-nowrap shadow-lg"
            style={{
              backgroundColor: pos.odColor,
              color: getContrastColor(pos.odColor),
            }}
          >
            {pos.odName}
          </div>
        </motion.div>
      ))}
    </div>
  )
}
