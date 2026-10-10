import type { StoryUri } from '#model/format/storyUri';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const unknownDialogueSpeaker = 'unknown';

export interface SceneDialogueTurn {
  readonly index: number;
  readonly speaker: string;
  readonly text: string;
}

export interface SceneDialogueRecord {
  readonly sceneStem: string;
  // 이 기록이 기술하는 초안 본문의 해시. 읽는 쪽이 초안과 대조해 낡은 기록을 걸러낸다.
  readonly bodyHash: string;
  readonly turns: readonly SceneDialogueTurn[];
}

export interface SceneDialogueFileSystem {
  readonly readFile: (uri: StoryUri) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: StoryUri, content: Uint8Array) => PromiseLike<void>;
}

const sceneDialogueTurnSchema = z.object({
  index: z.number().int().min(1),
  speaker: z.string().min(1),
  text: z.string().min(1),
});

const sceneDialogueRecordSchema = z.object({
  sceneStem: z.string().min(1),
  bodyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  turns: z.array(sceneDialogueTurnSchema),
});

export function serializeSceneDialogue(record: SceneDialogueRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function parseSceneDialogue(rawDialogue: string): SceneDialogueRecord {
  return sceneDialogueRecordSchema.parse(JSON.parse(rawDialogue));
}

export function computeDraftBodyHash(body: string): string {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

export async function readSceneDialogueFile(
  uri: StoryUri,
  fileSystem: SceneDialogueFileSystem,
): Promise<SceneDialogueRecord> {
  const bytes = await fileSystem.readFile(uri);
  return parseSceneDialogue(new TextDecoder().decode(bytes));
}

export async function writeSceneDialogueFile(
  uri: StoryUri,
  fileSystem: SceneDialogueFileSystem,
  record: SceneDialogueRecord,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeSceneDialogue(record)));
}

// NOTE: 첫 씬은 앞선 초안이 없어 말투 표본이 0개였다(#105-14). 노트에 따옴표로 적힌 인물의 대사를
// 카드 id 별로 모아 두고, 작품의 대사 코퍼스가 한도를 못 채울 때 그 자리를 채운다. 카드 voice 는
// 말투의 설명이고 이 파일은 그 인물이 실제로 한 말이라, 둘을 섞지 않는다.
export interface VoiceSeeds {
  readonly characters: Readonly<Record<string, readonly string[]>>;
}

const voiceSeedsSchema = z.object({
  characters: z.record(z.string().min(1), z.array(z.string().min(1))),
});

export function parseVoiceSeeds(raw: string): VoiceSeeds {
  return voiceSeedsSchema.parse(JSON.parse(raw));
}

export function serializeVoiceSeeds(seeds: VoiceSeeds): string {
  return `${JSON.stringify(seeds, null, 2)}\n`;
}

// 이미 있는 줄은 그대로 두고 새 줄만 뒤에 붙인다. 같은 노트를 다시 흡수해도 늘지 않는다.
export function mergeVoiceSeeds(
  existing: VoiceSeeds,
  added: Readonly<Record<string, readonly string[]>>,
): VoiceSeeds {
  const characters: Record<string, string[]> = Object.fromEntries(
    Object.entries(existing.characters).map(([id, lines]) => [id, [...lines]]),
  );

  for (const [id, lines] of Object.entries(added)) {
    const kept = characters[id] ?? [];
    for (const line of lines.map((value) => value.trim()).filter((value) => value.length > 0)) {
      if (!kept.includes(line)) {
        kept.push(line);
      }
    }
    if (kept.length > 0) {
      characters[id] = kept;
    }
  }

  return { characters };
}

export async function readVoiceSeedsFile(
  uri: StoryUri,
  fileSystem: SceneDialogueFileSystem,
): Promise<VoiceSeeds> {
  return parseVoiceSeeds(new TextDecoder().decode(await fileSystem.readFile(uri)));
}

export async function writeVoiceSeedsFile(
  uri: StoryUri,
  fileSystem: SceneDialogueFileSystem,
  seeds: VoiceSeeds,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeVoiceSeeds(seeds)));
}
