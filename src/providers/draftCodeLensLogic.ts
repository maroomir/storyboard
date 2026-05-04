import { parseDraft } from "../files/draft"
import { parseSceneStem, type SceneFileNameParts } from "../shared/scene"

export function tryParseDraftScenePartsForCodeLens(rawDraftText: string): SceneFileNameParts | undefined {
  try {
    const draft = parseDraft(rawDraftText)
    return parseSceneStem(draft.sceneStem)
  } catch {
    return undefined
  }
}
