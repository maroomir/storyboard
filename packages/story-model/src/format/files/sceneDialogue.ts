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
