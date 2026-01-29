"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface User {
  odId: string
  odName: string
  odColor: string
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
