import { AppSidebar } from "@/components/layout/app-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { QueryProvider } from "@/components/providers/query-provider"

export default function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <QueryProvider>
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
    </QueryProvider>
  )
}
