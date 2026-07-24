import React from "react"

import { SectionHeader } from "../ui/SectionHeader"
import { StatusPill } from "./SettingsPrimitives"
import {
  AI_PROVIDER_IDS,
  formatResolvedTaskAi,
  getProviderStatus,
  isAiProviderId,
  pickModelForTaskProvider,
  type AiProviderId,
  type SettingsReadSnapshot
} from "./settingsSnapshot"
import { sbSelectClass, sectionCardClass } from "./settingsStyles"

export function TaskAssignmentsSection({
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
