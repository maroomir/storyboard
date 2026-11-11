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

export interface VoiceSeeds {
  readonly characters: Readonly<Record<string, readonly string[]>>;
}

