import { z } from 'zod';

export type SidebarRunnableCommand =
  | 'storyboard.init'
  | 'storyboard.settings.open'
  | 'storyboard.outline.generate'
  | 'storyboard.scene.create'
  | 'storyboard.scene.generateAllSeeds'
  | 'storyboard.character.create'
  | 'storyboard.background.create';

export const sidebarRunnableCommands: readonly [
  SidebarRunnableCommand,
  ...SidebarRunnableCommand[],
] = [
  'storyboard.init',
  'storyboard.settings.open',
  'storyboard.outline.generate',
  'storyboard.scene.create',
  'storyboard.scene.generateAllSeeds',
  'storyboard.character.create',
  'storyboard.background.create',
];

export interface WorkspaceRunCommandRequestPayload {
  command: SidebarRunnableCommand;
}

export const workspaceRunCommandRequestPayloadSchema: z.ZodType<WorkspaceRunCommandRequestPayload> =
  z.object({
    command: z.enum(sidebarRunnableCommands),
  });

export interface WorkspaceRunCommandResponsePayload {
  [key: string]: never;
}

export const workspaceRunCommandResponsePayloadSchema: z.ZodType<WorkspaceRunCommandResponsePayload> =
  z.object({});
