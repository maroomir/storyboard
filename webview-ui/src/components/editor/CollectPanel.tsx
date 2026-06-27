import React, { useCallback, useEffect, useMemo, useState } from "react"

import { createRequestId } from "@webview/lib/messaging"
import type { CardCollectProposal, StoryboardCard } from "@webview/lib/types"
import { Button } from "../ui/Button"
import { SectionHeader } from "../ui/SectionHeader"

const panelClass =
  "flex flex-col gap-4 rounded-xl border border-sb-border bg-sb-bg-sidebar/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"

const addedColor = "var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-charts-green))"
const removedColor = "var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-errorForeground))"

const kindLabels: Record<CardCollectProposal["kind"], string> = {
  attribute: "속성",
  relation: "관계",
  arc: "아크",
  trait: "특성",
  recentDialogue: "최근 대사",
  descriptionLine: "설명",
  sense: "감각",
  scalar: "값",
  characterId: "등장인물"
}

type VscodeApi = ReturnType<NonNullable<typeof window.acquireVsCodeApi>>

type RpcResponse<T> = {
  readonly type: "response"
  readonly id: string
  readonly ok: boolean
  readonly payload?: T
  readonly error?: { readonly message: string }
}

function callRpc<T>(vscodeApi: VscodeApi, method: string, payload: Record<string, unknown>): Promise<T> {
  const id = createRequestId()

  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent): void => {
      const data = event.data as RpcResponse<T> | undefined
      if (!data || data.type !== "response" || data.id !== id) {
        return
      }

      window.removeEventListener("message", handler)

      if (data.ok && data.payload !== undefined) {
        resolve(data.payload)
        return
      }

      reject(new Error(data.error?.message ?? "요청을 처리하지 못했습니다."))
    }

    window.addEventListener("message", handler)
    vscodeApi.postMessage({ protocolVersion: "1.0.0", type: "request", id, method, payload })
  })
}

function proposalDiff(proposal: CardCollectProposal): { readonly before?: string; readonly after: string } {
  switch (proposal.kind) {
    case "attribute":
      return { after: `${proposal.key}: ${proposal.value}`, before: proposal.before === undefined ? undefined : `${proposal.key}: ${proposal.before}` }
    case "relation":
      return {
        after: `${proposal.target} · ${proposal.type}`,
        before: proposal.before === undefined ? undefined : `${proposal.target} · ${proposal.before}`
      }
    case "arc":
      return { after: proposal.summary, before: proposal.before }
    case "scalar": {
      const label = proposal.field === "time" ? "시간" : "날씨"
      return { after: `${label}: ${proposal.after}`, before: proposal.before === undefined ? undefined : `${label}: ${proposal.before}` }
    }
    default:
      return { after: proposal.value }
  }
}

function DiffRow({
  proposal,
  checked,
  onToggle
}: {
  readonly proposal: CardCollectProposal
  readonly checked: boolean
  readonly onToggle: () => void
}): React.ReactElement {
  const { before, after } = proposalDiff(proposal)

  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-sb-bg-list-hover">
      <input type="checkbox" className="mt-1" checked={checked} onChange={onToggle} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 font-mono text-xs leading-normal">
        {before ? <span style={{ color: removedColor }}>- {before}</span> : null}
        <span style={{ color: addedColor }}>+ {after}</span>
        {proposal.sourceScenes.length > 0 ? (
          <span className="font-sans text-[0.7rem] text-sb-fg-muted">출처 · {proposal.sourceScenes.join(", ")}</span>
        ) : null}
      </span>
    </label>
  )
}

export type CollectPanelProps = {
  readonly card: StoryboardCard
  readonly documentUri: string
  readonly vscodeApi?: VscodeApi
  readonly onStatusChange?: (status: string) => void
}

type Phase = "idle" | "loading" | "loaded" | "applying"

