import React, { useMemo, useState } from "react"

import { Button } from "../ui/Button"
import { IconButton } from "../ui/IconButton"
import { SectionHeader } from "../ui/SectionHeader"
import { StatusPill } from "./SettingsPrimitives"
import {
  AI_PROVIDER_IDS,
  formatDefaultProviderSummary,
  formatResolvedTaskAi,
  getProviderStatus,
  hasTaskOverride,
  isAiProviderId,
  pickModelForTaskProvider,
  type AiProviderId,
  type AiTaskName,
  type SettingsReadSnapshot,
  type TaskCatalogItem
} from "./settingsSnapshot"
import { sbInlineSelectClass, sbInputClass, sectionCardClass } from "./settingsStyles"

export function TaskAssignmentsSection({
  snapshot,
  callRpc,
  onRpcError
}: {
  readonly snapshot: SettingsReadSnapshot
  readonly callRpc: (method: string, payload: Record<string, unknown>) => Promise<unknown>
  readonly onRpcError: (message: string) => void
}): React.ReactElement {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState("")

  const overrides = useMemo(() => listTaskOverrides(snapshot), [snapshot])
  const addableTasks = useMemo(
    () => snapshot.taskCatalog.filter((task) => !hasTaskOverride(snapshot, task.name) && task.status === "wired"),
    [snapshot]
  )
  const matchedTasks = useMemo(() => filterTasksByQuery(addableTasks, pickerQuery), [addableTasks, pickerQuery])

  const plannedCount = snapshot.taskCatalog.filter((task) => task.status === "planned").length
  const defaultSummary = formatDefaultProviderSummary(snapshot)

  const saveTaskAi = (taskName: AiTaskName, providerId: AiProviderId | null, model: string | null): void => {
    void callRpc("settings.updateTaskAiConfig", { taskName, providerId, model }).catch((error: unknown) => {
      onRpcError(error instanceof Error ? error.message : "태스크 오버라이드를 저장하지 못했습니다.")
    })
  }

  const closePicker = (): void => {
    setIsPickerOpen(false)
    setPickerQuery("")
  }

  const addOverride = (taskName: AiTaskName): void => {
    const providerId = snapshot.defaultProvider
    saveTaskAi(taskName, providerId, pickModelForTaskProvider(snapshot, providerId, null))
    closePicker()
  }

  return (
    <section className={sectionCardClass} aria-label="태스크 오버라이드">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="활성 오버라이드"
          description={`여기에 없는 태스크는 모두 기본값(${defaultSummary})을 따릅니다.`}
        />
        <StatusPill tone="neutral">
          {overrides.length} / {snapshot.taskCatalog.length}개 태스크
        </StatusPill>
      </div>

      {overrides.length === 0 ? (
        <p className="m-0 rounded-md border border-dashed border-sb-border px-3 py-4 text-sm text-sb-fg-muted">
          활성 오버라이드가 없습니다. 모든 태스크가 기본 제공자와 기본 모델을 사용합니다.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {overrides.map((override) => (
            <OverrideRow key={override.task.name} override={override} snapshot={snapshot} onSave={saveTaskAi} />
          ))}
        </ul>
      )}

      {isPickerOpen ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-sb-border p-3">
          <label className="flex flex-col gap-1 text-xs text-sb-fg-muted">
            <span>오버라이드할 태스크 검색</span>
            <input
              className={sbInputClass}
              type="search"
              value={pickerQuery}
              placeholder="태스크 이름"
              onChange={(event) => setPickerQuery(event.target.value)}
            />
          </label>
          {matchedTasks.length === 0 ? (
            <p className="m-0 text-xs text-sb-fg-muted">추가할 수 있는 태스크가 없습니다.</p>
          ) : (
            <ul className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0">
              {matchedTasks.map((task) => (
                <li key={task.name}>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded border border-transparent bg-transparent px-2 py-1.5 text-left outline-none hover:bg-sb-bg-list-hover focus-visible:border-sb-border-focus"
                    onClick={() => addOverride(task.name)}
                  >
                    <span className="text-sm text-sb-fg">{task.label}</span>
                    <span className="text-xs text-sb-fg-muted">현재 {formatResolvedTaskAi(snapshot, task.name)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="ghost" className="self-start" onClick={closePicker}>
            취소
          </Button>
        </div>
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setIsPickerOpen(true)}>
          ＋ 태스크 오버라이드 추가
        </Button>
      )}

      {plannedCount > 0 ? (
        <p className="m-0 text-xs text-sb-fg-muted">Phase 6 예정 {plannedCount}개는 아직 오버라이드할 수 없습니다.</p>
      ) : null}
    </section>
  )
}

function OverrideRow({
  override,
  snapshot,
  onSave
}: {
  readonly override: TaskOverride
  readonly snapshot: SettingsReadSnapshot
  readonly onSave: (taskName: AiTaskName, providerId: AiProviderId | null, model: string | null) => void
}): React.ReactElement {
  const { task, providerId, model } = override
  const isPlanned = task.status === "planned"
  const modelValue = pickModelForTaskProvider(snapshot, providerId, model)

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sb-border border-l-2 border-l-sb-accent-background bg-sb-bg-widget/60 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2 text-sm font-medium text-sb-fg">
          <span>{task.label}</span>
          {isPlanned ? <StatusPill tone="warning">Phase 6 예정</StatusPill> : null}
        </div>
        <p className="m-0 text-xs text-sb-fg-muted">기본값: {formatDefaultProviderSummary(snapshot)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={sbInlineSelectClass}
          aria-label={`${task.label} 제공자`}
          value={providerId}
          disabled={isPlanned}
          onChange={(event) => {
            const nextProviderId = event.target.value
            if (!isAiProviderId(nextProviderId)) {
              return
            }

            onSave(task.name, nextProviderId, pickModelForTaskProvider(snapshot, nextProviderId, model))
          }}
        >
          {AI_PROVIDER_IDS.map((id) => (
            <option key={`${task.name}-${id}`} value={id}>
              {getProviderStatus(snapshot, id)?.displayName ?? id}
            </option>
          ))}
        </select>
        <select
          className={sbInlineSelectClass}
          aria-label={`${task.label} 모델`}
          value={modelValue}
          disabled={isPlanned}
          onChange={(event) => {
            const model = event.target.value
            if (model.length === 0) {
              return
            }

            onSave(task.name, providerId, model)
          }}
        >
          {snapshot.modelCatalog[providerId].map((option) => (
            <option key={`${task.name}-model-${option.id}`} value={option.id}>
              {option.displayName}
            </option>
          ))}
        </select>
        <IconButton
          icon="cancel"
          aria-label={`${task.label} 오버라이드 제거`}
          onClick={() => onSave(task.name, null, null)}
        />
      </div>
    </li>
  )
}

interface TaskOverride {
  readonly task: TaskCatalogItem
  readonly providerId: AiProviderId
  readonly model: string | null
}

function listTaskOverrides(snapshot: SettingsReadSnapshot): readonly TaskOverride[] {
  const overrides: TaskOverride[] = []

  for (const task of snapshot.taskCatalog) {
    const assigned = snapshot.taskAssignments[task.name]
    if (assigned?.providerId != null) {
      overrides.push({ task, providerId: assigned.providerId, model: assigned.model })
    }
  }

  return overrides
}

function filterTasksByQuery(tasks: readonly TaskCatalogItem[], query: string): readonly TaskCatalogItem[] {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) {
    return tasks
  }

  return tasks.filter(
    (task) => task.label.toLowerCase().includes(normalized) || task.name.toLowerCase().includes(normalized)
  )
}
