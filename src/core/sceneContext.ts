import type { BackgroundCard, CharacterCard } from "../shared/card"
import type { SceneFile } from "../shared/scene"
import { readCardFile } from "../files/card"
import { isIgnoredSampleCardFileName } from "./pathConventions"
import { detectCharactersInText } from "../utils/characterDetector"

export interface SceneContextWorkspacePaths {
  readonly characterDirectory: unknown
  readonly backgroundDirectory: unknown
  readonly draftDirectory: unknown
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

export async function readPreviousSceneContext(
  paths: SceneContextWorkspacePaths,
  currentSceneOrder: number,
  fileSystem: SceneContextWorkspaceFileSystem
): Promise<string | undefined> {
  if (currentSceneOrder <= 1) {
    return undefined
  }

  const previousOrder = currentSceneOrder - 1

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
          return card.type === "background" ? card : undefined
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

  const allNames = allCharacters.map((char) => char.name)
  const detectedNames = new Set(detectCharactersInText(scene.body, allNames))
  
  return allCharacters.filter((char) => detectedNames.has(char.name))
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
