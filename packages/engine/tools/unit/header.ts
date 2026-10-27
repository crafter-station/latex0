// Fixture header: leading `% key: value` comment lines.
//   % fixture: text/paragraph-basic
//   % tier: T3            target tier (T0 structural … T3 DVI-exact)
//   % engine: paragraph   adapter that turns the fixture into an engine layout
//   % covers: …           free text, what the fixture exercises
//   % issue: #112         optional, issue that owns this fixture
//   % xfail: reason       expected to fail until the named work lands; passing is reported as xpass
//   % oracle: pdflatex    the reference TeX: latex (dvips, the default) or pdflatex (PDF, positions from its box dumps)
//   % files: a.png b.jpg  files next to the fixture that TeX reads (images); the engine gets their sizes
//   % specials: compare  also compare every page's specials, in order and at their positions (the DVI's for latex;
//                        for pdflatex, the specials and pdfTeX whatsits its box dumps show)

export type Tier = "T0" | "T1" | "T2" | "T3"
export interface FixtureHeader { fixture?: string; tier: Tier; engine?: string; covers?: string; issue?: string; xfail?: string; oracle: "latex" | "pdflatex"; files: string[]; specials: boolean }

export function parseHeader(src: string): FixtureHeader {
  const fields: Record<string, string> = {}
  for (const line of src.split("\n")) {
    const m = line.match(/^%\s*([a-z]+):\s*(.*?)\s*$/)
    if (!m) break
    fields[m[1]] = m[2]
  }
  const tier = (fields.tier ?? "T3") as Tier
  if (!["T0", "T1", "T2", "T3"].includes(tier)) throw new Error(`bad tier "${fields.tier}"`)
  const oracle = (fields.oracle ?? "latex") as FixtureHeader["oracle"]
  if (!["latex", "pdflatex"].includes(oracle)) throw new Error(`bad oracle "${fields.oracle}"`)
  if (fields.specials !== undefined && fields.specials !== "compare") throw new Error(`bad specials "${fields.specials}"`)
  return { fixture: fields.fixture, tier, engine: fields.engine, covers: fields.covers, issue: fields.issue, xfail: fields.xfail, oracle, files: fields.files ? fields.files.split(/\s+/).filter(Boolean) : [], specials: fields.specials === "compare" }
}
