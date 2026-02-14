"use client"

import { useEffect, useState } from "react"
import {
  IconHistory,
  IconBookmark,
  IconArrowBackUp,
  IconX,
  IconClock,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useVersionStore } from "@/lib/version-store"
import { useDocumentStore } from "@/lib/document-store"
import { useFileStore } from "@/lib/file-store"
import { useShareStore } from "@/lib/share-store"
import type { DocumentVersion } from "@/lib/db/schema"

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)

  if (diffMin < 1) return "Just now"
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function triggerLabel(type: string): string {
  switch (type) {
    case "auto":
      return "Auto-save"
    case "manual":
      return "Checkpoint"
    case "compile":
      return "Compiled"
    case "significant":
      return "Significant change"
    default:
      return type
  }
}

function triggerColor(type: string): string {
  switch (type) {
    case "manual":
      return "text-blue-500"
    case "compile":
      return "text-emerald-500"
    case "significant":
      return "text-amber-500"
    default:
      return "text-muted-foreground"
  }
}

function VersionItem({
  version,
  isSelected,
  onSelect,
  onRestore,
  canRestore,
}: {
  version: DocumentVersion
  isSelected: boolean
  onSelect: () => void
  onRestore: () => void
  canRestore: boolean
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-md border px-3 py-2.5 transition-colors ${
        isSelected
          ? "border-primary bg-primary/5"
          : "border-transparent hover:bg-muted/50"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-medium ${triggerColor(version.triggerType)}`}>
            {triggerLabel(version.triggerType)}
          </span>
          {version.restoredFrom && (
            <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
              restored from v{version.restoredFrom}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          v{version.versionNumber}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <IconClock className="size-3" />
          <span>{formatTimeAgo(version.createdAt as unknown as string)}</span>
        </div>
        {canRestore && isSelected && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation()
              onRestore()
            }}
          >
            <IconArrowBackUp className="size-3" />
            Restore
          </Button>
        )}
      </div>
    </button>
  )
}

export function VersionHistoryPanel() {
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const currentPermission = useShareStore((s) => s.currentPermission)
  const setFiles = useFileStore((s) => s.setFiles)

  const {
    versions,
    isLoading,
    isHistoryOpen,
    selectedVersionId,
    fetchVersions,
    createCheckpoint,
    restoreVersion,
    getVersionContent,
    closeHistory,
    selectVersion,
  } = useVersionStore()

  const [previewContent, setPreviewContent] = useState<string | null>(null)

  useEffect(() => {
    if (isHistoryOpen && activeDocumentId) {
      fetchVersions(activeDocumentId)
    }
  }, [isHistoryOpen, activeDocumentId, fetchVersions])

  // Load preview when version is selected
  useEffect(() => {
    if (!selectedVersionId || !activeDocumentId) {
      setPreviewContent(null)
      return
    }
    getVersionContent(activeDocumentId, selectedVersionId).then((v) => {
      if (v) setPreviewContent(v.content)
    })
  }, [selectedVersionId, activeDocumentId, getVersionContent])

  if (!isHistoryOpen) return null

  const canRestore = currentPermission === "owner"

  async function handleRestore(versionId: string) {
    if (!activeDocumentId) return
    const success = await restoreVersion(activeDocumentId, versionId)
    if (success) {
      // Reload the document content
      const version = await getVersionContent(activeDocumentId, versionId)
      if (version) {
        setFiles([
          {
            id: "main",
            name: "main.tex",
            type: "file",
            content: version.content,
          },
        ])
      }
      selectVersion(null)
    }
  }

  return (
    <div className="flex h-full w-72 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <IconHistory className="size-4" />
          <h3 className="text-sm font-medium">Version History</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={closeHistory}
        >
          <IconX className="size-3.5" />
        </Button>
      </div>

      {/* Create checkpoint */}
      {canRestore && activeDocumentId && (
        <div className="border-b px-4 py-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={() => createCheckpoint(activeDocumentId)}
          >
            <IconBookmark className="size-3.5" />
            Save Checkpoint
          </Button>
        </div>
      )}

      {/* Version list */}
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {isLoading && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Loading versions...
            </p>
          )}

          {!isLoading && versions.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No versions yet. Versions are created automatically as you edit.
            </p>
          )}

          {versions.map((version) => (
            <VersionItem
              key={version.id}
              version={version}
              isSelected={selectedVersionId === version.id}
              onSelect={() =>
                selectVersion(
                  selectedVersionId === version.id ? null : version.id
                )
              }
              onRestore={() => handleRestore(version.id)}
              canRestore={canRestore}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Preview */}
      {previewContent && (
        <div className="border-t">
          <div className="px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">Preview</p>
          </div>
          <ScrollArea className="h-40">
            <pre className="whitespace-pre-wrap p-4 font-mono text-xs text-muted-foreground">
              {previewContent.slice(0, 500)}
              {previewContent.length > 500 && "..."}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
