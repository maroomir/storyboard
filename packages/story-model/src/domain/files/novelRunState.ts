import type { StoryUri } from '#model/format/storyUri';
import { z } from 'zod';

import {
  novelRunModes,
  novelStageNames,
  type NovelRunMode,
  type NovelStageName,
} from '#model/shared/novelRun';
import type { ReadWriteFileSystem } from '#model/format/files/readWriteFileSystem';

const novelRunStateVersion: string = '1.0.0';

export { novelStageNames, type NovelRunMode, type NovelStageName };

type NovelRunStatus = 'running' | 'paused' | 'done' | 'failed';

const novelRunStatuses: readonly [NovelRunStatus, ...NovelRunStatus[]] = [
  'running',
  'paused',
  'done',
  'failed',
];

export interface NovelRunState {
  readonly version: typeof novelRunStateVersion;
  readonly runId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly runMode: NovelRunMode;
  readonly status: NovelRunStatus;
  readonly completedStages: NovelStageName[];
  readonly nextChapterIndex: number;
  readonly lastError?: string;
}

const novelRunStateSchema: z.ZodType<NovelRunState> = z.object({
  version: z.literal(novelRunStateVersion),
  runId: z.string().trim().min(1),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  runMode: z.enum(novelRunModes),
  status: z.enum(novelRunStatuses),
  completedStages: z.array(z.enum(novelStageNames)).default([]),
  nextChapterIndex: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
});

export function parseNovelRunState(rawState: string): NovelRunState {
  return novelRunStateSchema.parse(JSON.parse(rawState));
}

export function serializeNovelRunState(state: NovelRunState): string {
  return `${JSON.stringify(novelRunStateSchema.parse(state), null, 2)}\n`;
}

export async function readNovelRunState(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
): Promise<NovelRunState> {
  const bytes: Uint8Array<ArrayBufferLike> = await fileSystem.readFile(uri);
  return parseNovelRunState(new TextDecoder().decode(bytes));
}

export async function writeNovelRunState(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
  state: NovelRunState,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeNovelRunState(state)));
}
