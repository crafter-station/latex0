import { QueryProvider } from "@/components/providers/query-provider"

export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <QueryProvider>
      {children}
    </QueryProvider>
  )
}
