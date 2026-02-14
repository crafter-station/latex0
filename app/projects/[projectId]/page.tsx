"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { IconFolder, IconFileDescription, IconCircleFilled, IconArrowLeft } from "@tabler/icons-react"
import { useUserIdentity } from "@/hooks/use-user-identity"
import { useProjectStore } from "@/lib/project-store"
import type { Project, Folder, Document } from "@/lib/db/schema"

export default function ProjectDashboard() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const { user, isLoading: authLoading } = useUserIdentity()
  const isAuthenticated = user?.isAuthenticated ?? false
  const setActiveProjectId = useProjectStore((s) => s.setActiveProjectId)

  // Sync project store with URL params
  useEffect(() => {
    if (projectId) setActiveProjectId(projectId)
  }, [projectId, setActiveProjectId])

  const { data, isLoading } = useQuery<{
    project: Project
    subProjects: Project[]
    folders: Folder[]
    documents: Document[]
  }>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) throw new Error("Failed to fetch project")
      return res.json()
    },
    enabled: isAuthenticated && !!projectId,
  })

  if (authLoading || isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading project...</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Project not found.</p>
      </div>
    )
  }

  const { project, subProjects, folders, documents } = data
  const isEmpty = subProjects.length === 0 && folders.length === 0 && documents.length === 0

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Header */}
        <button
          onClick={() => router.push("/projects")}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <IconArrowLeft size={14} />
          All Projects
        </button>
        <div className="flex items-center gap-3 mb-2">
          {project.color && <IconCircleFilled className="size-5" style={{ color: project.color }} />}
          <h1 className="text-2xl font-semibold">{project.name}</h1>
        </div>
        {project.description && <p className="text-muted-foreground mb-8">{project.description}</p>}
        {!project.description && <div className="mb-8" />}

        {isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <IconFolder className="size-12 text-muted-foreground/30" />
            <h2 className="text-lg font-medium">Empty project</h2>
            <p className="text-sm text-muted-foreground">No documents yet.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {subProjects.length > 0 && (
              <Section title="Sub-projects">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {subProjects.map((sp) => (
                    <button
                      key={sp.id}
                      onClick={() => router.push(`/projects/${sp.id}`)}
                      className="flex items-center gap-2 rounded-lg border border-border/50 bg-card p-3 text-left hover:border-border hover:bg-accent/50"
                    >
                      {sp.color ? (
                        <IconCircleFilled className="size-4 shrink-0" style={{ color: sp.color }} />
                      ) : (
                        <IconFolder className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium truncate">{sp.name}</span>
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {documents.length > 0 && (
              <Section title="Documents">
                <div className="flex flex-col gap-2">
                  {documents.map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => router.push(`/projects/${projectId}/${doc.id}`)}
                      className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-card px-4 py-3 text-left hover:border-border hover:bg-accent/50"
                    >
                      <IconFileDescription className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 text-sm font-medium truncate">{doc.title}</span>
                      <span className="text-xs text-muted-foreground/60 shrink-0">
                        {new Date(doc.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </button>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wider">{title}</h2>
      {children}
    </section>
  )
}
