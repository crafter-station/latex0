"use client"

import { useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useDocumentStore, type DocumentMeta } from "@/lib/document-store"
import { useFileStore } from "@/lib/file-store"
import { useShareStore } from "@/lib/share-store"
import { useUserIdentity } from "@/hooks/use-user-identity"
import { parseDocumentContent } from "@/lib/content-parser"
import { findMainFile } from "@/lib/file-utils"
import type { UserPermission } from "@/lib/db/schema"

export function useDocuments() {
  const queryClient = useQueryClient()
  const {
    activeDocumentId,
    setActiveDocumentId,
    updateDocumentMeta,
    documents: storedDocs,
  } = useDocumentStore()

  const { user } = useUserIdentity()
  const setFiles = useFileStore((s) => s.setFiles)
  const openFile = useFileStore((s) => s.openFile)
  const setCurrentPermission = useShareStore((s) => s.setCurrentPermission)

  const isAuthenticated = user?.isAuthenticated ?? false

  // --- Queries ---

  const {
    data: documents = [],
    isLoading,
  } = useQuery<DocumentMeta[]>({
    queryKey: ["documents"],
    queryFn: async () => {
      const res = await fetch("/api/documents")
      if (!res.ok) throw new Error("Failed to fetch documents")
      return res.json()
    },
    enabled: isAuthenticated,
    staleTime: 30_000,
  })

  // --- Mutations ---

  const createMutation = useMutation({
    mutationFn: async ({ title, projectId }: { title?: string; projectId?: string | null }) => {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || "Untitled Document",
          projectId: projectId || null,
        }),
      })
      if (!res.ok) throw new Error("Failed to create document")
      return res.json() as Promise<DocumentMeta>
    },
    onSuccess: (doc) => {
      queryClient.setQueryData<DocumentMeta[]>(["documents"], (old) =>
        old ? [doc, ...old] : [doc]
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete document")
      return docId
    },
    onSuccess: (docId) => {
      queryClient.setQueryData<DocumentMeta[]>(["documents"], (old) =>
        old ? old.filter((d) => d.id !== docId) : []
      )
      if (activeDocumentId === docId) {
        setActiveDocumentId(null)
      }
    },
  })

  const renameMutation = useMutation({
    mutationFn: async ({ docId, title }: { docId: string; title: string }) => {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error("Failed to rename document")
      return { docId, title }
    },
    onSuccess: ({ docId, title }) => {
      queryClient.setQueryData<DocumentMeta[]>(["documents"], (old) =>
        old ? old.map((d) => (d.id === docId ? { ...d, title } : d)) : []
      )
    },
  })

  // --- Callbacks (keep same API for consumers) ---

  const fetchDocuments = useCallback(async () => {
    if (!isAuthenticated) return
    queryClient.invalidateQueries({ queryKey: ["documents"] })
  }, [isAuthenticated, queryClient])

  const createDocument = useCallback(
    async (title?: string, projectId?: string | null) => {
      if (!isAuthenticated) return null
      try {
        return await createMutation.mutateAsync({ title, projectId })
      } catch (err) {
        console.error("[useDocuments] Failed to create document:", err)
        return null
      }
    },
    [isAuthenticated, createMutation]
  )

  const addDocument = useDocumentStore((s) => s.addDocument)

  const loadDocument = useCallback(
    async (docId: string) => {
      if (!isAuthenticated) return
      try {
        const res = await fetch(`/api/documents/${docId}`)
        if (res.ok) {
          const doc = await res.json()
          const files = parseDocumentContent(doc.content)
          setFiles(files)

          const mainFile = findMainFile(files)
          openFile(mainFile.id)

          setActiveDocumentId(docId)

          // Ensure document meta is in the store for header/sidebar display
          const exists = storedDocs.some((d) => d.id === docId)
          if (!exists) {
            addDocument({
              id: doc.id,
              title: doc.title,
              folder: doc.folder,
              folderId: doc.folderId,
              projectId: doc.projectId,
              createdAt: doc.createdAt,
              updatedAt: doc.updatedAt,
            })
          }

          if (doc.permission) {
            setCurrentPermission(doc.permission as UserPermission)
          }
        }
      } catch (err) {
        console.error("[useDocuments] Failed to load document:", err)
      }
    },
    [isAuthenticated, setFiles, openFile, setActiveDocumentId, setCurrentPermission, storedDocs, addDocument]
  )

  const deleteDocument = useCallback(
    async (docId: string) => {
      if (!isAuthenticated) return
      try {
        await deleteMutation.mutateAsync(docId)
      } catch (err) {
        console.error("[useDocuments] Failed to delete document:", err)
      }
    },
    [isAuthenticated, deleteMutation]
  )

  const renameDocument = useCallback(
    async (docId: string, title: string) => {
      if (!isAuthenticated) return
      try {
        await renameMutation.mutateAsync({ docId, title })
      } catch (err) {
        console.error("[useDocuments] Failed to rename document:", err)
      }
    },
    [isAuthenticated, renameMutation]
  )

  return {
    documents,
    activeDocumentId,
    isLoading,
    isAuthenticated,
    fetchDocuments,
    createDocument,
    loadDocument,
    deleteDocument,
    renameDocument,
  }
}
