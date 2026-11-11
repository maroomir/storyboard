import type { CardRoster, ElementBundle, IFileSystem, WorkspaceCards } from "@storyboard/story-engine"
import {
  getStoryboardProjectPaths,
  isBackgroundCard,
  joinStoryPath,
  parseCard,
  parseNarratorCard,
  serializeCard,
  type CharacterCard,
  type LocationBackgroundCard,
  type NarratorCard,
  type Statement,
  type StoryboardCard,
  type StoryUri
} from "@storyboard/story-model"

export interface StubCards {
  readonly characters?: readonly CharacterCard[]
  readonly backgrounds?: readonly LocationBackgroundCard[]
  readonly narrators?: readonly NarratorCard[]
}

function rosterOf(cards: StubCards): CardRoster {
  return {
    characters: cards.characters ?? [],
    backgrounds: cards.backgrounds ?? [],
    narrators: cards.narrators ?? [],
    bundles: [],
    warnings: [],
    lookup: { slugOf: () => undefined, idOf: () => undefined }
  }
}

export interface StubCardFact {
  readonly kind: "character" | "background"
  readonly slug: string
  readonly value: string
  readonly key?: string
  readonly since?: string
  readonly until?: string
  readonly revealFrom?: string
  readonly knownBy?: readonly string[]
}

function bundleOfFacts(kind: StubCardFact["kind"], slug: string, facts: readonly StubCardFact[]): ElementBundle {
  const statements: Statement[] = facts.map(({ kind: _kind, slug: _slug, ...fact }) => ({
    facet: "fact",
    ...fact,
    source: { origin: "author" }
  }))
  return { kind, path: `${kind}/${slug}.card`, header: { id: slug, slug, kind }, statements, cardHash: "" } as unknown as ElementBundle
}

export function stubCardFacts(facts: readonly StubCardFact[], cards: StubCards = {}): WorkspaceCards {
  const subjects: string[] = [...new Set(facts.map((fact) => `${fact.kind}:${fact.slug}`))]
  const roster: CardRoster = {
    ...rosterOf(cards),
    bundles: subjects.map((subject) => {
      const [kind, slug] = subject.split(":") as [StubCardFact["kind"], string]
      return bundleOfFacts(kind, slug, facts.filter((fact) => fact.kind === kind && fact.slug === slug))
    }),
    lookup: { slugOf: (id: string) => id, idOf: () => undefined }
  }
  return { loadRoster: async () => roster } as unknown as WorkspaceCards
}

export function stubCards(cards: StubCards = {}): WorkspaceCards {
  const roster: CardRoster = rosterOf(cards)
  return {
    loadRoster: async () => roster,
    findCard: async (_root: StoryUri, slug: string) =>
      roster.characters.find((card) => card.id === slug) ?? roster.backgrounds.find((card) => card.id === slug),
    exists: async (_root: StoryUri, kind: string, slug: string) =>
      (kind === "character" ? roster.characters : kind === "background" ? roster.backgrounds : roster.narrators).some(
        (card) => card.id === slug
      )
  } as unknown as WorkspaceCards
}

interface LegacyCardDirectories {
  readonly characterDirectory: unknown
  readonly backgroundDirectory: unknown
  readonly narratorDirectory?: unknown
  readonly joinPath: (base: never, ...segments: string[]) => unknown
}

type ReadableFileSystem = Pick<IFileSystem, "readFile" | "readDirectory">

async function readLegacyCards(
  fileSystem: ReadableFileSystem,
  directory: unknown,
  joinPath: LegacyCardDirectories["joinPath"]
): Promise<string[]> {
  if (directory === undefined) {
    return []
  }

  try {
    const entries = await fileSystem.readDirectory(directory as never)
    const texts: string[] = []
    for (const [name, entry] of entries) {
      if (entry.type !== "file" || !name.endsWith(".card") || name.startsWith(".")) {
        continue
      }
      try {
        texts.push(new TextDecoder().decode(await fileSystem.readFile(joinPath(directory as never, name) as never)))
      } catch {
        continue
      }
    }
    return texts
  } catch {
    return []
  }
}

