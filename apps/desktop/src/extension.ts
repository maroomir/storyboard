import * as vscode from 'vscode';

import { StoryboardApplication } from './bootstrap/storyboardApplication';

let application: StoryboardApplication | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  application = new StoryboardApplication();
  await application.initialize(context);
}

export function deactivate(): void {
  application?.dispose();
  application = undefined;
}
