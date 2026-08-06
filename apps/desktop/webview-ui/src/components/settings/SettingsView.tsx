import { ListChecks, Plug, ScrollText, Send, Star } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { createRequestId } from "@webview/lib/messaging"

import { Button } from "../ui/Button"
import { SectionHeader } from "../ui/SectionHeader"
import { Tabs } from "../ui/Tabs"
import { BotSection } from "./BotSection"
import { DefaultProviderSection } from "./DefaultProviderSection"
import { GenerationContractSection } from "./GenerationContractSection"
import { ProviderConfigCard } from "./ProviderConfigCard"
import { SettingsSummaryCards } from "./SettingsSummaryCards"
import { TaskAssignmentsSection } from "./TaskAssignmentsSection"
import {
  AI_PROVIDER_IDS,
  parseSettingsReadSnapshot,
  type AiProviderId,
  type ConnectionTestState,
  type SettingsReadSnapshot
} from "./settingsSnapshot"

const settingsPanelClass = "mx-auto flex w-full max-w-5xl flex-col gap-4"

interface StoryboardRpcRequest {
  readonly protocolVersion: "1.0.0"
  readonly type: "request"
  readonly id: string
  readonly method: string
  readonly payload: Record<string, unknown>
}

interface StoryboardRpcSuccessResponse {
  readonly protocolVersion: "1.0.0"
  readonly type: "response"
  readonly id: string
  readonly method: string
  readonly ok: true
  readonly payload: unknown
}

interface StoryboardRpcErrorResponse {
  readonly protocolVersion: "1.0.0"
  readonly type: "response"
  readonly id: string
  readonly method: string
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string }
}

interface SettingsChangedEvent {
  readonly type: "event"
  readonly method: "settings.changed"
  readonly payload: unknown
}

function useStoryboardRpc(): {
  readonly callRpc: (method: string, payload: Record<string, unknown>) => Promise<unknown>
  readonly vscodeApi: { readonly postMessage: (message: unknown) => void } | undefined
} {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), [])

  const callRpc = useCallback(
    (method: string, payload: Record<string, unknown>): Promise<unknown> => {
      if (!vscodeApi) {
        return Promise.reject(new Error("VS Code API를 사용할 수 없습니다."))
      }

      const id = createRequestId()
      const request: StoryboardRpcRequest = {
        protocolVersion: "1.0.0",
        type: "request",
        id,
        method,
        payload
      }

      return new Promise((resolve, reject) => {
        const handler = (event: MessageEvent): void => {
          const data = event.data as StoryboardRpcSuccessResponse | StoryboardRpcErrorResponse | undefined
          if (!data || data.type !== "response" || data.id !== id) {
            return
          }

          window.removeEventListener("message", handler)

          if (data.ok) {
            resolve(data.payload)
            return
          }

          reject(new Error(data.error.message))
        }

        window.addEventListener("message", handler)
        vscodeApi.postMessage(request)
      })
    },
    [vscodeApi]
  )

  return { callRpc, vscodeApi }
}

