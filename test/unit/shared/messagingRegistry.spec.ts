import { describe, expect, it } from "vitest"

import {
  isStoryboardRequestMethod,
  storyboardRequestPayloadSchemas,
  storyboardResponsePayloadSchemas
} from "@/shared/messaging"

const expectedMethods = [
  "ai.generate",
  "ai.generateStream",
  "ai.providers.checkConnection",
  "ai.providers.list",
  "cards.applyCollect",
  "cards.collect",
  "cards.createPlaceholder",
  "cards.delete",
  "cards.list",
  "cards.open",
  "cards.previewCollect",
  "cards.read",
  "cards.resolveImageUri",
  "cards.write",
  "cards.writeRaw",
  "project.readContract",
  "project.updateContract",
  "relations.list",
  "scenes.generateDraft",
  "scenes.list",
  "scenes.openDraft",
  "scenes.openScene",
  "secrets.deleteApiKey",
  "secrets.writeApiKey",
  "settings.read",
  "settings.updateDefaultProvider",
  "settings.updateProviderBaseUrl",
  "settings.updateProviderCommand",
  "settings.updateProviderModel",
  "settings.updateTaskAiConfig",
  "studio.runAction",
  "usage.read"
]

describe("storyboard RPC registry", () => {
  it("exposes exactly the expected request methods", () => {
    expect(Object.keys(storyboardRequestPayloadSchemas).sort()).toEqual(expectedMethods)
  })

  it("exposes the same method set for responses", () => {
    expect(Object.keys(storyboardResponsePayloadSchemas).sort()).toEqual(expectedMethods)
  })

  it("isStoryboardRequestMethod agrees with the request registry", () => {
    for (const method of expectedMethods) {
      expect(isStoryboardRequestMethod(method)).toBe(true)
    }
    expect(isStoryboardRequestMethod("cards.unknown")).toBe(false)
  })
})
