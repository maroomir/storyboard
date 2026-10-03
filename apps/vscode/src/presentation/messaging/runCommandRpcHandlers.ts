import * as vscode from 'vscode';

import type { StoryboardResponsePayload } from '@storyboard/story-model';

import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';

// The payload schema already restricts `command` to the sidebar allowlist, so by the time this
// runs the id is one the extension contributes itself.
export function createRunCommandRpcHandlers(): StoryboardRpcHandlers {
  return {
    'workspace.runCommand': async (
      payload,
    ): Promise<StoryboardResponsePayload<'workspace.runCommand'>> => {
      await vscode.commands.executeCommand(payload.command);
      return {};
    },
  };
}
