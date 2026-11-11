import type { IFileSystem, SceneRoster, SceneRosterEntry, WorkspaceScenes } from "@storyboard/story-engine"
import {
  getStoryboardProjectPaths,
  joinStoryPath,
  parseScene,
  parseSceneFileName,
  scenePath,
  serializeSceneCard,
  structureWithProjectThreads,
  type SceneBeat,
  type SceneCard,
  type SceneFile,
  type SceneStoryState,
  type StoryUri
} from "@storyboard/story-model"

export type WriteStubBeats = (stem: string, beats: readonly SceneBeat[]) => void

function rosterOf(scenes: readonly SceneFile[]): SceneRoster {
  const entries: SceneRosterEntry[] = scenes.map(
    (file) =>
      ({
        file,
        path: `scene/${file.stem}.card`,
        content: { header: { id: file.stem } },
        entry: {
          scene: file.stem,
          thread: file.card?.thread ?? "main",
          ...(file.card?.storyTime === undefined ? {} : { storyTime: file.card.storyTime })
        }
      }) as unknown as SceneRosterEntry
  )
  return { entries, scenes, structure: structureWithProjectThreads(undefined, undefined), warnings: [] }
}

function findScene(scenes: readonly SceneFile[], reference: string): SceneFile | undefined {
  const trimmed: string = reference.trim()
  const asNumber: number | undefined = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined
  return (
    scenes.find((scene) => scene.stem === trimmed) ??
    scenes.find((scene) => asNumber !== undefined && scene.order === asNumber) ??
    scenes.find((scene) => scene.slug === trimmed)
  )
}

function stemOfSceneUri(sceneUri: StoryUri): string {
  const segment: string = sceneUri.path.split("/").find((part) => part.endsWith(".card")) ?? ""
  return segment.slice(0, -".card".length)
}

export type StubSceneStates = Map<string, SceneStoryState>

function scenesOver(
  load: () => Promise<readonly SceneFile[]>,
  writeBeats?: WriteStubBeats,
  states: StubSceneStates = new Map()
): WorkspaceScenes {
  const read = async (_root: StoryUri, reference: string): Promise<SceneFile | undefined> =>
    findScene(await load(), reference)

  return {
    readState: async (_root: StoryUri, stem: string) => states.get(stem),
    writeState: async (_root: StoryUri, stem: string, state: SceneStoryState | undefined) => {
      if (state === undefined) {
        states.delete(stem)
      } else {
        states.set(stem, state)
      }
    },
    loadRoster: async () => rosterOf(await load()),
    find: async (_root: StoryUri, reference: string) => {
      const scene: SceneFile | undefined = findScene(await load(), reference)
      return scene === undefined ? undefined : rosterOf([scene]).entries[0]
    },
    read,
    readByUri: async (sceneUri: StoryUri) => {
      const scene: SceneFile | undefined = findScene(await load(), stemOfSceneUri(sceneUri))
      if (scene === undefined) {
        throw new Error(`씬이 없습니다: ${sceneUri.path}`)
      }
      return scene
    },
    sceneUri: (root: StoryUri, stem: string) => scenePath(root, stem),
    writeBeats: async (_root: StoryUri, stem: string, beats: readonly SceneBeat[]) => writeBeats?.(stem, beats),
    writeBeatsByUri: async (sceneUri: StoryUri, beats: readonly SceneBeat[]) =>
      writeBeats?.(stemOfSceneUri(sceneUri), beats)
  } as unknown as WorkspaceScenes
}

export function stubScenes(
  scenes: readonly SceneFile[] = [],
  writeBeats?: WriteStubBeats,
  states?: StubSceneStates
): WorkspaceScenes {
  return scenesOver(async () => scenes, writeBeats, states)
}

type ReadableFileSystem = Pick<IFileSystem, "readFile" | "readDirectory">

async function readLegacyScenes(fileSystem: ReadableFileSystem, sceneDirectory: StoryUri): Promise<SceneFile[]> {
  let entries: Awaited<ReturnType<IFileSystem["readDirectory"]>>
  try {
    entries = await fileSystem.readDirectory(sceneDirectory)
  } catch {
    return []
  }

  const scenes: SceneFile[] = []
  for (const [name, entry] of entries) {
    if (entry.type !== "file" || parseSceneFileName(name) === undefined) {
      continue
    }
    try {
      const text: string = new TextDecoder().decode(await fileSystem.readFile(joinStoryPath(sceneDirectory, name)))
      scenes.push(parseScene(text, name))
    } catch {
      continue
    }
  }

  return scenes.sort((left, right) => left.order - right.order)
}

export function legacyScenesUnder(
  fileSystem: ReadableFileSystem,
  workspaceRoot: StoryUri,
  writeBeats?: WriteStubBeats,
  states?: StubSceneStates
): WorkspaceScenes {
  const sceneDirectory: StoryUri = getStoryboardProjectPaths(workspaceRoot).sceneDirectory
  return scenesOver(() => readLegacyScenes(fileSystem, sceneDirectory), writeBeats, states)
}

const legacyScenePathPattern: RegExp = /\/scene\/([^/]+\.card)$/

export type WriteStubFile = (path: string, text: string) => void

export function scenesFromFiles(readFiles: () => Readonly<Record<string, string>>, writeFile?: WriteStubFile): WorkspaceScenes {
  const load = async (): Promise<readonly SceneFile[]> =>
    Object.entries(readFiles())
      .flatMap(([path, text]): SceneFile[] => {
        const fileName: string | undefined = legacyScenePathPattern.exec(path)?.[1]
        if (fileName === undefined || parseSceneFileName(fileName) === undefined) {
          return []
        }
        try {
          return [parseScene(text, fileName)]
        } catch {
          return []
        }
      })
      .sort((left, right) => left.order - right.order)

  return {
    ...scenesOver(load),
    writeCard: async (root: StoryUri, card: SceneCard) => {
      const stem: string = card.id ?? ""
      writeFile?.(`${root.path}/scene/${stem}.card`, serializeSceneCard(card))
      return { stem, uri: scenePath(root, stem), isNew: false }
    }
  } as unknown as WorkspaceScenes
}
