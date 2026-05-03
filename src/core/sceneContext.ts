import type { BackgroundCard, CharacterCard } from "../shared/card"
import type { SceneFile } from "../shared/scene"
import { readCardFile } from "../files/card"
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

    // draft 파일에서 frontmatter를 제외하고 본문만, 그 중에서도 앞부분 일부나 뒷부분 일부를 반환할 수 있음.
    // Picktion에서는 "직전 상황의 dialogue 일부"를 가져왔음.
    // 여기서는 일단 draft의 마지막 1000자 정도를 반환 (대략 이전 씬의 결말부)
    
    // 단순화: 파싱된 Draft를 쓰지 않고, raw content의 마지막 부분만 가져온다.
    // frontmatter 파싱 의존성을 분리하기 위함.
    const lastCharacters = content.slice(-1000).trim()
    return lastCharacters.length > 0 ? lastCharacters : undefined

  } catch {
    return undefined
  }
}

async function listProjectCharacters(
  paths: SceneContextWorkspacePaths,
  fileSystem: SceneContextWorkspaceFileSystem
): Promise<readonly CharacterCard[]> {
  try {
    const entries = await fileSystem.readDirectory(paths.characterDirectory)
    const cardFiles = entries.filter(([name, entry]) => entry.type === "file" && name.endsWith(".card"))

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
    const cardFiles = entries.filter(([name, entry]) => entry.type === "file" && name.endsWith(".card"))

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
  // 1. frontmatter.characters가 있으면 우선 사용
  if (scene.frontmatter.characters && scene.frontmatter.characters.length > 0) {
    const targetIds = new Set(scene.frontmatter.characters)
    return allCharacters.filter((char) => targetIds.has(char.id))
  }

  // 2. 없으면 본문에서 이름 매칭
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
