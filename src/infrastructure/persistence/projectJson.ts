import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import {
  pointOfViews,
  projectFormats,
  type ProjectFormat,
  type StoryboardProject,
  storyboardProjectVersion,
} from '../../shared/project';

const projectEditorSchema = z.object({
  scenePrefixDigits: z.number().int().positive(),
  trackDraft: z.boolean().optional(),
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
});

export const storyboardProjectSchema = z.object({
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
    id: uuidv4(),
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

export async function readProjectJson(uri: vscode.Uri): Promise<StoryboardProject> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return parseProjectJson(new TextDecoder().decode(bytes));
}

export async function writeProjectJson(uri: vscode.Uri, project: StoryboardProject): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(serializeProjectJson(project)));
}
