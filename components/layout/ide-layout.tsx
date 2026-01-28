"use client"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { SiteHeader } from "@/components/layout/site-header"
import { EditorTabs } from "@/components/editor/editor-tabs"
import { CodeEditor } from "@/components/editor/code-editor"
import { PdfViewer } from "@/components/preview/pdf-viewer"
import { ChatPanel } from "@/components/chat/chat-panel"

export function IdeLayout() {
  return (
    <div className="flex h-full flex-col">
      <SiteHeader />
      <div className="flex flex-1 flex-col overflow-hidden">
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          {/* Editor Panel */}
          <ResizablePanel defaultSize={40} minSize={25}>
            <div className="relative flex h-full flex-col bg-black">
              <EditorTabs />
              <div className="flex-1 overflow-hidden bg-black">
                <CodeEditor />
              </div>
              {/* Chat overlay at bottom */}
              <ChatPanel />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Preview Panel */}
          <ResizablePanel defaultSize={60} minSize={30}>
            <div className="h-full overflow-hidden bg-muted/30">
              <PdfViewer />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
