import type {
  CardEditorInitialData,
  CardType,
  SceneListItem,
  SidebarCardsInitialData,
  SidebarScenesInitialData
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

export function parseSidebarCardsInitialData(value: unknown): SidebarCardsInitialData {
  if (isSidebarCardsInitialData(value)) {
    return value
  }

  return {
    type: "character",
    title: "Cards",
    cards: [],
    isStoryboardProject: false
  }
}

export function parseSidebarScenesInitialData(value: unknown): SidebarScenesInitialData {
  if (isSidebarScenesInitialData(value)) {
    return value
  }

  return {
    title: "Scenes",
    scenes: [],
    isStoryboardProject: false
  }
}

function isCardEditorInitialData(value: unknown): value is CardEditorInitialData {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<CardEditorInitialData>
  return typeof candidate.documentUri === "string" && typeof candidate.rawText === "string"
}

function isSidebarCardsInitialData(value: unknown): value is SidebarCardsInitialData {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<SidebarCardsInitialData>
  return (
    isCardType(candidate.type) &&
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

function isCardType(value: unknown): value is CardType {
  return value === "character" || value === "background"
}
