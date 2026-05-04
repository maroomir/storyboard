import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

const sbInputClass =
  "w-full rounded-md border border-[color:var(--vscode-input-border)] bg-sb-bg-input px-3 py-2 text-sb-fg-input outline-none transition focus:border-sb-border-focus"

const sbControlButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[color:var(--vscode-button-border)] bg-sb-bg-button px-3 py-1.5 text-sm font-medium text-sb-fg-button transition hover:bg-sb-bg-button-hover disabled:cursor-not-allowed disabled:opacity-50"

const sbSecondaryButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-sb-border bg-sb-bg-widget px-3 py-1.5 text-sm font-medium text-sb-fg transition hover:border-sb-border-focus disabled:cursor-not-allowed disabled:opacity-50"

const sbDangerButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-sb-border bg-transparent px-3 py-1.5 text-sm font-medium text-sb-fg-error transition hover:border-sb-fg-error disabled:cursor-not-allowed disabled:opacity-50"

const sbSelectClass = `${sbInputClass} max-w-md`

const sectionCardClass =
  "flex flex-col gap-4 rounded-xl border border-sb-border bg-sb-bg-sidebar p-4 shadow-[0_12px_32px_rgba(0,0,0,0.12)]"

const fieldGroupClass = "flex max-w-xl flex-col gap-2 rounded-lg border border-sb-border bg-sb-bg-widget p-3"

const AI_PROVIDER_IDS = ["openai", "claude", "google", "ollama", "mock"] as const
type AiProviderId = (typeof AI_PROVIDER_IDS)[number]

const AI_TASK_NAMES = [
  "situationExtraction",
  "personaDialogue",
  "sceneDraft",
  "traitsExtraction",
  "grammarCheck",
  "inlineCompletion",
  "draftExpansion"
] as const
type AiTaskName = (typeof AI_TASK_NAMES)[number]

interface AiProviderStatus {
  readonly providerId: AiProviderId
  readonly displayName: string
  readonly model?: string
  readonly hasApiKey: boolean
  readonly isAvailable: boolean
}

interface ProviderModelOption {
  readonly id: string
  readonly displayName: string
}

interface ProviderRuntimeConfig {
  readonly model: string
  readonly baseUrl?: string
}

interface SettingsReadSnapshot {
  readonly defaultProvider: AiProviderId
  readonly providers: readonly AiProviderStatus[]
  readonly providerConfigs: Readonly<Record<AiProviderId, ProviderRuntimeConfig>>
  readonly taskAssignments: Readonly<Record<AiTaskName, AiProviderId | null>>
  readonly modelCatalog: Readonly<Record<AiProviderId, readonly ProviderModelOption[]>>
}

const AI_TASK_LABELS: Record<AiTaskName, string> = {
  situationExtraction: "상황 추출",
  personaDialogue: "페르소나 대화",
  sceneDraft: "씬 드래프트",
  traitsExtraction: "특성 추출",
  grammarCheck: "문법 검사",
  inlineCompletion: "인라인 완성",
  draftExpansion: "드래프트 확장"
}

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

function isAiProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value)
}

function parseSettingsReadSnapshot(value: unknown): SettingsReadSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const candidate = value as Partial<SettingsReadSnapshot>
  if (!isAiProviderId(candidate.defaultProvider ?? "")) {
    return undefined
  }

  if (!Array.isArray(candidate.providers) || !candidate.providerConfigs || !candidate.taskAssignments || !candidate.modelCatalog) {
    return undefined
  }

  for (const id of AI_PROVIDER_IDS) {
    const cfg = (candidate.providerConfigs as Record<string, unknown>)[id]
    if (!cfg || typeof cfg !== "object" || typeof (cfg as { model?: unknown }).model !== "string") {
      return undefined
    }
    const models = (candidate.modelCatalog as Record<string, unknown>)[id]
    if (!Array.isArray(models) || models.length === 0) {
      return undefined
    }
  }

  for (const task of AI_TASK_NAMES) {
    const assignment = (candidate.taskAssignments as Record<string, unknown>)[task]
    if (assignment !== null && assignment !== undefined && typeof assignment !== "string") {
      return undefined
    }
    if (typeof assignment === "string" && !isAiProviderId(assignment)) {
      return undefined
    }
  }

  return candidate as SettingsReadSnapshot
}

