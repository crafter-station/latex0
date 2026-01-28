"use client"

import { useEffect, useState, useCallback } from "react"
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
  odId: string
  odName: string
  odColor: string
  line: number
}

function getContrastColor(hexColor: string): string {
  // Handle hsl colors
  if (hexColor.startsWith("hsl")) {
    // Extract lightness from hsl(h, s%, l%)
    const match = hexColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/)
    if (match) {
      const lightness = parseInt(match[3], 10)
      return lightness > 50 ? "#1a1a1a" : "#ffffff"
    }
    return "#1a1a1a"
  }

  // Handle hex colors
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

  const updatePositions = useCallback(() => {
    if (!editor || cursors.length === 0) {
      setPositions([])
      return
    }

    const newPositions: PixelPosition[] = []

    for (const cursor of cursors) {
      try {
        // Get the pixel position for the cursor
        const pixelPos = editor.getScrolledVisiblePosition({
          lineNumber: cursor.position.line,
          column: cursor.position.column,
        })

        if (pixelPos) {
          // Add editor's dom node offset
          const editorDom = editor.getDomNode()
          const editorRect = editorDom?.getBoundingClientRect()

          newPositions.push({
            top: pixelPos.top + (editorRect?.top || 0),
            left: pixelPos.left + (editorRect?.left || 0) + 60, // Account for line numbers
            odId: cursor.odId,
            odName: cursor.odName,
            odColor: cursor.odColor,
            line: cursor.position.line,
          })

          console.log("[CursorOverlay] Position for", cursor.odName, ":", pixelPos, "->", { top: pixelPos.top, left: pixelPos.left + 60 })
        }
      } catch (e) {
        console.error("[CursorOverlay] Error getting position:", e)
      }
    }

    setPositions(newPositions)
  }, [editor, cursors])

  useEffect(() => {
    if (!editor) return

    // Update positions initially
    updatePositions()

    // Update positions on scroll and layout changes
    const scrollDisposable = editor.onDidScrollChange(updatePositions)
    const layoutDisposable = editor.onDidLayoutChange(updatePositions)
    const contentDisposable = editor.onDidChangeModelContent(updatePositions)

    // Update on cursor changes
    const interval = setInterval(updatePositions, 50)

    return () => {
      scrollDisposable.dispose()
      layoutDisposable.dispose()
      contentDisposable.dispose()
      clearInterval(interval)
    }
  }, [editor, updatePositions])

  // Also update when cursors change
  useEffect(() => {
    updatePositions()
  }, [cursors, updatePositions])

  console.log("[CursorOverlay] Rendering", positions.length, "cursor positions")

  if (positions.length === 0) return null

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 9999 }}>
      {positions.map((pos) => (
        <motion.div
          key={pos.odId}
          className="absolute pointer-events-none"
          initial={{ x: pos.left, y: pos.top }}
          animate={{ x: pos.left, y: pos.top }}
          transition={{
            type: "spring",
            damping: 30,
            mass: 0.8,
            stiffness: 350,
          }}
        >
          {/* Cursor caret */}
          <div
            className="w-0.5 h-[18px] rounded-sm"
            style={{
              backgroundColor: pos.odColor,
              boxShadow: `0 0 8px ${pos.odColor}, 0 0 16px ${pos.odColor}`,
            }}
          />
          {/* User label */}
          <div
            className="absolute -top-5 left-0 px-1.5 py-0.5 text-[10px] font-semibold rounded whitespace-nowrap shadow-lg border border-black/20"
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
