// Package boundary (#38): @latex0/engine stays extractable to npm. Every import
// is a relative path that stays inside the package; only dev tooling (tools/)
// may also use Node built-ins. No app code (`@/…`), no dependencies.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const ROOT = "packages/engine"
const IMPORT = /(?:^|\n)\s*(?:import|export)\b[^"'`]*?from\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s*["']([^"']+)["']/g

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (f === "node_modules" || f.startsWith(".")) return []
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

export function boundaryViolations(root = ROOT): string[] {
  const out: string[] = []
  for (const file of files(root)) {
    const tooling = relative(root, file).startsWith("tools/")
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3]
      if (spec.startsWith("node:") ? tooling : spec.startsWith(".") && !relative(resolve(root), resolve(dirname(file), spec)).startsWith("..")) continue
      out.push(`${file}: imports "${spec}"${spec.startsWith("node:") ? " outside tools/" : ""}`)
    }
  }
  return out
}

export function boundaryCheck(): number {
  const bad = boundaryViolations()
  console.log(bad.length ? `✗ ${bad.length} imports cross the package boundary:\n${bad.join("\n")}` : "✓ the engine imports only its own files")
  return bad.length ? 1 : 0
}
