import * as vscode from 'vscode';

import type { CondenseDraftResult } from '@storyboard/story-engine';
import type { DraftManager } from '@storyboard/story-app';
import {
  buildNarrativeContext,
  buildSceneContext,
  createDraft,
  formatBibleFactLines,
  parseDraft,
  readSceneFile,
  serializeDraft,
  archiveExistingDraft,
  sceneContextPaths,
  draftHistorySceneDirectory,
  getStoryboardProjectPaths,
  isDraftMarkdownFile,
  joinUri,
} from '@storyboard/story-model';
import { formatAugmentCards } from '@storyboard/story-ai';
import type { ConfigBridge } from '@storyboard/story-ai';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { deriveSceneUri } from '@/infrastructure/vscode/draftSceneLink';
import {
  draftHistoryFileSystem,
  sceneContextFileSystem,
  vscodeFsAdapter,
} from '@/infrastructure/vscode/workspaceFsAdapters';
import { hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';

const CONDENSE_DRAFT_COMMAND = 'storyboard.draft.condense';
const CONDENSE_PREVIEW_SCHEME = 'storyboard-condense';

export interface RegisterCondenseDraftCommandDependencies {
  readonly drafts: Pick<DraftManager, 'condense'>;
  readonly configBridge: ConfigBridge;
  readonly logger: IStoryboardLogger;
}

interface CondenseTarget {
  readonly editor: vscode.TextEditor;
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly documentText: string;
  readonly draft: ReturnType<typeof parseDraft>;
}

interface CondenseContext {
  readonly intent?: string;
  readonly facts?: readonly string[];
  readonly characterCards?: readonly string[];
}

function previewUri(draftUri: vscode.Uri, version: 'before' | 'after'): vscode.Uri {
  const baseName = (draftUri.path.split('/').at(-1) ?? 'draft.md').replace(/\.md$/, '');
  return vscode.Uri.from({
    scheme: CONDENSE_PREVIEW_SCHEME,
    path: `/${baseName}-${version}.md`,
    query: draftUri.toString(),
  });
}

async function resolveCondenseTarget(invokedUri?: vscode.Uri): Promise<CondenseTarget | undefined> {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.uri.scheme !== 'file') {
    await vscode.window.showErrorMessage('활성 드래프트 파일을 열고 다시 시도해 주세요.');
    return undefined;
  }
  if (invokedUri && editor.document.uri.toString() !== invokedUri.toString()) {
    await vscode.window.showErrorMessage(
      '현재 활성화된 드래프트 파일에서만 원본 축소를 실행할 수 있습니다.',
    );
    return undefined;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트의 드래프트 파일에서만 원본 축소를 실행할 수 있습니다.',
    );
    return undefined;
  }
  if (!isDraftMarkdownFile(editor.document.uri, workspaceFolder)) {
    await vscode.window.showErrorMessage('`draft/*.md` 파일에서만 원본 축소를 실행할 수 있습니다.');
    return undefined;
  }

  try {
    return {
      editor,
      workspaceFolder,
      documentText: editor.document.getText(),
      draft: parseDraft(editor.document.getText()),
    };
  } catch {
    await vscode.window.showErrorMessage(
      '드래프트 형식을 해석할 수 없습니다. frontmatter를 확인해 주세요.',
    );
    return undefined;
  }
}

async function loadCondenseContext(target: CondenseTarget): Promise<CondenseContext> {
  const sceneUri = deriveSceneUri(target.workspaceFolder, target.documentText);
  if (!sceneUri) {
    return {};
  }

  try {
    const scene = await readSceneFile(
      sceneUri,
      vscodeFsAdapter,
      sceneUri.path.split('/').at(-1) ?? '',
    );
    const contextPaths = sceneContextPaths(getStoryboardProjectPaths(target.workspaceFolder.uri));
    const context = await buildSceneContext(contextPaths, scene, sceneContextFileSystem);
    const narrative = await buildNarrativeContext(contextPaths, context, sceneContextFileSystem);

    return {
      intent: scene.body,
      facts: formatBibleFactLines(context, narrative.bibleFacts),
      characterCards: formatAugmentCards(context.characters, undefined),
    };
  } catch {
    return {};
  }
}

async function showCondenseDiff(
  previewProvider: VirtualDocumentStore,
  draftUri: vscode.Uri,
  before: string,
  after: string,
  title: string,
): Promise<void> {
  const beforeUri = previewUri(draftUri, 'before');
  const afterUri = previewUri(draftUri, 'after');
  previewProvider.setContent(beforeUri, before);
  previewProvider.setContent(afterUri, after);
  await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, title, {
    preview: true,
  });
}

export interface CondenseReviewLabels {
  readonly diffTitle: string;
  readonly confirmPrompt: string;
  readonly cancelLabel: string;
}

