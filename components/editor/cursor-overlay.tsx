"use client"

import { useEffect, useState } from "react"
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

interface CursorPosition {
  top: number
  left: number
  odId: string
  odName: string
  odColor: string
  line: number
}

export function CursorOverlay({ cursors, editor }: CursorOverlayProps) {
  const [positions, setPositions] = useState<CursorPosition[]>([])

  useEffect(() => {
    if (!editor || cursors.length === 0) {
      setPositions([])
      return
    }

    const updatePositions = () => {
      const newPositions: CursorPosition[] = []

      for (const cursor of cursors) {
        try {
          // Get the pixel position for the cursor
          const position = editor.getScrolledVisiblePosition({
            lineNumber: cursor.position.line,
            column: cursor.position.column,
          })

          if (position) {
            newPositions.push({
              top: position.top,
              left: position.left,
              odId: cursor.odId,
              odName: cursor.odName,
              odColor: cursor.odColor,
              line: cursor.position.line,
            })
          }
        } catch (e) {
          // Position might be out of view
        }
      }

      setPositions(newPositions)
    }

    // Update positions initially
    updatePositions()

    // Update positions on scroll and layout changes
    const scrollDisposable = editor.onDidScrollChange(updatePositions)
    const layoutDisposable = editor.onDidLayoutChange(updatePositions)

    // Update periodically to catch any changes
    const interval = setInterval(updatePositions, 100)

    return () => {
      scrollDisposable.dispose()
      layoutDisposable.dispose()
      clearInterval(interval)
    }
  }, [editor, cursors])

  if (positions.length === 0) return null

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {positions.map((pos) => (
        <div
          key={pos.odId}
          className="absolute transition-all duration-75"
          style={{
            top: pos.top,
            left: pos.left,
          }}
        >
          {/* Cursor bar */}
          <div
            className="w-0.5 h-5 rounded-sm"
            style={{
              backgroundColor: pos.odColor,
              boxShadow: `0 0 6px ${pos.odColor}, 0 0 12px ${pos.odColor}`,
            }}
          />
          {/* User label */}
          <div
            className="absolute -top-5 left-0 px-1.5 py-0.5 text-[10px] font-semibold rounded whitespace-nowrap"
            style={{
              backgroundColor: pos.odColor,
              color: "#000",
              boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
            }}
          >
            {pos.odName}
          </div>
        </div>
      ))}
    </div>
  )
}
