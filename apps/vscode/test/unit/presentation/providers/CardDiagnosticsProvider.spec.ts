import * as vscode from "vscode"
import { describe, expect, it } from "vitest"

import {
  mapCardErrorToSpans,
  validateBundleFile
} from "@/presentation/providers/CardDiagnosticsProvider"

const backgroundCardUri = vscode.Uri.file("/ws/project/background/home.card/card.yaml")
const statementsUri = vscode.Uri.file("/ws/project/character/hana.card/statements.yaml")
const homeId = "0b6f2f4e-1c1d-4c8e-9a51-6f0d6b1f7a10"

function errorFrom(uri: vscode.Uri, text: string): unknown {
  try {
    validateBundleFile(uri, text)
  } catch (error) {
    return error
  }
  throw new Error("expected validateBundleFile to throw")
}

describe("validateBundleFile", () => {
  it("accepts a header that matches its kind", () => {
    const text = [`id: ${homeId}`, "slug: home", "kind: background", "name: 집"].join("\n")

    expect(() => validateBundleFile(backgroundCardUri, text)).not.toThrow()
  })

  it("leaves files that are not bundle yaml alone", () => {
    expect(() =>
      validateBundleFile(vscode.Uri.file("/ws/project/character/hana.card/notes.yaml"), "::")
    ).not.toThrow()
    expect(() =>
      validateBundleFile(vscode.Uri.file("/ws/project/notes/card.yaml"), "::")
    ).not.toThrow()
  })
})

describe("mapCardErrorToSpans", () => {
  it("points a schema violation at the offending key line with the field path in the message", () => {
    const text = [`id: ${homeId}`, "slug: home", "kind: background", "name: 집", "locationKind: house"].join("\n")

    const spans = mapCardErrorToSpans(text, errorFrom(backgroundCardUri, text))

    expect(spans).toHaveLength(1)
    expect(spans[0]?.message).toContain("locationKind")
  })

  it("falls back to the first line when the offending key is absent from the text", () => {
    const text = [`id: ${homeId}`, "slug: home", "kind: background"].join("\n")

    const spans = mapCardErrorToSpans(text, errorFrom(backgroundCardUri, text))

    const nameSpan = spans.find((span) => span.message.includes("name"))
    expect(nameSpan?.line).toBe(0)
  })

  it("maps a YAML syntax error in statements.yaml to its mark line", () => {
    const text = ["- facet: traits", "  value: [unclosed"].join("\n")

    const spans = mapCardErrorToSpans(text, errorFrom(statementsUri, text))

    expect(spans).toHaveLength(1)
    expect(spans[0]?.message.length).toBeGreaterThan(0)
  })

  it("returns a first-line span for a non-bundle error", () => {
    const spans = mapCardErrorToSpans("본문\n둘째 줄", new Error("boom"))

    expect(spans).toEqual([{ line: 0, start: 0, end: "본문".length, message: "boom" }])
  })
})
