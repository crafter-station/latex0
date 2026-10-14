#!/usr/bin/env bun
// latex0 engine CLI (dev tooling). Grows per issue #39.
//   bun engine trace <fixture.tex>      TeX oracle trace (glyph positions in sp) as JSON
//   bun engine oracle:check             self-check the oracle against pdflatex
//   bun engine check:paragraph [fixture]  engine layout vs TeX at 0 sp (#29)
import { oracleTrace } from "./oracle/oracle"

const [cmd, ...args] = process.argv.slice(2)
switch (cmd) {
  case "trace": {
    if (!args[0]) throw new Error("usage: bun engine trace <fixture.tex>")
    console.log(JSON.stringify(oracleTrace(args[0]), null, 1))
    break
  }
  case "check:paragraph": {
    const { checkParagraph } = await import("./checks/paragraph")
    const fx = args[0] ?? "lib/latex/fixtures/micro/text/paragraph-basic.tex"
    if (!checkParagraph(fx)) process.exit(1)
    break
  }
  case "oracle:check":
    await import("./oracle/selfcheck")
    break
  default:
    console.log("usage: bun engine <trace|oracle:check|check:paragraph> ...")
    process.exit(cmd ? 1 : 0)
}
