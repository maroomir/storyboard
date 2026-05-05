import React, { useEffect, useMemo, useState } from "react"

import { createRequestId, parseSidebarScenesInitialData } from "../../lib/messaging"
import type { SceneListItem, SidebarScenesInitialData, StoryboardEventMessage, StoryboardRequestMethod } from "../../lib/types"
import { sbControlButtonClass } from "../ui/formClasses"

function statusBadgeEmoji(status: SceneListItem["status"]): string {
  switch (status) {
    case "ready":
      return "✅"
    case "stale":
      return "⚠️"
    case "missing":
      return "⬜"
    default:
      return ""
  }
}

export function ScenesSidebar({ initialData }: { readonly initialData: SidebarScenesInitialData }): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), [])
  const [sidebarState, setSidebarState] = useState(initialData)

  useEffect(() => {
    const handleMessage = (event: MessageEvent<StoryboardEventMessage>): void => {
      if (event.data.type !== "event" || event.data.method !== "scenes.listChanged") {
        return
      }

      setSidebarState(parseSidebarScenesInitialData(event.data.payload))
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const postSceneRequest = (method: StoryboardRequestMethod, payload: Record<string, unknown>): void => {
    vscodeApi?.postMessage({
      protocolVersion: "1.0.0",
      type: "request",
      id: createRequestId(),
      method,
      payload
    })
  }

  if (!sidebarState.isStoryboardProject) {
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
        <h1 className="m-0 text-xl leading-snug text-sb-fg">{sidebarState.title}</h1>
        <p className="m-0 leading-normal text-sb-fg-muted">
          Storyboard 프로젝트가 아닙니다. 먼저 Initialize Project를 실행해 주세요.
        </p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
      <h1 className="m-0 text-xl leading-snug text-sb-fg">{sidebarState.title}</h1>

      {sidebarState.scenes.length === 0 ? (
        <p className="m-0 leading-normal text-sb-fg-muted">아직 씬 파일이 없습니다. 상단 + 버튼으로 새 씬을 추가해 보세요.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Scene list">
          {sidebarState.scenes.map((scene) => (
            <li
              key={scene.sceneUri}
              className="flex flex-col gap-2 rounded-md border border-transparent bg-transparent p-2 hover:border-sb-border-focus hover:bg-sb-bg-list-hover"
            >
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-base" title={scene.status}>
                  {statusBadgeEmoji(scene.status)}
                </span>
                <button
                  className="min-w-0 flex-1 cursor-pointer rounded border border-transparent bg-transparent p-0 text-left text-sb-fg hover:underline focus:border-sb-border-focus focus:outline-none"
                  type="button"
                  onClick={() => postSceneRequest("scenes.openScene", { uri: scene.sceneUri })}
                >
                  <span className="block font-semibold">{scene.title ?? scene.slug}</span>
                  <span className="block truncate text-sm text-sb-fg-muted">{scene.stem}.txt</span>
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-7">
                <button type="button" className={sbControlButtonClass} onClick={() => postSceneRequest("scenes.generateDraft", { uri: scene.sceneUri })}>
                  Generate
                </button>
                <button
                  type="button"
                  className={`${sbControlButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
                  disabled={!scene.draftUri}
                  onClick={() => {
                    if (scene.draftUri) {
                      postSceneRequest("scenes.openDraft", { uri: scene.draftUri })
                    }
                  }}
                >
                  Open Draft
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
