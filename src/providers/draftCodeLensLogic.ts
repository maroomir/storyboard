import { parseDraft } from "../files/draft"
import { parseSceneStem, type SceneFileNameParts } from "../shared/scene"

/**
 * 드래프트 본문에서 CodeLens용 씬 파일명 파트를 안전하게 읽는다.
 * frontmatter 손상·sceneStem 불일치 시 undefined (빈 CodeLens).
 */
export function tryParseDraftScenePartsForCodeLens(rawDraftText: string): SceneFileNameParts | undefined {
  try {
    const draft = parseDraft(rawDraftText)
    return parseSceneStem(draft.sceneStem)
  } catch {
    return undefined
  }
}
