// Control-sequence -> Unicode mappings. Lookups are O(1) and shared by the
// text and math renderers. Grow this table to widen coverage.

export const SYMBOLS: Record<string, string> = {
  // lowercase greek
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
  varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  // uppercase greek
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",

  // binary operators
  times: "×", div: "÷", pm: "±", mp: "∓", cdot: "⋅", ast: "∗", star: "⋆",
  circ: "∘", bullet: "•", oplus: "⊕", ominus: "⊖", otimes: "⊗", oslash: "⊘",
  odot: "⊙", cap: "∩", cup: "∪", uplus: "⊎", sqcap: "⊓", sqcup: "⊔",
  vee: "∨", wedge: "∧", setminus: "∖", wr: "≀", diamond: "⋄", bigtriangleup: "△",
  bigtriangledown: "▽", triangleleft: "◁", triangleright: "▷", dagger: "†",
  ddagger: "‡", amalg: "⨿",

  // relations
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", equiv: "≡",
  approx: "≈", cong: "≅", simeq: "≃", sim: "∼", propto: "∝", ll: "≪", gg: "≫",
  subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇", sqsubseteq: "⊑",
  sqsupseteq: "⊒", in: "∈", ni: "∋", notin: "∉", mid: "∣", parallel: "∥",
  perp: "⊥", models: "⊨", vdash: "⊢", dashv: "⊣", asymp: "≍", doteq: "≐",
  prec: "≺", succ: "≻", preceq: "⪯", succeq: "⪰", bowtie: "⋈", smile: "⌣",
  frown: "⌢",

  // arrows
  leftarrow: "←", gets: "←", rightarrow: "→", to: "→", leftrightarrow: "↔",
  Leftarrow: "⇐", Rightarrow: "⇒", Leftrightarrow: "⇔", uparrow: "↑",
  downarrow: "↓", updownarrow: "↕", Uparrow: "⇑", Downarrow: "⇓",
  mapsto: "↦", longmapsto: "⟼", hookleftarrow: "↩", hookrightarrow: "↪",
  longleftarrow: "⟵", longrightarrow: "⟶", longleftrightarrow: "⟷",
  Longleftarrow: "⟸", Longrightarrow: "⟹", Longleftrightarrow: "⟺",
  nearrow: "↗", searrow: "↘", swarrow: "↙", nwarrow: "↖", leadsto: "⇝",

  // big operators (inline form; display handled by the renderer)
  sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭",
  oint: "∮", bigcap: "⋂", bigcup: "⋃", bigvee: "⋁", bigwedge: "⋀",
  bigoplus: "⨁", bigotimes: "⨂", bigodot: "⨀", biguplus: "⨄", bigsqcup: "⨆",

  // misc symbols & dots
  infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃",
  nexists: "∄", emptyset: "∅", varnothing: "∅", neg: "¬", lnot: "¬",
  top: "⊤", bot: "⊥", angle: "∠", measuredangle: "∡", triangle: "△",
  square: "□", blacksquare: "■", surd: "√", flat: "♭", natural: "♮",
  sharp: "♯", clubsuit: "♣", diamondsuit: "♦", heartsuit: "♥", spadesuit: "♠",
  ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱", dots: "…", aleph: "ℵ",
  hbar: "ℏ", ell: "ℓ", wp: "℘", Re: "ℜ", Im: "ℑ", mho: "℧", prime: "′",
  backslash: "\\", Box: "□", Diamond: "◇", checkmark: "✓",

  // delimiters
  langle: "⟨", rangle: "⟩", lceil: "⌈", rceil: "⌉", lfloor: "⌊", rfloor: "⌋",
  lbrace: "{", rbrace: "}", vert: "|", Vert: "‖", lbrack: "[", rbrack: "]",

  // text-mode accents & punctuation that appear as commands
  ldotp: "·", cdotp: "·", colon: ":", quad: " ", qquad: "  ",
  textbackslash: "\\", textasciitilde: "~", textasciicircum: "^",
  textbar: "|", textless: "<", textgreater: ">", textunderscore: "_",
  pounds: "£", textsterling: "£", texteuro: "€", copyright: "©",
  textcopyright: "©", textregistered: "®", texttrademark: "™", S: "§",
  P: "¶", dag: "†", ddag: "‡", LaTeX: "LaTeX", TeX: "TeX", ldotsc: "…",
}

// Escaped single characters: \{ \} \$ \% \& \_ \# \  etc.
export const ESCAPES: Record<string, string> = {
  "{": "{", "}": "}", $: "$", "%": "%", "&": "&", _: "_", "#": "#",
  " ": " ", ",": " ", ";": " ", ":": " ", "!": "",
  "/": "", "@": "", "-": "­",
}

// Function-like operators rendered upright: \sin x, \log, \lim, ...
export const OPERATORS = new Set([
  "arccos", "arcsin", "arctan", "arg", "cos", "cosh", "cot", "coth", "csc",
  "deg", "det", "dim", "exp", "gcd", "hom", "inf", "ker", "lg", "lim",
  "liminf", "limsup", "ln", "log", "max", "min", "Pr", "sec", "sin", "sinh",
  "sup", "tan", "tanh",
])

// \mathbb / \mathcal / \mathfrak letter maps for the common A–Z ranges.
const BB: Record<string, string> = {
  A: "𝔸", B: "𝔹", C: "ℂ", D: "𝔻", E: "𝔼", F: "𝔽", G: "𝔾", H: "ℍ", I: "𝕀",
  J: "𝕁", K: "𝕂", L: "𝕃", M: "𝕄", N: "ℕ", O: "𝕆", P: "ℙ", Q: "ℚ", R: "ℝ",
  S: "𝕊", T: "𝕋", U: "𝕌", V: "𝕍", W: "𝕎", X: "𝕏", Y: "𝕐", Z: "ℤ",
}

const CAL: Record<string, string> = {
  A: "𝒜", B: "ℬ", C: "𝒞", D: "𝒟", E: "ℰ", F: "ℱ", G: "𝒢", H: "ℋ", I: "ℐ",
  J: "𝒥", K: "𝒦", L: "ℒ", M: "ℳ", N: "𝒩", O: "𝒪", P: "𝒫", Q: "𝒬", R: "ℛ",
  S: "𝒮", T: "𝒯", U: "𝒰", V: "𝒱", W: "𝒲", X: "𝒳", Y: "𝒴", Z: "𝒵",
}

/** Map an ASCII string through a blackboard-bold / calligraphic table. */
export function mapAlphabet(text: string, kind: "bb" | "cal"): string {
  const table = kind === "bb" ? BB : CAL
  let out = ""
  for (const ch of text) out += table[ch] ?? ch
  return out
}