function createRequestId(): string {
  return crypto.randomUUID()
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

function getProviderStatus(snapshot: SettingsReadSnapshot, providerId: AiProviderId): AiProviderStatus | undefined {
  return snapshot.providers.find((entry) => entry.providerId === providerId)
}

function StatusPill({
  tone,
  children
}: {
  readonly tone: "neutral" | "success" | "warning" | "error"
  readonly children: React.ReactNode
}): React.ReactElement {
  const toneClass = {
    neutral: "border-sb-border text-sb-fg-muted",
    success: "border-sb-border-focus text-sb-fg",
    warning: "border-sb-border-warning text-sb-fg",
    error: "border-sb-fg-error text-sb-fg-error"
  }[tone]

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  )
}

function DefaultProviderSection({
  snapshot,
  callRpc,
  onRpcError
}: {
  readonly snapshot: SettingsReadSnapshot
  readonly callRpc: (method: string, payload: Record<string, unknown>) => Promise<unknown>
  readonly onRpcError: (message: string) => void
}): React.ReactElement {
  const [pending, setPending] = useState(false)
  const selectedProvider = getProviderStatus(snapshot, snapshot.defaultProvider)

  return (
    <section className={sectionCardClass} aria-label="기본 AI 제공자">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-semibold text-sb-fg">기본 제공자</h2>
          <p className="m-0 mt-1 text-sm text-sb-fg-muted">태스크별 설정이 없을 때 사용할 기본 AI 제공자입니다.</p>
        </div>
        <StatusPill tone="success">{selectedProvider?.displayName ?? snapshot.defaultProvider}</StatusPill>
      </div>
      <label className="flex max-w-md flex-col gap-1.5">
        <span className="text-sm font-medium text-sb-fg">Default provider</span>
        <select
          className={sbSelectClass}
          value={snapshot.defaultProvider}
          disabled={pending}
          onChange={(event) => {
            const providerId = event.target.value
            if (!isAiProviderId(providerId)) {
              return
            }

            setPending(true)
            void callRpc("settings.updateDefaultProvider", { providerId })
              .catch((error: unknown) => {
                onRpcError(error instanceof Error ? error.message : "기본 제공자를 바꾸지 못했습니다.")
              })
              .finally(() => {
                setPending(false)
              })
          }}
        >
          {AI_PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {getProviderStatus(snapshot, id)?.displayName ?? id}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}

type ConnectionTestState = "idle" | "loading" | "ok" | "error"

function ProviderConfigCard({
  providerId,
  snapshot,
  callRpc,
  onRpcError,
  apiKeyDraft,
  setApiKeyDraft,
  ollamaBaseUrlDraft,
  setOllamaBaseUrlDraft,
  baseUrlFocused,
  setBaseUrlFocused,
  connectionTest,
  setConnectionTest
}: {
  readonly providerId: AiProviderId
  readonly snapshot: SettingsReadSnapshot
  readonly callRpc: (method: string, payload: Record<string, unknown>) => Promise<unknown>
  readonly onRpcError: (message: string) => void
  readonly apiKeyDraft: Partial<Record<AiProviderId, string>>
  readonly setApiKeyDraft: React.Dispatch<React.SetStateAction<Partial<Record<AiProviderId, string>>>>
  readonly ollamaBaseUrlDraft: string | null
  readonly setOllamaBaseUrlDraft: React.Dispatch<React.SetStateAction<string | null>>
  readonly baseUrlFocused: boolean
  readonly setBaseUrlFocused: (value: boolean) => void
  readonly connectionTest: Partial<Record<AiProviderId, ConnectionTestState>>
  readonly setConnectionTest: React.Dispatch<React.SetStateAction<Partial<Record<AiProviderId, ConnectionTestState>>>>
}): React.ReactElement {
  const status = getProviderStatus(snapshot, providerId)
  const displayName = status?.displayName ?? providerId
  const config = snapshot.providerConfigs[providerId]
  const models = snapshot.modelCatalog[providerId]
  const showApiKey = providerId !== "mock" && providerId !== "ollama"
  const isOllama = providerId === "ollama"
  const testState = connectionTest[providerId] ?? "idle"
  const [isExpanded, setIsExpanded] = useState(providerId === snapshot.defaultProvider)

  const resolvedBaseUrl =
    ollamaBaseUrlDraft !== null ? ollamaBaseUrlDraft : (config.baseUrl ?? "http://127.0.0.1:11434")

  const runConnectionTest = (): void => {
    setConnectionTest((previous) => ({ ...previous, [providerId]: "loading" }))
    void callRpc("ai.providers.checkConnection", { providerId })
      .then((payload) => {
        const ok = typeof payload === "object" && payload !== null && (payload as { ok?: boolean }).ok === true
        setConnectionTest((previous) => ({ ...previous, [providerId]: ok ? "ok" : "error" }))
      })
      .catch(() => {
        setConnectionTest((previous) => ({ ...previous, [providerId]: "error" }))
      })
  }

  const saveApiKey = (): void => {
    const value = (apiKeyDraft[providerId] ?? "").trim()
    if (value.length === 0) {
      onRpcError("API 키를 입력한 뒤 저장하세요.")
      return
    }

    void callRpc("secrets.writeApiKey", { providerId, apiKey: value })
      .then(() => {
        setApiKeyDraft((previous) => {
          const next = { ...previous }
          delete next[providerId]
          return next
        })
      })
      .catch((error: unknown) => {
        onRpcError(error instanceof Error ? error.message : "API 키를 저장하지 못했습니다.")
      })
  }

  const deleteApiKey = (): void => {
    void callRpc("secrets.deleteApiKey", { providerId })
      .then(() => {
        setApiKeyDraft((previous) => {
          const next = { ...previous }
          delete next[providerId]
          return next
        })
      })
      .catch((error: unknown) => {
        onRpcError(error instanceof Error ? error.message : "API 키를 삭제하지 못했습니다.")
      })
  }

  const applyOllamaBaseUrl = (): void => {
    const trimmed = resolvedBaseUrl.trim()
    if (trimmed.length === 0) {
      onRpcError("Ollama base URL을 입력하세요.")
      return
    }

    void callRpc("settings.updateProviderBaseUrl", { providerId: "ollama", baseUrl: trimmed })
      .then(() => {
        if (!baseUrlFocused) {
          setOllamaBaseUrlDraft(null)
        }
      })
      .catch((error: unknown) => {
        onRpcError(error instanceof Error ? error.message : "Base URL을 저장하지 못했습니다.")
      })
  }

  return (
    <details
      className="group overflow-hidden rounded-xl border border-sb-border bg-sb-bg-sidebar shadow-[0_10px_28px_rgba(0,0,0,0.10)]"
      open={isExpanded}
      onToggle={(event) => setIsExpanded(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 transition hover:bg-sb-bg-list-hover [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-sm text-sb-fg-muted transition group-open:rotate-90">&gt;</span>
          <div className="min-w-0">
            <h3 className="m-0 truncate text-sm font-semibold text-sb-fg">{displayName}</h3>
            <p className="m-0 mt-0.5 truncate text-xs text-sb-fg-muted">{config.model}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {providerId === snapshot.defaultProvider ? <StatusPill tone="success">기본</StatusPill> : null}
          {status?.hasApiKey ? <StatusPill tone="success">키 저장됨</StatusPill> : null}
          {!status?.hasApiKey && showApiKey ? <StatusPill tone="warning">키 필요</StatusPill> : null}
          <StatusPill tone={status?.isAvailable ? "neutral" : "error"}>
            {status?.isAvailable ? "사용 가능" : "비활성"}
          </StatusPill>
        </div>
      </summary>

      <div className="flex flex-col gap-4 border-t border-sb-border p-4">
        <label className="flex max-w-md flex-col gap-1.5">
          <span className="text-sm font-medium text-sb-fg">모델</span>
          <select
            className={sbSelectClass}
            value={config.model}
            onChange={(event) => {
              const model = event.target.value
              void callRpc("settings.updateProviderModel", { providerId, model }).catch((error: unknown) => {
                onRpcError(error instanceof Error ? error.message : "모델을 바꾸지 못했습니다.")
              })
            }}
          >
            {models.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </select>
        </label>

        {isOllama ? (
          <div className={fieldGroupClass}>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-sb-fg">Base URL</span>
              <input
                className={sbInputClass}
                value={resolvedBaseUrl}
                onFocus={() => {
                  setBaseUrlFocused(true)
                  if (ollamaBaseUrlDraft === null) {
                    setOllamaBaseUrlDraft(config.baseUrl ?? "http://127.0.0.1:11434")
                  }
                }}
                onBlur={() => {
                  setBaseUrlFocused(false)
                }}
                onChange={(event) => {
                  setOllamaBaseUrlDraft(event.target.value)
                }}
              />
            </label>
            <button type="button" className={`${sbSecondaryButtonClass} self-start`} onClick={applyOllamaBaseUrl}>
              Base URL 적용
            </button>
          </div>
        ) : null}

        {showApiKey ? (
          <div className={fieldGroupClass}>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-sb-fg">API 키</span>
              <input
                className={sbInputClass}
                type="password"
                autoComplete="off"
                value={apiKeyDraft[providerId] ?? ""}
                placeholder={status?.hasApiKey ? "새 키를 입력하려면 입력 후 저장" : "API 키를 입력하세요"}
                onChange={(event) => {
                  const next = event.target.value
                  setApiKeyDraft((previous) => ({ ...previous, [providerId]: next }))
                }}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={sbControlButtonClass} onClick={saveApiKey}>
                저장
              </button>
              <button type="button" className={sbDangerButtonClass} onClick={deleteApiKey} disabled={!status?.hasApiKey}>
                삭제
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sb-border bg-sb-bg-widget px-3 py-2">
          <button type="button" className={sbSecondaryButtonClass} onClick={runConnectionTest}>
            연결 테스트
          </button>
          {testState === "loading" ? <span className="text-sm text-sb-fg-muted">확인 중…</span> : null}
          {testState === "ok" ? <StatusPill tone="success">연결 성공</StatusPill> : null}
          {testState === "error" ? <StatusPill tone="error">연결 실패</StatusPill> : null}
          {testState !== "idle" && testState !== "loading" ? (
            <button
              type="button"
              className="text-sm font-medium text-sb-fg-link underline"
              onClick={() => {
                setConnectionTest((previous) => ({ ...previous, [providerId]: "idle" }))
              }}
            >
              상태 지우기
            </button>
          ) : null}
        </div>
      </div>
    </details>
  )
}

function TaskAssignmentsSection({
  snapshot,
  callRpc,
  onRpcError
}: {
  readonly snapshot: SettingsReadSnapshot
  readonly callRpc: (method: string, payload: Record<string, unknown>) => Promise<unknown>
  readonly onRpcError: (message: string) => void
}): React.ReactElement {
  return (
    <section className={sectionCardClass} aria-label="태스크별 제공자">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-semibold text-sb-fg">태스크별 제공자</h2>
          <p className="m-0 mt-1 text-sm text-sb-fg-muted">각 작업에 사용할 제공자를 지정합니다. «기본값»이면 위의 기본 제공자를 따릅니다.</p>
        </div>
        <StatusPill tone="neutral">{AI_TASK_NAMES.length}개 태스크</StatusPill>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {AI_TASK_NAMES.map((taskName) => {
          const assigned = snapshot.taskAssignments[taskName]
          const selectValue = assigned === null || assigned === undefined ? "use-default" : assigned

          return (
            <li
              key={taskName}
              className="grid grid-cols-1 gap-2 rounded-lg border border-sb-border bg-sb-bg-widget p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center"
            >
              <span className="text-sm font-medium text-sb-fg">{AI_TASK_LABELS[taskName]}</span>
              <select
                className={sbSelectClass}
                value={selectValue}
                onChange={(event) => {
                  const value = event.target.value
                  const providerId = value === "use-default" ? null : value
                  if (providerId !== null && !isAiProviderId(providerId)) {
                    return
                  }

                  void callRpc("settings.updateTaskProvider", { taskName, providerId }).catch((error: unknown) => {
                    onRpcError(error instanceof Error ? error.message : "태스크 제공자를 바꾸지 못했습니다.")
                  })
                }}
              >
                <option value="use-default">기본값 사용</option>
                {AI_PROVIDER_IDS.map((id) => (
                  <option key={`${taskName}-${id}`} value={id}>
                    {getProviderStatus(snapshot, id)?.displayName ?? id}
                  </option>
                ))}
              </select>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function SettingsView({ initialData }: { readonly initialData: unknown }): React.ReactElement {
  const parsedInitial = useMemo(() => parseSettingsReadSnapshot(initialData), [initialData])
  const [snapshot, setSnapshot] = useState<SettingsReadSnapshot | undefined>(parsedInitial)
  const [loadError, setLoadError] = useState<string | null>(parsedInitial ? null : "설정을 불러오지 못했습니다.")
  const [rpcError, setRpcError] = useState<string | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState<Partial<Record<AiProviderId, string>>>({})
  const [ollamaBaseUrlDraft, setOllamaBaseUrlDraft] = useState<string | null>(null)
  const [baseUrlFocused, setBaseUrlFocused] = useState(false)
  const baseUrlFocusedRef = useRef(baseUrlFocused)
  baseUrlFocusedRef.current = baseUrlFocused
  const [connectionTest, setConnectionTest] = useState<Partial<Record<AiProviderId, ConnectionTestState>>>({})

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
      <main className="flex min-h-screen flex-col gap-3 bg-sb-bg p-4">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
        <h1 className="m-0 text-xl font-semibold text-sb-fg">설정</h1>
        <p className="m-0 text-sb-fg-error">{loadError ?? "알 수 없는 오류"}</p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col gap-5 bg-sb-bg p-5">
      <header className="rounded-xl border border-sb-border bg-sb-bg-sidebar p-5 shadow-[0_14px_36px_rgba(0,0,0,0.12)]">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="m-0 text-2xl font-semibold text-sb-fg">설정</h1>
            <p className="m-0 mt-1 text-sm text-sb-fg-muted">AI 제공자, 모델, API 키, 태스크 매핑을 관리합니다.</p>
          </div>
          <StatusPill tone="neutral">Workspace settings</StatusPill>
        </div>
      </header>

      {rpcError ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-sb-border-warning bg-sb-bg-widget px-3 py-2 text-sm text-sb-fg shadow-[0_8px_22px_rgba(0,0,0,0.10)]">
          <span>{rpcError}</span>
          <button type="button" className={sbSecondaryButtonClass} onClick={() => setRpcError(null)}>
            닫기
          </button>
        </div>
      ) : null}

      <DefaultProviderSection snapshot={snapshot} callRpc={callRpc} onRpcError={onRpcError} />

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="m-0 text-base font-semibold text-sb-fg">제공자 구성</h2>
          <p className="m-0 mt-1 text-sm text-sb-fg-muted">카드를 펼쳐 모델, API 키, 연결 상태를 조정합니다.</p>
        </div>
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
              ollamaBaseUrlDraft={ollamaBaseUrlDraft}
              setOllamaBaseUrlDraft={setOllamaBaseUrlDraft}
              baseUrlFocused={baseUrlFocused}
              setBaseUrlFocused={setBaseUrlFocused}
              connectionTest={connectionTest}
              setConnectionTest={setConnectionTest}
            />
          ))}
        </div>
      </div>

      <TaskAssignmentsSection snapshot={snapshot} callRpc={callRpc} onRpcError={onRpcError} />
    </main>
  )
}
