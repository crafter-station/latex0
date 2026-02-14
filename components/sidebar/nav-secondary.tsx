"use client"

import * as React from "react"
import { useCallback } from "react"
import { type Icon } from "@tabler/icons-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavSecondary({
  items,
  ...props
}: {
  items: {
    title: string
    url: string
    icon: Icon
    soon?: boolean
  }[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const handleClick = useCallback((title: string) => {
    if (title === "Search") {
      // Open command palette
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
      }))
    }
  }, [])

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isDisabled = item.soon && item.title !== "Search"
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  disabled={isDisabled}
                  onClick={() => handleClick(item.title)}
                >
                  <item.icon />
                  <span>{item.title}</span>
                  {isDisabled && (
                    <span className="ml-auto rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-white/30">
                      Soon
                    </span>
                  )}
                  {item.title === "Search" && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      ⌘K
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
