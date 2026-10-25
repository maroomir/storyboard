import { aiTaskLabels } from "@storyboard/story-model"
import type { AiTaskName, UsageRecord } from "@storyboard/story-model"

interface TaskTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface UsageSummary {
  readonly onUsage: (record: UsageRecord) => void
  readonly print: () => void
}

export function createUsageSummary(): UsageSummary {
  const byTask = new Map<AiTaskName, TaskTotals>()

  const onUsage = (record: UsageRecord): void => {
    const totals = byTask.get(record.taskName) ?? {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    }
    totals.calls += 1
    totals.inputTokens += record.usage?.inputTokens ?? 0
    totals.outputTokens += record.usage?.outputTokens ?? 0
    totals.costUsd += record.costUsd ?? 0
    byTask.set(record.taskName, totals)
  }

  const print = (): void => {
    if (byTask.size === 0) {
      return
    }

    const total: TaskTotals = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }

    for (const [taskName, totals] of byTask) {
      total.calls += totals.calls
      total.inputTokens += totals.inputTokens
      total.outputTokens += totals.outputTokens
      total.costUsd += totals.costUsd
      // eslint-disable-next-line no-console
      console.log(`[usage] ${aiTaskLabels[taskName]}: ${formatTotals(totals)}`)
    }

    // eslint-disable-next-line no-console
    console.log(`[usage] total: ${formatTotals(total)}`)
  }

  return { onUsage, print }
}

function formatTotals(totals: TaskTotals): string {
  const base = `calls=${totals.calls} in=${totals.inputTokens} out=${totals.outputTokens}`
  return totals.costUsd > 0 ? `${base} cost=$${totals.costUsd.toFixed(4)}` : base
}
