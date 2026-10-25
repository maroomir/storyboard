import type { ReadWriteFileSystem } from '#model/format/files/readWriteFileSystem';
import type { StoryUri } from '#model/format/storyUri';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const unknownDialogueSpeaker: string = 'unknown';

export interface SceneDialogueTurn {
  readonly index: number;
  readonly speaker: string;
  readonly text: string;
}

export interface SceneDialogueRecord {
  readonly sceneStem: string;
  readonly bodyHash: string;
  readonly turns: readonly SceneDialogueTurn[];
}

const sceneDialogueTurnSchema: z.ZodType<SceneDialogueTurn> = z.object({
  index: z.number().int().min(1),
  speaker: z.string().min(1),
  text: z.string().min(1),
});

const sceneDialogueRecordSchema: z.ZodType<SceneDialogueRecord> = z.object({
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
  fileSystem: ReadWriteFileSystem,
): Promise<SceneDialogueRecord> {
  const bytes: Uint8Array<ArrayBufferLike> = await fileSystem.readFile(uri);
  return parseSceneDialogue(new TextDecoder().decode(bytes));
}

export async function writeSceneDialogueFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
  record: SceneDialogueRecord,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeSceneDialogue(record)));
}

export interface VoiceSeeds {
  readonly characters: Readonly<Record<string, readonly string[]>>;
}

interface VoiceSeedsPayload {
  characters: Record<string, string[]>;
}

const voiceSeedsSchema: z.ZodType<VoiceSeedsPayload> = z.object({
  characters: z.record(z.string().min(1), z.array(z.string().min(1))),
});

export function parseVoiceSeeds(raw: string): VoiceSeeds {
  return voiceSeedsSchema.parse(JSON.parse(raw));
}

export function serializeVoiceSeeds(seeds: VoiceSeeds): string {
  return `${JSON.stringify(seeds, null, 2)}\n`;
}

export function mergeVoiceSeeds(
  existing: VoiceSeeds,
  added: Readonly<Record<string, readonly string[]>>,
): VoiceSeeds {
  const characters: Record<string, string[]> = Object.fromEntries(
    Object.entries(existing.characters).map(([id, lines]) => [id, [...lines]]),
  );

  for (const [id, lines] of Object.entries(added)) {
    const kept: string[] = characters[id] ?? [];
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
  fileSystem: ReadWriteFileSystem,
): Promise<VoiceSeeds> {
  return parseVoiceSeeds(new TextDecoder().decode(await fileSystem.readFile(uri)));
}

export async function writeVoiceSeedsFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
  seeds: VoiceSeeds,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeVoiceSeeds(seeds)));
}
