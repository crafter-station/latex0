"use client"

import { useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useProjectStore } from "@/lib/project-store"
import { useUserIdentity } from "@/hooks/use-user-identity"
import type { Project } from "@/lib/db/schema"

export function useProjects() {
  const queryClient = useQueryClient()
  const { activeProjectId, setActiveProjectId } = useProjectStore()
  const { user } = useUserIdentity()
  const isAuthenticated = user?.isAuthenticated ?? false

  const {
    data: projects = [],
    isLoading,
  } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects")
      if (!res.ok) throw new Error("Failed to fetch projects")
      return res.json()
    },
    enabled: isAuthenticated,
    staleTime: 30_000,
  })

  const createMutation = useMutation({
    mutationFn: async (params: {
      name: string
      parentId?: string | null
      description?: string
      color?: string
    }) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error("Failed to create project")
      return res.json() as Promise<Project>
    },
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ["projects"] })
      const previous = queryClient.getQueryData<Project[]>(["projects"])

      const tempId = `temp-${Date.now()}`
      const tempProject: Project = {
        id: tempId,
        name: params.name,
        description: params.description || null,
        parentId: params.parentId || null,
        userId: "",
        path: `/${params.name}`,
        depth: 0,
        visibility: "private",
        color: params.color || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      queryClient.setQueryData<Project[]>(["projects"], (old) =>
        old ? [...old, tempProject] : [tempProject]
      )

      return { previous, tempId }
    },
    onError: (_err, _params, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["projects"], context.previous)
      }
    },
    onSuccess: (data, _params, context) => {
      queryClient.setQueryData<Project[]>(["projects"], (old) =>
        old ? old.map((p) => (p.id === context?.tempId ? data : p)) : [data]
      )
    },
  })

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error("Failed to rename project")
      return res.json() as Promise<Project>
    },
    onMutate: async ({ id, name }) => {
      await queryClient.cancelQueries({ queryKey: ["projects"] })
      const previous = queryClient.getQueryData<Project[]>(["projects"])

      queryClient.setQueryData<Project[]>(["projects"], (old) =>
        old ? old.map((p) => (p.id === id ? { ...p, name } : p)) : []
      )

      return { previous }
    },
    onError: (_err, _params, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["projects"], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete project")
      return id
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["projects"] })
      const previous = queryClient.getQueryData<Project[]>(["projects"])

      queryClient.setQueryData<Project[]>(["projects"], (old) =>
        old ? old.filter((p) => p.id !== id) : []
      )

      return { previous }
    },
    onError: (_err, _params, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["projects"], context.previous)
      }
    },
    onSuccess: (id) => {
      if (activeProjectId === id) {
        setActiveProjectId(null)
      }
    },
  })

  const createProject = useCallback(
    async (
      name: string,
      parentId?: string | null,
      description?: string,
      color?: string
    ) => {
      if (!isAuthenticated) return null
      try {
        return await createMutation.mutateAsync({
          name,
          parentId,
          description,
          color,
        })
      } catch (err) {
        console.error("[useProjects] Failed to create project:", err)
        return null
      }
    },
    [isAuthenticated, createMutation]
  )

  const renameProject = useCallback(
    async (id: string, name: string) => {
      if (!isAuthenticated) return
      try {
        await renameMutation.mutateAsync({ id, name })
      } catch (err) {
        console.error("[useProjects] Failed to rename project:", err)
      }
    },
    [isAuthenticated, renameMutation]
  )

  const deleteProject = useCallback(
    async (id: string) => {
      if (!isAuthenticated) return
      try {
        await deleteMutation.mutateAsync(id)
      } catch (err) {
        console.error("[useProjects] Failed to delete project:", err)
      }
    },
    [isAuthenticated, deleteMutation]
  )

  return {
    projects,
    activeProjectId,
    setActiveProjectId,
    isLoading,
    isAuthenticated,
    createProject,
    renameProject,
    deleteProject,
  }
}
