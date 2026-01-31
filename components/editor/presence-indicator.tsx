"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

interface User {
  odId: string
  odName: string
  odColor: string
  odAvatar?: string // NEW: Support for Clerk avatars
}

interface PresenceIndicatorProps {
  users: User[]
  localUser: User | null
}

export function PresenceIndicator({ users, localUser }: PresenceIndicatorProps) {
  const allUsers = localUser ? [localUser, ...users] : users

  if (allUsers.length === 0) return null

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-black/40 dark:text-white/40 mr-1">
        {allUsers.length} online
      </span>
      <div className="flex -space-x-1.5">
        {allUsers.slice(0, 5).map((user, index) => (
          <Tooltip key={user.odId}>
            <TooltipTrigger asChild>
              {user.odAvatar ? (
                // For authenticated Clerk users - show avatar image
                <Avatar
                  className="w-6 h-6 rounded-full border-2 border-white dark:border-[#0A0A0A] cursor-default"
                  style={{ zIndex: 10 - index }}
                >
                  <AvatarImage src={user.odAvatar} alt={user.odName} />
                  <AvatarFallback
                    className="text-[10px] font-bold"
                    style={{ backgroundColor: user.odColor, color: '#000' }}
                  >
                    {user.odName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ) : (
                // For guest users - show colored circle with initials
                <div
                  className="w-6 h-6 rounded-full border-2 border-white dark:border-[#0A0A0A] flex items-center justify-center text-[10px] font-bold cursor-default"
                  style={{
                    backgroundColor: user.odColor,
                    color: '#000',
                    zIndex: 10 - index
                  }}
                >
                  {user.odName.slice(-2)}
                </div>
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {user.odName} {localUser?.odId === user.odId && "(you)"}
            </TooltipContent>
          </Tooltip>
        ))}
        {allUsers.length > 5 && (
          <div className="w-6 h-6 rounded-full border-2 border-white dark:border-[#0A0A0A] bg-black/10 dark:bg-white/10 flex items-center justify-center text-[10px] text-black/60 dark:text-white/60">
            +{allUsers.length - 5}
          </div>
        )}
      </div>
    </div>
  )
}
