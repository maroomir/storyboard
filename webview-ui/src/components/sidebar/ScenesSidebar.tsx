import { AlertTriangle, CheckCircle2, CircleDashed, type LucideIcon } from "lucide-react"
import React, { useEffect, useMemo, useState } from "react"

import { createRequestId, normalizeUsageSummary, parseSidebarScenesInitialData } from "../../lib/messaging"
import type { SceneListItem, SidebarScenesInitialData, StoryboardEventMessage, StoryboardRequestMethod } from "../../lib/types"
import { Button } from "../ui/Button"

function sceneStatusPresentation(status: SceneListItem["status"]): {
  readonly Icon: LucideIcon
  readonly railClass: string
  readonly iconClass: string
} {
  switch (status) {
    case "ready":
      return {
        Icon: CheckCircle2,
        railClass: "bg-emerald-500/90",
        iconClass: "text-emerald-500"
      }
    case "stale":
      return {
        Icon: AlertTriangle,
        railClass: "bg-amber-500/90",
        iconClass: "text-amber-500"
      }
    case "missing":
      return {
        Icon: CircleDashed,
        railClass: "bg-sb-fg-muted/50",
        iconClass: "text-sb-fg-muted"
      }
    default:
      return {
        Icon: CircleDashed,
        railClass: "bg-sb-border",
        iconClass: "text-sb-fg-muted"
      }
  }
}

export function ScenesSidebar({ initialData }: { readonly initialData: SidebarScenesInitialData }): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), [])
  const [sidebarState, setSidebarState] = useState(initialData)

  useEffect(() => {
    const handleMessage = (event: MessageEvent<StoryboardEventMessage>): void => {
      if (event.data.type !== "event") {
        return
      }

      if (event.data.method === "scenes.listChanged") {
        setSidebarState(parseSidebarScenesInitialData(event.data.payload))
        return
      }

      if (event.data.method === "usage.changed") {
        const summary = (event.data.payload as { readonly summary?: unknown }).summary
        setSidebarState((prev) => ({
          ...prev,
          usage: normalizeUsageSummary(summary)
        }))
      }
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
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Scene list">
          {sidebarState.scenes.map((scene) => {
            const { Icon, railClass, iconClass } = sceneStatusPresentation(scene.status)
            return (
              <li
                key={scene.sceneUri}
                className="overflow-hidden rounded-xl border border-sb-border bg-sb-bg-widget shadow-cardRest transition hover:border-sb-border-focus hover:shadow-cardHover"
              >
                <div className="flex min-h-[4.25rem] min-w-0">
                  <div className={`w-1 shrink-0 ${railClass}`} aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5 pl-3">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 shrink-0" title={scene.status}>
                        <Icon className={`h-4 w-4 ${iconClass}`} aria-hidden />
                      </span>
                      <button
                        className="min-w-0 flex-1 cursor-pointer rounded-md border border-transparent bg-transparent p-0 text-left text-sb-fg outline-none hover:underline focus-visible:ring-1 focus-visible:ring-sb-border-focus"
                        type="button"
                        onClick={() => postSceneRequest("scenes.openScene", { uri: scene.sceneUri })}
                      >
                        <span className="block font-semibold leading-snug">{scene.title ?? scene.slug}</span>
                        <span className="mt-0.5 block truncate text-sm text-sb-fg-muted">{scene.stem}.txt</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pl-7">
                      <Button type="button" onClick={() => postSceneRequest("scenes.generateDraft", { uri: scene.sceneUri })}>
                        Generate
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!scene.draftUri}
                        onClick={() => {
                          if (scene.draftUri) {
                            postSceneRequest("scenes.openDraft", { uri: scene.draftUri })
                          }
                        }}
                      >
                        Open Draft
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
