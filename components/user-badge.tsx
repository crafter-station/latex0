"use client"

import { useUser, useClerk } from "@clerk/nextjs"
import { IconUserCircle, IconLogout } from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"

export function UserBadge() {
  const { isSignedIn, isLoaded, user } = useUser()
  const { signOut, openUserProfile } = useClerk()

  if (!isLoaded || !isSignedIn || !user) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all">
          <Avatar className="h-5 w-5 rounded-full">
            <AvatarImage src={user.imageUrl} alt={user.fullName || "User"} />
            <AvatarFallback className="text-[10px] bg-white/20 text-white">
              {user.firstName?.[0]}{user.lastName?.[0]}
            </AvatarFallback>
          </Avatar>
          <span className="font-mono text-xs text-white/70">
            {user.firstName || user.username || "User"}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 bg-[#0A0A0A] border-white/10"
      >
        <DropdownMenuLabel className="font-mono text-xs text-white/70">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8 rounded-full">
              <AvatarImage src={user.imageUrl} alt={user.fullName || "User"} />
              <AvatarFallback className="bg-white/20 text-white">
                {user.firstName?.[0]}{user.lastName?.[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium text-white">{user.fullName || user.username}</span>
              <span className="text-[10px] text-white/50">{user.primaryEmailAddress?.emailAddress}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem
          onClick={() => openUserProfile()}
          className="font-mono text-xs text-white/70 hover:bg-white/10 hover:text-white cursor-pointer"
        >
          <IconUserCircle className="mr-2 h-4 w-4" />
          Account
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem
          onClick={() => signOut({ redirectUrl: "/" })}
          className="font-mono text-xs text-white/70 hover:bg-white/10 hover:text-white cursor-pointer"
        >
          <IconLogout className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
