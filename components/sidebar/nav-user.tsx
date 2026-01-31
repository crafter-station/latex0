"use client"

import {
  IconCreditCard,
  IconDotsVertical,
  IconLogout,
  IconNotification,
  IconUserCircle,
} from "@tabler/icons-react"
import { useClerk } from "@clerk/nextjs"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import type { UserIdentity } from "@/types/user"

export function NavUser({
  user,
}: {
  user: UserIdentity
}) {
  const { isMobile } = useSidebar()
  const { signOut, openUserProfile } = useClerk()

  const handleSignOut = () => {
    signOut({ redirectUrl: "/" })
  }

  const handleOpenAccount = () => {
    openUserProfile()
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg grayscale">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">
                  {user.initials || user.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {user.email || "Guest User"}
                </span>
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-lg">
                    {user.initials || user.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email || "Guest User"}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Only show these options for authenticated users */}
            {user.isAuthenticated && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={handleOpenAccount}>
                    <IconUserCircle />
                    Account
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}

            {/* Sign out button - only for authenticated users */}
            {user.isAuthenticated && (
              <DropdownMenuItem onClick={handleSignOut}>
                <IconLogout />
                Log out
              </DropdownMenuItem>
            )}

            {/* For guest users, show a sign-in prompt */}
            {!user.isAuthenticated && (
              <DropdownMenuItem asChild>
                <a href="/" className="cursor-pointer">
                  <IconUserCircle />
                  Sign in to save work
                </a>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
