import { isBackgroundCard, type BackgroundCard, type CharacterCard } from "../shared/card"
import type { SceneFile } from "../shared/scene"
import { readCardFile } from "../files/card"
import { readBibleFile } from "../files/bible"
import {
  createEmptyBible,
  selectInjectedFacts,
  type BibleFact,
  type BibleFactSubject,
  type StoryBible
} from "../shared/bible"
import { isIgnoredSampleCardFileName } from "./pathConventions"
import { detectCharactersInText } from "../utils/characterDetector"

export interface SceneContextWorkspacePaths {
  readonly characterDirectory: unknown
  readonly backgroundDirectory: unknown
  readonly draftDirectory: unknown
  readonly bibleCanon?: unknown
  readonly manuscriptSummary?: unknown
  readonly joinPath: (base: unknown, ...pathSegments: string[]) => unknown
}

export interface SceneContextWorkspaceFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>
  readonly readDirectory: (uri: unknown) => PromiseLike<[string, { type: "file" | "directory" }][]>
}

export interface SceneContext {
  readonly scene: SceneFile
  readonly characters: readonly CharacterCard[]
  readonly background?: BackgroundCard
}

export async function buildSceneContext(
  paths: SceneContextWorkspacePaths,
  scene: SceneFile,
  fileSystem: SceneContextWorkspaceFileSystem
): Promise<SceneContext> {
  const [allCharacters, allBackgrounds] = await Promise.all([
    listProjectCharacters(paths, fileSystem),
    listProjectBackgrounds(paths, fileSystem)
  ])

  const characters = resolveSceneCharacters(scene, allCharacters)
  const background = resolveSceneBackground(scene, allBackgrounds)

  return {
    scene,
    characters,
    background
  }
}

const summaryContextBudget = 2000

export async function readPreviousSceneContext(
  paths: SceneContextWorkspacePaths,
  currentSceneOrder: number,
  fileSystem: SceneContextWorkspaceFileSystem
): Promise<string | undefined> {
  if (currentSceneOrder <= 1) {
    return undefined
  }

  const rollingSummary = await readRollingSummary(paths, fileSystem)
  if (rollingSummary) {
    return rollingSummary
  }

  return readPreviousDraftTail(paths, currentSceneOrder - 1, fileSystem)
}

async function readRollingSummary(
  paths: SceneContextWorkspacePaths,
  fileSystem: SceneContextWorkspaceFileSystem
): Promise<string | undefined> {
  if (!paths.manuscriptSummary) {
    return undefined
  }

  try {
    const content = new TextDecoder().decode(await fileSystem.readFile(paths.manuscriptSummary))
    const trimmed = content.trim()
    return trimmed.length > 0 ? boundSummary(trimmed) : undefined
  } catch {
    return undefined
  }
}

function boundSummary(content: string): string {
  const trimmed = content.trim()
  return trimmed.length <= summaryContextBudget ? trimmed : trimmed.slice(-summaryContextBudget).trim()
}

async function readPreviousDraftTail(
  paths: SceneContextWorkspacePaths,
  previousOrder: number,
  fileSystem: SceneContextWorkspaceFileSystem
): Promise<string | undefined> {
  try {
    const entries = await fileSystem.readDirectory(paths.draftDirectory)
    const draftFiles = entries.filter(([name, entry]) => entry.type === "file" && name.endsWith(".md"))

    const previousFileName = draftFiles.find(([name]) => {
      const match = /^(\d+)-/.exec(name)
      return match && Number.parseInt(match[1] as string, 10) === previousOrder
    })

    if (!previousFileName) {
      return undefined
    }

    const uri = paths.joinPath(paths.draftDirectory, previousFileName[0])
    const content = new TextDecoder().decode(await fileSystem.readFile(uri))

    const lastCharacters = content.slice(-1000).trim()
    return lastCharacters.length > 0 ? lastCharacters : undefined

  } catch {
    return undefined
  }
}

export interface NarrativeContext {
  readonly bibleFacts: readonly BibleFact[]
  readonly prompt?: string
}

// NOTE: Replaces the raw previous-draft tail as the pipeline's previousContext, prepending
// canon bible facts for the scene's entities so long-range setting stays consistent.
export async function buildNarrativeContext(
  paths: SceneContextWorkspacePaths,
  context: SceneContext,
  fileSystem: SceneContextWorkspaceFileSystem
): Promise<NarrativeContext> {
  const previousContext = await readPreviousSceneContext(paths, context.scene.order, fileSystem)
  const bible = await readSceneBible(paths, fileSystem)
  const bibleFacts = selectInjectedFacts(
    bible,
    sceneSubjects(context),
    context.scene.body,
    context.scene.order
  )
  const prompt = composeNarrativePrompt(formatBibleFactLines(context, bibleFacts), previousContext)

  return { bibleFacts, prompt }
}

