import {
  computeCardHash,
  parseBible,
  parseBackgroundMemory,
  parseCard,
  parseChapterPlan,
  parsePersonaMemory,
  parseScene,
  serializeBible,
  serializeBackgroundMemory,
  serializeCard,
  serializeChapterPlan,
  serializeDraft,
  serializePersonaMemory,
  serializeSynopsisMarkdown,
  type BackgroundCard,
  type BackgroundMemoryRecord,
  type CharacterCard,
  type ChapterPlan,
  type Draft,
  type OutlineSynopsis,
  type PersonaMemoryRecord,
  type SceneFile,
  type StoryBible,
  type StoryboardCard,
} from '@seedkernel/wasm';

// NOTE: The codecs live in @seedkernel/wasm and know nothing about storage; these adapters pair
// them with a workspace FileSystem port. `uri` stays opaque so the VSCode host can pass a
// vscode.Uri while headless callers pass a path.

export interface ReadOnlyFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>;
}

export interface ReadWriteFileSystem extends ReadOnlyFileSystem {
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>;
}

export type CardFileSystem = ReadWriteFileSystem;
export type SceneFileSystem = ReadOnlyFileSystem;
export type DraftFileSystem = ReadWriteFileSystem;
export type BibleFileSystem = ReadWriteFileSystem;
export type OutlineFileSystem = ReadWriteFileSystem;
export type CardMemoryFileSystem = ReadWriteFileSystem;

async function readText(uri: unknown, fileSystem: ReadOnlyFileSystem): Promise<string> {
  return new TextDecoder().decode(await fileSystem.readFile(uri));
}

async function writeText(
  uri: unknown,
  fileSystem: ReadWriteFileSystem,
  text: string,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(text));
}

export async function readCardFile(
  uri: unknown,
  fileSystem: CardFileSystem,
): Promise<StoryboardCard> {
  return parseCard(await readText(uri, fileSystem));
}

export async function writeCardFile(
  uri: unknown,
  fileSystem: CardFileSystem,
  card: StoryboardCard,
): Promise<void> {
  await writeText(uri, fileSystem, serializeCard(card));
}

export async function readSceneFile(
  uri: unknown,
  fileSystem: SceneFileSystem,
  fileName: string,
): Promise<SceneFile> {
  return parseScene(await readText(uri, fileSystem), fileName);
}

export async function readDraftFile(uri: unknown, fileSystem: DraftFileSystem): Promise<string> {
  return readText(uri, fileSystem);
}

export async function writeDraftFile(
  uri: unknown,
  fileSystem: DraftFileSystem,
  draft: Draft,
): Promise<void> {
  await writeText(uri, fileSystem, serializeDraft(draft));
}

export async function readBibleFile(
  uri: unknown,
  fileSystem: BibleFileSystem,
): Promise<StoryBible> {
  return parseBible(await readText(uri, fileSystem));
}

export async function writeBibleFile(
  uri: unknown,
  fileSystem: BibleFileSystem,
  bible: StoryBible,
): Promise<void> {
  await writeText(uri, fileSystem, serializeBible(bible));
}

export async function readChapterPlanFile(
  uri: unknown,
  fileSystem: OutlineFileSystem,
): Promise<ChapterPlan> {
  return parseChapterPlan(await readText(uri, fileSystem));
}

export async function writeChapterPlanFile(
  uri: unknown,
  fileSystem: OutlineFileSystem,
  plan: ChapterPlan,
): Promise<void> {
  await writeText(uri, fileSystem, serializeChapterPlan(plan));
}

export async function writeSynopsisFile(
  uri: unknown,
  fileSystem: OutlineFileSystem,
  synopsis: OutlineSynopsis,
): Promise<void> {
  await writeText(uri, fileSystem, serializeSynopsisMarkdown(synopsis));
}

// The engine picks the digest by card type; these keep the call sites' intent explicit.
export function computePersonaCardHash(card: CharacterCard): string {
  return computeCardHash(card);
}

export function computeBackgroundCardHash(card: BackgroundCard): string {
  return computeCardHash(card);
}

export async function readPersonaMemoryFile(
  uri: unknown,
  fileSystem: CardMemoryFileSystem,
): Promise<PersonaMemoryRecord> {
  return parsePersonaMemory(await readText(uri, fileSystem));
}

export async function writePersonaMemoryFile(
  uri: unknown,
  fileSystem: CardMemoryFileSystem,
  record: PersonaMemoryRecord,
): Promise<void> {
  await writeText(uri, fileSystem, serializePersonaMemory(record));
}

export async function readBackgroundMemoryFile(
  uri: unknown,
  fileSystem: CardMemoryFileSystem,
): Promise<BackgroundMemoryRecord> {
  return parseBackgroundMemory(await readText(uri, fileSystem));
}

export async function writeBackgroundMemoryFile(
  uri: unknown,
  fileSystem: CardMemoryFileSystem,
  record: BackgroundMemoryRecord,
): Promise<void> {
  await writeText(uri, fileSystem, serializeBackgroundMemory(record));
}
