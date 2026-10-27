// pgfkeys (pgfkeys.code.tex) as TikZ uses it: a tree of keys named by paths, each a value (\pgfk@<path>), a
// command (<path>/.@cmd) with one argument, or a default (<path>/.@def); a key list is split at commas and
// each item at `=` (\pgfkeys@unpack, 369–388), the key resolved in this order (\pgfkeys@case@one, two, three:
// 390–424): its command, its value, a handler named by its last component (/handlers/<name>), the path's
// .unknown command. Definitions are local to TeX's groups. A command is a list of parts: TS mirrors of
// pgf's and TikZ's macros, and \pgfkeysalso{…} bodies (styles) with #1 replaced; TeX code that is neither
// throws Unsupported when it runs. The handlers modeled are .code (bodies made of \pgfkeysalso, \pgfkeys and
// \tikzset), .style, .append style, .prefix style, .initial, .default, .value required,
// .is choice, .is family, .cd and .try; others, unknown keys and every TeX error throw Unsupported.

import { Unsupported } from "../latex/unsupported"
import { arg, groupEnd, isCs, meaning, same, spdef, splitAll, substitute, tokenize, type Tok, type Toks } from "./tokens"

/** \pgfkeysnovalue: what a key without `=` gets when it has no default */
export const NOVALUE: Toks = ["\\pgfkeysnovalue"]
/** \pgfkeysvaluerequired: the default of a key that must have a value */
export const REQUIRED: Toks = ["\\pgfkeysvaluerequired"]

/** one piece of a key's command; `v` is #1, undefined for \pgfkeysnovalue */
export type Part =
  /** a TikZ or pgf macro, mirrored */
  | { kind: "native"; run: (k: Keys, v: Toks | undefined) => void }
  /** \pgfkeysalso{body} (with the default path as it is), or \pgfqkeys{path}{body} when `path` is given */
  | { kind: "also"; body: Toks; path?: string }
  /** \pgfkeyssetvalue{path}{#1}: what .add code starts from when the key had no command */
  | { kind: "setvalue"; path: string }
  /** .is choice: \pgfkeysalso{\pgfkeyscurrentkey/#1} */
  | { kind: "choice" }
  /** .is family: the default path becomes the key's */
  | { kind: "cd"; path: string }
  /** TeX code not modeled */
  | { kind: "tex"; body: Toks }
export type Code = readonly Part[]

type Entry = { cmd: Code } | { toks: Toks }

/** TeX's text for a string of characters (a key path) */
export const chars = (s: string): Tok[] => [...s]

export class Keys {
  private layers: Map<string, Entry>[] = [new Map()]
  /** \pgfkeysdefaultpath */
  defaultPath = "/"
  /** \pgfkeyscurrentkey, \pgfkeyscurrentpath and \pgfkeyscurrentname as the last key left them */
  key = ""
  path = ""
  name = ""
  /** \ifpgfkeyssuccess */
  success = false

  begingroup() { this.layers.push(new Map()) }
  endgroup() {
    if (this.layers.length === 1) throw new Unsupported("pgfkeys: a group ends that did not begin")
    this.layers.pop()
  }

