import yaml from 'js-yaml';
import { z, type ZodError } from 'zod';

import { elementIdSchema, headerTextSchema } from '#model/element/elementId';
import { elementHeaderSchemas, type ElementHeader } from '#model/element/elementHeader';
import type { ElementKind } from '#model/element/elementKind';
import { beatSchema, type Beat } from '#model/element/scene';
import {
  statementListSchema,
  storyStateStatementSchema,
  type Statement,
  type StoryStateStatement,
} from '#model/element/statement';

export type BundleFileErrorCode = 'invalid-yaml' | 'invalid-shape' | 'missing-file';

export class BundleFileError extends Error {
  public constructor(
    public readonly code: BundleFileErrorCode,
    public readonly fileName: string,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BundleFileError';
  }
}

export interface VoiceSampleLine {
  readonly text: string;
  readonly source: string;
}

export interface ElementMemory {
  readonly throughScene?: string;
  readonly cardHash?: string;
  readonly persona?: string;
  readonly voiceSample?: readonly VoiceSampleLine[];
}

export interface SceneStoryState {
  readonly inputHash?: string;
  readonly stale?: true;
  readonly statements: readonly StoryStateStatement[];
}

const contentHashSchema: z.ZodType<string> = z.string().regex(/^sha256:[0-9a-f]+$/, {
  message: '해시는 sha256:<16진수> 꼴이어야 합니다.',
});

const voiceSampleSourceSchema: z.ZodType<string> = z.string().regex(/^(draft|note):\S.*$/, {
  message: '대사 견본의 출처는 draft:<씬> 이나 note:<위치> 여야 합니다.',
});

const voiceSampleLineSchema: z.ZodType<VoiceSampleLine> = z
  .object({ text: headerTextSchema, source: voiceSampleSourceSchema })
  .strict();

export const elementMemorySchema: z.ZodType<ElementMemory> = z
  .object({
    throughScene: elementIdSchema.optional(),
    cardHash: contentHashSchema.optional(),
    persona: headerTextSchema.optional(),
    voiceSample: z.array(voiceSampleLineSchema).readonly().optional(),
  })
  .strict();

export const sceneStoryStateSchema: z.ZodType<SceneStoryState> = z
  .object({
    inputHash: contentHashSchema.optional(),
    stale: z.literal(true).optional(),
    statements: z.array(storyStateStatementSchema).readonly(),
  })
  .strict();

const beatListSchema: z.ZodType<readonly Beat[]> = z.array(beatSchema).readonly();

const emptyListDocument: unknown[] = [];

const listItemsInFlowLevel: number = 1;

const nestedValuesInFlowLevel: number = 2;

function describeShapeError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(맨 위)'}: ${issue.message}`)
    .join('; ');
}

function loadYamlDocument(text: string, fileName: string): unknown {
  try {
    return yaml.load(text);
  } catch (error) {
    throw new BundleFileError(
      'invalid-yaml',
      fileName,
      `${fileName} 의 YAML 을 읽을 수 없습니다.`,
      error,
    );
  }
}

function parseYamlDocument<T>(
  text: string,
  fileName: string,
  schema: z.ZodType<T>,
  emptyDocument?: unknown,
): T {
  const document: unknown = loadYamlDocument(text, fileName) ?? emptyDocument;
  const result: z.ZodSafeParseResult<T> = schema.safeParse(document);
  if (!result.success) {
    throw new BundleFileError(
      'invalid-shape',
      fileName,
      `${fileName} 의 형식이 올바르지 않습니다. ${describeShapeError(result.error)}`,
      result.error,
    );
  }

  return result.data;
}

function dumpYaml(document: unknown, flowLevel: number): string {
  return yaml.dump(document, { lineWidth: -1, noRefs: true, sortKeys: false, flowLevel });
}

export function parseElementCard(kind: ElementKind, text: string, fileName: string): ElementHeader {
  return parseYamlDocument(text, fileName, elementHeaderSchemas[kind]);
}

export function serializeElementCard(header: ElementHeader): string {
  return dumpYaml(elementHeaderSchemas[header.kind].parse(header), listItemsInFlowLevel);
}

export function parseStatementsFile(text: string, fileName: string): readonly Statement[] {
  return parseYamlDocument(text, fileName, statementListSchema, emptyListDocument);
}

export function serializeStatementsFile(statements: readonly Statement[]): string {
  return dumpYaml(statementListSchema.parse(statements), listItemsInFlowLevel);
}

export function parseBeatsFile(text: string, fileName: string): readonly Beat[] {
  return parseYamlDocument(text, fileName, beatListSchema, emptyListDocument);
}

export function serializeBeatsFile(beats: readonly Beat[]): string {
  return dumpYaml(beatListSchema.parse(beats), nestedValuesInFlowLevel);
}

export function parseSceneStateFile(text: string, fileName: string): SceneStoryState {
  return parseYamlDocument(text, fileName, sceneStoryStateSchema);
}

export function serializeSceneStateFile(state: SceneStoryState): string {
  return dumpYaml(sceneStoryStateSchema.parse(state), nestedValuesInFlowLevel);
}

export function parseElementMemory(text: string, fileName: string): ElementMemory {
  return parseYamlDocument(text, fileName, elementMemorySchema, {});
}

export function serializeElementMemory(memory: ElementMemory): string {
  return dumpYaml(elementMemorySchema.parse(memory), nestedValuesInFlowLevel);
}
