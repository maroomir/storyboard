import { describe, expect, it } from "vitest"

import { findCopiedElementIds, resolveElement, type ElementIndexEntry } from "@storyboard/story-model"

const elia = "3f9a2c1e-6b0d-4e7a-9c11-0d2f5a8b7e44"
const eliaNarrator = "e1f0a2b3-c4d5-4e6f-8a7b-9c0d1e2f3a4b"
const rooftop = "c2e8a1b4-9d7c-4e3f-a2b1-0c9d8e7f6a5b"
const arrival = "9d41b2c3-4d5e-4f6a-8b7c-1d2e3f4a5b6c"

const entries: ElementIndexEntry[] = [
  { id: elia, kind: "character", slug: "elia", path: "character/elia.card" },
  { id: eliaNarrator, kind: "narrator", slug: "elia", path: "narrator/elia.card" },
  { id: arrival, kind: "scene", slug: "arrival", path: "scene/001-arrival.card", sceneNumber: 1 },
  { id: rooftop, kind: "scene", slug: "rooftop", path: "scene/002-rooftop.card", sceneNumber: 2 },
]

describe("element resolver", () => {
  it("finds a scene by number and slug, by number alone and by slug alone", () => {
    for (const text of ["002-rooftop", "2", "002", "rooftop", rooftop]) {
      expect(resolveElement(entries, { text }), text).toEqual({ kind: "found", entry: entries[3] })
    }
  })

  it("follows the slug when a typed number has gone stale", () => {
    expect(resolveElement(entries, { text: "007-rooftop", kind: "scene" })).toMatchObject({ kind: "found" })
  })

  it("asks for the kind when two kinds share a slug, and takes it from a prefix", () => {
    expect(resolveElement(entries, { text: "elia" })).toMatchObject({ kind: "ambiguous" })
    expect(resolveElement(entries, { text: "elia", kind: "character" })).toEqual({ kind: "found", entry: entries[0] })
    expect(resolveElement(entries, { text: "narrator:elia" })).toEqual({ kind: "found", entry: entries[1] })
  })

  it("reports a missing element and a uuid copied into two folders", () => {
    expect(resolveElement(entries, { text: "sera" })).toEqual({ kind: "missing" })
    expect(resolveElement(entries, { text: "9" })).toEqual({ kind: "missing" })

    const copied: ElementIndexEntry[] = [...entries, { id: elia, kind: "character", slug: "elia-copy", path: "character/elia-copy.card" }]

    expect(resolveElement(copied, { text: elia })).toMatchObject({ kind: "copied" })
    expect(findCopiedElementIds(copied)).toEqual([[entries[0], copied[4]]])
  })
})
