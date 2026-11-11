import * as vscode from 'vscode';

import { parseDraft, parseSceneStem, scenePath } from '@storyboard/story-model';
import type { Draft, SceneFileNameParts } from '@storyboard/story-model';

export function parseDraftSceneParts(rawDraftText: string): SceneFileNameParts | undefined {
  try {
    const draft: Draft = parseDraft(rawDraftText);
    return parseSceneStem(draft.sceneStem);
  } catch {
    return undefined;
  }
}

export function deriveSceneUri(
  workspaceFolder: vscode.WorkspaceFolder,
  documentText: string,
): vscode.Uri | undefined {
  const parts: SceneFileNameParts | undefined = parseDraftSceneParts(documentText);

  if (!parts) {
    return undefined;
  }

  return scenePath(workspaceFolder.uri, parts.stem);
}
