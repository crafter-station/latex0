import { AppSidebar } from "@/components/layout/app-sidebar"
import { IdeLayout } from "@/components/layout/ide-layout"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function Playground() {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 56)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset className="h-svh overflow-hidden pt-2">
        <IdeLayout />
      </SidebarInset>
    </SidebarProvider>
  )
}
