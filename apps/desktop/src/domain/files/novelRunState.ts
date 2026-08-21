import { z } from 'zod';

const novelRunStateVersion = '1.0.0';

const novelRunModes = ['auto', 'outline-approval', 'chapter-approval'] as const;
export type NovelRunMode = (typeof novelRunModes)[number];

export const novelStageNames = [
  'outline',
  'seeds',
  'chapters',
  'assemble',
  'review',
  'summaries',
] as const;
export type NovelStageName = (typeof novelStageNames)[number];

const novelRunStatuses = ['running', 'paused', 'done', 'failed'] as const;
type NovelRunStatus = (typeof novelRunStatuses)[number];

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

export interface NovelRunStateFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>;
}

const novelRunStateSchema = z.object({
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
  uri: unknown,
  fileSystem: NovelRunStateFileSystem,
): Promise<NovelRunState> {
  const bytes = await fileSystem.readFile(uri);
  return parseNovelRunState(new TextDecoder().decode(bytes));
}

export async function writeNovelRunState(
  uri: unknown,
  fileSystem: NovelRunStateFileSystem,
  state: NovelRunState,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeNovelRunState(state)));
}
