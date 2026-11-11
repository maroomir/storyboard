import yaml from 'js-yaml';
import { z, ZodError } from 'zod';

import { elementIdSchema, elementSlugSchema, headerTextSchema } from '#model/element/elementId';
import { maxSceneNumber } from '#model/format/bundlePaths';

export interface StructureThread {
  readonly id: string;
  readonly title: string;
  readonly wraps?: readonly string[];
}

export interface StructureSceneEntry {
  readonly scene: string;
  readonly thread: string;
  readonly narrator?: string;
  readonly storyTime?: number;
}

export interface StoryStructure {
  readonly threads: readonly StructureThread[];
  readonly scenes: readonly StructureSceneEntry[];
}

export type StructureParseErrorCode = 'invalid-yaml' | 'invalid-shape';

export class StructureParseError extends Error {
  public constructor(
    public readonly code: StructureParseErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StructureParseError';
  }
}

const structureThreadSchema: z.ZodType<StructureThread> = z
  .object({
    id: elementSlugSchema,
    title: headerTextSchema,
    wraps: z.array(elementSlugSchema).readonly().optional(),
  })
  .strict();

const structureSceneEntrySchema: z.ZodType<StructureSceneEntry> = z
  .object({
    scene: elementIdSchema,
    thread: elementSlugSchema,
    narrator: elementIdSchema.optional(),
    storyTime: z.number().int().optional(),
  })
  .strict();

function findDuplicate(values: readonly string[]): string | undefined {
  return values.find((value, index) => values.indexOf(value) !== index);
}

function listStructureIssues(structure: StoryStructure): readonly string[] {
  const threadIds: readonly string[] = structure.threads.map((thread) => thread.id);
  const duplicateThread: string | undefined = findDuplicate(threadIds);
  const duplicateScene: string | undefined = findDuplicate(
    structure.scenes.map((entry) => entry.scene),
  );
  const unknownSceneThreads: readonly string[] = structure.scenes
    .map((entry) => entry.thread)
    .filter((threadId) => !threadIds.includes(threadId));
  const unknownWrappedThreads: readonly string[] = structure.threads
    .flatMap((thread) => thread.wraps ?? [])
    .filter((threadId) => !threadIds.includes(threadId));

  return [
    duplicateThread === undefined ? undefined : `줄기 id 가 두 번 나옵니다: ${duplicateThread}`,
    duplicateScene === undefined ? undefined : `씬이 두 번 나옵니다: ${duplicateScene}`,
    ...unknownSceneThreads.map((threadId) => `threads 에 없는 줄기입니다: ${threadId}`),
    ...unknownWrappedThreads.map((threadId) => `wraps 가 없는 줄기를 가리킵니다: ${threadId}`),
    structure.scenes.length > maxSceneNumber ? `씬은 ${maxSceneNumber} 개까지입니다.` : undefined,
  ].filter((issue): issue is string => issue !== undefined);
}

export const storyStructureSchema: z.ZodType<StoryStructure> = z
  .object({
    threads: z.array(structureThreadSchema).min(1).readonly(),
    scenes: z.array(structureSceneEntrySchema).readonly(),
  })
  .strict()
  .superRefine((structure, context) => {
    for (const message of listStructureIssues(structure)) {
      context.addIssue({ code: 'custom', message });
    }
  });

function describeShapeError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(맨 위)'}: ${issue.message}`)
    .join('; ');
}

function loadStructureYaml(text: string, fileName: string): unknown {
  try {
    return yaml.load(text);
  } catch (error) {
    throw new StructureParseError(
      'invalid-yaml',
      `${fileName} 의 YAML 을 읽을 수 없습니다.`,
      error,
    );
  }
}

export function parseStoryStructure(text: string, fileName: string): StoryStructure {
  const result: z.ZodSafeParseResult<StoryStructure> = storyStructureSchema.safeParse(
    loadStructureYaml(text, fileName),
  );
  if (!result.success) {
    throw new StructureParseError(
      'invalid-shape',
      `${fileName} 의 형식이 올바르지 않습니다. ${describeShapeError(result.error)}`,
      result.error,
    );
  }

  return result.data;
}

function orderThread(thread: StructureThread): StructureThread {
  return {
    id: thread.id,
    title: thread.title,
    ...(thread.wraps === undefined ? {} : { wraps: thread.wraps }),
  };
}

function orderSceneEntry(entry: StructureSceneEntry): StructureSceneEntry {
  return {
    scene: entry.scene,
    thread: entry.thread,
    ...(entry.narrator === undefined ? {} : { narrator: entry.narrator }),
    ...(entry.storyTime === undefined ? {} : { storyTime: entry.storyTime }),
  };
}

export function serializeStoryStructure(structure: StoryStructure): string {
  const validStructure: StoryStructure = storyStructureSchema.parse(structure);

  return yaml.dump(
    {
      threads: validStructure.threads.map(orderThread),
      scenes: validStructure.scenes.map(orderSceneEntry),
    },
    { lineWidth: -1, noRefs: true, sortKeys: false },
  );
}

export function listThreadScenes(
  structure: StoryStructure,
  threadId: string,
): readonly StructureSceneEntry[] {
  return structure.scenes.filter((entry) => entry.thread === threadId);
}
