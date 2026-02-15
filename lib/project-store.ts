import { create } from "zustand"
import type { Project } from "@/lib/db/schema"

/** Build the URL for a document, scoped to its project if available. */
export function docUrl(docId: string, projectId?: string | null): string {
  return projectId ? `/projects/${projectId}/${docId}` : `/playground/${docId}`
}

export interface ProjectNode extends Project {
  children: ProjectNode[]
}

export type DashboardView = "all" | "yours" | "shared"

interface ProjectStore {
  projects: Project[]
  tree: ProjectNode[]
  expandedProjects: Set<string>
  activeProjectId: string | null
  isLoading: boolean
  dashboardView: DashboardView

  setProjects: (projects: Project[]) => void
  setActiveProjectId: (id: string | null) => void
  setLoading: (loading: boolean) => void
  setDashboardView: (view: DashboardView) => void

  fetchProjects: () => Promise<void>
  createProject: (
    name: string,
    parentId?: string | null,
    description?: string,
    color?: string
  ) => Promise<Project | null>
  renameProject: (id: string, name: string) => Promise<void>
  updateProject: (
    id: string,
    data: { description?: string; color?: string }
  ) => Promise<void>
  moveProject: (id: string, newParentId: string | null) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  toggleExpanded: (projectId: string) => void
}

function buildTree(projects: Project[]): ProjectNode[] {
  const map = new Map<string, ProjectNode>()
  const roots: ProjectNode[] = []

  for (const project of projects) {
    map.set(project.id, { ...project, children: [] })
  }

  for (const project of projects) {
    const node = map.get(project.id)!
    if (project.parentId && map.has(project.parentId)) {
      map.get(project.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  tree: [],
  expandedProjects: new Set<string>(),
  activeProjectId: null,
  isLoading: false,
  dashboardView: "yours",

  setProjects: (projects) => set({ projects, tree: buildTree(projects) }),
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
  setLoading: (isLoading) => set({ isLoading }),
  setDashboardView: (dashboardView) => set({ dashboardView }),

  fetchProjects: async () => {
    set({ isLoading: true })
    try {
      const res = await fetch("/api/projects")
      if (res.ok) {
        const data = await res.json()
        set({ projects: data, tree: buildTree(data) })
      }
    } catch (err) {
      console.error("[ProjectStore] Failed to fetch projects:", err)
    } finally {
      set({ isLoading: false })
    }
  },

  createProject: async (name, parentId, description, color) => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          parentId: parentId || null,
          description: description || undefined,
          color: color || undefined,
        }),
      })
      if (res.ok) {
        const project = await res.json()
        const projects = [...get().projects, project]
        set({ projects, tree: buildTree(projects) })

        if (parentId) {
          const expanded = new Set(get().expandedProjects)
          expanded.add(parentId)
          set({ expandedProjects: expanded })
        }

        return project
      }
    } catch (err) {
      console.error("[ProjectStore] Failed to create project:", err)
    }
    return null
  },

  renameProject: async (id, name) => {
    // Optimistic update immediately
    const prev = get().projects
    const updated = prev.map((p) => (p.id === id ? { ...p, name } : p))
    set({ projects: updated, tree: buildTree(updated) })

    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        // Rollback on failure
        set({ projects: prev, tree: buildTree(prev) })
      }
    } catch (err) {
      console.error("[ProjectStore] Failed to rename project:", err)
      set({ projects: prev, tree: buildTree(prev) })
    }
  },

  updateProject: async (id, data) => {
    const prev = get().projects
    const updated = prev.map((p) => (p.id === id ? { ...p, ...data } : p))
    set({ projects: updated, tree: buildTree(updated) })

    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        set({ projects: prev, tree: buildTree(prev) })
      }
    } catch (err) {
      console.error("[ProjectStore] Failed to update project:", err)
      set({ projects: prev, tree: buildTree(prev) })
    }
  },

  moveProject: async (id, newParentId) => {
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: newParentId }),
      })
      if (res.ok) {
        await get().fetchProjects()
      }
    } catch (err) {
      console.error("[ProjectStore] Failed to move project:", err)
    }
  },

  deleteProject: async (id) => {
    // Optimistic: remove immediately
    const prev = get().projects
    const updated = prev.filter((p) => p.id !== id && p.parentId !== id)
    set({ projects: updated, tree: buildTree(updated) })

    if (get().activeProjectId === id) {
      set({ activeProjectId: null })
    }

    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" })
      if (!res.ok) {
        set({ projects: prev, tree: buildTree(prev) })
      }
    } catch (err) {
      console.error("[ProjectStore] Failed to delete project:", err)
      set({ projects: prev, tree: buildTree(prev) })
    }
  },

  toggleExpanded: (projectId) => {
    const expanded = new Set(get().expandedProjects)
    if (expanded.has(projectId)) {
      expanded.delete(projectId)
    } else {
      expanded.add(projectId)
    }
    set({ expandedProjects: expanded })
  },
}))
