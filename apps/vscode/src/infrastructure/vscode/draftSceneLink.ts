import * as vscode from 'vscode';

import { parseDraft, parseSceneStem, sceneFilePath } from '@storyboard/story-model';
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

  return sceneFilePath(workspaceFolder.uri, parts.orderText, parts.slug);
}
