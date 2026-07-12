import * as vscode from 'vscode';

import type { AugmentDraftUseCase } from '../application/drafts/augmentDraftUseCase';
import type { StoryboardLogger } from '../core/logger';
import { deriveSceneUri } from '../core/draftSceneLink';
import { draftHistorySceneDirectory, isDraftMarkdownFile } from '../core/pathConventions';
import { draftHistoryFileSystem } from '../core/vscodeFileSystem';
import { hasStoryboardProject } from '../core/workspace';
import type { Draft } from '../domain/Draft';
import { createDraft, parseDraft, serializeDraft } from '../files/draft';
import { archiveExistingDraft } from '../files/draftHistory';
import { VirtualDocumentStore } from '../presentation/providers/virtualDocumentStore';
import type { DraftAugmentScope } from '../services/ai/prompts/draftAugment';
import type { ConfigBridge } from '../services/settings/ConfigBridge';
import { resolveExpandRange } from './expandDraft';

const augmentDraftCommand = 'storyboard.draft.augment';
const augmentSelectionCommand = 'storyboard.draft.augmentSelection';
const editSelectionCommand = 'storyboard.draft.editSelection';
const augmentPreviewScheme = 'storyboard-augment';

export interface RegisterAugmentDraftCommandDependencies {
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly configBridge: ConfigBridge;
  readonly logger: StoryboardLogger;
}

function augmentBeforeUri(draftUri: vscode.Uri): vscode.Uri {
  const baseName = (draftUri.path.split('/').at(-1) ?? 'draft.md').replace(/\.md$/, '');
  return vscode.Uri.from({
    scheme: augmentPreviewScheme,
    path: `/${baseName}-before.md`,
    query: draftUri.toString(),
  });
}

function augmentAfterUri(draftUri: vscode.Uri): vscode.Uri {
  const baseName = (draftUri.path.split('/').at(-1) ?? 'draft.md').replace(/\.md$/, '');
  return vscode.Uri.from({
    scheme: augmentPreviewScheme,
    path: `/${baseName}-after.md`,
    query: draftUri.toString(),
  });
}

interface AugmentReplacement {
  readonly range: vscode.Range;
  readonly text: string;
}

function buildReplacement(
  scope: DraftAugmentScope,
  document: vscode.TextDocument,
  selectionRange: vscode.Range,
  draft: Draft,
  augmented: string,
): AugmentReplacement {
  if (scope === 'selection') {
    return { range: new vscode.Range(selectionRange.start, selectionRange.end), text: augmented };
  }

  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  const serialized = serializeDraft(
    createDraft({
      sceneStem: draft.sceneStem,
      format: draft.format,
      body: augmented,
      generatedAt: draft.generatedAt,
    }),
  );

  return { range: fullRange, text: serialized };
}

function applyReplacementToText(
  documentText: string,
  document: vscode.TextDocument,
  replacement: AugmentReplacement,
): string {
  const startOffset = document.offsetAt(replacement.range.start);
  const endOffset = document.offsetAt(replacement.range.end);

  return documentText.slice(0, startOffset) + replacement.text + documentText.slice(endOffset);
}

async function maybeArchiveDraft(
  dependencies: RegisterAugmentDraftCommandDependencies,
  workspaceFolder: vscode.WorkspaceFolder,
  sceneStem: string,
  draftUri: vscode.Uri,
): Promise<void> {
  if (!dependencies.configBridge.isKeepDraftHistoryEnabled()) {
    return;
  }

  const historyDirectory = draftHistorySceneDirectory(workspaceFolder.uri, sceneStem);

  try {
    await archiveExistingDraft({
      draftUri,
      historyDirectory,
      resolveArchiveUri: (archiveFileName) =>
        vscode.Uri.joinPath(historyDirectory, archiveFileName),
      fileSystem: draftHistoryFileSystem,
    });
  } catch (error) {
    dependencies.logger.warn(`이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`);
  }
}

