"use client"

import { useState, useCallback, useEffect } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { EditorToolbar } from "@/components/editor/editor-toolbar"
import { CodeEditor } from "@/components/editor/code-editor"
import { ChatInterface } from "@/components/chat/chat-interface"
import { ChatPanel } from "@/components/chat/chat-panel"
import { UniversalPreview } from "@/components/preview/universal-preview"
import { ImagePreview } from "@/components/preview/image-preview"
import { PreviewToolbar } from "@/components/preview/preview-toolbar"
import { CommandPalette } from "@/components/editor/command-palette"
import { VersionHistoryPanel } from "@/components/versions/version-history-panel"
import { useContentStore } from "@/lib/content-store"
import { useFileStore } from "@/lib/file-store"
import { useAutoSave } from "@/hooks/use-auto-save"
import { usePlaygroundPersistence } from "@/hooks/use-playground-persistence"
import { isImageFile } from "@/lib/upload-helpers"

export function IdeLayout() {
  useAutoSave()
  usePlaygroundPersistence()

  const activeContentType = useContentStore((s) => s.activeContentType)
  const requestCompile = useFileStore((s) => s.requestCompile)
  const activeTabId = useFileStore((s) => s.activeTabId)
  const getFileById = useFileStore((s) => s.getFileById)
  const activeFile = activeTabId ? getFileById(activeTabId) : null
  const isActiveFileImage = activeFile?.blobUrl && isImageFile(activeFile.name)

  const [zoom, setZoom] = useState(100)
  // the exact page view (beta), remembered per browser
  const [exact, setExact] = useState(false)
  useEffect(() => {
    try { setExact(localStorage.getItem("latex0:exact-view") === "1") } catch {}
  }, [])
  const handleToggleExact = useCallback(() => {
    setExact((on) => {
      try { localStorage.setItem("latex0:exact-view", on ? "0" : "1") } catch {}
      return !on
    })
  }, [])

  const handleCompile = useCallback(() => {
    requestCompile()
  }, [requestCompile])

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z + 10, 200))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z - 10, 50))
  }, [])

  const handleDownload = useCallback(() => {
    window.dispatchEvent(new Event("latex0:download-pdf"))
  }, [])

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Dashboard — base layer with inset styling */}
      <div className="flex flex-1 m-2 ml-0 rounded-xl bg-background shadow-sm overflow-hidden">
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          {/* Left panel — editor or image preview */}
          <ResizablePanel defaultSize={50} minSize={25}>
            <div className="flex h-full flex-col">
              <EditorToolbar />
              <div className="relative flex-1 overflow-hidden">
                {activeContentType === "chat" ? (
                  <ChatInterface />
                ) : isActiveFileImage ? (
                  <ImagePreview file={activeFile} />
                ) : (
                  <div className="h-full bg-black">
                    <CodeEditor />
                  </div>
                )}
                {/* Chat input overlay — always visible at the bottom */}
                {activeContentType === "file" && !isActiveFileImage && <ChatPanel />}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle className="opacity-0 !ring-0 !ring-offset-0 !outline-none" />

          {/* Right panel — always PDF preview */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full bg-background">
              <div className="flex h-full flex-col rounded-l-xl bg-muted/30 overflow-hidden relative z-10">
                <PreviewToolbar
                  onCompile={handleCompile}
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                  onDownload={handleDownload}
                  onToggleExact={handleToggleExact}
                  exact={exact}
                  zoom={zoom}
                />
                <div className="flex-1 overflow-hidden">
                  <UniversalPreview zoom={zoom} exact={exact} />
                </div>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        <VersionHistoryPanel />
      </div>

      <CommandPalette />
    </div>
  )
}
