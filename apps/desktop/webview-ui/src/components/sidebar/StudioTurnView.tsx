import {
  ArrowRight,
  Check,
  CircleAlert,
  FileDiff,
  ShieldCheck,
  ShieldQuestion,
  Sparkles
} from "lucide-react"
import React from "react"

import type {
  StudioChatTurn,
  StudioFollowUpTarget,
  StudioPatch,
  StudioProposalTurn,
  StudioValidation
} from "@webview/lib/types"
import { Button } from "../ui/Button"

export interface StudioProposalActions {
  readonly onPreview: (turn: StudioProposalTurn) => void
  readonly onApply: (turn: StudioProposalTurn) => void
  readonly onReject: (turn: StudioProposalTurn) => void
}

export type StudioFollowUpHandler = (followUp: StudioFollowUpTarget) => void

const bubbleClass =
  "flex max-w-[92%] flex-col gap-2 rounded-lg rounded-bl-sm border border-sb-border bg-sb-bg-widget px-3 py-2"

export function StudioTurnView({
  turn,
  onAnswer,
  onOpenFollowUp,
  proposalActions
}: {
  readonly turn: StudioChatTurn
  readonly onAnswer: (text: string) => void
  readonly onOpenFollowUp: StudioFollowUpHandler
  readonly proposalActions: StudioProposalActions
}): React.ReactElement {
  if (turn.role === "user") {
    return (
      <div className="ml-auto max-w-[92%] whitespace-pre-wrap rounded-lg rounded-br-sm border border-sb-border bg-sb-bg-list-hover px-3 py-2 text-sm text-sb-fg">
        {turn.text}
      </div>
    )
  }

  if (turn.kind === "say") {
    return (
      <div className={bubbleClass}>
        <p className="m-0 whitespace-pre-wrap text-sm text-sb-fg">{turn.message}</p>
        <FollowUpList followUps={turn.followUps} onOpen={onOpenFollowUp} />
      </div>
    )
  }

  if (turn.kind === "ask") {
    return (
      <div className={bubbleClass}>
        <p className="m-0 flex items-start gap-1.5 text-sm text-sb-fg">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sb-fg-muted" aria-hidden />
          <span className="whitespace-pre-wrap">{turn.question}</span>
        </p>
        {turn.options.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {turn.options.map((option) => (
              <button
                key={option}
                type="button"
                className="inline-flex cursor-pointer items-center rounded-full border border-sb-border bg-sb-bg-widget px-2.5 py-1 text-xs text-sb-fg outline-none hover:border-sb-border-focus focus-visible:ring-1 focus-visible:ring-sb-border-focus"
                onClick={() => onAnswer(option)}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  if (turn.kind === "result") {
    return (
      <p className="m-0 flex items-center gap-1.5 text-xs text-emerald-500">
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {turn.message}
      </p>
    )
  }

  return <ProposalCard turn={turn} actions={proposalActions} onOpenFollowUp={onOpenFollowUp} />
}

function FollowUpList({
  followUps,
  onOpen
}: {
  readonly followUps?: readonly StudioFollowUpTarget[]
  readonly onOpen: StudioFollowUpHandler
}): React.ReactElement | null {
  if (!followUps || followUps.length === 0) {
    return null
  }

  return (
    <section aria-label="이어서 고칠 대상" className="flex flex-col gap-1 border-t border-sb-border pt-2">
      <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-sb-fg-muted">
        이어서 고칠 대상
      </p>
      {followUps.map((followUp) => (
        <button
          key={followUp.targetFile}
          type="button"
          className="flex w-full cursor-pointer items-start gap-1.5 rounded border border-sb-border bg-sb-bg-widget px-2 py-1.5 text-left outline-none hover:border-sb-border-focus focus-visible:ring-1 focus-visible:ring-sb-border-focus"
          onClick={() => onOpen(followUp)}
        >
          <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-sb-fg-muted" aria-hidden />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs font-medium text-sb-fg">{followUp.targetFile}</span>
            <span className="text-xs text-sb-fg-muted">{followUp.reason}</span>
          </span>
        </button>
      ))}
    </section>
  )
}

function ProposalCard({
  turn,
  actions,
  onOpenFollowUp
}: {
  readonly turn: StudioProposalTurn
  readonly actions: StudioProposalActions
  readonly onOpenFollowUp: StudioFollowUpHandler
}): React.ReactElement {
  return (
    <div className={bubbleClass}>
      <p className="m-0 text-sm font-semibold text-sb-fg">{turn.summary}</p>
      {turn.message ? (
        <p className="m-0 whitespace-pre-wrap text-sm text-sb-fg-muted">{turn.message}</p>
      ) : null}
      <p className="m-0 text-xs text-sb-fg-muted">{patchScopeLabel(turn.patch)}</p>
      <ValidationBadge validation={turn.validation} />
      {turn.status === "pending" ? (
        <div className="flex flex-wrap gap-1.5">
          <Button variant="secondary" onClick={() => actions.onPreview(turn)}>
            <FileDiff className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            diff 보기
          </Button>
          <Button onClick={() => actions.onApply(turn)}>승인</Button>
          <Button variant="secondary" onClick={() => actions.onReject(turn)}>
            거절
          </Button>
        </div>
      ) : (
        <ProposalStatusLine turn={turn} />
      )}
      {turn.status === "applied" ? (
        <FollowUpList followUps={turn.followUps} onOpen={onOpenFollowUp} />
      ) : null}
    </div>
  )
}

function ValidationBadge({
  validation
}: {
  readonly validation: StudioValidation
}): React.ReactElement {
  if (validation.state === "warn") {
    return (
      <div className="flex flex-col gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
        <p className="m-0 flex items-center gap-1.5 text-xs font-medium text-amber-500">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          기존 설정과 충돌할 수 있어요
        </p>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {validation.warnings.map((warning) => (
            <li key={warning.message} className="text-xs text-sb-fg-muted">
              {warning.message}
              {warning.source ? ` (${warning.source})` : ""}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (validation.state === "pass") {
    return (
      <p className="m-0 flex items-center gap-1.5 text-xs text-sb-fg-muted">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
        정합성 검사 통과
      </p>
    )
  }

  return (
    <p className="m-0 flex items-center gap-1.5 text-xs text-sb-fg-muted">
      <ShieldQuestion className="h-3.5 w-3.5 shrink-0" aria-hidden />
      정합성 검사 안 함
    </p>
  )
}

function ProposalStatusLine({ turn }: { readonly turn: StudioProposalTurn }): React.ReactElement {
  if (turn.status === "applied") {
    return (
      <p className="m-0 flex items-center gap-1.5 text-sm text-emerald-500">
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
        적용됨
      </p>
    )
  }

  if (turn.status === "failed") {
    return (
      <p className="m-0 flex items-center gap-1.5 text-sm text-sb-fg-error">
        <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {turn.errorMessage ?? "적용하지 못했습니다"}
      </p>
    )
  }

  return <p className="m-0 text-sm text-sb-fg-muted">거절함</p>
}

function patchScopeLabel(patch: StudioPatch): string {
  return patch.target === "card"
    ? `카드 필드 ${patch.changes.length}곳`
    : `본문 ${patch.replacements.length}구간`
}
