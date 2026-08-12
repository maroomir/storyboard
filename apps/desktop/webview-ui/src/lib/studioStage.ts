import type { StudioReviewState, StudioStage, StudioTarget } from "./types"

const millisecondsPerDay = 86_400_000

export function stageTitle(target: StudioTarget, stage?: StudioStage): string {
  if (!stage) {
    return targetTitle(target)
  }

  const order = stage.sceneStem.split("-")[0]
  return `씬 ${order} · ${stage.title ?? stage.sceneStem}`
}

export function stageFacts(stage?: StudioStage, now: Date = new Date()): readonly string[] {
  if (!stage) {
    return []
  }

  if (stage.draftUpdatedAt === undefined) {
    return ["초안 없음"]
  }

  const facts: string[] = []

  if (stage.draftLength !== undefined) {
    facts.push(`${stage.draftLength.toLocaleString()}자`)
  }

  facts.push(stage.draftRevision === undefined ? "초안" : `초안 v${stage.draftRevision}`)

  const updatedLabel = formatRelativeDay(stage.draftUpdatedAt, now)
  if (updatedLabel.length > 0) {
    facts.push(updatedLabel)
  }

  facts.push(reviewLabel(stage.review))

  return facts
}

export function formatRelativeDay(isoDate: string, now: Date = new Date()): string {
  const updated = new Date(isoDate)

  if (Number.isNaN(updated.getTime())) {
    return ""
  }

  const elapsedDays = calendarDayDifference(now, updated)

  if (elapsedDays <= 0) {
    return "오늘"
  }

  return elapsedDays === 1 ? "어제" : `${elapsedDays}일 전`
}

function reviewLabel(review: StudioReviewState): string {
  switch (review) {
    case "clean":
      return "검수 통과"
    case "issues":
      return "검수 이슈"
    case "unreviewed":
      return "검수 전"
  }
}

function targetTitle(target: StudioTarget): string {
  switch (target.kind) {
    case "draft":
      return `초안 · ${target.label ?? ""}`
    case "scene":
      return `씬 · ${target.label ?? ""}`
    case "project":
      return `프로젝트 · ${target.label ?? ""}`
    case "none":
      return "열린 대상 없음"
  }
}

function calendarDayDifference(now: Date, updated: Date): number {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const updatedDay = Date.UTC(updated.getFullYear(), updated.getMonth(), updated.getDate())

  return Math.round((today - updatedDay) / millisecondsPerDay)
}