  private get(name: string): Entry | undefined {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const e = this.layers[i].get(name)
      if (e !== undefined) return e
    }
    return undefined
  }
  private put(name: string, e: Entry) { this.layers[this.layers.length - 1].set(name, e) }

  /** \pgfk@<path>/.@cmd */
  command(path: string): Code | undefined {
    const e = this.get(`${path}/.@cmd`)
    return e && "cmd" in e ? e.cmd : undefined
  }
  /** \pgfkeysvalueof{path}: the value, or undefined (\relax) */
  valueOf(path: string): Toks | undefined {
    const e = this.get(path)
    return e && "toks" in e ? e.toks : undefined
  }
  /** \pgfkeyssetvalue{path}{toks} */
  setValue(path: string, toks: Toks) { this.put(path, { toks }) }
  /** \pgfkeysdef{path}{code} (the key's command) */
  define(path: string, cmd: Code) { this.put(`${path}/.@cmd`, { cmd }) }
  /** \pgfkeysdef with a default: what \tikzoption does */
  option(path: string, run: (k: Keys, v: Toks | undefined) => void, def: Toks | string = REQUIRED) {
    this.define(path, [{ kind: "native", run }])
    this.setValue(`${path}/.@def`, typeof def === "string" ? tokenize(def, true) : def)
  }

  /** \pgfkeys{list} */
  pgfkeys(list: Toks | string) { this.withPath("/", list) }
  /** \pgfqkeys{path}{list} (\tikzset is \pgfqkeys{/tikz}) */
  pgfqkeys(path: string, list: Toks | string) { this.withPath(`${path}/`, list) }
  /** \pgfkeysalso{list}: the default path stays (and what .cd does to it stays) */
  also(list: Toks | string) { this.parse(typeof list === "string" ? tokenize(list, true) : list) }

  private withPath(path: string, list: Toks | string) {
    const saved = this.defaultPath
    this.defaultPath = path
    this.parse(typeof list === "string" ? tokenize(list, true) : list)
    this.defaultPath = saved
  }

  /** \pgfkeys@parse: the items between commas, a whole group unbraced (\pgfkeys@@normal#1,) */
  private parse(list: Toks) {
    const items = splitAll([...list, ","], [","])
    items.pop() // what follows the last comma is \pgfkeys@mainstop
    for (const item of items) this.unpack(arg(item))
  }

  /** \pgfkeys@unpack#1=#2=#3\pgfkeys@stop on `item=\pgfkeysnovalue=` */
  private unpack(item: Toks) {
    const [k, v] = splitAll([...item, "=", ...NOVALUE, "="], ["="])
    const keyToks = spdef(arg(k))
    // \edef\pgfkeyscurrentkey: a key is plain text once expanded
    if (keyToks.some((t) => isCs(t) || t === "~" || t === "#")) throw new Unsupported(`pgfkeys: key "${meaning(keyToks, false)}"`)
    if (keyToks.length === 0) return
    const raw = keyToks.join("")
    // \pgfkeys@add@path@as@needed
    this.key = raw.startsWith("/") ? raw : this.defaultPath + raw
    let value: Toks | undefined = spdef(arg(v))
    if (same(value, NOVALUE)) value = this.valueOf(`${this.key}/.@def`)
    if (value && same(value, REQUIRED)) throw new Unsupported(`pgfkeys: the key '${this.key}' requires a value`)
    if (value && same(value, NOVALUE)) value = undefined
    this.dispatch(value)
  }

  /** \pgfkeys@case@one, two and three for \pgfkeyscurrentkey */
  private dispatch(value: Toks | undefined) {
    const key = this.key
    const cmd = this.command(key)
    if (cmd) return this.run(cmd, value)
    const stored = this.valueOf(key)
    if (stored) {
      // a value key without a value is executed: TeX code, unless it is empty
      if (value === undefined) {
        if (stored.length) throw new Unsupported(`pgfkeys: the value of '${key}' run as code`)
        return
      }
      return this.setValue(key, value)
    }
    this.splitPath()
    const handler = HANDLERS[this.name]
    if (handler) return handler(this, this.path, value)
    if (TEX_HANDLERS.has(this.name)) throw new Unsupported(`pgfkeys: handler ${this.name}`)
    this.unknown(value)
  }

  /** \pgfkeys@unknown: the path's .unknown command, or pgfkeys' error */
  private unknown(value: Toks | undefined) {
    const cmd = this.command(`${this.path}/.unknown`)
    if (cmd) return this.run(cmd, value)
    throw new Unsupported(`pgfkeys: I do not know the key '${this.key}'`)
  }

  /** \pgfkeys@split@path: \pgfkeyscurrentpath and \pgfkeyscurrentname from \pgfkeyscurrentkey */
  private splitPath() {
    const i = this.key.lastIndexOf("/")
    this.path = i < 0 ? "" : this.key.slice(0, i)
    this.name = this.key.slice(i + 1)
  }

  /** a command with #1 */
  run(cmd: Code, value: Toks | undefined) {
    const key = this.key
    for (const p of cmd) {
      switch (p.kind) {
        case "native": p.run(this, value); break
        case "also": {
          const body = substitute(p.body, value ?? NOVALUE)
          if (p.path !== undefined) this.pgfqkeys(p.path, body)
          else this.also(body)
          break
        }
        case "setvalue": this.setValue(p.path, value ?? NOVALUE); break
        case "choice":
          if (value === undefined) throw new Unsupported(`pgfkeys: choice key '${key}' without a value`)
          this.also([...chars(key), "/", ...value])
          break
        case "cd": this.defaultPath = `${p.path}/`; break
        case "tex": throw new Unsupported(`pgfkeys: code of '${key}': ${meaning(p.body, false)}`)
      }
    }
  }

  /**
   * \pgfkeys@try (.try, pgfkeys.code.tex 1026–1071): the key's command, its value, or a handler; \ifpgfkeyssuccess says whether one
   * existed. The default applies to the key itself.
   */
  try(path: string, value: Toks | undefined) {
    this.key = path
    if (value === undefined) {
      const def = this.valueOf(`${path}/.@def`)
      if (def && same(def, REQUIRED)) throw new Unsupported(`pgfkeys: the key '${path}' requires a value`)
      if (def && !same(def, NOVALUE)) value = def
    }
    const cmd = this.command(path)
    if (cmd) { this.run(cmd, value); this.success = true; return }
    const stored = this.valueOf(path)
    if (stored) {
      if (value === undefined) {
        if (stored.length) throw new Unsupported(`pgfkeys: the value of '${path}' run as code`)
      } else this.setValue(path, value)
      this.success = true
      return
    }
    this.splitPath()
    const handler = HANDLERS[this.name]
    if (handler) { handler(this, this.path, value); this.success = true; return }
    if (TEX_HANDLERS.has(this.name)) throw new Unsupported(`pgfkeys: handler ${this.name}`)
    this.success = false
  }

  /**
   * .add code (pgfkeys.code.tex 783–818) with \pgfkeysalso bodies: before and after the key's command, or
   * after \pgfkeyssetvalue{path}{#1} when it has none.
   */
  addCode(path: string, before: Code, after: Code) {
    const old: Code = this.command(path) ?? [{ kind: "setvalue", path }]
    this.define(path, [...before, ...old, ...after])
  }
}

