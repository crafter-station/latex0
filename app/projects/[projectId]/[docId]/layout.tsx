import { AppSidebar } from "@/components/layout/app-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"

export default function EditorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider
      className="!min-h-0 h-svh overflow-hidden"
      style={
        {
          "--sidebar-width": "320px",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      {children}
    </SidebarProvider>
  )
}
