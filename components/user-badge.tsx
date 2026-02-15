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
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/80 border border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300 transition-all">
          <Avatar className="h-5 w-5 rounded-full">
            <AvatarImage src={user.imageUrl} alt={user.fullName || "User"} />
            <AvatarFallback className="text-[10px] bg-neutral-100 text-neutral-600">
              {user.firstName?.[0]}{user.lastName?.[0]}
            </AvatarFallback>
          </Avatar>
          <span className="font-mono text-xs text-neutral-600">
            {user.firstName || user.username || "User"}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 bg-white border-neutral-200"
      >
        <DropdownMenuLabel className="font-mono text-xs text-neutral-600">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8 rounded-full">
              <AvatarImage src={user.imageUrl} alt={user.fullName || "User"} />
              <AvatarFallback className="bg-neutral-100 text-neutral-600">
                {user.firstName?.[0]}{user.lastName?.[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium text-neutral-900">{user.fullName || user.username}</span>
              <span className="text-[10px] text-neutral-400">{user.primaryEmailAddress?.emailAddress}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-neutral-200" />
        <DropdownMenuItem
          onClick={() => openUserProfile()}
          className="font-mono text-xs text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 cursor-pointer"
        >
          <IconUserCircle className="mr-2 h-4 w-4" />
          Account
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-neutral-200" />
        <DropdownMenuItem
          onClick={() => signOut({ redirectUrl: "/" })}
          className="font-mono text-xs text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 cursor-pointer"
        >
          <IconLogout className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
