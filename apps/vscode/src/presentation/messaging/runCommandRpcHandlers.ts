import * as vscode from 'vscode';

import type { StoryboardResponsePayload } from '@storyboard/story-model';

import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';

export class RunCommandRpc {
  public handlers(): StoryboardRpcHandlers {
    return {
      'workspace.runCommand': async (
        payload,
      ): Promise<StoryboardResponsePayload<'workspace.runCommand'>> => {
        await vscode.commands.executeCommand(payload.command);
        return {};
      },
    };
  }
}