export function buildCondenseReviewLabels(
  result: Extract<CondenseDraftResult, { readonly ok: true }>,
): CondenseReviewLabels {
  if (result.kind === 'review-required') {
    return {
      diffTitle: '안전 기준 미달 · 초안 ↔ 축소 제안',
      confirmPrompt: `축소안이 안전 기준보다 짧습니다 (후보 ${result.candidateLength}자 / 최소 ${result.minimumLength}자). 검토 후 적용하시겠습니까?`,
      cancelLabel: '원본 유지',
    };
  }

  return {
    diffTitle: '초안 ↔ 축소 제안',
    confirmPrompt: '축소 결과를 적용하시겠습니까?',
    cancelLabel: '취소',
  };
}

async function archiveDraftBeforeApply(
  target: CondenseTarget,
  configBridge: ConfigBridge,
  logger: IStoryboardLogger,
): Promise<void> {
  if (!configBridge.isKeepDraftHistoryEnabled()) {
    return;
  }

  try {
    const historyDirectory = draftHistorySceneDirectory(
      target.workspaceFolder.uri,
      target.draft.sceneStem,
    );
    await archiveExistingDraft({
      draftUri: target.editor.document.uri,
      historyDirectory,
      resolveArchiveUri: (fileName) => joinUri(historyDirectory, fileName),
      fileSystem: draftHistoryFileSystem,
    });
  } catch (error) {
    logger.warn(`이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`);
  }
}

async function reportFailure(
  result: Exclude<CondenseDraftResult, { readonly ok: true }>,
): Promise<void> {
  if (result.kind === 'rejected') {
    const reason =
      result.reason === 'not-shorter'
        ? '축소되지 않았습니다.'
        : result.reason === 'too-short'
          ? `너무 짧습니다 (${result.candidateLength}자 / 최소 ${result.minimumLength}자).`
          : result.reason === 'scene-breaks-changed'
            ? '장면 구분(---)의 수가 바뀌었습니다.'
            : '본문으로 적용할 수 없는 응답입니다.';
    await vscode.window.showWarningMessage(`원본을 유지했습니다: ${reason}`);
    return;
  }

  await showStoryboardFailure(`원본 축소에 실패했습니다: ${result.message}`);
}

async function runCondenseDraft(
  dependencies: RegisterCondenseDraftCommandDependencies,
  previewProvider: VirtualDocumentStore,
  invokedUri?: vscode.Uri,
): Promise<void> {
  const target = await resolveCondenseTarget(invokedUri);
  if (!target || target.draft.body.trim().length === 0) {
    return;
  }

  const context = await loadCondenseContext(target);
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Storyboard 원본 축소',
      cancellable: false,
    },
    async () =>
      await dependencies.drafts.condense({
        workspaceRoot: target.workspaceFolder.uri,
        sceneStem: target.draft.sceneStem,
        format: target.draft.format,
        body: target.draft.body,
        maxCompressionPercent: dependencies.configBridge.getMaxCompressionPercent(),
        ...context,
      }),
  );

  if (!result.ok) {
    await reportFailure(result);
    return;
  }

  const labels = buildCondenseReviewLabels(result);

  const proposed = serializeDraft(
    createDraft({
      sceneStem: target.draft.sceneStem,
      format: target.draft.format,
      body: result.text,
      generator: target.draft.generator,
      providerId: target.draft.providerId,
      model: target.draft.model,
    }),
  );
  await showCondenseDiff(
    previewProvider,
    target.editor.document.uri,
    target.documentText,
    proposed,
    labels.diffTitle,
  );

  const decision = await vscode.window.showInformationMessage(
    labels.confirmPrompt,
    '적용',
    labels.cancelLabel,
  );
  if (decision !== '적용') {
    return;
  }

  await archiveDraftBeforeApply(target, dependencies.configBridge, dependencies.logger);
  const fullRange = new vscode.Range(
    target.editor.document.positionAt(0),
    target.editor.document.positionAt(target.documentText.length),
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(target.editor.document.uri, fullRange, proposed);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    await vscode.window.showErrorMessage('축소 결과를 적용하지 못했습니다.');
    return;
  }

  await target.editor.document.save();
  await vscode.window.showInformationMessage('원본 축소를 적용했습니다.');
}

export function registerCondenseDraftCommand(
  dependencies: RegisterCondenseDraftCommandDependencies,
): vscode.Disposable {
  const previewProvider = new VirtualDocumentStore();
  return vscode.Disposable.from(
    previewProvider,
    vscode.workspace.registerTextDocumentContentProvider(CONDENSE_PREVIEW_SCHEME, previewProvider),
    vscode.commands.registerCommand(CONDENSE_DRAFT_COMMAND, (uri?: vscode.Uri) =>
      runCondenseDraft(dependencies, previewProvider, uri),
    ),
  );
}
