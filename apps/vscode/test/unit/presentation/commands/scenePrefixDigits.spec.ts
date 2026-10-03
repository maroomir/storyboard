import { describe, expect, it } from "vitest"

import { clampScenePrefixDigits, resolveScenePrefixDigitCount } from '@storyboard/story-model';

describe("clampScenePrefixDigits", () => {
  it("clamps to 1..4", () => {
    expect(clampScenePrefixDigits(0)).toBe(1)
    expect(clampScenePrefixDigits(5)).toBe(4)
    expect(clampScenePrefixDigits(2)).toBe(2)
  })
})

describe("resolveScenePrefixDigitCount", () => {
  it("uses project digits when no explicit VSCode override", () => {
    expect(resolveScenePrefixDigitCount(3, undefined)).toBe(3)
    expect(resolveScenePrefixDigitCount(3, {})).toBe(3)
    expect(resolveScenePrefixDigitCount(3, { defaultValue: 2 })).toBe(3)
  })

  it("uses workspaceFolderValue when set", () => {
    expect(resolveScenePrefixDigitCount(2, { workspaceFolderValue: 4, defaultValue: 2 })).toBe(4)
  })

  it("uses workspaceValue when workspaceFolderValue is unset", () => {
    expect(resolveScenePrefixDigitCount(2, { workspaceValue: 1, defaultValue: 2 })).toBe(1)
  })

  it("uses globalValue when only global is set", () => {
    expect(resolveScenePrefixDigitCount(3, { globalValue: 4, defaultValue: 2 })).toBe(4)
  })

  it("prefers workspaceFolder over workspace over global", () => {
    expect(
      resolveScenePrefixDigitCount(1, {
        workspaceFolderValue: 3,
        workspaceValue: 2,
        globalValue: 4,
        defaultValue: 2
      })
    ).toBe(3)
  })

  it("clamps override values", () => {
    expect(resolveScenePrefixDigitCount(2, { workspaceValue: 99, defaultValue: 2 })).toBe(4)
    expect(resolveScenePrefixDigitCount(2, { workspaceValue: 0, defaultValue: 2 })).toBe(1)
  })
})
