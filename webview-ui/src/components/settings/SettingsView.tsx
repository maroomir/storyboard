import { AlertCircle, CheckCircle2, LoaderCircle, PlugZap } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "../ui/Button"
import { SectionHeader } from "../ui/SectionHeader"
import { Tabs } from "../ui/Tabs"
import { GenerationContractSection } from "./GenerationContractSection"

const sbInputClass =
  "w-full rounded-md border border-[color:var(--vscode-input-border)] bg-sb-bg-input px-3 py-2 text-sb-fg-input outline-none transition focus:border-sb-border-focus focus:ring-1 focus:ring-sb-border-focus/40"

const sbSelectClass = `${sbInputClass} max-w-md`

const sectionCardClass =
  "flex flex-col gap-4 rounded-lg border border-sb-border bg-sb-bg-sidebar/80 p-4"

const fieldGroupClass =
  "grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)] sm:items-center"

const settingsPanelClass = "mx-auto flex w-full max-w-5xl flex-col gap-4"

const AI_PROVIDER_IDS = ["openai", "claude", "google", "ollama", "claude-code", "codex", "mock"] as const
type AiProviderId = (typeof AI_PROVIDER_IDS)[number]
type AiTaskName = string
type AiTaskStatus = "wired" | "planned"

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
  readonly command?: string
}

interface TaskAiAssignment {
  readonly providerId: AiProviderId | null
  readonly model: string | null
}

interface TaskCatalogItem {
  readonly name: AiTaskName
  readonly label: string
  readonly status: AiTaskStatus
}

interface SettingsReadSnapshot {
  readonly defaultProvider: AiProviderId
  readonly providers: readonly AiProviderStatus[]
  readonly providerConfigs: Readonly<Record<AiProviderId, ProviderRuntimeConfig>>
  readonly taskAssignments: Readonly<Record<string, TaskAiAssignment>>
  readonly modelCatalog: Readonly<Record<AiProviderId, readonly ProviderModelOption[]>>
  readonly taskCatalog: readonly TaskCatalogItem[]
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

