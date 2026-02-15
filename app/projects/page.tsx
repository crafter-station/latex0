"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { IconFolder, IconPlus, IconSearch } from "@tabler/icons-react"
import { useUserIdentity } from "@/hooks/use-user-identity"
import { useProjectStore } from "@/lib/project-store"
import { ProjectCard } from "@/components/projects/project-card"
import { ProjectsSidebar } from "@/components/projects/projects-sidebar"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Project } from "@/lib/db/schema"

export default function ProjectsPage() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useUserIdentity()
  const isAuthenticated = user?.isAuthenticated ?? false
  const { createProject, deleteProject } = useProjectStore()
  const activeView = useProjectStore((s) => s.dashboardView)
  const [search, setSearch] = useState("")

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

  async function handleDelete(id: string) {
    await deleteProject(id)
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
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </SidebarProvider>
  )
}
