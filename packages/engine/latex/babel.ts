// babel (#63): \usepackage[languages]{babel}, the last one the main language, which \begin{document}
// selects (\selectlanguage, babel.sty's \AtBeginDocument): its captions (\captions<lang>), its \today
// (\date<lang>), its patterns (\language, \l@<lang> of TeX Live's language.dat) and \lefthyphenmin and
// \righthyphenmin (\<lang>hyphenmins), and its extras (\extras<lang>: \frenchspacing). Each language is
// what its .ldf says (babel-english's english.ldf, babel-spanish's spanish.ldf with its defaults: what
// spanish.ts models); options and languages not modeled throw Unsupported.

import type { ClassOptionData } from "../layout/classdata"
import { Unsupported } from "./unsupported"
import { markAccentHyphens } from "./spanish"

/** the names \captions<lang> defines, and the standard classes' (and amsthm's \proofname) without babel */
export interface Captions {
  refname: string; abstractname: string; bibname: string; chaptername: string; appendixname: string; contentsname: string
  listfigurename: string; listtablename: string; indexname: string; figurename: string; tablename: string; partname: string
  enclname: string; ccname: string; headtoname: string; pagename: string; proofname: string
}

export const LATEX_CAPTIONS: Captions = {
  refname: "References", abstractname: "Abstract", bibname: "Bibliography", chaptername: "Chapter", appendixname: "Appendix",
  contentsname: "Contents", listfigurename: "List of Figures", listtablename: "List of Tables", indexname: "Index", figurename: "Figure",
  tablename: "Table", partname: "Part", enclname: "encl", ccname: "cc", headtoname: "To", pagename: "Page", proofname: "Proof",
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
/** english.ldf's UK days: \ifcase\day\or 1st\or 2nd … 31st\fi */
const UK_DAYS = "1st 2nd 3rd 4th 5th 6th 7th 8th 9th 10th 11th 12th 13th 14th 15th 16th 17th 18th 19th 20th 21st 22nd 23rd 24th 25th 26th 27th 28th 29th 30th 31st".split(" ")

interface LanguageDef {
  /** \captions<lang> (LaTeX source, as \SetString leaves it); `chapters`: the class has \chapter */
  captions: Captions | ((chapters: boolean) => Captions)
  /** \today as \date<lang> defines it (LaTeX source: ~ is \nobreakspace) */
  today(d: Date): string
  /** the patterns of \l@<lang> (data/hyphenation) */
  patterns: string
  /** \<lang>hyphenmins */
  hyphenmins: [number, number]
  /** \l@<lang>: the language's number in the format (TeX Live's language.dat) */
  number: number
  /** \extras<lang> selects \frenchspacing */
  frenchspacing?: boolean
}

/** english.ldf's dates: US (english, american, USenglish, canadian), UK (british, UKenglish), AU (australian, newzealand) */
const usDate = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
const ukDate = (d: Date) => `${UK_DAYS[d.getUTCDate() - 1]}~${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
const auDate = (d: Date) => `${d.getUTCDate()}~${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`

/** spanish.ldf's \captionsspanish for pdfTeX (the block without unicode): cuadro, and \'{I}ndice general with \chapter */
const spanishCaptions = (chapters: boolean): Captions => ({
  refname: "Referencias", abstractname: "Resumen", bibname: "Bibliograf\\'{\\i}a", chaptername: "Cap\\'{\\i}tulo", appendixname: "Ap\\'{e}ndice",
  contentsname: chapters ? "\\'{I}ndice general" : "\\'{I}ndice", listfigurename: "\\'{I}ndice de figuras", listtablename: "\\'{I}ndice de cuadros",
  indexname: "\\'{I}ndice alfab\\'{e}tico", figurename: "Figura", tablename: "Cuadro", partname: "Parte", enclname: "Adjunto", ccname: "Copia a",
  headtoname: "A", pagename: "p\\'{a}gina", proofname: "Demostraci\\'{o}n",
})
const SPANISH_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
/** spanish.ldf's \spanishdate: \number\day~de \monthname\ de~\number\year (the control space as a space: the same
 *  glue after a lowercase letter) */
const esDate = (d: Date) => `${d.getUTCDate()}~de ${SPANISH_MONTHS[d.getUTCMonth()]} de~${d.getUTCFullYear()}`

/** portuges.ldf's captions: portuguese and portuges, or brazil and brazilian */
const portugueseCaptions = (brazil: boolean): Captions => ({
  refname: "Refer\\^encias", abstractname: "Resumo", bibname: brazil ? "Refer\\^encias Bibliogr\\'aficas" : "Bibliografia",
  chaptername: "Cap\\'{\\i}tulo", appendixname: "Ap\\^endice", contentsname: brazil ? "Sum\\'ario" : "\\'Indice",
  listfigurename: "Lista de Figuras", listtablename: "Lista de Tabelas", indexname: "\\'Indice Remissivo", figurename: "Figura",
  tablename: "Tabela", partname: "Parte", enclname: "Anexo", ccname: brazil ? "C\\'opia para" : "Com c\\'opia a", headtoname: "Para",
  pagename: "P\\'agina", proofname: "Demonstra\\c{c}\\~ao",
})
const PORTUGUESE_MONTHS = ["janeiro", "fevereiro", "mar\\c{c}o", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
/** portuges.ldf's \today: \number\day\space de\space <month>\space de\space\number\year */
const ptDate = (d: Date) => `${d.getUTCDate()} de ${PORTUGUESE_MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`

/** each option's language: english is TeX Live's language 0 (hyphen.tex), british and its dialects ukenglish's */
const LANGUAGES: Record<string, LanguageDef> = {
  english: { captions: LATEX_CAPTIONS, today: usDate, patterns: "en-us", hyphenmins: [2, 3], number: 0 },
  american: { captions: LATEX_CAPTIONS, today: usDate, patterns: "en-us", hyphenmins: [2, 3], number: 0 },
  USenglish: { captions: LATEX_CAPTIONS, today: usDate, patterns: "en-us", hyphenmins: [2, 3], number: 0 },
  canadian: { captions: LATEX_CAPTIONS, today: usDate, patterns: "en-us", hyphenmins: [2, 3], number: 0 },
  british: { captions: LATEX_CAPTIONS, today: ukDate, patterns: "en-gb", hyphenmins: [2, 3], number: 3 },
  UKenglish: { captions: LATEX_CAPTIONS, today: ukDate, patterns: "en-gb", hyphenmins: [2, 3], number: 3 },
  australian: { captions: LATEX_CAPTIONS, today: auDate, patterns: "en-gb", hyphenmins: [2, 3], number: 3 },
  newzealand: { captions: LATEX_CAPTIONS, today: auDate, patterns: "en-gb", hyphenmins: [2, 3], number: 3 },
  spanish: { captions: spanishCaptions, today: esDate, patterns: "es", hyphenmins: [2, 2], number: 10, frenchspacing: true },
  portuguese: { captions: portugueseCaptions(false), today: ptDate, patterns: "pt", hyphenmins: [2, 3], number: 9 },
  portuges: { captions: portugueseCaptions(false), today: ptDate, patterns: "pt", hyphenmins: [2, 3], number: 9 },
  brazil: { captions: portugueseCaptions(true), today: ptDate, patterns: "pt", hyphenmins: [2, 3], number: 9 },
  brazilian: { captions: portugueseCaptions(true), today: ptDate, patterns: "pt", hyphenmins: [2, 3], number: 9 },
}

/** the languages babel loaded, the main one (the last), and those the class's options gave (global: hyperref and
 *  cleveref read them too) */
export interface Babel { languages: string[]; main: string; global: string[] }

/** \usepackage[options]{babel}: the class's options that are languages, then its own (a language twice is once) */
export function babelOptions(own: string[], classOptions: string[]): Babel {
  for (const o of own) if (!Object.hasOwn(LANGUAGES, o)) throw new Unsupported(`babel option ${o}`)
  const languages = [...classOptions.filter((o) => Object.hasOwn(LANGUAGES, o)), ...own]
  if (!languages.length) throw new Unsupported("babel without a language")
  const main = languages[languages.length - 1]
  // (spanish.ldf's shorthands and its \AtBeginDocument act with another main language too)
  if (languages.includes("spanish") && main !== "spanish") throw new Unsupported(`babel with spanish and the main language ${main}`)
  return { languages: [...new Set(languages)], main, global: classOptions.filter((o) => Object.hasOwn(LANGUAGES, o)) }
}

/** whether a class option is a language babel reads */
export const isBabelLanguage = (o: string) => Object.hasOwn(LANGUAGES, o)

/** The main language's captions (none: LaTeX's), a copy of its own (which a language selected later changes) */
export function captions(b: Babel | null, chapters: boolean): Captions {
  const c = b ? LANGUAGES[b.main].captions : LATEX_CAPTIONS
  const names = typeof c === "function" ? c(chapters) : { ...c }
  // (spanish.ldf's accents: \bbl@allowhyphens where no space follows)
  return isSpanish(b) ? Object.fromEntries(Object.entries(names).map(([k, v]) => [k, markAccentHyphens(v)])) as unknown as Captions : names
}

/** whether a language's extras select \frenchspacing */
export const babelFrenchspacing = (lang: string): boolean => !!LANGUAGES[lang].frenchspacing

/** the main language's .ldf is spanish.ldf (whose layout and shorthands spanish.ts models) */
export const isSpanish = (b: Babel | null | undefined): boolean => b?.main === "spanish"

/** \today in the language selected (LaTeX's without babel) */
export const babelToday = (b: Babel | null, d: Date): string => (b ? LANGUAGES[babelState.b ? babelState.lang : b.main] : LANGUAGES.english).today(d)

/** The class parameters with the main language selected: its patterns and hyphenmins */
export function withBabel(k: ClassOptionData, b: Babel): ClassOptionData {
  const lang = LANGUAGES[b.main]
  return { ...k, patterns: lang.patterns, ints: { ...k.ints, lefthyphenmin: lang.hyphenmins[0], righthyphenmin: lang.hyphenmins[1] } }
}

/** \selectlanguage's (and otherlanguage's) \write to the .aux file */
export const babelAux = (lang: string) => `\\write1{\\babel@aux{${lang}}{}}`

/** A language babel's commands switch to (\selectlanguage, otherlanguage, \foreignlanguage): one babel loaded */
export function babelLanguage(b: Babel | undefined | null, lang: string): string {
  if (!b) throw new Unsupported(`babel's language commands without babel (${lang})`)
  if (!b.languages.includes(lang)) throw new Unsupported(`babel language ${lang} not loaded`) // (LaTeX: an error)
  return lang
}

/**
 * babel as the document is typeset: \languagename (`lang`), \bbl@language@stack (the languages otherlanguage,
 * otherlanguage* and \foreignlanguage go back to at their end), the language of the last \babel@aux written (which
 * the next run's .toc selects with \babel@toc), and what a switch changes elsewhere (`onSwitch`: the captions, the
 * marks' language)
 */
export const babelState: { b: Babel | null; lang: string; stack: string[]; written: string; onSwitch: ((lang: string) => void) | null; /** the body has language commands that outlast a paragraph */ switches: boolean } = { b: null, lang: "", stack: [], written: "", onSwitch: null, switches: false }

/** \begin{document}: the main language selected (none: babel not loaded); `body`: the document's body, whose
 *  \selectlanguage and otherlanguage outlast a paragraph (\foreignlanguage's group ends in it) */
export function babelBegin(b: Babel | null, onSwitch: ((lang: string) => void) | null = null, body = ""): void {
  const switches = /\\selectlanguage(?![A-Za-z])|\\begin\s*\{otherlanguage\*?\}/.test(body)
  Object.assign(babelState, { b, lang: b?.main ?? "", stack: [], written: b?.main ?? "", onSwitch, switches })
}

/**
 * \selectlanguage in a group or an environment (`grouped`: the source is one) is not modeled: at the group's end,
 * babel's \aftergroup\bbl@pop@language selects the language before again, and writes it to the .aux file
 */
export function selectInGroups(src: string, grouped = false): void {
  let depth = grouped ? 1 : 0
  for (const m of src.replace(/(^|[^\\])%.*$/gm, "$1").matchAll(/\\(begin|end)\s*\{[^{}]*\}|\\selectlanguage(?![A-Za-z])|\\[\\{}]|[{}]/g)) {
    if (m[1] === "begin" || m[0] === "{") depth++
    else if (m[1] === "end" || m[0] === "}") depth--
    else if (m[0] === "\\selectlanguage" && depth > 0) throw new Unsupported("\\selectlanguage in a group or an environment")
  }
}

export type BabelCommand = "select" | "other" | "endother" | "otherstar" | "endotherstar" | "foreign" | "endforeign"

/**
 * babel's language commands: \selectlanguage (select), otherlanguage (other; endother, \bbl@pop@language at its
 * group's end), otherlanguage* (otherstar, endotherstar: the group's end) and \foreignlanguage (foreign, endforeign).
 * \bbl@switch selects the language's captions, date, extras, patterns and hyphenmins. Returns the language, and
 * whether \bbl@set@language writes \babel@aux to the .aux file (select, other, endother).
 */
export function babelSwitch(what: BabelCommand, name: string): { lang: string; write: boolean } {
  const s = babelState
  if (!s.b) throw new Unsupported(`babel's language commands without babel (${name})`)
  let lang: string
  if (what.startsWith("end")) {
    if (!s.stack.length) throw new Unsupported(`babel: the end of a language environment without its start`)
    lang = s.stack.pop()!
  } else {
    lang = babelLanguage(s.b, name)
    if (what === "select" && s.stack.length) throw new Unsupported("\\selectlanguage in otherlanguage or \\foreignlanguage") // (\aftergroup\bbl@pop@language)
    if (what !== "select") s.stack.push(s.lang)
  }
  const write = what === "select" || what === "other" || what === "endother"
  if (write) s.written = lang
  if (lang !== s.lang) { s.lang = lang; s.onSwitch?.(lang) }
  return { lang, write }
}

/** \select@language without a write: the .toc's \babel@toc{lang}{}, and the end of the group the .toc is read in */
export function babelSelect(lang: string): void {
  const s = babelState
  if (s.b && lang !== s.lang) { s.lang = lang; s.onSwitch?.(lang) }
}

/** the language selected's captions (\captions<lang>; `chapters`: the class has \chapter) */
export const languageCaptions = (lang: string, chapters: boolean): Captions => captions({ languages: [lang], main: lang, global: [] }, chapters)

/** the hyphenation of a language: its patterns, \l@<lang>, its hyphenmins (none: the class's, English) */
export function languageHyphenation(lang: string): { patterns: string; number: number; lhm: number; rhm: number } | null {
  const l = LANGUAGES[lang]
  return l ? { patterns: l.patterns, number: l.number, lhm: l.hyphenmins[0], rhm: l.hyphenmins[1] } : null
}
