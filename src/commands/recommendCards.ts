import * as vscode from "vscode"

import { getStoryboardProjectPaths, isIgnoredSampleCardFileName } from "../core/pathConventions"
import { resolveStoryboardWorkspaceRoot } from "../core/workspace"
import { createEmptyBackground } from "../domain/Background"
import { createEmptyCharacter } from "../domain/Character"
import { parseCard } from "../files/card"
import { parseDraft, readDraftFile, type DraftFileSystem } from "../files/draft"
import { readSceneFile, type SceneFileSystem } from "../files/scene"
import type { StoryboardCard } from "../shared/card"
import { StoryboardAIService } from "../services/ai/AIService"
import {
  buildCardRecommendations,
  type RecommendationSource,
  type RecommendedCard
} from "../services/ai/cardRecommendationBuilder"
import type { RecommendationCategory } from "../services/ai/prompts/cardRecommendation"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { recordUsageSafely } from "../services/ai/recordUsageSafely"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import type { StoryboardLogger } from "../core/logger"
import { deriveUniqueCardId, writeNewCardFiles } from "./createCard"

const recommendCharacterCommand = "storyboard.character.recommend"
const recommendBackgroundCommand = "storyboard.background.recommend"

export interface RecommendCardDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly usageRecorder: UsageRecorder
  readonly logger: StoryboardLogger
}

const sceneFileSystem: SceneFileSystem = {
  readFile: (uri) => vscode.workspace.fs.readFile(uri as vscode.Uri)
}

const draftFileSystem: DraftFileSystem = {
  readFile: (uri) => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri, content) => vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

export function registerRecommendCardCommands(dependencies: RecommendCardDependencies): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand(recommendCharacterCommand, () => recommendCards("character", dependencies)),
    vscode.commands.registerCommand(recommendBackgroundCommand, () => recommendCards("background", dependencies))
  )
}

async function recommendCards(
  category: RecommendationCategory,
  dependencies: RecommendCardDependencies
): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot()

  if (!workspaceRoot) {
    await vscode.window.showWarningMessage("Storyboard 프로젝트를 먼저 열어 주세요.")
    return
  }

  const paths = getStoryboardProjectPaths(workspaceRoot)
  const sources = await gatherRecommendationSources(paths.sceneDirectory, paths.draftDirectory)

  if (sources.length === 0) {
    await vscode.window.showInformationMessage("스캔할 scene 또는 draft가 없습니다.")
    return
  }

  const existingNames = await loadExistingCardNames(workspaceRoot, category)
  const recommendations = await scanForRecommendations(category, sources, existingNames, workspaceRoot, dependencies)

  if (recommendations === undefined) {
    return
  }

  if (recommendations.length === 0) {
    await vscode.window.showInformationMessage(
      category === "character" ? "추천할 새 캐릭터를 찾지 못했습니다." : "추천할 새 배경을 찾지 못했습니다."
    )
    return
  }

  const picked = await pickRecommendations(category, recommendations)

  if (!picked || picked.length === 0) {
    return
  }

  const created = await createCardsFromRecommendations(workspaceRoot, category, picked)
  await vscode.window.showInformationMessage(
    `${created}개의 ${category === "character" ? "캐릭터" : "배경"} 카드를 추가했습니다.`
  )
}

async function scanForRecommendations(
  category: RecommendationCategory,
  sources: readonly RecommendationSource[],
  existingNames: readonly string[],
  workspaceRoot: vscode.Uri,
  dependencies: RecommendCardDependencies
): Promise<RecommendedCard[] | undefined> {
  const aiService = new StoryboardAIService(dependencies.aiProviderRegistry, {
    onUsage: (record): void =>
      recordUsageSafely(dependencies.usageRecorder, workspaceRoot, record, dependencies.logger)
  })

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "scene·draft에서 새 카드를 찾는 중입니다…",
      cancellable: true
    },
    async (_progress, token) => {
      try {
        const recommendations = await buildCardRecommendations({ category, sources, existingNames, aiService })
        return token.isCancellationRequested ? undefined : recommendations
      } catch (error) {
        dependencies.logger.error("Card recommendation failed", error)
        await vscode.window.showErrorMessage(error instanceof Error ? error.message : "카드 추천에 실패했습니다.")
        return undefined
      }
    }
  )
}

interface RecommendationPick extends vscode.QuickPickItem {
  readonly recommendation: RecommendedCard
}

