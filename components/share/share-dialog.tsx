"use client"

import { useEffect, useState } from "react"
import {
  IconCopy,
  IconLink,
  IconTrash,
  IconCheck,
  IconShare,
} from "@tabler/icons-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useShareStore } from "@/lib/share-store"
import { useDocumentStore } from "@/lib/document-store"

export function ShareDialog() {
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const {
    shares,
    isLoading,
    fetchShares,
    createShare,
    revokeShare,
    currentPermission,
  } = useShareStore()

  const [permission, setPermission] = useState<"view" | "edit">("view")
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open && activeDocumentId) {
      fetchShares(activeDocumentId)
    }
  }, [open, activeDocumentId, fetchShares])

  if (!activeDocumentId || currentPermission !== "owner") return null

  async function handleCreateLink() {
    if (!activeDocumentId) return
    await createShare(activeDocumentId, { permission })
  }

  async function handleCopyLink(shareToken: string) {
    const url = `${window.location.origin}/share/${shareToken}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleRevoke(shareId: string) {
    if (!activeDocumentId) return
    await revokeShare(activeDocumentId, shareId)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <IconShare className="size-4" />
          <span className="hidden sm:inline">Share</span>
          {shares.length > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {shares.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Document</DialogTitle>
          <DialogDescription>
            Create a link to share this document with others.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Create new share link */}
          <div className="flex items-center gap-2">
            <Select
              value={permission}
              onValueChange={(v) => setPermission(v as "view" | "edit")}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">Can view</SelectItem>
                <SelectItem value="edit">Can edit</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleCreateLink} className="gap-1.5 flex-1">
              <IconLink className="size-4" />
              Create Link
            </Button>
          </div>

          {/* Existing shares */}
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading shares...</p>
          )}

          {shares.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Active Links</h4>
              {shares.map((share) => (
                <div
                  key={share.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <IconLink className="size-3.5 text-muted-foreground" />
                    <span className="font-mono text-xs text-muted-foreground">
                      {share.shareToken?.slice(0, 8)}...
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {share.permission}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        share.shareToken && handleCopyLink(share.shareToken)
                      }
                    >
                      {copied ? (
                        <IconCheck className="size-3.5 text-emerald-500" />
                      ) : (
                        <IconCopy className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleRevoke(share.id)}
                    >
                      <IconTrash className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
