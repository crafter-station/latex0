import type { Metadata } from "next"
import Link from "next/link"
import scorecard from "@/lib/latex/fixtures/scorecard.json"

export const metadata: Metadata = {
  title: "Engine scorecard · LATEX0",
  description: "Every fixture typeset by real TeX and by the LATEX0 engine, compared to the scaled point.",
}

const REPO = "https://github.com/crafter-station/latex0"

// Checks CI runs on every engine change, on generated input (.github/workflows/engine.yml)
const GENERATED = [
  { what: "Random paragraphs", detail: "line breaks with inline math and footnotes, page breaks, every page's boxes", count: "1,000" },
  { what: "Number, dimension and glue scans", detail: "values, errors and unscanned input", count: "20,000" },
  { what: "Dictionary words", detail: "hyphenation points against \\showhyphens", count: "20,000" },
  { what: "Words in 80 fonts and 40 synthetic fonts", detail: "ligatures, kerns, boundary characters, italic corrections", count: "10,000" },
  { what: "Macro programs", detail: "expansion results and \\meaning, against TeX", count: "3,000" },
  { what: "Documents with their own macros", detail: "typeset unchanged after the renderer's expansion", count: "300" },
  { what: "Math formulas", detail: "scripts, fractions, operators and styles, against \\showbox", count: "3,000" },
]

export default function ScorecardPage() {
  const { summary, areas, fixtures } = scorecard
  const pct = Math.round((summary.exact / summary.fixtures) * 100)
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <Link href="/" className="font-mono text-xs text-muted-foreground hover:text-foreground">
          ← LATEX0
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Engine scorecard</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Each fixture is typeset twice: by real TeX and by the LATEX0 engine, which has no TeX inside. A fixture counts only
          when the line breaks, the box tree and every glyph position are identical, to the scaled point (1/65536 pt). Whole
          documents from the editor's templates are in the corpus too; they turn green as the engine learns to lay them out.
        </p>

        <section className="mt-8 grid gap-3 sm:grid-cols-3">
          <Stat label="Fixtures identical to TeX" value={`${summary.exact}/${summary.fixtures}`} note={`${pct}%`} />
          <Stat label="Glyphs placed exactly" value={summary.glyphs.toLocaleString("en-US")} note="0 sp difference" />
          <Stat label="Not yet attempted" value={String(summary.pending)} note={summary.failing ? `${summary.failing} failing` : "0 failing"} />
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-medium">Also checked on every change</h2>
          <div className="mt-3 divide-y rounded-lg border">
            {GENERATED.map((g) => (
              <div key={g.what} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
                <div>
                  <div>{g.what}</div>
                  <div className="text-xs text-muted-foreground">{g.detail}</div>
                </div>
                <div className="shrink-0 font-mono text-xs text-muted-foreground">{g.count} identical</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-medium">By area</h2>
          <div className="mt-3 divide-y rounded-lg border">
            {areas.map((a) => (
              <div key={a.area} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-mono">{a.area}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {a.exact}/{a.fixtures}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-medium">Fixtures</h2>
          <ul className="mt-3 divide-y rounded-lg border">
            {fixtures.map((f) => (
              <li key={f.id} className="flex gap-3 px-4 py-3 text-sm">
                <span
                  aria-label={f.reached ? "identical" : f.status === "skip" ? "not yet attempted" : f.status}
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${f.reached ? "bg-emerald-500" : f.status === "skip" ? "bg-muted-foreground/40" : f.status === "xfail" ? "bg-amber-500" : "bg-red-500"}`}
                />
                <div className="min-w-0 flex-1">
                  <a href={`${REPO}/blob/main/lib/latex/fixtures/${f.file}`} className="break-all font-mono text-xs hover:underline">
                    {f.id}
                  </a>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.covers}</p>
                </div>
                {"issue" in f && f.issue ? (
                  <a href={`${REPO}/issues/${f.issue.replace("#", "")}`} className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground">
                    {f.issue}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-10 text-xs text-muted-foreground">
          Generated by <code className="font-mono">bun engine scorecard</code>; CI fails any change that makes a fixture stop matching.{" "}
          <a href={`${REPO}/blob/main/lib/latex/ROADMAP.md`} className="underline hover:text-foreground">
            Roadmap
          </a>
        </p>
      </div>
    </main>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-2xl">{value}</div>
      <div className="text-xs text-muted-foreground">{note}</div>
    </div>
  )
}
