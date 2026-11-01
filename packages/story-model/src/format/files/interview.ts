import { createHash } from 'node:crypto';

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

export function parseInterviewWorkingModel(text: string): InterviewWorkingModel {
  return interviewWorkingModelSchema.parse(JSON.parse(text));
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
