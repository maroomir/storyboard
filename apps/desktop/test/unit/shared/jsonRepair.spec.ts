import { describe, expect, it } from "vitest"

import { extractCompleteObjectsFromJsonArray, findFirstJsonArray } from "@/shared/jsonRepair"

describe("jsonRepair", () => {
  it("finds the first balanced JSON array while respecting strings", () => {
    const text = 'prefix [{"text":"대괄호 ] 포함"},{"id":2}] suffix [1]'

    expect(findFirstJsonArray(text)).toBe('[{"text":"대괄호 ] 포함"},{"id":2}]')
  })

  it("extracts complete objects from a partially broken JSON array", () => {
    const brokenJson = '[{"name":"엘리아"},{"name":"지훈"},{"name":"미완성"'

    expect(extractCompleteObjectsFromJsonArray(brokenJson)).toBe('[{"name":"엘리아"},{"name":"지훈"}]')
  })
})
