import React, { useState } from "react"

import { Button } from "../ui/Button"
import { ConnectionTestButton, StatusPill } from "./SettingsPrimitives"
import {
  getProviderStatus,
  requiresApiKey,
  type AiProviderId,
  type ConnectionTestState,
  type SettingsReadSnapshot
} from "./settingsSnapshot"
import { fieldGroupClass, sbInputClass } from "./settingsStyles"

export function ProviderConfigCard({
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
  const showApiKey = requiresApiKey(providerId)
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
