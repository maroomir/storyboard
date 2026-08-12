import * as vscode from 'vscode';

import { parseDraft, parseSceneStem } from '@seedkernel/wasm';
import type { SceneFileNameParts } from '@seedkernel/wasm';
import { sceneFilePath } from './pathConventions';

export function parseDraftSceneParts(rawDraftText: string): SceneFileNameParts | undefined {
  try {
    const draft = parseDraft(rawDraftText);
    return parseSceneStem(draft.sceneStem);
  } catch {
    return undefined;
  }
}

export function deriveSceneUri(
  workspaceFolder: vscode.WorkspaceFolder,
  documentText: string,
): vscode.Uri | undefined {
  const parts = parseDraftSceneParts(documentText);

  if (!parts) {
    return undefined;
  }

  return sceneFilePath(workspaceFolder.uri, parts.orderText, parts.slug);
}
