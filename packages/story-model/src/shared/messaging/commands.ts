import { z } from 'zod';

// SECURITY: a webview may only trigger the commands named here — an open-ended command id from
// the browser side would let sidebar HTML run anything the extension host can.
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
