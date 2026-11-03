import { createHash } from 'node:crypto';

import type { z } from 'zod';

import type { ReadWriteFileSystem } from '#model/format/files/readWriteFileSystem';
import type { ProjectSetting } from '#model/format/project';
import type { StoryUri } from '#model/format/storyUri';
import {
  interviewAxesFileSchema,
  interviewWorkingModelSchema,
  type InterviewAxesFile,
  type InterviewWorkingModel,
} from '#model/format/interview';

export function computeInterviewContractHash(setting: ProjectSetting | undefined): string {
  const digestSource: Readonly<Record<string, unknown>> = {
    genre: setting?.genre ?? '',
    audience: setting?.audience ?? '',
    concept: setting?.concept ?? '',
    description: setting?.description ?? '',
    tags: setting?.tags ?? [],
  };

  return `sha256:${createHash('sha256').update(JSON.stringify(digestSource)).digest('hex')}`;
}

export function parseInterviewAxesFile(text: string): InterviewAxesFile {
  return interviewAxesFileSchema.parse(JSON.parse(text));
}

export function serializeInterviewAxesFile(file: InterviewAxesFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export type InterviewWorkingModelParseErrorCode = 'invalid-json' | 'invalid-schema';

export class InterviewWorkingModelParseError extends Error {
  public constructor(
    public readonly code: InterviewWorkingModelParseErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'InterviewWorkingModelParseError';
  }
}

export function parseInterviewWorkingModel(text: string): InterviewWorkingModel {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    throw new InterviewWorkingModelParseError(
      'invalid-json',
      `인터뷰 작업 모델 JSON 을 읽을 수 없습니다. (${error instanceof Error ? error.message : String(error)})`,
      error,
    );
  }

  const parsed: z.ZodSafeParseResult<InterviewWorkingModel> =
    interviewWorkingModelSchema.safeParse(parsedJson);
  if (parsed.success) {
    return parsed.data;
  }

  const details: string = parsed.error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
  throw new InterviewWorkingModelParseError(
    'invalid-schema',
    `인터뷰 작업 모델 스키마가 올바르지 않습니다. (${details})`,
    parsed.error,
  );
}

export function serializeInterviewWorkingModel(model: InterviewWorkingModel): string {
  return `${JSON.stringify(model, null, 2)}\n`;
}

export async function readInterviewAxesFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
): Promise<InterviewAxesFile> {
  return parseInterviewAxesFile(new TextDecoder().decode(await fileSystem.readFile(uri)));
}

export async function writeInterviewAxesFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
  file: InterviewAxesFile,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeInterviewAxesFile(file)));
}

export async function readInterviewWorkingModelFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
): Promise<InterviewWorkingModel> {
  return parseInterviewWorkingModel(new TextDecoder().decode(await fileSystem.readFile(uri)));
}

export async function writeInterviewWorkingModelFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
  model: InterviewWorkingModel,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeInterviewWorkingModel(model)));
}