  if (
    !Array.isArray(candidate.providers) ||
    !candidate.providerConfigs ||
    !candidate.taskAssignments ||
    !candidate.modelCatalog ||
    !Array.isArray(candidate.taskCatalog)
  ) {
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

  for (const taskEntry of candidate.taskCatalog) {
    if (!taskEntry || typeof taskEntry !== "object") {
      return undefined
    }

    const task = taskEntry as Record<string, unknown>
    if (typeof task.name !== "string" || task.name.trim().length === 0) {
      return undefined
    }
    if (typeof task.label !== "string" || task.label.trim().length === 0) {
      return undefined
    }
    if (task.status !== "wired" && task.status !== "planned") {
      return undefined
    }

    const taskName = task.name
    const assignment = (candidate.taskAssignments as Record<string, unknown>)[taskName]
    if (!assignment || typeof assignment !== "object") {
      return undefined
    }

    const row = assignment as Record<string, unknown>
    if (!("providerId" in row) || !("model" in row)) {
      return undefined
    }

    const providerId = row.providerId
    const model = row.model
    const usesDefaultProvider = providerId === null || providerId === undefined

    if (!usesDefaultProvider) {
      if (typeof providerId !== "string" || !isAiProviderId(providerId)) {
        return undefined
      }
    }

    if (model !== null && model !== undefined && typeof model !== "string") {
      return undefined
    }

    if (usesDefaultProvider && model !== null && model !== undefined) {
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

function pickModelForTaskProvider(
  snapshot: SettingsReadSnapshot,
  providerId: AiProviderId,
  preferredModelId: string | null
): string {
  const catalog = snapshot.modelCatalog[providerId]
  if (preferredModelId !== null && catalog.some((entry) => entry.id === preferredModelId)) {
    return preferredModelId
  }

  const globalModel = snapshot.providerConfigs[providerId].model
  if (catalog.some((entry) => entry.id === globalModel)) {
    return globalModel
  }

  return catalog[0]?.id ?? globalModel
}

function formatResolvedTaskAi(snapshot: SettingsReadSnapshot, taskName: AiTaskName): string {
  const assign = snapshot.taskAssignments[taskName]
  let providerId: AiProviderId
  let modelId: string

  if (!assign || assign.providerId === null) {
    providerId = snapshot.defaultProvider
    modelId = snapshot.providerConfigs[providerId].model
  } else {
    providerId = assign.providerId
    modelId = assign.model ?? snapshot.providerConfigs[providerId].model
  }

  const providerName = getProviderStatus(snapshot, providerId)?.displayName ?? providerId
  const modelLabel =
    snapshot.modelCatalog[providerId].find((entry) => entry.id === modelId)?.displayName ?? modelId

  return `${providerName} / ${modelLabel}`
}

function formatDefaultProviderSummary(snapshot: SettingsReadSnapshot): string {
  const providerId = snapshot.defaultProvider
  const providerName = getProviderStatus(snapshot, providerId)?.displayName ?? providerId
  const modelId = snapshot.providerConfigs[providerId].model
  const modelName = snapshot.modelCatalog[providerId].find((entry) => entry.id === modelId)?.displayName ?? modelId

  return `${providerName} · ${modelName}`
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

function ConnectionTestButton({
  state,
  onClick
}: {
  readonly state: ConnectionTestState
  readonly onClick: () => void
}): React.ReactElement {
  const iconClass = "h-4 w-4"
  const stateView = {
    idle: { label: "연결 테스트", icon: <PlugZap className={iconClass} aria-hidden />, className: "text-sb-fg-muted" },
    loading: {
      label: "연결 확인 중",
      icon: <LoaderCircle className={`${iconClass} animate-spin`} aria-hidden />,
      className: "text-sb-fg-muted"
    },
    ok: { label: "연결 성공", icon: <CheckCircle2 className={iconClass} aria-hidden />, className: "text-sb-fg" },
    error: { label: "연결 실패", icon: <AlertCircle className={iconClass} aria-hidden />, className: "text-sb-fg-error" },
    "not-installed": {
      label: "CLI 미설치",
      icon: <AlertCircle className={iconClass} aria-hidden />,
      className: "text-sb-fg-error"
    }
  }[state]

  return (
    <button
      type="button"
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-sb-border bg-sb-bg-widget outline-none transition hover:border-sb-border-focus focus-visible:border-sb-border-focus focus-visible:ring-1 focus-visible:ring-sb-border-focus ${stateView.className}`}
      aria-label={stateView.label}
      title={stateView.label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (state !== "loading") {
          onClick()
        }
      }}
      disabled={state === "loading"}
    >
      {stateView.icon}
    </button>
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
  const defaultProviderId = snapshot.defaultProvider
  const selectedProvider = getProviderStatus(snapshot, defaultProviderId)
  const defaultModelCatalog = snapshot.modelCatalog[defaultProviderId]
  const defaultModelSelectValue = pickModelForTaskProvider(
    snapshot,
    defaultProviderId,
    snapshot.providerConfigs[defaultProviderId].model
  )

  return (
    <section className={sectionCardClass} aria-label="기본 AI 제공자와 모델">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="기본 제공자와 모델"
          description="태스크가 «기본값 사용»일 때 쓰는 제공자와, 그 제공자의 기본 모델입니다. 모델은 아래 태스크에서 다른 값으로 덮어쓸 수 있습니다."
        />
        <StatusPill tone="success">{selectedProvider?.displayName ?? defaultProviderId}</StatusPill>
      </div>
      <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-sb-fg">기본 제공자</span>
          <select
            className={sbSelectClass}
            value={defaultProviderId}
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
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-sb-fg">기본 모델</span>
          <select
            className={sbSelectClass}
            value={defaultModelSelectValue}
            disabled={pending}
            onChange={(event) => {
              const model = event.target.value
              if (model.length === 0) {
                return
              }

              setPending(true)
              void callRpc("settings.updateProviderModel", { providerId: defaultProviderId, model })
                .catch((error: unknown) => {
                  onRpcError(error instanceof Error ? error.message : "기본 모델을 바꾸지 못했습니다.")
                })
                .finally(() => {
                  setPending(false)
                })
            }}
          >
            {defaultModelCatalog.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}

type ConnectionTestState = "idle" | "loading" | "ok" | "error" | "not-installed"

function ProviderConfigCard({
  providerId,
  snapshot,
  callRpc,
  onRpcError,
  apiKeyDraft,
  setApiKeyDraft,
  commandDraft,
  setCommandDraft,
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
  readonly commandDraft: Partial<Record<AiProviderId, string>>
  readonly setCommandDraft: React.Dispatch<React.SetStateAction<Partial<Record<AiProviderId, string>>>>
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
  const isCli = providerId === "claude-code" || providerId === "codex"
  const showApiKey = providerId !== "mock" && providerId !== "ollama" && !isCli
  const isOllama = providerId === "ollama"
  const testState = connectionTest[providerId] ?? "idle"
  const [isExpanded, setIsExpanded] = useState(providerId === snapshot.defaultProvider)
  const hasConnectionFields = showApiKey || isOllama || isCli

  const resolvedBaseUrl =
    ollamaBaseUrlDraft !== null ? ollamaBaseUrlDraft : (config.baseUrl ?? "http://127.0.0.1:11434")

  const resolvedCommand = commandDraft[providerId] ?? config.command ?? ""

  const runConnectionTest = (): void => {
    setConnectionTest((previous) => ({ ...previous, [providerId]: "loading" }))
    void callRpc("ai.providers.checkConnection", { providerId })
      .then((payload) => {
        const result = typeof payload === "object" && payload !== null ? (payload as { ok?: boolean; reason?: string }) : {}
        const next = result.ok === true ? "ok" : result.reason === "not-installed" ? "not-installed" : "error"
        setConnectionTest((previous) => ({ ...previous, [providerId]: next }))
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

  const saveCommand = (): void => {
    const trimmed = resolvedCommand.trim()
    if (trimmed.length === 0) {
      onRpcError("CLI 실행 명령을 입력하세요.")
      return
    }

    void callRpc("settings.updateProviderCommand", { providerId, command: trimmed })
      .then(() => {
        setCommandDraft((previous) => {
          const next = { ...previous }
          delete next[providerId]
          return next
        })
      })
      .catch((error: unknown) => {
        onRpcError(error instanceof Error ? error.message : "실행 명령을 저장하지 못했습니다.")
      })
  }

  return (
    <details
      className="group overflow-hidden rounded-lg border border-sb-border bg-sb-bg-sidebar/80"
      open={isExpanded}
      onToggle={(event) => setIsExpanded(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 transition hover:bg-sb-bg-list-hover [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-3">
          {hasConnectionFields ? (
            <span className="text-xs text-sb-fg-muted transition group-open:rotate-90">›</span>
          ) : (
            <span className="w-[0.45rem]" aria-hidden />
          )}
          <div className="min-w-0">
            <h3 className="m-0 truncate text-sm font-semibold text-sb-fg">{displayName}</h3>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {providerId === snapshot.defaultProvider ? <StatusPill tone="success">기본</StatusPill> : null}
          {status?.hasApiKey && showApiKey ? <StatusPill tone="success">키 저장됨</StatusPill> : null}
          {!status?.hasApiKey && showApiKey ? <StatusPill tone="warning">키 필요</StatusPill> : null}
          {isOllama ? <StatusPill tone="neutral">로컬</StatusPill> : null}
          {isCli ? <StatusPill tone="neutral">CLI</StatusPill> : null}
          {providerId === "mock" ? <StatusPill tone="neutral">Mock</StatusPill> : null}
          <StatusPill tone={status?.isAvailable ? "neutral" : "error"}>
            {status?.isAvailable ? "사용 가능" : "비활성"}
          </StatusPill>
          <ConnectionTestButton state={testState} onClick={runConnectionTest} />
        </div>
      </summary>

      {hasConnectionFields ? <div className="flex flex-col gap-3 border-t border-sb-border p-4">
        {isOllama ? (
          <div className={fieldGroupClass}>
            <label className="text-sm font-medium text-sb-fg" htmlFor={`${providerId}-base-url`}>
              Base URL
            </label>
            <div className="flex min-w-0 gap-2">
              <input
                id={`${providerId}-base-url`}
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
              <Button type="button" variant="secondary" className="shrink-0" onClick={applyOllamaBaseUrl}>
                적용
              </Button>
            </div>
          </div>
        ) : null}

        {isCli ? (
          <div className={fieldGroupClass}>
            <label className="text-sm font-medium text-sb-fg" htmlFor={`${providerId}-command`}>
              실행 명령
            </label>
            <div className="flex min-w-0 gap-2">
              <input
                id={`${providerId}-command`}
                className={sbInputClass}
                autoComplete="off"
                spellCheck={false}
                value={resolvedCommand}
                placeholder={providerId === "claude-code" ? "claude" : "codex"}
                onChange={(event) => {
                  const next = event.target.value
                  setCommandDraft((previous) => ({ ...previous, [providerId]: next }))
                }}
              />
              <Button type="button" variant="secondary" className="shrink-0" onClick={saveCommand}>
                적용
              </Button>
            </div>
          </div>
        ) : null}

        {isCli && testState === "not-installed" ? (
          <p className="m-0 text-xs text-sb-fg-error">
            CLI 미설치: 실행 명령 «{resolvedCommand || (providerId === "claude-code" ? "claude" : "codex")}»을 찾을 수 없습니다. 설치 후 PATH를 확인하거나 위에서 명령 경로를 지정하세요.
          </p>
        ) : null}

        {showApiKey ? (
          <div className={fieldGroupClass}>
            <label className="text-sm font-medium text-sb-fg" htmlFor={`${providerId}-api-key`}>
              API 키
            </label>
            <div className="flex min-w-0 gap-2">
              <input
                id={`${providerId}-api-key`}
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
              <Button type="button" className="shrink-0" onClick={saveApiKey}>
                저장
              </Button>
            </div>
          </div>
        ) : null}
      </div> : null}
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
    <section className={sectionCardClass} aria-label="태스크별 제공자와 모델">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="태스크별 제공자와 모델"
          description="각 작업에 사용할 제공자와 모델을 지정합니다. «기본값 사용»이면 위에서 고른 기본 제공자와 기본 모델을 따릅니다."
        />
        <StatusPill tone="neutral">{snapshot.taskCatalog.length}개 태스크</StatusPill>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {snapshot.taskCatalog.map((task) => {
          const taskName = task.name
          const assigned = snapshot.taskAssignments[taskName]
          const useDefault = assigned === undefined || assigned.providerId === null
          const isPlanned = task.status === "planned"
          const providerSelectValue = useDefault ? "use-default" : assigned.providerId
          const activeProviderId: AiProviderId = useDefault ? snapshot.defaultProvider : assigned.providerId!
          const modelOptions = snapshot.modelCatalog[activeProviderId]
          const storedModelWhenOverridden =
            !useDefault && assigned.model !== null && assigned.model !== undefined ? assigned.model : null
          const modelSelectValue = useDefault
            ? ""
            : pickModelForTaskProvider(snapshot, assigned.providerId, storedModelWhenOverridden)

          return (
            <li key={taskName} className="grid gap-3 border-t border-sb-border py-3 first:border-t-0 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.6fr)] sm:items-start">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2 text-sm font-medium text-sb-fg">
                  <span>{task.label}</span>
                  {isPlanned ? <StatusPill tone="warning">Phase 6 예정</StatusPill> : null}
                </div>
                <p className="m-0 text-xs text-sb-fg-muted">
                  실제 사용: <span className="text-sb-fg">{formatResolvedTaskAi(snapshot, taskName)}</span>
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-center">
                <label className="flex flex-col gap-1 text-xs text-sb-fg-muted">
                  <span>Provider</span>
                  <select
                    className={sbSelectClass}
                    value={providerSelectValue}
                    disabled={isPlanned}
                    onChange={(event) => {
                      const value = event.target.value
                      const providerId = value === "use-default" ? null : value
                      if (providerId !== null && !isAiProviderId(providerId)) {
                        return
                      }

                      if (providerId === null) {
                        void callRpc("settings.updateTaskAiConfig", { taskName, providerId: null, model: null }).catch(
                          (error: unknown) => {
                            onRpcError(error instanceof Error ? error.message : "태스크 설정을 바꾸지 못했습니다.")
                          }
                        )
                        return
                      }

                      const previousModel =
                        !useDefault && assigned.model !== null && assigned.model !== undefined ? assigned.model : null
                      const model = pickModelForTaskProvider(snapshot, providerId, previousModel)

                      void callRpc("settings.updateTaskAiConfig", { taskName, providerId, model }).catch(
                        (error: unknown) => {
                          onRpcError(error instanceof Error ? error.message : "태스크 설정을 바꾸지 못했습니다.")
                        }
                      )
                    }}
                  >
                    <option value="use-default">기본값 사용</option>
                    {AI_PROVIDER_IDS.map((id) => (
                      <option key={`${taskName}-${id}`} value={id}>
                        {getProviderStatus(snapshot, id)?.displayName ?? id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-sb-fg-muted">
                  <span>Model</span>
                  <select
                    className={sbSelectClass}
                    disabled={useDefault || isPlanned}
                    value={useDefault ? "" : modelSelectValue}
                    onChange={(event) => {
                      const model = event.target.value
                      const rowProvider = assigned.providerId
                      if (rowProvider === null || rowProvider === undefined || model.length === 0) {
                        return
                      }

                      void callRpc("settings.updateTaskAiConfig", {
                        taskName,
                        providerId: rowProvider,
                        model
                      }).catch((error: unknown) => {
                        onRpcError(error instanceof Error ? error.message : "태스크 모델을 바꾸지 못했습니다.")
                      })
                    }}
                  >
                    {useDefault ? (
                      <option value="">기본 provider/model 사용</option>
                    ) : (
                      modelOptions.map((opt) => (
                        <option key={`${taskName}-model-${opt.id}`} value={opt.id}>
                          {opt.displayName}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>
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
  const [commandDraft, setCommandDraft] = useState<Partial<Record<AiProviderId, string>>>({})
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
      panel: <DefaultProviderSection snapshot={snapshot} callRpc={callRpc} onRpcError={onRpcError} />
    },
    {
      id: "connections",
      label: "연결",
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
      panel: <TaskAssignmentsSection snapshot={snapshot} callRpc={callRpc} onRpcError={onRpcError} />
    },
    {
      id: "contract",
      label: "작품 계약",
      panel: <GenerationContractSection callRpc={callRpc} onRpcError={onRpcError} />
    }
  ]

  return (
    <main className="flex min-h-screen bg-sb-bg p-5">
      <div className={settingsPanelClass}>
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-sb-border pb-4">
          <SectionHeader
            eyebrow="Storyboard"
            title="설정"
            description="AI 기본값, 연결 정보, 태스크별 덮어쓰기를 필요한 범위만 열어 관리합니다."
          />
          <StatusPill tone="neutral">{formatDefaultProviderSummary(snapshot)}</StatusPill>
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
          <Tabs items={settingsTabs} initialId="defaults" />
        </div>
      </div>
    </main>
  )
}
