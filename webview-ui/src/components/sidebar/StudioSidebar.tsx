import { FileText } from "lucide-react"
import React, { useEffect, useMemo, useState } from "react"

import { createRequestId, parseStudioTarget } from "@webview/lib/messaging"
import type { StoryboardEventMessage, StudioActionId, StudioInitialData, StudioTarget } from "@webview/lib/types"
import { Button } from "../ui/Button"
import { EmptyState } from "../ui/EmptyState"
import { SectionHeader } from "../ui/SectionHeader"
import { sbInputClass } from "../ui/formClasses"

export function StudioSidebar({ initialData }: { readonly initialData: StudioInitialData }): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), [])
  const [target, setTarget] = useState<StudioTarget>(initialData.target)
  const [instruction, setInstruction] = useState("")

  useEffect(() => {
    const handleMessage = (event: MessageEvent<StoryboardEventMessage>): void => {
      if (event.data.type !== "event" || event.data.method !== "studio.targetChanged") {
        return
      }

      setTarget(parseStudioTarget(event.data.payload))
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const runAction = (action: StudioActionId, payloadInstruction?: string): void => {
    vscodeApi?.postMessage({
      protocolVersion: "1.0.0",
      type: "request",
      id: createRequestId(),
      method: "studio.runAction",
      payload: { action, instruction: payloadInstruction }
    })
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-sb-bg-sidebar p-3">
      <SectionHeader eyebrow="Storyboard" title={initialData.title} description={targetDescription(target)} />
      {target.kind === "draft" ? (
        <DraftActions target={target} runAction={runAction} instruction={instruction} setInstruction={setInstruction} />
      ) : target.kind === "scene" ? (
        <SceneActions target={target} runAction={runAction} />
      ) : (
        <EmptyState
          icon={FileText}
          title="대상이 없습니다"
          description="씬(scene/*.txt) 또는 초안(draft/*.md) 파일을 열면 여기서 재생성·검사·편집을 실행할 수 있습니다."
        />
      )}
    </main>
  )
}

function targetDescription(target: StudioTarget): string {
  if (target.kind === "draft") {
    return `초안 · ${target.label ?? ""}`
  }

  if (target.kind === "scene") {
    return `씬 · ${target.label ?? ""}`
  }

  return "열린 대상 없음"
}

type RunAction = (action: StudioActionId, instruction?: string) => void

function DraftActions({
  target,
  runAction,
  instruction,
  setInstruction
}: {
  readonly target: StudioTarget
  readonly runAction: RunAction
  readonly instruction: string
  readonly setInstruction: (value: string) => void
}): React.ReactElement {
  const trimmedInstruction = instruction.trim()

  return (
    <div className="flex flex-col gap-4">
      <ActionGroup title="초안 전체">
        <Button onClick={() => runAction("regenerate")}>Regenerate</Button>
        <Button variant="secondary" onClick={() => runAction("grammarCheck")}>
          Grammar Check
        </Button>
        <Button variant="secondary" onClick={() => runAction("continuityCheck")}>
          Continuity Check
        </Button>
        <Button variant="secondary" onClick={() => runAction("augment")}>
          Augment from Cards
        </Button>
      </ActionGroup>

      <ActionGroup
        title="선택 영역"
        hint={target.hasSelection ? undefined : "본문에서 영역을 먼저 선택하세요."}
      >
        <Button variant="secondary" disabled={!target.hasSelection} onClick={() => runAction("expand")}>
          Expand
        </Button>
        <Button variant="secondary" disabled={!target.hasSelection} onClick={() => runAction("augmentSelection")}>
          Update Selection
        </Button>
      </ActionGroup>

      <div className="flex flex-col gap-2">
        <SectionHeader title="Edit Selection" description="선택 영역을 지시문대로 수정합니다." />
        <textarea
          className={`${sbInputClass} min-h-20 resize-y`}
          placeholder="예: 더 긴장감 있게, 캐릭터 감정을 강조해서, 짧게 줄여서..."
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
        />
        <Button
          disabled={!target.hasSelection || trimmedInstruction.length === 0}
          onClick={() => runAction("editSelection", trimmedInstruction)}
        >
          Apply
        </Button>
        {!target.hasSelection ? (
          <p className="m-0 text-sm text-sb-fg-muted">본문에서 수정할 영역을 먼저 선택하세요.</p>
        ) : null}
      </div>
    </div>
  )
}

function SceneActions({ target, runAction }: { readonly target: StudioTarget; readonly runAction: RunAction }): React.ReactElement {
  return (
    <ActionGroup title="씬">
      <Button onClick={() => runAction(target.draftExists ? "regenerate" : "generate")}>
        {target.draftExists ? "Regenerate Draft" : "Generate Draft"}
      </Button>
      <Button variant="secondary" disabled={!target.draftExists} onClick={() => runAction("applyFormat")}>
        Apply Format
      </Button>
    </ActionGroup>
  )
}

function ActionGroup({
  title,
  hint,
  children
}: {
  readonly title: string
  readonly hint?: string
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">{title}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
      {hint ? <p className="m-0 text-sm text-sb-fg-muted">{hint}</p> : null}
    </section>
  )
}
