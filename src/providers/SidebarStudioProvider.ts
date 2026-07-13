import * as vscode from 'vscode';

import { deriveSceneUri } from '../infrastructure/vscode/draftSceneLink';
import {
  draftPath,
  isDirectSceneTextFile,
  isDraftMarkdownFile,
} from '../infrastructure/vscode/pathConventions';
import { hasStoryboardProject, uriExists } from '../infrastructure/vscode/workspace';
import { createWebviewBridge, type StoryboardRpcHandlers } from '../messaging/bridge';
import { parseSceneFileName } from '../shared/scene';
import type { StoryboardResponsePayload, StudioAction, StudioTarget } from '../shared/messaging';
import { planStudioAction, type StudioArgSlot } from './studioActions';
import { createWebviewHtml, getWebviewDistRoot } from './webviewHtml';

const studioSidebarViewId = 'storyboard.studioView';
const noneTarget: StudioTarget = { kind: 'none', hasSelection: false };

interface SidebarStudioInitialData {
  readonly title: string;
  readonly target: StudioTarget;
}

export class SidebarStudioProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private lastTargetKey: string | undefined;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [getWebviewDistRoot(this.extensionUri)],
    };

    void this.bootstrapWebview(webviewView);
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private async bootstrapWebview(webviewView: vscode.WebviewView): Promise<void> {
    const target = await computeStudioTarget(vscode.window.activeTextEditor);
    this.lastTargetKey = JSON.stringify(target);

    const initialData: SidebarStudioInitialData = { title: 'Studio', target };

    webviewView.webview.html = createWebviewHtml(webviewView.webview, {
      extensionUri: this.extensionUri,
      title: 'Studio',
      view: 'studio-sidebar',
      initialData,
    });

    const bridge = createWebviewBridge(webviewView.webview, this.createHandlers());
    this.disposables.push(bridge);

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        void this.postTargetChanged();
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          void this.postTargetChanged();
        }
      }),
    );
  }

  private createHandlers(): StoryboardRpcHandlers {
    return {
      'studio.runAction': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.runAction'>> => {
        await runStudioAction(payload.action, payload.instruction);
        return {};
      },
    };
  }

  private async postTargetChanged(): Promise<void> {
    const target = await computeStudioTarget(vscode.window.activeTextEditor);
    const key = JSON.stringify(target);

    if (key === this.lastTargetKey) {
      return;
    }

    this.lastTargetKey = key;

    await this.webviewView?.webview.postMessage({
      type: 'event',
      method: 'studio.targetChanged',
      payload: target,
    });
  }
}

async function computeStudioTarget(editor: vscode.TextEditor | undefined): Promise<StudioTarget> {
  if (!editor || editor.document.uri.scheme !== 'file') {
    return noneTarget;
  }

  const uri = editor.document.uri;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    return noneTarget;
  }

  const hasSelection = !editor.selection.isEmpty;
  const label = uri.path.split('/').pop();

  if (isDraftMarkdownFile(uri, workspaceFolder)) {
    const sceneUri = deriveSceneUri(workspaceFolder, editor.document.getText());

    return {
      kind: 'draft',
      label,
      draftUri: uri.toString(),
      sceneUri: sceneUri?.toString(),
      hasSelection,
    };
  }

  if (isDirectSceneTextFile(uri, workspaceFolder)) {
    const parts = parseSceneFileName(uri.path.split('/').pop() ?? '');

    if (!parts) {
      return noneTarget;
    }

    const draftUri = draftPath(workspaceFolder.uri, parts.stem);

    return {
      kind: 'scene',
      label,
      sceneUri: uri.toString(),
      draftUri: draftUri.toString(),
      hasSelection,
      draftExists: await uriExists(draftUri),
    };
  }

  return noneTarget;
}

async function runStudioAction(action: StudioAction, instruction?: string): Promise<void> {
  const target = await computeStudioTarget(vscode.window.activeTextEditor);
  const plan = planStudioAction(action);

  if (plan.requires === 'scene' && !target.sceneUri) {
    return;
  }

  if (plan.requires === 'draft' && !target.draftUri) {
    return;
  }

  const slotValues: Record<StudioArgSlot, unknown> = {
    scene: target.sceneUri ? vscode.Uri.parse(target.sceneUri) : undefined,
    draft: target.draftUri ? vscode.Uri.parse(target.draftUri) : undefined,
    selection: currentSelectionRange(target.draftUri),
    instruction,
  };

  await vscode.commands.executeCommand(plan.command, ...plan.slots.map((slot) => slotValues[slot]));
}

function currentSelectionRange(draftUri: string | undefined): vscode.Range | undefined {
  if (!draftUri) {
    return undefined;
  }

  const editor =
    vscode.window.visibleTextEditors.find(
      (candidate) => candidate.document.uri.toString() === draftUri,
    ) ?? vscode.window.activeTextEditor;

  if (!editor || editor.document.uri.toString() !== draftUri || editor.selection.isEmpty) {
    return undefined;
  }

  return new vscode.Range(editor.selection.start, editor.selection.end);
}

export function registerSidebarStudioProvider(context: vscode.ExtensionContext): vscode.Disposable {
  const provider = new SidebarStudioProvider(context.extensionUri);

  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider(studioSidebarViewId, provider),
    provider,
  );
}
