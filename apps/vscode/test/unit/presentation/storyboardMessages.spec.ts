import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  missingApiKeyMarker,
  missingApiKeyMessage,
  STORYBOARD_RELATIVE_PATHS,
} from "@storyboard/story-model"

import { storyboardMessages } from "@/presentation/notifications/storyboardMessages"

const commandsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/presentation/commands"
)

const commandSources = readdirSync(commandsDirectory)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, text: readFileSync(path.join(commandsDirectory, name), "utf8") }))

// 같은 안내를 열두 파일이 저마다 적어 두면 워크스페이스 규칙이 바뀔 때 일부만 고쳐진다. 문구가
// 다시 흩어지는 순간을 여기서 잡는다.
describe("shared command messages", () => {
  it("names the workspace marker the table defines", () => {
    expect(storyboardMessages.missingWorkspace).toContain(STORYBOARD_RELATIVE_PATHS.projectJson)
    expect(storyboardMessages.missingSceneUri).toContain(STORYBOARD_RELATIVE_PATHS.sceneDirectory)
  })

  it("keeps commands from spelling the shared notices out again", () => {
    for (const source of commandSources) {
      expect(source.text, `${source.name} spells the workspace notice out`).not.toContain(
        "Storyboard 프로젝트(.storyboard/project.json)"
      )
      expect(source.text, `${source.name} spells the outline notice out`).not.toContain(
        "아웃라인(chapters.yaml)이 없습니다"
      )
    }
  })

  // 호스트는 오류 코드가 아니라 문구로 «키가 없다»를 알아본다. 프로바이더가 내는 문장과 호스트가
  // 찾는 조각이 같은 상수에서 나오는지 확인한다.
  it("recognises the missing-key notice a provider actually produces", () => {
    expect(missingApiKeyMessage("openai")).toContain(missingApiKeyMarker)
  })
})
