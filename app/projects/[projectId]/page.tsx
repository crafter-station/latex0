"use client"

import { useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useUserIdentity } from "@/hooks/use-user-identity"
import type { Project, Document } from "@/lib/db/schema"

export default function ProjectRedirect() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const { user, isLoading: authLoading } = useUserIdentity()
  const isAuthenticated = user?.isAuthenticated ?? false
  const redirectedRef = useRef(false)

  const { data } = useQuery<{
    project: Project
    subProjects: Project[]
    folders: unknown[]
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

  // Prefetch the editor route as soon as we know the document id
  useEffect(() => {
    if (data?.documents?.[0]?.id) {
      router.prefetch(`/projects/${projectId}/${data.documents[0].id}`)
    }
  }, [data, projectId, router])

  useEffect(() => {
    if (!data || redirectedRef.current) return
    redirectedRef.current = true

    if (data.documents.length > 0) {
      // Go to the first document
      router.replace(`/projects/${projectId}/${data.documents[0].id}`)
    } else {
      // Create a new document and redirect
      fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled", projectId }),
      })
        .then((res) => res.json())
        .then((doc) => {
          router.replace(`/projects/${projectId}/${doc.id}`)
        })
        .catch(() => {
          router.replace("/projects")
        })
    }
  }, [data, projectId, router])

  return (
    <div className="flex h-svh items-center justify-center">
      <div className="text-sm text-muted-foreground animate-pulse">
        Opening project...
      </div>
    </div>
  )
}
