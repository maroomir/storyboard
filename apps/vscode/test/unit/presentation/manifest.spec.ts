import { describe, expect, it } from "vitest"

import { sidebarRunnableCommands } from "@storyboard/story-engine/contracts"

import manifest from "../../../package.json"
import {
  cardEditorViewType,
  sidebarViewIds,
  workspaceReadyContextKey
} from "@/contributionIds"

// package.json 은 확장 코드가 import 하지 않으므로 기여 목록과 코드는 두 벌로 존재할 수밖에 없다.
// 둘이 어긋나면 메뉴가 아무 일도 하지 않는 항목을 띄우거나 뷰가 비어 보이므로 여기서 묶어 둔다.
const contributes = manifest.contributes
const commandIds = contributes.commands.map((command) => command.command)

describe("package.json contributions", () => {
  it("gives every contributed command a unique storyboard id", () => {
    expect(new Set(commandIds).size).toBe(commandIds.length)

    for (const id of commandIds) {
      expect(id.startsWith("storyboard."), `${id} is outside the namespace`).toBe(true)
    }
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

  // SECURITY: 사이드바가 부를 수 있다고 스키마가 허락한 명령이 기여 목록에 없으면, 웹뷰 버튼이
  // 아무 일도 하지 않거나 등록되지 않은 명령을 부른다.
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
