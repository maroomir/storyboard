import { listSceneStemIssues } from "@seedcoat/wasm"

import type { WorkspaceContent } from "@/services/seedcoat/projectAdapter"

const SEEDCOAT_SCENE_PREFIX_DIGITS = 2

export function listSeedExportPreflightIssues(content: WorkspaceContent): string[] {
  return listSceneStemIssues(content, { digits: SEEDCOAT_SCENE_PREFIX_DIGITS }).map((issue) => {
    if (issue.kind === "prefix-digits") {
      return `editor.scenePrefixDigits가 ${issue.expected}가 아닙니다(현재 ${issue.actual}). .seed보내기는 두 자리 씬 번호(예: 01-slug)만 지원합니다.`
    }

    return `scene/${issue.stem}.txt — stem이 seedcoat 규칙(두 자리 숫자-슬러그, 예: 01-opening)과 맞지 않습니다.`
  })
}
