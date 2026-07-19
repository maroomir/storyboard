import { describe, expect, it } from "vitest"

import { parseCard } from "@/domain/files/card"
import { mapCardErrorToSpans } from "@/presentation/providers/CardDiagnosticsProvider"

function errorFrom(rawCard: string): unknown {
  try {
    parseCard(rawCard)
  } catch (error) {
    return error
  }
  throw new Error("expected parseCard to throw")
}

describe("mapCardErrorToSpans", () => {
  it("points a schema violation at the offending key line with the field path in the message", () => {
    const rawCard = ["type: location", "id: home", "name: 집", "locationKind: house"].join("\n")

    const spans = mapCardErrorToSpans(rawCard, errorFrom(rawCard))

    expect(spans).toHaveLength(1)
    expect(spans[0]?.line).toBe(3)
    expect(spans[0]?.start).toBe(0)
    expect(spans[0]?.end).toBe("locationKind".length)
    expect(spans[0]?.message).toContain("locationKind")
  })

  it("falls back to the first line when the offending key is absent from the text", () => {
    const rawCard = ["type: character", "id: a", "role: main"].join("\n")

    const spans = mapCardErrorToSpans(rawCard, errorFrom(rawCard))

    expect(spans.length).toBeGreaterThanOrEqual(1)
    const nameSpan = spans.find((span) => span.message.includes("name"))
    expect(nameSpan?.line).toBe(0)
  })

  it("maps a YAML syntax error to its mark line", () => {
    const rawCard = ["type: character", "id: a", "tags: [unclosed"].join("\n")

    const spans = mapCardErrorToSpans(rawCard, errorFrom(rawCard))

    expect(spans).toHaveLength(1)
    expect(spans[0]?.line).toBeGreaterThanOrEqual(0)
    expect(spans[0]?.message.length).toBeGreaterThan(0)
  })

  it("returns a first-line span for a non-card error", () => {
    const spans = mapCardErrorToSpans("본문\n둘째 줄", new Error("boom"))

    expect(spans).toEqual([{ line: 0, start: 0, end: "본문".length, message: "boom" }])
  })
})
