import { describe, expect, it } from "vitest"

import { renderTemplate, TemplateSyntaxError } from "@storyboard/story-ai"

describe("renderTemplate", () => {
  it("inserts values verbatim and keeps text as is", () => {
    expect(renderTemplate("[본문]\n{{body}}", { body: "가 {{나}} 다" })).toBe("[본문]\n가 {{나}} 다")
  })

  it("drops a standalone section line so conditional lines join like a filtered list", () => {
    const template = "첫 줄\n{{#extra}}\n{{extra}}\n{{/extra}}\n마지막 줄"

    expect(renderTemplate(template, { extra: "가운데" })).toBe("첫 줄\n가운데\n마지막 줄")
    expect(renderTemplate(template, {})).toBe("첫 줄\n마지막 줄")
  })

  it("repeats a section for each item and reads the item with a dot", () => {
    expect(renderTemplate("{{#names}}\n- {{.}}\n{{/names}}", { names: ["a", "b"] })).toBe("- a\n- b\n")
  })

  it("renders an inverted section only when the value is missing or empty", () => {
    const template = "{{^facts}}(없음){{/facts}}{{#facts}}있음{{/facts}}"

    expect(renderTemplate(template, { facts: [] })).toBe("(없음)")
    expect(renderTemplate(template, { facts: ["x"] })).toBe("있음")
  })

  it("inserts a partial and removes the whole line when the partial is empty", () => {
    const template = "위\n{{> block}}\n아래"

    expect(renderTemplate(template, {}, { block: "가\n나" })).toBe("위\n가\n나\n아래")
    expect(renderTemplate(template, {}, { block: "" })).toBe("위\n아래")
  })

  it("refuses an unclosed or mismatched section", () => {
    expect(() => renderTemplate("{{#a}}x", {})).toThrow(TemplateSyntaxError)
    expect(() => renderTemplate("{{#a}}x{{/b}}", {})).toThrow(TemplateSyntaxError)
  })
})
