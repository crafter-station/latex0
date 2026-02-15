"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { IconFolder, IconPlus, IconSearch } from "@tabler/icons-react"
import { useUserIdentity } from "@/hooks/use-user-identity"
import { useProjectStore } from "@/lib/project-store"
import { ProjectCard } from "@/components/projects/project-card"
import { ProjectsSidebar } from "@/components/projects/projects-sidebar"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Project } from "@/lib/db/schema"

type ProjectWithDoc = Project & { firstDocumentId: string | null }

export default function ProjectsPage() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useUserIdentity()
  const isAuthenticated = user?.isAuthenticated ?? false
  const { createProject, deleteProject, renameProject } = useProjectStore()
  const queryClient = useQueryClient()
  const activeView = useProjectStore((s) => s.dashboardView)
  const [search, setSearch] = useState("")
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState("")
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: projects = [], isLoading } = useQuery<ProjectWithDoc[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects")
      if (!res.ok) throw new Error("Failed to fetch projects")
      return res.json()
    },
    enabled: isAuthenticated,
    staleTime: 30_000,
  })

  if (authLoading || isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading projects...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Sign in to view your projects.</p>
      </div>
    )
  }

  const rootProjects = projects.filter((p) => !p.parentId)
  const filtered = rootProjects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  async function handleCreate() {
    const project = await createProject("Untitled")
    if (project) router.push(`/projects/${project.id}`)
  }

  async function handleDeleteConfirm() {
    if (!deleteId) return
    await deleteProject(deleteId)
    queryClient.invalidateQueries({ queryKey: ["projects"] })
    setDeleteId(null)
  }

  function handleRenameOpen(id: string) {
    const project = projects.find((p) => p.id === id)
    if (!project) return
    setRenameName(project.name)
    setRenameId(id)
  }

  async function handleRenameSave() {
    if (!renameId || !renameName.trim()) return
    await renameProject(renameId, renameName.trim())
    queryClient.invalidateQueries({ queryKey: ["projects"] })
    setRenameId(null)
  }

  const viewLabels = {
    all: "All Projects",
    yours: "Your Projects",
    shared: "Shared with you",
  }

  return (
    <SidebarProvider
      className="!min-h-0 h-svh overflow-hidden"
      style={{ "--sidebar-width": "320px" } as React.CSSProperties}
    >
      <ProjectsSidebar />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col m-2 ml-0 rounded-xl bg-background shadow-sm overflow-hidden">
          {/* Toolbar */}
          <div className="flex h-10 shrink-0 items-center gap-3 px-3">
            <SidebarTrigger className="shrink-0" />
            <h1 className="text-sm font-medium">{viewLabels[activeView]}</h1>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search projects..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-7 w-48 text-xs"
                />
              </div>
              <Button onClick={handleCreate} size="sm" className="h-7 gap-1.5 text-xs rounded-full">
                <IconPlus className="size-3.5" />
                New Project
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-6">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                <IconFolder className="size-12 text-muted-foreground/30" />
                <h2 className="text-lg font-medium">
                  {search ? "No matching projects" : "No projects yet"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {search
                    ? "Try a different search term."
                    : "Create your first project to get started."}
                </p>
                {!search && (
                  <Button onClick={handleCreate} size="sm" className="gap-1.5">
                    <IconPlus className="size-4" />
                    New Project
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onRename={handleRenameOpen}
                    onDelete={setDeleteId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent
          className="sm:max-w-sm"
          showCloseButton={false}
          overlayClassName="bg-black/20 backdrop-blur-sm"
        >
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete{" "}
            <span className="font-medium text-foreground">
              {projects.find((p) => p.id === deleteId)?.name}
            </span>{" "}
            and all its documents. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renameId} onOpenChange={(open) => !open && setRenameId(null)}>
        <DialogContent
          className="sm:max-w-md"
          showCloseButton={false}
          overlayClassName="bg-black/20 backdrop-blur-sm"
        >
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleRenameSave()
            }}
            className="flex flex-col gap-4"
          >
            <Input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              placeholder="Project name"
              autoFocus
              onFocus={(e) => e.target.select()}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRenameId(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!renameName.trim()}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  )
}
