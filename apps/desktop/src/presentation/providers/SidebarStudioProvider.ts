import * as vscode from 'vscode';

import { deriveSceneUri } from '../../infrastructure/vscode/draftSceneLink';
import {
  draftPath,
  isDirectSceneCardFile,
  isDraftMarkdownFile,
} from '../../infrastructure/vscode/pathConventions';
import {
  hasStoryboardProject,
  resolveStoryboardWorkspaceRoot,
  uriExists,
} from '../../infrastructure/vscode/workspace';
import {
  StudioSessionRepository,
  type IStudioSessionRepository,
} from '../../infrastructure/persistence/repositories/studioSessionRepository';
import { readStudioStage } from '../../infrastructure/persistence/studioStage';
import { createWebviewBridge, type StoryboardRpcHandlers } from '../messaging/bridge';
import { parseSceneFileName } from '@storyboard/story-format';
import type {
  StoryboardResponsePayload,
  StudioAction,
  StudioSessionSnapshot,
  StudioTarget,
} from '../../shared/messaging';
import { createStudioSessionRpcHandlers } from '../messaging/studioSessionRpcHandlers';
import { planStudioAction, type StudioArgSlot } from './studioActions';
import { createWebviewHtml, getWebviewDistRoot } from './webviewHtml';

const studioSidebarViewId = 'storyboard.studioView';
const noneTarget: StudioTarget = { kind: 'none', hasSelection: false };

interface SidebarStudioInitialData {
  readonly title: string;
  readonly target: StudioTarget;
  readonly session?: StudioSessionSnapshot;
}

export class SidebarStudioProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private lastTargetKey: string | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionRepository: IStudioSessionRepository,
  ) {}

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

    const root = await resolveStoryboardWorkspaceRoot();
    const session = root ? await this.sessionRepository.loadLatest(root) : undefined;

    const initialData: SidebarStudioInitialData = { title: 'Studio', target, session };

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
      'studio.stage': async (): Promise<StoryboardResponsePayload<'studio.stage'>> => {
        const root = await resolveStoryboardWorkspaceRoot();

        if (!root) {
          return {};
        }

        const target = await computeStudioTarget(vscode.window.activeTextEditor);
        return { stage: await readStudioStage(root, target) };
      },
      ...createStudioSessionRpcHandlers({
        repository: this.sessionRepository,
        getProjectRoot: () => resolveStoryboardWorkspaceRoot(),
      }),
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
  const workspaceFolder =
    editor && editor.document.uri.scheme === 'file'
      ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
      : vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    return noneTarget;
  }

  if (!editor || editor.document.uri.scheme !== 'file') {
    return { kind: 'project', label: workspaceFolder.name, hasSelection: false };
  }

  const uri = editor.document.uri;

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

  if (isDirectSceneCardFile(uri, workspaceFolder)) {
    const parts = parseSceneFileName(uri.path.split('/').pop() ?? '');

    if (!parts) {
      return { kind: 'project', label: workspaceFolder.name, hasSelection: false };
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

  return { kind: 'project', label: workspaceFolder.name, hasSelection: false };
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
  if (plan.requires === 'project' && target.kind === 'none') {
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
  const provider = new SidebarStudioProvider(context.extensionUri, new StudioSessionRepository());

  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider(studioSidebarViewId, provider),
    provider,
  );
}
