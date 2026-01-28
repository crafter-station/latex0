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

const CURSOR_THROTTLE_MS = 50
const CONTENT_THROTTLE_MS = 150

export function useRealtimeCursors(
  roomName: string,
  fileId: string,
  onRemoteContentChange?: (fileId: string, content: string) => void
) {
  const [cursors, setCursors] = useState<Map<string, CursorState>>(new Map())
  const [localUser, setLocalUser] = useState<{
    odId: string
    odName: string
    odColor: string
  } | null>(null)

  const channelRef = useRef<RealtimeChannel | null>(null)

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
      setLocalUser({ odId, odName, odColor })
    }
    initUser()
  }, [])

  // Subscribe to realtime channel
  useEffect(() => {
    if (!localUser) return

    const channel = supabase.channel(roomName, {
      config: {
        broadcast: {
          self: false,
        },
      },
    })

    channel
      .on("broadcast", { event: "cursor" }, ({ payload }: { payload: CursorBroadcastPayload }) => {
        console.log("[Realtime] Received cursor event:", payload)
        if (payload.odId === localUser.odId) {
          console.log("[Realtime] Ignoring own cursor")
          return
        }

        console.log("[Realtime] Adding cursor for", payload.odName, "fileId:", payload.fileId)
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
      .on("broadcast", { event: "content" }, ({ payload }: { payload: ContentBroadcastPayload }) => {
        if (payload.odId === localUser.odId) return

        // Apply remote content change
        if (onRemoteContentChange) {
          isApplyingRemoteRef.current = true
          onRemoteContentChange(payload.fileId, payload.content)
          // Reset flag after a short delay to allow state to settle
          setTimeout(() => {
            isApplyingRemoteRef.current = false
          }, 50)
        }
      })
      .on("broadcast", { event: "leave" }, ({ payload }: { payload: { odId: string } }) => {
        setCursors((prev) => {
          const next = new Map(prev)
          next.delete(payload.odId)
          return next
        })
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current && localUser) {
        channelRef.current.send({
          type: "broadcast",
          event: "leave",
          payload: { odId: localUser.odId },
        })
      }
      channel.unsubscribe()
      channelRef.current = null
    }
  }, [roomName, localUser, onRemoteContentChange])

  // Broadcast cursor position with throttling
  const broadcastPosition = useCallback(
    (position: CursorPosition) => {
      if (!channelRef.current || !localUser) return

      const now = Date.now()
      const timeSinceLastBroadcast = now - lastCursorBroadcastRef.current

      const sendBroadcast = (pos: CursorPosition) => {
        if (!channelRef.current || !localUser) return

        channelRef.current.send({
          type: "broadcast",
          event: "cursor",
          payload: {
            odId: localUser.odId,
            odName: localUser.odName,
            odColor: localUser.odColor,
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
    [localUser, fileId]
  )

  // Broadcast content with throttling
  const broadcastContent = useCallback(
    (contentFileId: string, content: string) => {
      // Don't broadcast if we're applying remote changes
      if (!channelRef.current || !localUser || isApplyingRemoteRef.current) return

      const now = Date.now()
      const timeSinceLastBroadcast = now - lastContentBroadcastRef.current

      const sendBroadcast = (fId: string, c: string) => {
        if (!channelRef.current || !localUser) return

        channelRef.current.send({
          type: "broadcast",
          event: "content",
          payload: {
            odId: localUser.odId,
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
    [localUser]
  )

  // Filter cursors to only show those in the current file
  const allCursorsArray = Array.from(cursors.values())
  const fileCursors = allCursorsArray.filter(
    (cursor) => cursor.fileId === fileId
  )

  // Debug logging
  if (allCursorsArray.length > 0) {
    console.log("[Realtime] All cursors:", allCursorsArray.length, "Filtered for fileId", fileId, ":", fileCursors.length)
  }

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
    broadcastPosition,
    broadcastContent,
    localUser,
    allCursors: Array.from(cursors.values()),
    isApplyingRemote: isApplyingRemoteRef,
  }
}