async function runAugmentDraft(
  scope: DraftAugmentScope,
  dependencies: RegisterAugmentDraftCommandDependencies,
  previewProvider: VirtualDocumentStore,
  invokedSceneUri?: vscode.Uri,
  invokedDraftUri?: vscode.Uri,
  rangeArg?: vscode.Range,
  instruction?: string,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.uri.scheme !== 'file') {
    await vscode.window.showErrorMessage('활성 드래프트 파일을 열고 다시 시도해 주세요.');
    return;
  }

  if (invokedDraftUri && editor.document.uri.toString() !== invokedDraftUri.toString()) {
    await vscode.window.showErrorMessage(
      '현재 활성화된 드래프트 파일에서만 보충을 실행할 수 있습니다.',
    );
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);

  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('워크스페이스 폴더를 찾을 수 없습니다.');
    return;
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다.',
    );
    return;
  }

  if (!isDraftMarkdownFile(editor.document.uri, workspaceFolder)) {
    await vscode.window.showErrorMessage('`draft/*.md` 파일에서만 보충할 수 있습니다.');
    return;
  }

  const documentText = editor.document.getText();

  let draft: Draft;
  try {
    draft = parseDraft(documentText);
  } catch {
    await vscode.window.showErrorMessage(
      '드래프트 형식을 해석할 수 없습니다. frontmatter를 확인해 주세요.',
    );
    return;
  }

  const selectionRange = resolveExpandRange(editor, rangeArg);

  if (scope === 'selection' && selectionRange.isEmpty) {
    await vscode.window.showInformationMessage(
      instruction ? '수정할 영역을 먼저 선택해 주세요.' : '보충할 영역을 먼저 선택해 주세요.',
    );
    return;
  }

  const target =
    scope === 'selection' ? editor.document.getText(selectionRange).trim() : draft.body.trim();

  if (target.length === 0) {
    await vscode.window.showInformationMessage('보충할 본문이 비어 있습니다.');
    return;
  }

  const sceneUri = invokedSceneUri ?? deriveSceneUri(workspaceFolder, documentText);

  if (!sceneUri) {
    await vscode.window.showErrorMessage('연결된 씬 파일을 찾을 수 없습니다.');
    return;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: instruction
        ? 'Storyboard 선택 영역 편집'
        : scope === 'selection'
          ? 'Storyboard 선택 영역 보충'
          : 'Storyboard 초안 보충',
      cancellable: false,
    },
    async () =>
      await dependencies.augmentDraftUseCase.execute({
        draftSceneStem: draft.sceneStem,
        instruction,
        sceneUri,
        scope,
        target,
        workspaceRoot: workspaceFolder.uri,
      }),
  );

  if (!result.ok) {
    if (result.kind === 'empty') {
      await vscode.window.showWarningMessage('보충 결과가 비어 있어 적용하지 않았습니다.');
      return;
    }

    dependencies.logger.show();
    await vscode.window.showErrorMessage(`초안 보충에 실패했습니다: ${result.message}`);
    return;
  }

  const replacement = buildReplacement(scope, editor.document, selectionRange, draft, result.text);
  const proposedFullText = applyReplacementToText(documentText, editor.document, replacement);
  const beforeUri = augmentBeforeUri(editor.document.uri);
  const afterUri = augmentAfterUri(editor.document.uri);

  previewProvider.setContent(beforeUri, documentText);
  previewProvider.setContent(afterUri, proposedFullText);

  await vscode.commands.executeCommand(
    'vscode.diff',
    beforeUri,
    afterUri,
    instruction ? '초안 ↔ 수정 제안' : '초안 ↔ 보충 제안',
    { preview: true },
  );

  const decision = await vscode.window.showInformationMessage(
    instruction ? '수정 결과를 적용하시겠습니까?' : '보충 결과를 적용하시겠습니까?',
    '적용',
    '취소',
  );

  if (decision !== '적용') {
    return;
  }

  await maybeArchiveDraft(dependencies, workspaceFolder, draft.sceneStem, editor.document.uri);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(editor.document.uri, replacement.range, replacement.text);
  const applied = await vscode.workspace.applyEdit(edit);

  if (!applied) {
    await vscode.window.showErrorMessage('보충 결과를 적용하지 못했습니다.');
    return;
  }

  await editor.document.save();
  await vscode.window.showInformationMessage(
    instruction
      ? '선택 영역을 수정했습니다.'
      : scope === 'selection'
        ? '선택 영역을 보충했습니다.'
        : '초안을 보충했습니다.',
  );
}

export function registerAugmentDraftCommands(
  dependencies: RegisterAugmentDraftCommandDependencies,
): vscode.Disposable {
  const previewProvider = new VirtualDocumentStore();

  return vscode.Disposable.from(
    previewProvider,
    vscode.workspace.registerTextDocumentContentProvider(augmentPreviewScheme, previewProvider),
    vscode.commands.registerCommand(
      augmentDraftCommand,
      (sceneUri?: vscode.Uri, draftUri?: vscode.Uri) =>
        runAugmentDraft('draft', dependencies, previewProvider, sceneUri, draftUri),
    ),
    vscode.commands.registerCommand(
      augmentSelectionCommand,
      (sceneUri?: vscode.Uri, draftUri?: vscode.Uri, rangeArg?: vscode.Range) =>
        runAugmentDraft('selection', dependencies, previewProvider, sceneUri, draftUri, rangeArg),
    ),
    vscode.commands.registerCommand(
      editSelectionCommand,
      async (
        sceneUri?: vscode.Uri,
        draftUri?: vscode.Uri,
        rangeArg?: vscode.Range,
        instructionArg?: string,
      ) => {
        const instruction =
          instructionArg ??
          (await vscode.window.showInputBox({
            title: '선택 영역 편집',
            prompt: '어떻게 수정할까요?',
            placeHolder: '예: 더 긴장감 있게, 캐릭터 감정을 강조해서, 짧게 줄여서...',
            ignoreFocusOut: true,
          }));
        if (instruction === undefined) return;
        if (!instruction.trim()) {
          await vscode.window.showInformationMessage('수정 지시문을 입력해 주세요.');
          return;
        }
        return runAugmentDraft(
          'selection',
          dependencies,
          previewProvider,
          sceneUri,
          draftUri,
          rangeArg,
          instruction,
        );
      },
    ),
  );
}
