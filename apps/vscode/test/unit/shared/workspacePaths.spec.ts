import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  STORYBOARD_FILE_EXTENSIONS,
  STORYBOARD_GLOBS,
  STORYBOARD_RELATIVE_PATHS,
  characterCardRelativePath,
  draftRelativePath,
  sceneRelativePath,
  storyboardGitignoreEntries
} from "@storyboard/story-model"

const manifestPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../package.json"
)

// 디렉터리 이름과 확장자가 앱마다 흩어져 있으면 한 곳만 고쳤을 때 감시자가 파일을 놓치고 사용자는
// 이유를 알 수 없다. 만드는 경로와 찾는 글롭이 같은 표에서 나오는지 여기서 본다.
describe("workspace path conventions", () => {
  it("builds card and draft paths under the directories the table names", () => {
    expect(characterCardRelativePath("hana")).toBe(
      `${STORYBOARD_RELATIVE_PATHS.characterDirectory}/hana${STORYBOARD_FILE_EXTENSIONS.card}`
    )
    expect(sceneRelativePath("01-start")).toBe(
      `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/01-start${STORYBOARD_FILE_EXTENSIONS.card}`
    )
    expect(draftRelativePath("01-start")).toBe(
      `${STORYBOARD_RELATIVE_PATHS.draftDirectory}/01-start${STORYBOARD_FILE_EXTENSIONS.draft}`
    )
  })

  it("matches what it builds with the globs the editor watches", () => {
    expect(STORYBOARD_GLOBS.characterCards).toBe(
      `${STORYBOARD_RELATIVE_PATHS.characterDirectory}/*${STORYBOARD_FILE_EXTENSIONS.card}`
    )
    expect(STORYBOARD_GLOBS.anyDraftMarkdown).toContain(
      `${STORYBOARD_RELATIVE_PATHS.draftDirectory}/`
    )
  })

  it("ignores the generated directories the table names", () => {
    for (const directory of [
      STORYBOARD_RELATIVE_PATHS.cacheDirectory,
      STORYBOARD_RELATIVE_PATHS.draftHistoryDirectory,
      STORYBOARD_RELATIVE_PATHS.manuscriptDirectory
    ]) {
      expect(storyboardGitignoreEntries, `${directory} is not ignored`).toContain(`${directory}/`)
    }
  })

  it("activates on the workspace marker the hosts look for", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      readonly activationEvents: readonly string[]
    }

    expect(manifest.activationEvents).toContain(
      `workspaceContains:${STORYBOARD_RELATIVE_PATHS.projectJson}`
    )
  })
})
