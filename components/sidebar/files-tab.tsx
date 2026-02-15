"use client"

import { useCallback, useRef, useState } from "react"
import { FileTree } from "@/components/sidebar/file-tree"
import { DocumentOutline } from "@/components/editor/document-outline"
import { FileActionsDropdown } from "@/components/sidebar/file-actions-dropdown"
import {
  SidebarGroup,
  SidebarGroupContent,
} from "@/components/ui/sidebar"
import { IconChevronRight } from "@tabler/icons-react"

export function FilesTab() {
  const [outlineHeight, setOutlineHeight] = useState(200)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startY = e.clientY
      const startHeight = outlineHeight

      const onPointerMove = (ev: PointerEvent) => {
        const delta = startY - ev.clientY
        const newHeight = Math.max(60, Math.min(500, startHeight + delta))
        setOutlineHeight(newHeight)
      }

      const onPointerUp = () => {
        document.removeEventListener("pointermove", onPointerMove)
        document.removeEventListener("pointerup", onPointerUp)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }

      document.body.style.cursor = "row-resize"
      document.body.style.userSelect = "none"
      document.addEventListener("pointermove", onPointerMove)
      document.addEventListener("pointerup", onPointerUp)
    },
    [outlineHeight]
  )

  return (
    <div ref={containerRef} className="flex flex-col flex-1 min-h-0">
      {/* Files */}
      <SidebarGroup className="flex-1 min-h-0">
        <div className="flex items-center justify-end px-2 py-1">
          <FileActionsDropdown />
        </div>
        <SidebarGroupContent className="overflow-y-auto">
          <FileTree />
        </SidebarGroupContent>
      </SidebarGroup>

      {/* Resize handle */}
      <div
        onPointerDown={handlePointerDown}
        role="separator"
        className="flex border-t border-border justify-center items-center cursor-row-resize shrink-0"
        style={{ touchAction: "none", userSelect: "none" }}
      >
        <div className="bg-foreground w-[17px] h-[2px] my-2 opacity-10 rounded-full" />
      </div>

      {/* Outline */}
      <div className="shrink-0 flex flex-col min-h-0" style={{ height: outlineOpen ? outlineHeight : "auto" }}>
        <button
          type="button"
          onClick={() => setOutlineOpen((v) => !v)}
          className="flex shrink-0 items-center gap-1 w-full px-4 h-[30px] cursor-pointer text-foreground"
        >
          <IconChevronRight
            className={`size-3.5 transition-transform duration-200 ${outlineOpen ? "rotate-90" : ""}`}
          />
          <span className="text-sm font-normal">Outline</span>
        </button>
        {outlineOpen && (
          <SidebarGroupContent className="overflow-y-auto flex-1 min-h-0">
            <DocumentOutline />
          </SidebarGroupContent>
        )}
      </div>
    </div>
  )
}