async function pickRecommendations(
  category: RecommendationCategory,
  recommendations: readonly RecommendedCard[]
): Promise<RecommendedCard[] | undefined> {
  const items: RecommendationPick[] = recommendations.map((recommendation) => ({
    label: recommendation.name,
    ...(recommendation.role ? { description: recommendation.role } : {}),
    detail: buildRecommendationDetail(recommendation),
    picked: true,
    recommendation
  }))

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: category === "character" ? "추가할 캐릭터 선택" : "추가할 배경 선택",
    placeHolder: "카드로 추가할 항목을 선택하세요."
  })

  return selected?.map((item) => item.recommendation)
}

function buildRecommendationDetail(recommendation: RecommendedCard): string {
  const parts: string[] = []

  if (recommendation.description) {
    parts.push(recommendation.description)
  }

  if (recommendation.sourceScenes.length > 0) {
    parts.push(`출처 · ${recommendation.sourceScenes.join(", ")}`)
  }

  return parts.join("  ·  ")
}

async function createCardsFromRecommendations(
  workspaceRoot: vscode.Uri,
  category: RecommendationCategory,
  recommendations: readonly RecommendedCard[]
): Promise<number> {
  const cardType: StoryboardCard["type"] = category === "character" ? "character" : "location"
  let created = 0

  for (const recommendation of recommendations) {
    const id = await deriveUniqueCardId(workspaceRoot, cardType, recommendation.name)
    await writeNewCardFiles(workspaceRoot, buildCardFromRecommendation(category, id, recommendation))
    created += 1
  }

  return created
}

function buildCardFromRecommendation(
  category: RecommendationCategory,
  id: string,
  recommendation: RecommendedCard
): StoryboardCard {
  const description = recommendation.description ? { description: [recommendation.description] } : {}

  if (category === "character") {
    return {
      ...createEmptyCharacter(id, recommendation.name),
      ...(recommendation.role ? { role: recommendation.role } : {}),
      ...description
    }
  }

  return {
    ...createEmptyBackground(id, recommendation.name),
    ...description
  }
}

async function gatherRecommendationSources(
  sceneDirectory: vscode.Uri,
  draftDirectory: vscode.Uri
): Promise<RecommendationSource[]> {
  const sceneBodies = await readSceneBodies(sceneDirectory)
  const draftBodies = await readDraftBodies(draftDirectory)

  const stems = new Set<string>([...sceneBodies.keys(), ...draftBodies.keys()])
  const sources: RecommendationSource[] = []

  for (const stem of stems) {
    const text = [sceneBodies.get(stem), draftBodies.get(stem)]
      .filter((part): part is string => part !== undefined && part.trim().length > 0)
      .join("\n\n")

    if (text.trim().length > 0) {
      sources.push({ sceneStem: stem, text })
    }
  }

  return sources
}

async function readSceneBodies(sceneDirectory: vscode.Uri): Promise<Map<string, string>> {
  const bodies = new Map<string, string>()
  const entries = await readDirectorySafely(sceneDirectory)

  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.File || !name.endsWith(".txt") || name.startsWith(".")) {
      continue
    }

    try {
      const scene = await readSceneFile(vscode.Uri.joinPath(sceneDirectory, name), sceneFileSystem, name)
      bodies.set(scene.stem, scene.body)
    } catch {
      // skip unreadable or invalid scene files
    }
  }

  return bodies
}

async function readDraftBodies(draftDirectory: vscode.Uri): Promise<Map<string, string>> {
  const bodies = new Map<string, string>()
  const entries = await readDirectorySafely(draftDirectory)

  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.File || !name.endsWith(".md")) {
      continue
    }

    try {
      const draft = parseDraft(await readDraftFile(vscode.Uri.joinPath(draftDirectory, name), draftFileSystem))
      bodies.set(draft.sceneStem, draft.body)
    } catch {
      // skip unreadable or unparsable drafts
    }
  }

  return bodies
}

async function loadExistingCardNames(
  workspaceRoot: vscode.Uri,
  category: RecommendationCategory
): Promise<string[]> {
  const glob = category === "character" ? "character/*.card" : "background/*.card"
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceRoot, glob), undefined)
  const names: string[] = []

  for (const uri of uris) {
    if (isIgnoredSampleCardFileName(uri.path.split("/").at(-1) ?? "")) {
      continue
    }

    try {
      const card = parseCard(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)))
      names.push(card.name, ...(card.aliases ?? []))
    } catch {
      // skip unreadable or invalid cards
    }
  }

  return names
}

async function readDirectorySafely(directory: vscode.Uri): Promise<[string, vscode.FileType][]> {
  try {
    return await vscode.workspace.fs.readDirectory(directory)
  } catch {
    return []
  }
}
