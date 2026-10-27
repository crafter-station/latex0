// babel (#63): \usepackage[languages]{babel}, the last one the main language, which \begin{document}
// selects (\selectlanguage, babel.sty's \AtBeginDocument): its captions (\captions<lang>), its \today
// (\date<lang>), its patterns (\language, \l@<lang> of TeX Live's language.dat) and \lefthyphenmin and
// \righthyphenmin (\<lang>hyphenmins), and its extras (\extras<lang>: \frenchspacing). Each language is
// what its .ldf says (babel-english's english.ldf); options and languages not modeled throw Unsupported.

import type { ClassOptionData } from "../layout/classdata"
import { Unsupported } from "./unsupported"

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
  captions: Captions
  /** \today as \date<lang> defines it (LaTeX source: ~ is \nobreakspace) */
  today(d: Date): string
  /** the patterns of \l@<lang> (data/hyphenation) */
  patterns: string
  /** \<lang>hyphenmins */
  hyphenmins: [number, number]
}

/** english.ldf's dates: US (english, american, USenglish, canadian), UK (british, UKenglish), AU (australian, newzealand) */
const usDate = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
const ukDate = (d: Date) => `${UK_DAYS[d.getUTCDate() - 1]}~${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
const auDate = (d: Date) => `${d.getUTCDate()}~${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`

/** each option's language: english is TeX Live's language 0 (hyphen.tex), british and its dialects ukenglish's */
const LANGUAGES: Record<string, LanguageDef> = {
  english: { captions: LATEX_CAPTIONS, today: usDate, patterns: "en-us", hyphenmins: [2, 3] },
  american: { captions: LATEX_CAPTIONS, today: usDate, patterns: "en-us", hyphenmins: [2, 3] },
  USenglish: { captions: LATEX_CAPTIONS, today: usDate, patterns: "en-us", hyphenmins: [2, 3] },
  canadian: { captions: LATEX_CAPTIONS, today: usDate, patterns: "en-us", hyphenmins: [2, 3] },
  british: { captions: LATEX_CAPTIONS, today: ukDate, patterns: "en-gb", hyphenmins: [2, 3] },
  UKenglish: { captions: LATEX_CAPTIONS, today: ukDate, patterns: "en-gb", hyphenmins: [2, 3] },
  australian: { captions: LATEX_CAPTIONS, today: auDate, patterns: "en-gb", hyphenmins: [2, 3] },
  newzealand: { captions: LATEX_CAPTIONS, today: auDate, patterns: "en-gb", hyphenmins: [2, 3] },
}

/** the languages babel loaded and the main one (the last) */
export interface Babel { languages: string[]; main: string }

/** \usepackage[options]{babel}: the class's options that are languages, then its own (a language twice is once) */
export function babelOptions(own: string[], classOptions: string[]): Babel {
  for (const o of own) if (!Object.hasOwn(LANGUAGES, o)) throw new Unsupported(`babel option ${o}`)
  const languages = [...classOptions.filter((o) => Object.hasOwn(LANGUAGES, o)), ...own]
  if (!languages.length) throw new Unsupported("babel without a language")
  return { languages: [...new Set(languages)], main: languages[languages.length - 1] }
}

/** whether a class option is a language babel reads */
export const isBabelLanguage = (o: string) => Object.hasOwn(LANGUAGES, o)

/** The main language's captions (none: LaTeX's) */
export const captions = (b: Babel | null): Captions => (b ? LANGUAGES[b.main].captions : LATEX_CAPTIONS)

/** \today in the main language (LaTeX's without babel) */
export const babelToday = (b: Babel | null, d: Date): string => (b ? LANGUAGES[b.main] : LANGUAGES.english).today(d)

/** The class parameters with the main language selected: its patterns and hyphenmins */
export function withBabel(k: ClassOptionData, b: Babel): ClassOptionData {
  const lang = LANGUAGES[b.main]
  return { ...k, patterns: lang.patterns, ints: { ...k.ints, lefthyphenmin: lang.hyphenmins[0], righthyphenmin: lang.hyphenmins[1] } }
}

/** \selectlanguage's (and otherlanguage's) \write to the .aux file */
export const babelAux = (lang: string) => `\\write1{\\babel@aux{${lang}}{}}`

/** A language babel's commands switch to (\selectlanguage, otherlanguage, \foreignlanguage; "": the one before, which
 *  the end of otherlanguage goes back to): the main language, the only one modeled there yet */
export function babelLanguage(b: Babel | undefined | null, lang: string): string {
  if (!b) throw new Unsupported(`babel's language commands without babel (${lang})`)
  if (lang === "") return b.main
  if (!b.languages.includes(lang)) throw new Unsupported(`babel language ${lang} not loaded`) // (LaTeX: an error)
  if (lang !== b.main) throw new Unsupported(`babel: a switch to ${lang} from ${b.main}`)
  return lang
}
