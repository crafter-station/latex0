import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

// The exact engine's data (packages/engine/data), served as static files for the preview's worker,
// which fetches each one the first time a document needs it.

const DATA = join(process.cwd(), "packages/engine/data")

export const dynamic = "force-static"
export const dynamicParams = false

export async function generateStaticParams(): Promise<{ path: string[] }[]> {
  const entries = await readdir(DATA, { recursive: true, withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => ({ path: [...join(e.parentPath, e.name).slice(DATA.length + 1).split("/")] }))
}

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  if (!path.every((p) => /^[\w.-]+$/.test(p) && p !== "..")) return new Response("not found", { status: 404 })
  const text = await readFile(join(DATA, ...path), "utf8")
  return new Response(text, { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } })
}
