import { Link2, RefreshCw } from "lucide-react"
import React, { useCallback, useEffect, useState } from "react"

import { Button } from "../ui/Button"
import { SectionHeader } from "../ui/SectionHeader"
import { StatusPill } from "./SettingsPrimitives"
import { fieldGroupClass, sbInputClass, sbSelectClass, sectionCardClass } from "./settingsStyles"
import {
  BOT_HEALTH_LABELS,
  formatChatIdList,
  parseBotConfigSnapshot,
  parseChatIdList,
  type BotConfigSnapshot,
  type BotHealth,
  type BotProviderId
} from "./botSnapshot"

const PROVIDER_OPTIONS: readonly { readonly id: BotProviderId; readonly label: string }[] = [
  { id: "claude-code", label: "claude-code (Claude Code CLI)" },
  { id: "codex", label: "codex (Codex CLI)" },
  { id: "mock", label: "mock (생성 없이 흐름 확인)" }
]

function healthTone(health: BotHealth): "neutral" | "success" | "warning" | "error" {
  if (health === "online") {
    return "success"
  }
  if (health === "offline") {
    return "error"
  }
  return "neutral"
}

export function BotSection({
  callRpc,
  onRpcError
}: {
  readonly callRpc: (method: string, payload: Record<string, unknown>) => Promise<unknown>
  readonly onRpcError: (message: string) => void
}): React.ReactElement {
  const [snapshot, setSnapshot] = useState<BotConfigSnapshot | undefined>(undefined)
  const [chatIdDraft, setChatIdDraft] = useState<string | null>(null)
  const [chatIdError, setChatIdError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const applySnapshot = useCallback((value: unknown): void => {
    const parsed = parseBotConfigSnapshot(value)
    if (parsed) {
      setSnapshot(parsed)
      setChatIdDraft(null)
    }
  }, [])

  useEffect(() => {
    void callRpc("bot.config.read", {})
      .then(applySnapshot)
      .catch(() => onRpcError("봇 설정을 읽지 못했습니다."))
  }, [applySnapshot, callRpc, onRpcError])

  const update = useCallback(
    (patch: Record<string, unknown>): void => {
      void callRpc("bot.config.update", patch)
        .then((value) => {
          applySnapshot(value)
          setIsDirty(true)
        })
        .catch(() => onRpcError("봇 설정을 저장하지 못했습니다."))
    },
    [applySnapshot, callRpc, onRpcError]
  )

  const restart = useCallback((): void => {
    void callRpc("bot.restart", {})
      .then((value) => {
        const status = (value as { status?: string } | undefined)?.status
        if (status === "restarted") {
          setIsDirty(false)
          return callRpc("bot.config.read", {}).then(applySnapshot)
        }
        onRpcError(
          status === "not-installed"
            ? "자동 시작(launchd)이 설치되어 있지 않아 재시작할 수 없습니다."
            : status === "unsupported-platform"
              ? "자동 재시작은 macOS에서만 지원됩니다. 봇 프로세스를 직접 재시작하세요."
              : "봇 재시작에 실패했습니다."
        )
        return undefined
      })
      .catch(() => onRpcError("봇 재시작에 실패했습니다."))
  }, [applySnapshot, callRpc, onRpcError])

  if (!snapshot) {
    return (
      <section className="flex flex-col gap-3" aria-label="텔레그램 봇">
        <SectionHeader title="텔레그램 봇" description="설정을 불러오는 중입니다." />
      </section>
    )
  }

  if (!snapshot.configured) {
    return (
      <section className="flex flex-col gap-3" aria-label="텔레그램 봇">
        <SectionHeader
          title="텔레그램 봇"
          description="아직 설정되지 않았습니다. 토큰 검증이 필요하므로 설정 마법사에서 시작하세요."
        />
        <p className="m-0 text-xs text-sb-fg-muted">
          명령 팔레트에서 <code>Storyboard: 텔레그램 봇 설정…</code>을 실행하세요.
        </p>
      </section>
    )
  }

  const chatIdValue = chatIdDraft ?? formatChatIdList(snapshot.allowedChatIds)

  const commitChatIds = (): void => {
    if (chatIdDraft === null) {
      return
    }

    const parsed = parseChatIdList(chatIdDraft)
    if (parsed === undefined) {
      setChatIdError("정수 id를 쉼표로 구분해 입력하세요.")
      return
    }

    setChatIdError(null)
    update({ allowedChatIds: parsed })
  }

  return (
    <section className="flex flex-col gap-3" aria-label="텔레그램 봇">
      <SectionHeader
        title="텔레그램 봇"
        description="봇이 어느 작품을 편집할지와 누가 쓸 수 있는지를 관리합니다. 토큰 변경은 설정 마법사에서만 가능합니다."
      />

      <div className={sectionCardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill tone={healthTone(snapshot.health)}>
            {BOT_HEALTH_LABELS[snapshot.health]}
          </StatusPill>
          <span className="text-xs text-sb-fg-muted">{snapshot.configFile}</span>
        </div>

        <div className={fieldGroupClass}>
          <span className="text-sm text-sb-fg-muted">봇 토큰</span>
          <span className="text-sm text-sb-fg">{snapshot.tokenHint ?? "없음"}</span>
        </div>

        <div className={fieldGroupClass}>
          <label className="text-sm text-sb-fg-muted" htmlFor="bot-chat-ids">
            허용 채팅 ID
          </label>
          <div className="flex flex-col gap-1">
            <input
              id="bot-chat-ids"
              className={sbInputClass}
              value={chatIdValue}
              placeholder="123456789, -100987654321"
              onChange={(event) => setChatIdDraft(event.target.value)}
              onBlur={commitChatIds}
            />
            {chatIdError ? <span className="text-xs text-sb-fg-error">{chatIdError}</span> : null}
          </div>
        </div>

        <div className={fieldGroupClass}>
          <label className="text-sm text-sb-fg-muted" htmlFor="bot-provider">
            기본 프로바이더
          </label>
          <select
            id="bot-provider"
            className={sbSelectClass}
            value={snapshot.defaultProvider ?? "mock"}
            onChange={(event) => update({ defaultProvider: event.target.value })}
          >
            {PROVIDER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={sectionCardClass}>
        <SectionHeader
          title="연결된 작품"
          description="봇은 한 번에 작품 하나를 편집합니다. 열려 있는 워크스페이스 중에서 고르세요."
        />
        <p className="m-0 text-sm text-sb-fg">{snapshot.workspacePath ?? "연결된 작품 없음"}</p>

        <div className="flex flex-col gap-2">
          {snapshot.workspaceCandidates.map((candidate) => (
            <div
              key={candidate.path}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sb-border bg-sb-bg-widget/60 px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-sm text-sb-fg">{candidate.path}</span>
                {!candidate.hasProject ? (
                  <span className="text-xs text-sb-fg-muted">
                    Storyboard 프로젝트가 아닙니다 (Storyboard: Init 필요)
                  </span>
                ) : null}
              </div>
              {candidate.isConnected ? (
                <StatusPill tone="success">연결됨</StatusPill>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!candidate.hasProject}
                  onClick={() => update({ workspacePath: candidate.path })}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Link2 className="h-4 w-4" aria-hidden />
                    이 작품을 봇에 연결
                  </span>
                </Button>
              )}
            </div>
          ))}
          {snapshot.workspaceCandidates.length === 0 ? (
            <span className="text-xs text-sb-fg-muted">열려 있는 워크스페이스 폴더가 없습니다.</span>
          ) : null}
        </div>
      </div>

      {/* NOTE: the bot reads its config only at boot, so a saved change is inert until a restart. */}
      {isDirty ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sb-border-warning bg-sb-bg-widget/80 px-3 py-2 text-sm text-sb-fg">
          <span>변경을 저장했습니다. 봇은 부팅 때만 설정을 읽으므로 재시작해야 반영됩니다.</span>
          <Button type="button" onClick={restart}>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="h-4 w-4" aria-hidden />
              봇 재시작
            </span>
          </Button>
        </div>
      ) : null}
    </section>
  )
}
