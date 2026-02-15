"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  IconSelector,
  IconFolder,
  IconPlus,
  IconCircleFilled,
  IconCheck,
  IconSettings,
} from "@tabler/icons-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useProjectStore } from "@/lib/project-store"
import { useUserIdentity } from "@/hooks/use-user-identity"
import type { Project } from "@/lib/db/schema"

export function ProjectSwitcher() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useUserIdentity()
  const isAuthenticated = user?.isAuthenticated ?? false
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    fetchProjects,
    createProject,
    isLoading,
  } = useProjectStore()

  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (isAuthenticated) {
      fetchProjects()
    }
  }, [isAuthenticated, fetchProjects])

  if (authLoading || !isAuthenticated) return null

  const activeProject = projects.find((p) => p.id === activeProjectId)
  // Only show root-level projects in the switcher
  const rootProjects = projects.filter((p) => !p.parentId)

  function handleSelect(project: Project | null) {
    setActiveProjectId(project?.id ?? null)
    setOpen(false)
  }

  async function handleCreate() {
    setOpen(false)
    const project = await createProject("Untitled")
    if (project) {
      setActiveProjectId(project.id)
      router.push(`/projects/${project.id}`)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md border border-border/50 bg-sidebar px-2.5 py-1.5 text-sm transition-colors hover:bg-accent/50">
          {activeProject?.color ? (
            <IconCircleFilled
              className="size-3.5 shrink-0"
              style={{ color: activeProject.color }}
            />
          ) : (
            <IconFolder className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="flex-1 truncate text-left">
            {activeProject?.name ?? "All Documents"}
          </span>
          <IconSelector className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] p-1"
      >
        {isLoading ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            Loading...
          </div>
        ) : (
          <div className="flex flex-col">
            {/* All Documents */}
            <button
              onClick={() => handleSelect(null)}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <IconFolder className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">All Documents</span>
              {activeProjectId === null && (
                <IconCheck className="size-3.5 shrink-0 text-primary" />
              )}
            </button>

            {rootProjects.length > 0 && (
              <div className="my-1 h-px bg-border" />
            )}

            {/* Project list */}
            {rootProjects.map((project) => (
              <button
                key={project.id}
                onClick={() => handleSelect(project)}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                {project.color ? (
                  <IconCircleFilled
                    className="size-3.5 shrink-0"
                    style={{ color: project.color }}
                  />
                ) : (
                  <IconFolder className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate text-left">
                  {project.name}
                </span>
                {activeProjectId === project.id && (
                  <IconCheck className="size-3.5 shrink-0 text-primary" />
                )}
              </button>
            ))}

            <div className="my-1 h-px bg-border" />

            {/* Actions */}
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <IconPlus className="size-3.5 shrink-0" />
              <span>New Project</span>
            </button>
            <button
              onClick={() => {
                setOpen(false)
                router.push("/projects")
              }}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <IconSettings className="size-3.5 shrink-0" />
              <span>Manage Projects</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
