"use client"

import { useCallback } from "react"
import { useDocumentStore, type DocumentMeta } from "@/lib/document-store"
import { useFileStore } from "@/lib/file-store"
import { useShareStore } from "@/lib/share-store"
import { useUserIdentity } from "@/hooks/use-user-identity"
import { parseDocumentContent } from "@/lib/content-parser"
import { findMainFile } from "@/lib/file-utils"
import type { UserPermission } from "@/lib/db/schema"

export function useDocuments() {
  const {
    documents,
    activeDocumentId,
    isLoading,
    setDocuments,
    setActiveDocumentId,
    setLoading,
    addDocument,
    removeDocument,
    updateDocumentMeta,
  } = useDocumentStore()

  const { user } = useUserIdentity()
  const setFiles = useFileStore((s) => s.setFiles)
  const openFile = useFileStore((s) => s.openFile)
  const setCurrentPermission = useShareStore((s) => s.setCurrentPermission)

  const isAuthenticated = user?.isAuthenticated ?? false

  const fetchDocuments = useCallback(async () => {
    if (!isAuthenticated) return
    setLoading(true)
    try {
      const res = await fetch("/api/documents")
      if (res.ok) {
        const data: DocumentMeta[] = await res.json()
        setDocuments(data)
      }
    } catch (err) {
      console.error("[useDocuments] Failed to fetch documents:", err)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated, setDocuments, setLoading])

  const createDocument = useCallback(
    async (title?: string) => {
      if (!isAuthenticated) return null
      try {
        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title || "Untitled Document" }),
        })
        if (res.ok) {
          const doc: DocumentMeta = await res.json()
          addDocument(doc)
          return doc
        }
      } catch (err) {
        console.error("[useDocuments] Failed to create document:", err)
      }
      return null
    },
    [isAuthenticated, addDocument]
  )

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
          if (doc.permission) {
            setCurrentPermission(doc.permission as UserPermission)
          }
        }
      } catch (err) {
        console.error("[useDocuments] Failed to load document:", err)
      }
    },
    [isAuthenticated, setFiles, openFile, setActiveDocumentId, setCurrentPermission]
  )

  const saveDocument = useCallback(
    async (content: string) => {
      if (!isAuthenticated || !activeDocumentId) return
      try {
        await fetch(`/api/documents/${activeDocumentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        })
        updateDocumentMeta(activeDocumentId, {
          updatedAt: new Date(),
        })
      } catch (err) {
        console.error("[useDocuments] Failed to save document:", err)
      }
    },
    [isAuthenticated, activeDocumentId, updateDocumentMeta]
  )

  const deleteDocument = useCallback(
    async (docId: string) => {
      if (!isAuthenticated) return
      try {
        const res = await fetch(`/api/documents/${docId}`, {
          method: "DELETE",
        })
        if (res.ok) {
          removeDocument(docId)
        }
      } catch (err) {
        console.error("[useDocuments] Failed to delete document:", err)
      }
    },
    [isAuthenticated, removeDocument]
  )

  const renameDocument = useCallback(
    async (docId: string, title: string) => {
      if (!isAuthenticated) return
      try {
        const res = await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        })
        if (res.ok) {
          updateDocumentMeta(docId, { title })
        }
      } catch (err) {
        console.error("[useDocuments] Failed to rename document:", err)
      }
    },
    [isAuthenticated, updateDocumentMeta]
  )

  return {
    documents,
    activeDocumentId,
    isLoading,
    isAuthenticated,
    fetchDocuments,
    createDocument,
    loadDocument,
    saveDocument,
    deleteDocument,
    renameDocument,
  }
}
