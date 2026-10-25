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

  it("recognises the missing-key notice a provider actually produces", () => {
    expect(missingApiKeyMessage("openai")).toContain(missingApiKeyMarker)
  })
})
