import { z } from 'zod';

// SECURITY: a webview may only trigger the commands named here — an open-ended command id from
// the browser side would let sidebar HTML run anything the extension host can.
export const sidebarRunnableCommands = [
  'storyboard.init',
  'storyboard.settings.open',
  'storyboard.outline.generate',
  'storyboard.scene.create',
  'storyboard.scene.generateAllSeeds',
  'storyboard.character.create',
  'storyboard.background.create',
] as const;

export type SidebarRunnableCommand = (typeof sidebarRunnableCommands)[number];

export const workspaceRunCommandRequestPayloadSchema = z.object({
  command: z.enum(sidebarRunnableCommands),
});

export const workspaceRunCommandResponsePayloadSchema = z.object({});
