export function detectCharactersInText(
  text: string,
  characterNames: readonly string[]
): string[] {
  if (characterNames.length === 0) {
    return []
  }

  // 간단한 substring 매칭
  const detectedNames = new Set<string>()

  for (const name of characterNames) {
    // 조사 등을 처리하기 위해 name이 단독으로 또는 조사가 붙은 형태로 등장하는지 확인
    // 현재는 가장 단순하게 substring 매칭을 사용
    if (text.includes(name)) {
      detectedNames.add(name)
    }
  }

  return Array.from(detectedNames)
}
