export function detectCharactersInText(
  text: string,
  characterNames: readonly string[]
): string[] {
  if (characterNames.length === 0) {
    return []
  }

  const detectedNames = new Set<string>()

  for (const name of characterNames) {
    if (text.includes(name)) {
      detectedNames.add(name)
    }
  }

  return Array.from(detectedNames)
}
