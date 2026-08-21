import type {
  CardEditorInitialData,
  SceneListItem,
  SidebarCardCategory,
  SidebarCardsInitialData,
  SidebarScenesInitialData,
  StudioChatTurn,
  StudioInitialData,
  StudioSessionSnapshot,
  StudioSessionSummary,
  StudioTarget,
  UsageSummaryByEntity
} from "./types"

export function createRequestId(): string {
  return crypto.randomUUID()
}

export function parseCardEditorInitialData(value: unknown): CardEditorInitialData {
  if (isCardEditorInitialData(value)) {
    return value
  }

  return {
    documentUri: "",
    rawText: "",
    error: "초기 카드 데이터를 읽을 수 없습니다."
  }
}

const emptyUsageSummary: UsageSummaryByEntity = {
  scenes: {},
  characters: {},
  backgrounds: {},
  totalUsd: 0
}

export function parseSidebarCardsInitialData(value: unknown): SidebarCardsInitialData {
  if (isSidebarCardsInitialData(value)) {
    return { ...value, usage: normalizeUsageSummary(value.usage) }
  }

  return {
    type: "character",
    title: "Cards",
    cards: [],
    isStoryboardProject: false,
    usage: emptyUsageSummary
  }
}

export function parseSidebarScenesInitialData(value: unknown): SidebarScenesInitialData {
  if (isSidebarScenesInitialData(value)) {
    return { ...value, usage: normalizeUsageSummary(value.usage) }
  }

  return {
    title: "Scenes",
    scenes: [],
    isStoryboardProject: false,
    usage: emptyUsageSummary
  }
}

const noneStudioTarget: StudioTarget = { kind: "none", hasSelection: false }

export function parseStudioTarget(value: unknown): StudioTarget {
  if (!value || typeof value !== "object") {
    return noneStudioTarget
  }

  const candidate = value as Partial<StudioTarget>

  if (
    candidate.kind !== "draft" &&
    candidate.kind !== "scene" &&
    candidate.kind !== "project" &&
    candidate.kind !== "none"
  ) {
    return noneStudioTarget
  }

  return {
    kind: candidate.kind,
    label: typeof candidate.label === "string" ? candidate.label : undefined,
    sceneUri: typeof candidate.sceneUri === "string" ? candidate.sceneUri : undefined,
    draftUri: typeof candidate.draftUri === "string" ? candidate.draftUri : undefined,
    hasSelection: candidate.hasSelection === true,
    draftExists: typeof candidate.draftExists === "boolean" ? candidate.draftExists : undefined
  }
}

export function parseStudioInitialData(value: unknown): StudioInitialData {
  const candidate = (value && typeof value === "object" ? value : {}) as Partial<StudioInitialData>
  const title = typeof candidate.title === "string" ? candidate.title : "Studio"

  return {
    title,
    target: parseStudioTarget(candidate.target),
    session: parseStudioSessionSnapshot(candidate.session)
  }
}

function parseStudioSessionSnapshot(value: unknown): StudioSessionSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const candidate = value as Partial<StudioSessionSnapshot>

  if (
    typeof candidate.id !== "string" ||
    typeof candidate.createdAt !== "string" ||
    !Array.isArray(candidate.turns)
  ) {
    return undefined
  }

  return {
    id: candidate.id,
    createdAt: candidate.createdAt,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : candidate.createdAt,
    title: typeof candidate.title === "string" ? candidate.title : "",
    turns: candidate.turns as readonly StudioChatTurn[]
  }
}

export function parseSessionListPayload(payload: unknown): readonly StudioSessionSummary[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const sessions = (payload as { sessions?: unknown }).sessions
  if (!Array.isArray(sessions)) {
    return []
  }

  return sessions.filter(isStudioSessionSummary)
}

export function parseSessionLoadPayload(payload: unknown): StudioSessionSnapshot | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined
  }

  return parseStudioSessionSnapshot((payload as { session?: unknown }).session)
}

function isStudioSessionSummary(value: unknown): value is StudioSessionSummary {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<StudioSessionSummary>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.turnCount === "number"
  )
}

export function normalizeRestoredTurns(
  turns: readonly StudioChatTurn[]
): readonly StudioChatTurn[] {
  return turns.map((turn) => {
    if (turn.role !== "assistant" || turn.kind !== "proposal") {
      return turn
    }

    if (turn.status === "pending") {
      return { ...turn, status: "cancelled", requestId: undefined }
    }

    if (turn.status === "running") {
      return { ...turn, status: "failed", requestId: undefined, errorMessage: "중단됨" }
    }

    return turn
  })
}

function isCardEditorInitialData(value: unknown): value is CardEditorInitialData {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<CardEditorInitialData>
  return typeof candidate.documentUri === "string" && typeof candidate.rawText === "string"
}

export function parseUsageChangedPayload(payload: unknown): UsageSummaryByEntity {
  return normalizeUsageSummary(payload)
}

export function sumUsageMap(map: Readonly<Record<string, number>>): number {
  let total = 0
  for (const value of Object.values(map)) {
    if (Number.isFinite(value)) {
      total += value
    }
  }
  return total
}

function normalizeUsageSummary(value: unknown): UsageSummaryByEntity {
  if (!value || typeof value !== "object") {
    return emptyUsageSummary
  }

  const u = value as Partial<UsageSummaryByEntity & { readonly total?: number }>
  const totalUsdRaw = u.totalUsd ?? u.total
  return {
    scenes: typeof u.scenes === "object" && u.scenes !== null ? u.scenes : {},
    characters: typeof u.characters === "object" && u.characters !== null ? u.characters : {},
    backgrounds: typeof u.backgrounds === "object" && u.backgrounds !== null ? u.backgrounds : {},
    totalUsd: typeof totalUsdRaw === "number" && Number.isFinite(totalUsdRaw) ? totalUsdRaw : 0
  }
}

function isSidebarCardsInitialData(value: unknown): value is SidebarCardsInitialData {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<SidebarCardsInitialData>
  return (
    isSidebarCardCategory(candidate.type) &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.cards) &&
    typeof candidate.isStoryboardProject === "boolean"
  )
}

function isSidebarScenesInitialData(value: unknown): value is SidebarScenesInitialData {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<SidebarScenesInitialData>
  return (
    typeof candidate.title === "string" &&
    Array.isArray(candidate.scenes) &&
    typeof candidate.isStoryboardProject === "boolean" &&
    candidate.scenes.every(isSceneListItem)
  )
}

function isSceneListItem(value: unknown): value is SceneListItem {
  if (!value || typeof value !== "object") {
    return false
  }

  const s = value as Partial<SceneListItem>
  return (
    typeof s.stem === "string" &&
    typeof s.order === "number" &&
    typeof s.slug === "string" &&
    typeof s.sceneUri === "string" &&
    (s.status === "ready" || s.status === "stale" || s.status === "missing") &&
    typeof s.sceneMtime === "number"
  )
}

function isSidebarCardCategory(value: unknown): value is SidebarCardCategory {
  return value === "character" || value === "background"
}
