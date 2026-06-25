import yaml from "js-yaml"

import { splitCardTextToList } from "../shared/card"

const listTextFields = ["description", "voice"] as const

export interface CardTextMigrationResult {
  readonly yaml: string
  readonly changed: boolean
}

export function migrateCardTextFieldsToList(rawYaml: string): CardTextMigrationResult {
  const parsed = yaml.load(rawYaml)

  if (!isPlainObject(parsed)) {
    return { yaml: rawYaml, changed: false }
  }

  let changed = false
  const next = { ...parsed }

  for (const field of listTextFields) {
    const value = next[field]
    if (typeof value === "string") {
      next[field] = splitCardTextToList(value)
      changed = true
    }
  }

  if (!changed) {
    return { yaml: rawYaml, changed: false }
  }

  return {
    yaml: yaml.dump(next, { lineWidth: -1, noRefs: true, sortKeys: false }),
    changed: true
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
