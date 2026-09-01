import { randomUUID } from 'node:crypto';
import type { StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '../ports/fileSystem';
import { z } from 'zod';

import { pointOfViews, projectFormats, storyboardProjectVersion } from '@storyboard/story-format';
import type { ProjectFormat, StoryboardProject } from '@storyboard/story-format';

const projectEditorSchema = z.object({
  scenePrefixDigits: z.number().int().positive(),
  trackDraft: z.boolean().optional(),
});

const craftContractOverrideSchema = z.object({
  banTelling: z.boolean().optional(),
  motifRepeatLimit: z.number().int().positive().optional(),
  stockGestureBlacklist: z.array(z.string()).optional(),
  requireCharacterInterior: z.boolean().optional(),
  actionClarity: z.boolean().optional(),
  modulateDensity: z.boolean().optional(),
  sceneLengthMultiplier: z.number().nonnegative().optional(),
});

const projectSettingSchema = z.object({
  genre: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
  concept: z.string().trim().min(1).optional(),
  tags: z.array(z.string()).default([]),
  description: z.string().optional(),
  audience: z.string().trim().min(1).optional(),
  targetWordCount: z.number().int().positive().optional(),
  pov: z.enum(pointOfViews).optional(),
  prohibitions: z.array(z.string()).default([]),
  styleConstraints: z.array(z.string()).default([]),
  qualityCriteria: z.array(z.string()).default([]),
  craftContract: craftContractOverrideSchema.optional(),
});

const storyboardProjectSchema = z.object({
  version: z.literal(storyboardProjectVersion),
  id: z.string().min(1),
  name: z.string().trim().min(1),
  format: z.enum(projectFormats),
  language: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  editor: projectEditorSchema,
  setting: projectSettingSchema.optional(),
});

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
