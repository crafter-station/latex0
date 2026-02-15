"use client"

import { useState, useEffect } from "react"
import { IconX } from "@tabler/icons-react"
import { useUserIdentity } from "@/hooks/use-user-identity"

const DISMISSED_KEY = "playground-banner-dismissed"

export function PlaygroundBanner() {
  const [isDismissed, setIsDismissed] = useState(true)
  const { user } = useUserIdentity()

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISSED_KEY)
    setIsDismissed(dismissed === "true")
  }, [])

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true")
    setIsDismissed(true)
  }

  // Only show for unauthenticated users
  if (user?.isAuthenticated || isDismissed) return null

  return (
    <div className="flex items-center justify-center gap-1.5 border-b border-border/40 px-3 py-1">
      <span className="text-[11px] text-muted-foreground">
        Playground — changes aren&apos;t saved.
      </span>
      <button
        onClick={handleDismiss}
        className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        <IconX className="size-3" />
      </button>
    </div>
  )
}
