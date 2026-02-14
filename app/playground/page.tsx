"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { IdeLayout } from "@/components/layout/ide-layout"
import { useUserIdentity } from "@/hooks/use-user-identity"

export default function Playground() {
  const router = useRouter()
  const { user, isLoading } = useUserIdentity()
  const isAuthenticated = user?.isAuthenticated ?? false

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/projects")
    }
  }, [isLoading, isAuthenticated, router])

  if (isLoading || isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">Redirecting...</div>
      </div>
    )
  }

  return <IdeLayout />
}
