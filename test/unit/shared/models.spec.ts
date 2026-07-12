import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { storyboardModelCatalog } from "@/shared/models"
import { aiProviderIds, type AiProviderId } from "@/shared/ai"

describe("storyboardModelCatalog vs package.json defaults", () => {
  it("includes every contributed provider model default from package.json", () => {
    const packageJsonPath = path.join(process.cwd(), "package.json")
    const raw = readFileSync(packageJsonPath, "utf8")
    const packageJson = JSON.parse(raw) as {
      readonly contributes?: {
        readonly configuration?: { readonly properties?: Record<string, { readonly default?: unknown }> }
      }
    }

    const properties = packageJson.contributes?.configuration?.properties ?? {}

    for (const providerId of aiProviderIds) {
      if (providerId === "mock") {
        continue
      }

      const key = `storyboard.providers.${providerId}.model`
      const defaultModel = properties[key]?.default

      expect(typeof defaultModel, `missing default for ${key}`).toBe("string")
      const ids = storyboardModelCatalog[providerId as AiProviderId].map((o) => o.id)
      expect(ids).toContain(defaultModel)
    }
  })
})
