import { describe, expect, it } from "vitest"

import { sidebarRunnableCommands } from "@storyboard/story-model/contracts"

import manifest from "../../../package.json"
import {
  cardEditorViewType,
  sidebarViewIds,
  storyboardCommandIds,
  workspaceReadyContextKey
} from "@/contributionIds"

const contributes = manifest.contributes
const commandIds = contributes.commands.map((command) => command.command)
const registeredWithoutContribution = [
  storyboardCommandIds.providerChoose,
  storyboardCommandIds.draftApplyGrammarFix
]

describe("package.json contributions", () => {
  it("gives every contributed command a unique storyboard id", () => {
    expect(new Set(commandIds).size).toBe(commandIds.length)

    for (const id of commandIds) {
      expect(id.startsWith("storyboard."), `${id} is outside the namespace`).toBe(true)
    }
  })

  it("names every contributed command in contributionIds and nothing stale", () => {
    const knownIds = Object.values(storyboardCommandIds)

    for (const id of commandIds) {
      expect(knownIds, `${id} is not in storyboardCommandIds`).toContain(id)
    }

    const uncontributed = knownIds.filter((id) => !commandIds.includes(id))
    expect(uncontributed.sort()).toEqual([...registeredWithoutContribution].sort())
  })

  it("points every menu entry at a contributed command", () => {
    const menus = contributes.menus as Readonly<
      Record<string, readonly { readonly command?: string }[]>
    >

    for (const [menu, entries] of Object.entries(menus)) {
      for (const entry of entries) {
        if (entry.command === undefined) {
          continue
        }

        expect(commandIds, `${menu} points at ${entry.command}`).toContain(entry.command)
      }
    }
  })

  it("contributes every command the sidebar is allowed to run", () => {
    for (const command of sidebarRunnableCommands) {
      expect(commandIds, `${command} is not contributed`).toContain(command)
    }
  })

  it("declares the view ids the sidebar providers register", () => {
    const contributedViewIds = Object.values(
      contributes.views as Readonly<Record<string, readonly { readonly id: string }[]>>
    )
      .flat()
      .map((view) => view.id)

    for (const viewId of Object.values(sidebarViewIds)) {
      expect(contributedViewIds, `${viewId} is not contributed`).toContain(viewId)
    }
  })

  it("declares the card editor view type the providers open", () => {
    const viewTypes = contributes.customEditors.map((editor) => editor.viewType)

    expect(viewTypes).toContain(cardEditorViewType)
  })

  it("guards its views with the context key the host actually sets", () => {
    const whenClauses = Object.values(
      contributes.views as Readonly<Record<string, readonly { readonly when?: string }[]>>
    )
      .flat()
      .map((view) => view.when)

    expect(whenClauses).toContain(workspaceReadyContextKey)
  })
})
