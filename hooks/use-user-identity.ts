"use client"

import { useUser } from "@clerk/nextjs"
import { useEffect, useState } from "react"
import { getFingerprint, generateColor, generateUserName } from "@/lib/fingerprint"
import type { UserIdentity } from "@/types/user"

/**
 * Hybrid user identity hook
 * Returns authenticated Clerk user OR anonymous fingerprint user
 *
 * Priority:
 * 1. If Clerk user is signed in, return their data
 * 2. Otherwise, return fingerprint-based guest user
 */
export function useUserIdentity(): {
  user: UserIdentity | null
  isLoading: boolean
} {
  const { isSignedIn, user: clerkUser, isLoaded } = useUser()
  const [fingerprintUser, setFingerprintUser] = useState<UserIdentity | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)

  // Initialize fingerprint user (runs once on mount)
  useEffect(() => {
    async function initFingerprint() {
      try {
        const fingerprintId = await getFingerprint()
        const guestName = generateUserName(fingerprintId)
        const guestUser: UserIdentity = {
          id: fingerprintId,
          name: guestName,
          color: generateColor(fingerprintId),
          isAuthenticated: false,
          initials: guestName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2),
        }
        setFingerprintUser(guestUser)
      } catch (error) {
        console.error("[useUserIdentity] Failed to initialize fingerprint:", error)
      } finally {
        setIsInitializing(false)
      }
    }
    initFingerprint()
  }, [])

  // Return loading state while initializing
  if (!isLoaded || isInitializing) {
    return { user: null, isLoading: true }
  }

  // If user is signed in with Clerk, return their data
  if (isSignedIn && clerkUser) {
    const authenticatedUser: UserIdentity = {
      id: clerkUser.id,
      name: clerkUser.fullName || clerkUser.username || "User",
      email: clerkUser.primaryEmailAddress?.emailAddress,
      avatar: clerkUser.imageUrl,
      color: generateColor(clerkUser.id), // Generate consistent color from Clerk ID
      isAuthenticated: true,
      initials: clerkUser.firstName && clerkUser.lastName
        ? `${clerkUser.firstName[0]}${clerkUser.lastName[0]}`.toUpperCase()
        : clerkUser.fullName?.slice(0, 2).toUpperCase() || "U",
    }
    return { user: authenticatedUser, isLoading: false }
  }

  // Otherwise, return fingerprint guest user
  return { user: fingerprintUser, isLoading: false }
}
