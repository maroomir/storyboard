import { describe, expect, it } from "vitest"

import { StudioCardAuditPrompt } from "@storyboard/story-ai"

describe("StudioCardAuditPrompt golden", () => {
  it("renders the card and the reference material", () => {
    expect(
      StudioCardAuditPrompt.build({
        entityLabel: "엘리아",
        cardText: "id: elia\nname: 엘리아\ndescription: 항구의 의사",
        context: "[씬 03-harbor]\n엘리아는 약사로 일한다."
      })
    ).toMatchSnapshot()
  })

  it("renders empty card text and material", () => {
    expect(StudioCardAuditPrompt.build({ entityLabel: "준", cardText: "", context: "" })).toMatchSnapshot()
  })
})
