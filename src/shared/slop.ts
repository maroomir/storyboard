import { slopPhrases } from "./slopPhrases"

export type SlopKind = "phrase" | "contrast" | "trigram"

export type SlopSeverity = "info" | "warning"

export interface SlopFinding {
  readonly start: number
  readonly end: number
  readonly kind: SlopKind
  readonly message: string
  readonly severity: SlopSeverity
}

export interface AnalyzeSlopOptions {
  readonly trigramThreshold?: number
}

const defaultTrigramThreshold = 3

export function analyzeSlop(body: string, options?: AnalyzeSlopOptions): SlopFinding[] {
  const trigramThreshold = options?.trigramThreshold ?? defaultTrigramThreshold

  return [
    ...detectClichePhrases(body),
    ...detectContrastPattern(body),
    ...detectOverfrequentTrigrams(body, trigramThreshold)
  ].sort((first, second) => first.start - second.start || first.end - second.end)
}

function detectClichePhrases(body: string): SlopFinding[] {
  const findings: SlopFinding[] = []

  for (const phrase of slopPhrases.ko) {
    findings.push(...findLiteralOccurrences(body, phrase))
  }

  const lowerBody = body.toLowerCase()
  for (const phrase of slopPhrases.en) {
    findings.push(...findLiteralOccurrences(body, phrase.toLowerCase(), lowerBody))
  }

  return findings
}

function findLiteralOccurrences(body: string, phrase: string, haystack: string = body): SlopFinding[] {
  if (phrase.length === 0) {
    return []
  }

  const findings: SlopFinding[] = []
  let searchIndex = haystack.indexOf(phrase)

  while (searchIndex !== -1) {
    const end = searchIndex + phrase.length
    findings.push({
      start: searchIndex,
      end,
      kind: "phrase",
      message: `상투 표현: "${body.slice(searchIndex, end)}" — 다른 표현을 검토하세요`,
      severity: "warning"
    })
    searchIndex = haystack.indexOf(phrase, end)
  }

  return findings
}

const contrastPatterns: readonly RegExp[] = [
  /not\s+(?:just|only)\s+[^\n]{1,80}?\s+but\s+[^\n.,!?]{1,80}/giu,
  /(?:단순히|단지|그저)\s+[^\n]{1,80}?(?:이|가)\s+아니라\s+[^\n.,!?]{1,80}/gu
]

function detectContrastPattern(body: string): SlopFinding[] {
  const findings: SlopFinding[] = []

  for (const pattern of contrastPatterns) {
    pattern.lastIndex = 0
    let match = pattern.exec(body)
    while (match) {
      findings.push({
        start: match.index,
        end: match.index + match[0].length,
        kind: "contrast",
        message: `대조 상투구문: "단순히 X가 아니라 Y" 류의 AI 상투 표현입니다`,
        severity: "info"
      })
      match = pattern.exec(body)
    }
  }

  return findings
}

interface Token {
  readonly text: string
  readonly start: number
  readonly end: number
}

function detectOverfrequentTrigrams(body: string, threshold: number): SlopFinding[] {
  const tokens = tokenizeWords(body)
  if (tokens.length < 3) {
    return []
  }

  const occurrencesByKey = new Map<string, Array<readonly [Token, Token, Token]>>()

  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const trigram = [tokens[index], tokens[index + 1], tokens[index + 2]] as const
    const [first, second, third] = trigram
    if (!first || !second || !third) {
      continue
    }
    const key = `${normalizeTokenKey(first.text)} ${normalizeTokenKey(second.text)} ${normalizeTokenKey(third.text)}`
    if (key.trim().length === 0) {
      continue
    }

    const existing = occurrencesByKey.get(key) ?? []
    existing.push([first, second, third])
    occurrencesByKey.set(key, existing)
  }

  const findings: SlopFinding[] = []

  for (const occurrences of occurrencesByKey.values()) {
    const nonOverlapping = dropOverlappingOccurrences(occurrences)
    if (nonOverlapping.length < threshold) {
      continue
    }

    for (const trigram of nonOverlapping) {
      const start = trigram[0].start
      const end = trigram[2].end
      findings.push({
        start,
        end,
        kind: "trigram",
        message: `반복 표현: 3어절 "${body.slice(start, end)}"이(가) ${nonOverlapping.length}회 반복됩니다`,
        severity: "info"
      })
    }
  }

  return findings
}

function dropOverlappingOccurrences(
  occurrences: ReadonlyArray<readonly [Token, Token, Token]>
): Array<readonly [Token, Token, Token]> {
  const kept: Array<readonly [Token, Token, Token]> = []
  let lastEnd = -1

  for (const trigram of occurrences) {
    if (trigram[0].start >= lastEnd) {
      kept.push(trigram)
      lastEnd = trigram[2].end
    }
  }

  return kept
}

function tokenizeWords(body: string): Token[] {
  const tokens: Token[] = []
  const pattern = /\S+/gu
  let match = pattern.exec(body)

  while (match) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length })
    match = pattern.exec(body)
  }

  return tokens
}

function normalizeTokenKey(text: string): string {
  return text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
}
