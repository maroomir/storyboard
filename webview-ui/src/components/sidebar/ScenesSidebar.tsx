import { AlertTriangle, CheckCircle2, CircleDashed, type LucideIcon } from "lucide-react"
import React, { useEffect, useMemo, useState } from "react"

import {
  createRequestId,
  parseSidebarScenesInitialData,
  parseUsageChangedPayload,
  sumUsageMap
} from "@webview/lib/messaging"
import type { SceneListItem, SidebarScenesInitialData, StoryboardEventMessage, StoryboardRequestMethod } from "@webview/lib/types"
import { Button } from "../ui/Button"
import { CostBadge } from "../ui/CostBadge"

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
  const [pendingGenerateRequestMap, setPendingGenerateRequestMap] = useState<Readonly<Record<string, string>>>({})

  useEffect(() => {
    const handleMessage = (event: MessageEvent<StoryboardEventMessage | { readonly type: "response"; readonly id: string }>): void => {
      if (event.data.type === "response" && "id" in event.data) {
        const responseId = event.data.id
        setPendingGenerateRequestMap((prev) => {
          if (!prev[responseId]) {
            return prev
          }

          const next = { ...prev }
          delete next[responseId]
          return next
        })
        return
      }

      if (event.data.type !== "event") {
        return
      }

      const eventMessage = event.data as StoryboardEventMessage

      if (eventMessage.method === "scenes.listChanged") {
        setSidebarState(parseSidebarScenesInitialData(eventMessage.payload))
        return
      }

      if (eventMessage.method === "usage.changed") {
        setSidebarState((prev) => ({
          ...prev,
          usage: parseUsageChangedPayload(eventMessage.payload)
        }))
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const scenesUsageTotal = sumUsageMap(sidebarState.usage.scenes)
  const sceneCostUsd = (scene: SceneListItem): number => {
    const raw = sidebarState.usage.scenes[scene.stem]
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0
  }

  const postSceneRequest = (method: StoryboardRequestMethod, payload: Record<string, unknown>): void => {
    const requestId = createRequestId()
    if (method === "scenes.generateDraft") {
      const uri = typeof payload.uri === "string" ? payload.uri : ""
      if (uri.length > 0) {
        setPendingGenerateRequestMap((prev) => ({ ...prev, [requestId]: uri }))
      }
    }

    vscodeApi?.postMessage({
      protocolVersion: "1.0.0",
      type: "request",
      id: requestId,
      method,
      payload
    })
  }

  if (!sidebarState.isStoryboardProject) {
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
            <h1 className="m-0 text-xl leading-snug text-sb-fg">{sidebarState.title}</h1>
          </div>
          <CostBadge usd={0} className="shrink-0" />
        </div>
        <p className="m-0 leading-normal text-sb-fg-muted">
          Storyboard 프로젝트가 아닙니다. 먼저 Initialize Project를 실행해 주세요.
        </p>
      </main>
    )
  }

  const pendingGenerateUris = new Set(Object.values(pendingGenerateRequestMap))

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
          <h1 className="m-0 text-xl leading-snug text-sb-fg">{sidebarState.title}</h1>
        </div>
        <CostBadge usd={scenesUsageTotal} className="shrink-0" />
      </div>

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
                      {scene.outlineStale ? (
                        <span
                          className="shrink-0 self-start rounded-full border border-amber-500/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-500"
                          title="아웃라인(chapters.yaml)이 이 씬보다 최신입니다. 시드·초안이 계획과 어긋날 수 있습니다."
                        >
                          outline
                        </span>
                      ) : null}
                      <CostBadge usd={sceneCostUsd(scene)} className="shrink-0 self-start" />
                    </div>
                    <div className="flex flex-wrap gap-1.5 pl-7">
                      <Button type="button" onClick={() => postSceneRequest("scenes.generateDraft", { uri: scene.sceneUri })}>
                        {pendingGenerateUris.has(scene.sceneUri) ? "Generating…" : "Generate"}
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