const value = (path: string, v: Toks | undefined, what: string): Toks => {
  if (v === undefined) throw new Unsupported(`pgfkeys: ${path}/${what} without a value`)
  return v
}

/** a .code body: a sequence of \pgfkeysalso{…}, \pgfkeys{…} and \tikzset{…}; other TeX code is kept as such */
export function parseCode(body: Toks): Code {
  const parts: Part[] = []
  let i = 0
  const skip = () => { while (body[i] === " ") i++ }
  for (skip(); i < body.length; skip()) {
    const cs = body[i]
    const call = cs === "\\pgfkeysalso" ? undefined : cs === "\\tikzset" ? "/tikz" : cs === "\\pgfkeys" ? "" : null
    if (call === null || body[i + 1] !== "{") return [{ kind: "tex", body }]
    const end = groupEnd(body, i + 1)
    if (end < 0) return [{ kind: "tex", body }]
    const inner = body.slice(i + 2, end)
    parts.push(call === undefined ? { kind: "also", body: inner } : call === "" ? { kind: "also", body: inner, path: "" } : { kind: "also", body: inner, path: call })
    i = end + 1
  }
  return parts
}

type Handler = (k: Keys, path: string, v: Toks | undefined) => void

/** /handlers/<name>/.@cmd (pgfkeys.code.tex 772–1043), those modeled */
const HANDLERS: Record<string, Handler> = {
  ".code": (k, path, v) => k.define(path, parseCode(value(path, v, ".code"))),
  ".style": (k, path, v) => k.define(path, [{ kind: "also", body: value(path, v, ".style") }]),
  ".append style": (k, path, v) => k.addCode(path, [], [{ kind: "also", body: value(path, v, ".append style") }]),
  ".prefix style": (k, path, v) => k.addCode(path, [{ kind: "also", body: value(path, v, ".prefix style") }], []),
  ".initial": (k, path, v) => k.setValue(path, value(path, v, ".initial")),
  ".default": (k, path, v) => k.setValue(`${path}/.@def`, value(path, v, ".default")),
  ".value required": (k, path) => k.setValue(`${path}/.@def`, REQUIRED),
  ".is choice": (k, path) => k.define(path, [{ kind: "choice" }]),
  ".is family": (k, path) => k.define(path, [{ kind: "cd", path }]),
  ".cd": (k, path) => { k.defaultPath = `${path}/` },
  ".try": (k, path, v) => k.try(path, v),
}

/** pgfkeys' other handlers (and the ones pgf and TikZ add): TeX has them, they are not modeled */
const TEX_HANDLERS = new Set([
  ".code 2 args", ".ecode", ".ecode 2 args", ".code args", ".ecode args", ".code n args", ".ecode n args", ".add code", ".prefix code",
  ".append code", ".estyle", ".style args", ".estyle args", ".style 2 args", ".style n args", ".add style", ".add", ".prefix", ".append",
  ".get", ".link", ".value forbidden", ".store in", ".estore in", ".is if", ".list", ".forward to", ".show value", ".show code",
  ".search also", ".expand once", ".expand twice", ".expanded", ".evaluated", ".retry", ".lastretry", ".tip", ".install key filter",
  ".install key filter handler", ".activate family", ".deactivate family", ".belongs to family", "first char syntax",
  ".pgfmath", ".pgfmath int", ".pgfmath macro",
])