function parseOrUndefined<T>(parse: () => T): T | undefined {
  try {
    return parse()
  } catch {
    return undefined
  }
}

export function legacyCards(fileSystem: ReadableFileSystem, directories: LegacyCardDirectories): WorkspaceCards {
  const loadRoster = async (): Promise<CardRoster> => {
    const cards: StoryboardCard[] = [
      ...(await readLegacyCards(fileSystem, directories.characterDirectory, directories.joinPath)),
      ...(await readLegacyCards(fileSystem, directories.backgroundDirectory, directories.joinPath))
    ].flatMap((text) => {
      const card = parseOrUndefined(() => parseCard(text))
      return card === undefined ? [] : [card]
    })
    const narrators: NarratorCard[] = (
      await readLegacyCards(fileSystem, directories.narratorDirectory, directories.joinPath)
    ).flatMap((text) => {
      const card = parseOrUndefined(() => parseNarratorCard(text))
      return card === undefined ? [] : [card]
    })

    return rosterOf({
      characters: cards.filter((card): card is CharacterCard => card.type === "character"),
      backgrounds: cards.filter((card): card is LocationBackgroundCard => isBackgroundCard(card)) as LocationBackgroundCard[],
      narrators
    })
  }

  return {
    loadRoster,
    findCard: async (_root: StoryUri, slug: string) => {
      const roster = await loadRoster()
      return roster.characters.find((card) => card.id === slug) ?? roster.backgrounds.find((card) => card.id === slug)
    },
    writeCard: async (root: StoryUri, card: StoryboardCard) => {
      const directory: string = card.type === "character" ? "character" : "background"
      const path: string = `${root.path}/${directory}/${card.id}.card`
      writeFile?.(path, serializeCard(card))
      return path
    }
  } as unknown as WorkspaceCards
}

export function legacyCardsUnder(fileSystem: ReadableFileSystem, workspaceRoot: StoryUri): WorkspaceCards {
  const paths = getStoryboardProjectPaths(workspaceRoot)
  return legacyCards(fileSystem, {
    characterDirectory: paths.characterDirectory,
    backgroundDirectory: paths.backgroundDirectory,
    narratorDirectory: paths.narratorDirectory,
    joinPath: (base: never, ...segments: string[]) => joinStoryPath(base, ...segments)
  })
}

const legacyCardPathPattern: RegExp = /\/(character|background)\/[^/]+\.card$/

export type WriteStubFile = (path: string, text: string) => void

export function cardsFromFiles(
  readFiles: () => Readonly<Record<string, string>>,
  writeFile?: WriteStubFile
): WorkspaceCards {
  const loadRoster = async (): Promise<CardRoster> => {
    const cards: StoryboardCard[] = Object.entries(readFiles()).flatMap(([path, text]) => {
      if (!legacyCardPathPattern.test(path)) {
        return []
      }
      const card = parseOrUndefined(() => parseCard(text))
      return card === undefined ? [] : [card]
    })

    return rosterOf({
      characters: cards.filter((card): card is CharacterCard => card.type === "character"),
      backgrounds: cards.filter((card): card is LocationBackgroundCard => isBackgroundCard(card)) as LocationBackgroundCard[]
    })
  }

  return {
    loadRoster,
    findCard: async (_root: StoryUri, slug: string) => {
      const roster = await loadRoster()
      return roster.characters.find((card) => card.id === slug) ?? roster.backgrounds.find((card) => card.id === slug)
    },
    writeCard: async (root: StoryUri, card: StoryboardCard) => {
      const directory: string = card.type === "character" ? "character" : "background"
      const path: string = `${root.path}/${directory}/${card.id}.card`
      writeFile?.(path, serializeCard(card))
      return path
    }
  } as unknown as WorkspaceCards
}
