"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { getFingerprint, generateColor, generateUserName } from "@/lib/fingerprint"
import type { RealtimeChannel } from "@supabase/supabase-js"

export interface CursorPosition {
  line: number
  column: number
}

export interface CursorState {
  odId: string
  odName: string
  odColor: string
  position: CursorPosition
  fileId: string
}

export interface OnlineUser {
  odId: string
  odName: string
  odColor: string
}

interface CursorBroadcastPayload {
  odId: string
  odName: string
  odColor: string
  position: CursorPosition
  fileId: string
}

interface ContentBroadcastPayload {
  odId: string
  fileId: string
  content: string
  timestamp: number
}

interface PresenceState {
  odId: string
  odName: string
  odColor: string
  online_at: string
}

const CURSOR_THROTTLE_MS = 50
const CONTENT_THROTTLE_MS = 150

export function useRealtimeCursors(
  roomName: string,
  fileId: string,
  onRemoteContentChange?: (fileId: string, content: string) => void
) {
  const [cursors, setCursors] = useState<Map<string, CursorState>>(new Map())
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [localUser, setLocalUser] = useState<{
    odId: string
    odName: string
    odColor: string
  } | null>(null)

  const channelRef = useRef<RealtimeChannel | null>(null)
  // Ref to always have current localUser value in callbacks
  const localUserRef = useRef<typeof localUser>(null)

  // Cursor throttling refs
  const lastCursorBroadcastRef = useRef<number>(0)
  const pendingCursorRef = useRef<CursorPosition | null>(null)
  const cursorThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Content throttling refs
  const lastContentBroadcastRef = useRef<number>(0)
  const pendingContentRef = useRef<{ fileId: string; content: string } | null>(null)
  const contentThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track if we're applying remote changes to avoid echo
  const isApplyingRemoteRef = useRef<boolean>(false)

  // Initialize fingerprint and user info
  useEffect(() => {
    async function initUser() {
      const odId = await getFingerprint()
      const odName = generateUserName(odId)
      const odColor = generateColor(odId)
      const user = { odId, odName, odColor }
      setLocalUser(user)
      localUserRef.current = user
    }
    initUser()
  }, [])

  // Subscribe to realtime channel with Presence
  useEffect(() => {
    if (!localUser) return

    const channel = supabase.channel(roomName, {
      config: {
        broadcast: {
          self: false,
        },
        presence: {
          key: localUser.odId,
        },
      },
    })

    // Handle presence sync - when we first connect, get all online users
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState()
      console.log("[Presence] Sync - current state:", state)

      const users: OnlineUser[] = []
      for (const [, presences] of Object.entries(state)) {
        const presence = (presences as unknown as PresenceState[])[0]
        if (presence?.odId && presence.odId !== localUser.odId) {
          users.push({
            odId: presence.odId,
            odName: presence.odName,
            odColor: presence.odColor,
          })
        }
      }
      console.log("[Presence] Online users (excluding self):", users.length)
      setOnlineUsers(users)
    })

    // Handle presence join
    channel.on("presence", { event: "join" }, ({ key, newPresences }) => {
      console.log("[Presence] User joined:", key, newPresences)
    })

    // Handle presence leave
    channel.on("presence", { event: "leave" }, ({ key, leftPresences }) => {
      console.log("[Presence] User left:", key, leftPresences)
      // Also remove their cursor
      setCursors((prev) => {
        const next = new Map(prev)
        next.delete(key)
        return next
      })
    })

    // Handle cursor broadcasts
    channel.on("broadcast", { event: "cursor" }, ({ payload }: { payload: CursorBroadcastPayload }) => {
      console.log("[Broadcast] Received cursor:", payload.odName, "at line", payload.position.line)
      if (payload.odId === localUser.odId) return

      setCursors((prev) => {
        const next = new Map(prev)
        next.set(payload.odId, {
          odId: payload.odId,
          odName: payload.odName,
          odColor: payload.odColor,
          position: payload.position,
          fileId: payload.fileId,
        })
        return next
      })
    })

    // Handle content broadcasts
    channel.on("broadcast", { event: "content" }, ({ payload }: { payload: ContentBroadcastPayload }) => {
      if (payload.odId === localUser.odId) return

      if (onRemoteContentChange) {
        isApplyingRemoteRef.current = true
        onRemoteContentChange(payload.fileId, payload.content)
        setTimeout(() => {
          isApplyingRemoteRef.current = false
        }, 50)
      }
    })

    // Subscribe and track presence
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        console.log("[Channel] Subscribed, tracking presence...")
        await channel.track({
          odId: localUser.odId,
          odName: localUser.odName,
          odColor: localUser.odColor,
          online_at: new Date().toISOString(),
        })
      }
    })

    channelRef.current = channel

    return () => {
      console.log("[Channel] Unsubscribing...")
      channel.unsubscribe()
      channelRef.current = null
    }
  }, [roomName, localUser, onRemoteContentChange])

  // Broadcast cursor position with throttling
  const broadcastPosition = useCallback(
    (position: CursorPosition) => {
      const user = localUserRef.current
      if (!channelRef.current || !user) {
        console.log("[Broadcast] Cannot send - channel:", !!channelRef.current, "localUser:", !!user)
        return
      }

      console.log("[Broadcast] Sending cursor position:", position)

      const now = Date.now()
      const timeSinceLastBroadcast = now - lastCursorBroadcastRef.current

      const sendBroadcast = (pos: CursorPosition) => {
        const currentUser = localUserRef.current
        if (!channelRef.current || !currentUser) return

        console.log("[Broadcast] Actually sending cursor:", currentUser.odName, "at", pos, "fileId:", fileId)
        channelRef.current.send({
          type: "broadcast",
          event: "cursor",
          payload: {
            odId: currentUser.odId,
            odName: currentUser.odName,
            odColor: currentUser.odColor,
            position: pos,
            fileId,
          } satisfies CursorBroadcastPayload,
        })
        lastCursorBroadcastRef.current = Date.now()
        pendingCursorRef.current = null
      }

      if (timeSinceLastBroadcast >= CURSOR_THROTTLE_MS) {
        sendBroadcast(position)
      } else {
        pendingCursorRef.current = position

        if (!cursorThrottleRef.current) {
          cursorThrottleRef.current = setTimeout(() => {
            cursorThrottleRef.current = null
            if (pendingCursorRef.current) {
              sendBroadcast(pendingCursorRef.current)
            }
          }, CURSOR_THROTTLE_MS - timeSinceLastBroadcast)
        }
      }
    },
    [fileId]
  )

  // Broadcast content with throttling
  const broadcastContent = useCallback(
    (contentFileId: string, content: string) => {
      const user = localUserRef.current
      // Don't broadcast if we're applying remote changes
      if (!channelRef.current || !user || isApplyingRemoteRef.current) return

      const now = Date.now()
      const timeSinceLastBroadcast = now - lastContentBroadcastRef.current

      const sendBroadcast = (fId: string, c: string) => {
        const currentUser = localUserRef.current
        if (!channelRef.current || !currentUser) return

        channelRef.current.send({
          type: "broadcast",
          event: "content",
          payload: {
            odId: currentUser.odId,
            fileId: fId,
            content: c,
            timestamp: Date.now(),
          } satisfies ContentBroadcastPayload,
        })
        lastContentBroadcastRef.current = Date.now()
        pendingContentRef.current = null
      }

      if (timeSinceLastBroadcast >= CONTENT_THROTTLE_MS) {
        sendBroadcast(contentFileId, content)
      } else {
        pendingContentRef.current = { fileId: contentFileId, content }

        if (!contentThrottleRef.current) {
          contentThrottleRef.current = setTimeout(() => {
            contentThrottleRef.current = null
            if (pendingContentRef.current) {
              sendBroadcast(pendingContentRef.current.fileId, pendingContentRef.current.content)
            }
          }, CONTENT_THROTTLE_MS - timeSinceLastBroadcast)
        }
      }
    },
    []
  )

  // Filter cursors to only show those in the current file
  const allCursorsArray = Array.from(cursors.values())
  const fileCursors = allCursorsArray.filter(
    (cursor) => cursor.fileId === fileId
  )

  // Cleanup throttle timeouts on unmount
  useEffect(() => {
    return () => {
      if (cursorThrottleRef.current) {
        clearTimeout(cursorThrottleRef.current)
      }
      if (contentThrottleRef.current) {
        clearTimeout(contentThrottleRef.current)
      }
    }
  }, [])

  return {
    cursors: fileCursors,
    onlineUsers,
    broadcastPosition,
    broadcastContent,
    localUser,
    allCursors: Array.from(cursors.values()),
    isApplyingRemote: isApplyingRemoteRef,
  }
}
