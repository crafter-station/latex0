import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { ProjectsSidebar } from "./projects-sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { IconSearch, IconPlus } from "@tabler/icons-react"

export function ProjectsLoader() {
  return (
    <SidebarProvider
      className="!min-h-0 h-svh overflow-hidden"
      style={{ "--sidebar-width": "320px" } as React.CSSProperties}
    >
      <ProjectsSidebar />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col m-2 ml-0 rounded-xl bg-background shadow-sm overflow-hidden">
          {/* Toolbar */}
          <div className="flex h-10 shrink-0 items-center gap-3 px-3">
            <SidebarTrigger className="shrink-0" />
            <div className="h-4 w-24 bg-muted rounded animate-pulse" />
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search projects..."
                  disabled
                  className="pl-8 h-7 w-48 text-xs"
                />
              </div>
              <Button size="sm" className="h-7 gap-1.5 text-xs rounded-full" disabled>
                <IconPlus className="size-3.5" />
                New Project
              </Button>
            </div>
          </div>

          {/* Content - Skeleton Grid */}
          <div className="flex-1 overflow-auto p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <ProjectCardSkeleton key={i} delay={i * 50} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </SidebarProvider>
  )
}

function ProjectCardSkeleton({ delay }: { delay: number }) {
  return (
    <div
      className="group relative flex flex-col rounded-lg border bg-card p-4 transition-all hover:shadow-md animate-pulse"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Project Icon Skeleton */}
      <div className="mb-3 flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 bg-muted rounded" />
          <div className="h-3 w-1/2 bg-muted/70 rounded" />
        </div>
      </div>

      {/* Description Skeleton */}
      <div className="mb-4 space-y-2">
        <div className="h-3 w-full bg-muted/70 rounded" />
        <div className="h-3 w-5/6 bg-muted/70 rounded" />
        <div className="h-3 w-2/3 bg-muted/70 rounded" />
      </div>

      {/* Footer Skeleton */}
      <div className="mt-auto flex items-center justify-between pt-3 border-t">
        <div className="h-3 w-20 bg-muted/70 rounded" />
        <div className="h-6 w-6 bg-muted/70 rounded-full" />
      </div>
    </div>
  )
}
