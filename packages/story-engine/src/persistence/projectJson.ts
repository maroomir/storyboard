import { randomUUID } from 'node:crypto';
import type { ProjectFormat, StoryboardProject } from '@storyboard/story-model';
import {
  assertSupportedProjectVersion,
  storyboardProjectSchema,
  storyboardProjectVersion,
} from '@storyboard/story-model';

export interface CreateProjectJsonInput {
  readonly name: string;
  readonly format?: ProjectFormat;
  readonly language?: string;
}

export function createDefaultProjectJson(input: CreateProjectJsonInput): StoryboardProject {
  return {
    version: storyboardProjectVersion,
    id: randomUUID(),
    name: input.name.trim(),
    format: input.format ?? 'novel',
    language: input.language ?? 'ko',
    createdAt: new Date().toISOString(),
    editor: {},
  };
}

export function parseProjectJson(rawProjectJson: string): StoryboardProject {
  const rawProject: unknown = JSON.parse(rawProjectJson);
  assertSupportedProjectVersion(rawProject);

  return storyboardProjectSchema.parse(rawProject);
}

export function serializeProjectJson(project: StoryboardProject): string {
  const parsedProject: StoryboardProject = storyboardProjectSchema.parse(project);
  return `${JSON.stringify(parsedProject, null, 2)}\n`;
}
