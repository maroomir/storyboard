import * as vscode from 'vscode';

import { StoryboardApplication } from './bootstrap/storyboardApplication';

let application: StoryboardApplication | undefined;

export function activate(context: vscode.ExtensionContext): void {
  application = new StoryboardApplication();
  application.initialize(context);
}

export function deactivate(): void {
  application?.dispose();
  application = undefined;
}
