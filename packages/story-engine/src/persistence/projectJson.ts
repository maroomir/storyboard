import { randomUUID } from 'node:crypto';
import type { StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { storyboardProjectSchema, storyboardProjectVersion } from '@storyboard/story-format';
import type { ProjectFormat, StoryboardProject } from '@storyboard/story-format';

export interface CreateProjectJsonInput {
  readonly name: string;
  readonly format?: ProjectFormat;
  readonly language?: string;
  readonly scenePrefixDigits?: number;
}

export function createDefaultProjectJson(input: CreateProjectJsonInput): StoryboardProject {
  return {
    version: storyboardProjectVersion,
    id: randomUUID(),
    name: input.name.trim(),
    format: input.format ?? 'novel',
    language: input.language ?? 'ko',
    createdAt: new Date().toISOString(),
    editor: {
      scenePrefixDigits: input.scenePrefixDigits ?? 2,
    },
  };
}

export function parseProjectJson(rawProjectJson: string): StoryboardProject {
  return storyboardProjectSchema.parse(JSON.parse(rawProjectJson));
}

export function serializeProjectJson(project: StoryboardProject): string {
  const parsedProject = storyboardProjectSchema.parse(project);
  return `${JSON.stringify(parsedProject, null, 2)}\n`;
}

export async function readProjectJson(fs: IFileSystem, uri: StoryUri): Promise<StoryboardProject> {
  const bytes = await fs.readFile(uri);
  return parseProjectJson(new TextDecoder().decode(bytes));
}

export async function writeProjectJson(
  fs: IFileSystem,
  uri: StoryUri,
  project: StoryboardProject,
): Promise<void> {
  await fs.writeFile(uri, new TextEncoder().encode(serializeProjectJson(project)));
}
