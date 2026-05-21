import type { WorkspaceContent } from "@/services/seedcoat/projectAdapter"

export const seedcoatSceneStemPattern = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/

const SEEDCOAT_SCENE_PREFIX_DIGITS = 2

export function listSeedExportPreflightIssues(content: WorkspaceContent): string[] {
  const issues: string[] = []

  if (content.project.editor.scenePrefixDigits !== SEEDCOAT_SCENE_PREFIX_DIGITS) {
    issues.push(
      `editor.scenePrefixDigits가 ${SEEDCOAT_SCENE_PREFIX_DIGITS}가 아닙니다(현재 ${content.project.editor.scenePrefixDigits}). .seed보내기는 두 자리 씬 번호(예: 01-slug)만 지원합니다.`
    )
  }

  for (const scene of content.scenes) {
    if (!seedcoatSceneStemPattern.test(scene.stem)) {
      issues.push(
        `scene/${scene.stem}.txt — stem이 seedcoat 규칙(두 자리 숫자-슬러그, 예: 01-opening)과 맞지 않습니다.`
      )
    }
  }

  return issues
}
