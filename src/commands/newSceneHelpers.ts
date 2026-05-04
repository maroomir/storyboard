import { parseSceneFileName, sceneFileNamePattern } from "../shared/scene"

const sceneSlugInputPattern = /^[a-z0-9][a-z0-9-]*$/

export function computeNextSceneOrderFromSceneFileNames(fileNames: readonly string[]): number {
  let maxOrder = 0

  for (const name of fileNames) {
    const parts = parseSceneFileName(name)
    if (parts) {
      maxOrder = Math.max(maxOrder, parts.order)
    }
  }

  return maxOrder + 1
}

export function formatSceneOrderPrefix(order: number, digitCount: number): string {
  return String(order).padStart(digitCount, "0")
}

export function validateSceneSlugInput(slug: string): string | undefined {
  const trimmed = slug.trim()

  if (trimmed.length === 0) {
    return "슬러그를 입력해 주세요."
  }

  if (!sceneSlugInputPattern.test(trimmed)) {
    return "슬러그는 영문 소문자·숫자로 시작하고, 이후에는 소문자·숫자·하이픈만 사용할 수 있습니다."
  }

  const probeName = `01-${trimmed}.txt`
  if (!sceneFileNamePattern.test(probeName)) {
    return "씬 파일명 규칙에 맞지 않는 슬러그입니다."
  }

  return undefined
}
