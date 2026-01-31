/**
 * Unified user identity interface
 * Works for both authenticated Clerk users and anonymous fingerprint users
 */
export interface UserIdentity {
  /** Unique identifier - Clerk user ID or fingerprint ID */
  id: string

  /** Display name - Clerk full name or generated researcher name */
  name: string

  /** Email address - only available for Clerk users */
  email?: string

  /** Avatar URL - only available for Clerk users */
  avatar?: string

  /** Consistent color for UI display (cursors, presence, etc) */
  color: string

  /** Whether this is an authenticated Clerk user */
  isAuthenticated: boolean

  /** Optional initials for avatar fallback */
  initials?: string
}

/**
 * User data shape for realtime collaboration
 * Used in Supabase presence broadcasts
 */
export interface RealtimeUser {
  odId: string      // User identifier
  odName: string    // Display name
  odColor: string   // Color for UI elements
  odAvatar?: string // Optional avatar URL (for Clerk users)
}
