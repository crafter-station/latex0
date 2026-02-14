"use client"

import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { IconFolder, IconPlus, IconCircleFilled } from "@tabler/icons-react"
import { useUserIdentity } from "@/hooks/use-user-identity"
import { useProjectStore } from "@/lib/project-store"
import type { Project } from "@/lib/db/schema"

export default function ProjectsPage() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useUserIdentity()
  const isAuthenticated = user?.isAuthenticated ?? false
  const { createProject } = useProjectStore()

  const { data: projects = [], isLoading } = useQuery<Project[]>({
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
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading projects...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Sign in to view your projects.</p>
      </div>
    )
  }

  const rootProjects = projects.filter((p) => !p.parentId)

  async function handleCreate() {
    const project = await createProject("Untitled")
    if (project) router.push(`/projects/${project.id}`)
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Projects</h1>
          <button
            onClick={handleCreate}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <IconPlus size={16} />
            New Project
          </button>
        </div>

        {rootProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <IconFolder className="size-12 text-muted-foreground/30" />
            <h2 className="text-lg font-medium">No projects yet</h2>
            <p className="text-sm text-muted-foreground">Create your first project to get started.</p>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <IconPlus size={16} />
              New Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rootProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => router.push(`/projects/${p.id}`)}
                className="group flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-4 text-left transition-colors hover:border-border hover:bg-accent/50"
              >
                <div className="flex items-center gap-2">
                  {p.color ? (
                    <IconCircleFilled className="size-4" style={{ color: p.color }} />
                  ) : (
                    <IconFolder className="size-4 text-muted-foreground" />
                  )}
                  <span className="font-medium truncate">{p.name}</span>
                </div>
                {p.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>
                )}
                <span className="text-xs text-muted-foreground/60">
                  {new Date(p.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