export function SettingsView({ initialData }: { readonly initialData: unknown }): React.ReactElement {
  const parsedInitial = useMemo(() => parseSettingsReadSnapshot(initialData), [initialData])
  const [snapshot, setSnapshot] = useState<SettingsReadSnapshot | undefined>(parsedInitial)
  const [loadError, setLoadError] = useState<string | null>(parsedInitial ? null : "설정을 불러오지 못했습니다.")
  const [rpcError, setRpcError] = useState<string | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState<Partial<Record<AiProviderId, string>>>({})
  const [commandDraft, setCommandDraft] = useState<Partial<Record<AiProviderId, string>>>({})
  const [ollamaBaseUrlDraft, setOllamaBaseUrlDraft] = useState<string | null>(null)
  const [baseUrlFocused, setBaseUrlFocused] = useState(false)
  const baseUrlFocusedRef = useRef(baseUrlFocused)
  baseUrlFocusedRef.current = baseUrlFocused
  const [connectionTest, setConnectionTest] = useState<Partial<Record<AiProviderId, ConnectionTestState>>>({})
  const [activeTabId, setActiveTabId] = useState("defaults")

  const { callRpc, vscodeApi } = useStoryboardRpc()

  const onRpcError = useCallback((message: string): void => {
    setRpcError(message)
  }, [])

  useEffect(() => {
    if (snapshot || !vscodeApi) {
      return
    }

    const id = createRequestId()
    const request: StoryboardRpcRequest = {
      protocolVersion: "1.0.0",
      type: "request",
      id,
      method: "settings.read",
      payload: {}
    }

    const handler = (event: MessageEvent): void => {
      const data = event.data as StoryboardRpcSuccessResponse | StoryboardRpcErrorResponse | undefined
      if (!data || data.type !== "response" || data.id !== id) {
        return
      }

      window.removeEventListener("message", handler)

      if (!data.ok) {
        setLoadError(data.error.message)
        return
      }

      const next = parseSettingsReadSnapshot(data.payload)
      if (!next) {
        setLoadError("설정 응답 형식이 올바르지 않습니다.")
        return
      }

      setSnapshot(next)
      setLoadError(null)
    }

    window.addEventListener("message", handler)
    vscodeApi.postMessage(request)

    return () => {
      window.removeEventListener("message", handler)
    }
  }, [snapshot, vscodeApi])

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      const data = event.data as SettingsChangedEvent | undefined
      if (!data || data.type !== "event" || data.method !== "settings.changed") {
        return
      }

      const next = parseSettingsReadSnapshot(data.payload)
      if (!next) {
        return
      }

      setSnapshot(next)

      if (!baseUrlFocusedRef.current) {
        setOllamaBaseUrlDraft(null)
      }
    }

    window.addEventListener("message", handleMessage)
    return () => {
      window.removeEventListener("message", handleMessage)
    }
  }, [])

  if (loadError || !snapshot) {
    return (
      <main className="flex min-h-screen bg-sb-bg p-5">
        <div className={settingsPanelClass}>
          <SectionHeader eyebrow="Storyboard" title="설정" description={<span className="text-sb-fg-error">{loadError ?? "알 수 없는 오류"}</span>} />
        </div>
      </main>
    )
  }

  const settingsTabs = [
    {
      id: "defaults",
      label: "기본값",
      icon: Star,
      panel: <DefaultProviderSection snapshot={snapshot} callRpc={callRpc} onRpcError={onRpcError} />
    },
    {
      id: "connections",
      label: "연결",
      icon: Plug,
      panel: (
        <section className="flex flex-col gap-3" aria-label="제공자 연결">
          <SectionHeader
            title="제공자 연결"
            description="API 키, Ollama Base URL, 연결 테스트만 관리합니다. 모델 선택은 기본값 또는 태스크 탭에서 조정합니다."
          />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {AI_PROVIDER_IDS.map((providerId) => (
              <ProviderConfigCard
                key={providerId}
                providerId={providerId}
                snapshot={snapshot}
                callRpc={callRpc}
                onRpcError={onRpcError}
                apiKeyDraft={apiKeyDraft}
                setApiKeyDraft={setApiKeyDraft}
                commandDraft={commandDraft}
                setCommandDraft={setCommandDraft}
                ollamaBaseUrlDraft={ollamaBaseUrlDraft}
                setOllamaBaseUrlDraft={setOllamaBaseUrlDraft}
                baseUrlFocused={baseUrlFocused}
                setBaseUrlFocused={setBaseUrlFocused}
                connectionTest={connectionTest}
                setConnectionTest={setConnectionTest}
              />
            ))}
          </div>
        </section>
      )
    },
    {
      id: "tasks",
      label: "태스크",
      icon: ListChecks,
      panel: <TaskAssignmentsSection snapshot={snapshot} callRpc={callRpc} onRpcError={onRpcError} />
    },
    {
      id: "contract",
      label: "작품 계약",
      icon: ScrollText,
      panel: <GenerationContractSection callRpc={callRpc} onRpcError={onRpcError} />
    },
    {
      id: "bot",
      label: "텔레그램 봇",
      icon: Send,
      panel: <BotSection callRpc={callRpc} onRpcError={onRpcError} />
    }
  ]

  return (
    <main className="flex min-h-screen bg-sb-bg p-5">
      <div className={settingsPanelClass}>
        <header className="flex flex-col gap-3 border-b border-sb-border pb-4">
          <SectionHeader
            eyebrow="Storyboard"
            title="설정"
            description="AI 기본값, 연결 정보, 태스크별 덮어쓰기를 필요한 범위만 열어 관리합니다."
          />
          <SettingsSummaryCards snapshot={snapshot} onNavigate={setActiveTabId} />
        </header>

        {rpcError ? (
          <div className="flex items-start justify-between gap-3 rounded-md border border-sb-border-warning bg-sb-bg-widget/80 px-3 py-2 text-sm text-sb-fg">
            <span>{rpcError}</span>
            <Button type="button" variant="secondary" onClick={() => setRpcError(null)}>
              닫기
            </Button>
          </div>
        ) : null}

        <div className="rounded-lg border border-sb-border bg-sb-bg-sidebar/70 p-3">
          <Tabs items={settingsTabs} activeId={activeTabId} onActiveIdChange={setActiveTabId} />
        </div>
      </div>
    </main>
  )
}