export function CollectPanel({ card, documentUri, vscodeApi, onStatusChange }: CollectPanelProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("idle")
  const [proposals, setProposals] = useState<readonly CardCollectProposal[]>([])
  const [acceptedIds, setAcceptedIds] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    setPhase("idle")
    setProposals([])
    setAcceptedIds(new Set())
    setError(undefined)
  }, [card.id])

  const runCollect = useCallback((): void => {
    if (!vscodeApi) {
      setError("VS Code API를 사용할 수 없습니다.")
      return
    }

    setPhase("loading")
    setError(undefined)
    setProposals([])
    setAcceptedIds(new Set())
    onStatusChange?.("draft에서 카드 정보를 수집하는 중입니다…")

    void callRpc<{ readonly proposals: CardCollectProposal[] }>(vscodeApi, "cards.collect", { uri: documentUri })
      .then((result) => {
        setProposals(result.proposals)
        setAcceptedIds(new Set(result.proposals.map((proposal) => proposal.id)))
        setPhase("loaded")
        onStatusChange?.(
          result.proposals.length > 0
            ? `${result.proposals.length}개의 제안을 수집했습니다.`
            : "추가할 새로운 정보를 찾지 못했습니다."
        )
      })
      .catch((collectError: unknown) => {
        const message = collectError instanceof Error ? collectError.message : "수집에 실패했습니다."
        setError(message)
        setPhase("idle")
        onStatusChange?.(message)
      })
  }, [vscodeApi, documentUri, onStatusChange])

  const toggle = useCallback((id: string): void => {
    setAcceptedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const allSelected = proposals.length > 0 && acceptedIds.size === proposals.length

  const toggleAll = useCallback((): void => {
    setAcceptedIds((previous) =>
      previous.size === proposals.length ? new Set() : new Set(proposals.map((proposal) => proposal.id))
    )
  }, [proposals])

  const previewDiff = useCallback((): void => {
    if (!vscodeApi) {
      setError("VS Code API를 사용할 수 없습니다.")
      return
    }

    const accepted = proposals.filter((proposal) => acceptedIds.has(proposal.id))

    if (accepted.length === 0) {
      return
    }

    void callRpc<Record<string, never>>(vscodeApi, "cards.previewCollect", { uri: documentUri, accepted })
      .then(() => {
        onStatusChange?.("선택 항목을 반영한 YAML diff를 열었습니다.")
      })
      .catch((previewError: unknown) => {
        const message = previewError instanceof Error ? previewError.message : "diff 미리보기에 실패했습니다."
        setError(message)
        onStatusChange?.(message)
      })
  }, [vscodeApi, documentUri, proposals, acceptedIds, onStatusChange])

  const applyAccepted = useCallback((): void => {
    if (!vscodeApi) {
      setError("VS Code API를 사용할 수 없습니다.")
      return
    }

    const accepted = proposals.filter((proposal) => acceptedIds.has(proposal.id))

    if (accepted.length === 0) {
      return
    }

    setPhase("applying")
    setError(undefined)
    onStatusChange?.("선택한 제안을 카드에 반영하는 중입니다…")

    void callRpc<{ readonly card: StoryboardCard }>(vscodeApi, "cards.applyCollect", { uri: documentUri, accepted })
      .then(() => {
        setProposals([])
        setAcceptedIds(new Set())
        setPhase("idle")
        onStatusChange?.(`${accepted.length}개의 제안을 카드에 반영했습니다.`)
      })
      .catch((applyError: unknown) => {
        const message = applyError instanceof Error ? applyError.message : "반영에 실패했습니다."
        setError(message)
        setPhase("loaded")
        onStatusChange?.(message)
      })
  }, [vscodeApi, documentUri, proposals, acceptedIds, onStatusChange])

  const groups = useMemo(() => {
    const order: CardCollectProposal["kind"][] = [
      "descriptionLine",
      "attribute",
      "trait",
      "relation",
      "arc",
      "sense",
      "scalar",
      "characterId",
      "recentDialogue"
    ]

    return order
      .map((kind) => ({ kind, items: proposals.filter((proposal) => proposal.kind === kind) }))
      .filter((group) => group.items.length > 0)
  }, [proposals])

  const isBusy = phase === "loading" || phase === "applying"

  return (
    <div className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <SectionHeader
          title="draft에서 수집"
          eyebrow="Collect"
          description="생성된 draft를 분석해 카드에 추가할 정보를 제안합니다. 기존 값은 덮어쓰지 않습니다."
        />
        <Button variant="primary" disabled={!vscodeApi || isBusy} onClick={runCollect}>
          {phase === "loading" ? "수집 중…" : "수집"}
        </Button>
      </div>

      {error ? <p className="m-0 text-sm text-sb-fg-error">{error}</p> : null}

      {phase === "loading" ? <p className="m-0 text-sm text-sb-fg-muted">draft를 분석하는 중입니다…</p> : null}

      {phase !== "loading" && proposals.length === 0 ? (
        <p className="m-0 text-sm text-sb-fg-muted">
          {phase === "loaded" ? "추가할 새로운 정보를 찾지 못했습니다." : "수집 버튼을 눌러 draft에서 정보를 모아 보세요."}
        </p>
      ) : null}

      {proposals.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-sb-fg-muted">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              전체 선택
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={isBusy || acceptedIds.size === 0} onClick={previewDiff}>
                diff 미리보기
              </Button>
              <Button variant="primary" disabled={isBusy || acceptedIds.size === 0} onClick={applyAccepted}>
                {phase === "applying" ? "반영 중…" : `선택 항목 반영 (${acceptedIds.size})`}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <fieldset key={group.kind} className="m-0 flex flex-col gap-1 border-0 p-0">
                <legend className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">
                  {kindLabels[group.kind]}
                </legend>
                {group.items.map((proposal) => (
                  <DiffRow
                    key={proposal.id}
                    proposal={proposal}
                    checked={acceptedIds.has(proposal.id)}
                    onToggle={() => toggle(proposal.id)}
                  />
                ))}
              </fieldset>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