export function formatBibleFactLines(context: SceneContext, facts: readonly BibleFact[]): string[] {
  const names = sceneEntityNames(context)

  return facts.map((fact) => {
    const subject = names.get(`${fact.subject.kind}:${fact.subject.id}`) ?? fact.subject.id
    return `${subject} — ${fact.key}: ${fact.value}`
  })
}

async function readSceneBible(
  paths: SceneContextWorkspacePaths,
  fileSystem: SceneContextWorkspaceFileSystem
): Promise<StoryBible> {
  if (!paths.bibleCanon) {
    return createEmptyBible()
  }

  try {
    return await readBibleFile(paths.bibleCanon, fileSystem)
  } catch {
    return createEmptyBible()
  }
}

function sceneSubjects(context: SceneContext): BibleFactSubject[] {
  const subjects: BibleFactSubject[] = context.characters.map((character) => ({
    kind: "character",
    id: character.id
  }))

  if (context.background) {
    subjects.push({ kind: "background", id: context.background.id })
  }

  return subjects
}

function sceneEntityNames(context: SceneContext): ReadonlyMap<string, string> {
  const names = new Map<string, string>()

  for (const character of context.characters) {
    names.set(`character:${character.id}`, character.name)
  }

  if (context.background) {
    names.set(`background:${context.background.id}`, context.background.name)
  }

  return names
}

function composeNarrativePrompt(
  factLines: readonly string[],
  previousContext: string | undefined
): string | undefined {
  const sections: string[] = []

  if (factLines.length > 0) {
    sections.push(`[설정 메모]\n${factLines.map((line) => `- ${line}`).join("\n")}`)
  }

  const trimmedPrevious = previousContext?.trim()
  if (trimmedPrevious) {
    sections.push(`[이전 장면]\n${trimmedPrevious}`)
  }

  return sections.length > 0 ? sections.join("\n\n") : undefined
}

function isWorkingCardFileName(name: string): boolean {
  return name.endsWith(".card") && !isIgnoredSampleCardFileName(name)
}

async function listProjectCharacters(
  paths: SceneContextWorkspacePaths,
  fileSystem: SceneContextWorkspaceFileSystem
): Promise<readonly CharacterCard[]> {
  try {
    const entries = await fileSystem.readDirectory(paths.characterDirectory)
    const cardFiles = entries.filter(([name, entry]) => entry.type === "file" && isWorkingCardFileName(name))

    const cards = await Promise.all(
      cardFiles.map(async ([name]) => {
        const uri = paths.joinPath(paths.characterDirectory, name)
        try {
          const card = await readCardFile(uri, fileSystem)
          return card.type === "character" ? card : undefined
        } catch {
          return undefined
        }
      })
    )

    return cards.filter((card): card is CharacterCard => card !== undefined)
  } catch {
    return []
  }
}

async function listProjectBackgrounds(
  paths: SceneContextWorkspacePaths,
  fileSystem: SceneContextWorkspaceFileSystem
): Promise<readonly BackgroundCard[]> {
  try {
    const entries = await fileSystem.readDirectory(paths.backgroundDirectory)
    const cardFiles = entries.filter(([name, entry]) => entry.type === "file" && isWorkingCardFileName(name))

    const cards = await Promise.all(
      cardFiles.map(async ([name]) => {
        const uri = paths.joinPath(paths.backgroundDirectory, name)
        try {
          const card = await readCardFile(uri, fileSystem)
          return isBackgroundCard(card) ? card : undefined
        } catch {
          return undefined
        }
      })
    )

    return cards.filter((card): card is BackgroundCard => card !== undefined)
  } catch {
    return []
  }
}

function resolveSceneCharacters(
  scene: SceneFile,
  allCharacters: readonly CharacterCard[]
): readonly CharacterCard[] {
  if (scene.frontmatter.characters && scene.frontmatter.characters.length > 0) {
    const targetIds = new Set(scene.frontmatter.characters)
    return allCharacters.filter((char) => targetIds.has(char.id))
  }

  const detectableTokens = allCharacters.flatMap((char) => [char.name, ...(char.aliases ?? [])])
  const detectedTokens = new Set(detectCharactersInText(scene.body, detectableTokens))

  return allCharacters.filter(
    (char) => detectedTokens.has(char.name) || (char.aliases ?? []).some((alias) => detectedTokens.has(alias))
  )
}

function resolveSceneBackground(
  scene: SceneFile,
  allBackgrounds: readonly BackgroundCard[]
): BackgroundCard | undefined {
  if (!scene.frontmatter.location) {
    return undefined
  }

  return allBackgrounds.find((bg) => bg.id === scene.frontmatter.location)
}
