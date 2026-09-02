import * as vscode from 'vscode';

import type {
  AugmentDraftRequest,
  AugmentDraftResult,
  AugmentDraftUseCase,
} from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { deriveSceneUri } from '@/infrastructure/vscode/draftSceneLink';
import { isDraftMarkdownFile } from '@storyboard/story-engine';
import { hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { createDraft, parseDraft, serializeDraft } from '@storyboard/story-format';
import type { Draft } from '@storyboard/story-format';
import { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';
import type { DraftAugmentScope } from '@storyboard/story-ai';
import { resolveExpandRange } from './expandDraft';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';

const augmentDraftCommand = 'storyboard.draft.augment';
const augmentSelectionCommand = 'storyboard.draft.augmentSelection';
const editSelectionCommand = 'storyboard.draft.editSelection';
const augmentPreviewScheme = 'storyboard-augment';

export interface RegisterAugmentDraftCommandDependencies {
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly logger: IStoryboardLogger;
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
      generator: draft.generator,
      providerId: draft.providerId,
      model: draft.model,
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

interface AugmentTarget {
  readonly editor: vscode.TextEditor;
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly documentText: string;
  readonly draft: Draft;
  readonly selectionRange: vscode.Selection | vscode.Range;
  readonly target: string;
  readonly sceneUri: vscode.Uri;
}

interface AugmentEditorContext {
  readonly editor: vscode.TextEditor;
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly documentText: string;
  readonly draft: Draft;
}

async function resolveAugmentEditorContext(
  invokedDraftUri: vscode.Uri | undefined,
): Promise<AugmentEditorContext | undefined> {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.uri.scheme !== 'file') {
    await vscode.window.showErrorMessage('활성 드래프트 파일을 열고 다시 시도해 주세요.');
    return undefined;
  }

  if (invokedDraftUri && editor.document.uri.toString() !== invokedDraftUri.toString()) {
    await vscode.window.showErrorMessage(
      '현재 활성화된 드래프트 파일에서만 보충을 실행할 수 있습니다.',
    );
    return undefined;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);

  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('워크스페이스 폴더를 찾을 수 없습니다.');
    return undefined;
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다.',
    );
    return undefined;
  }

  if (!isDraftMarkdownFile(editor.document.uri, workspaceFolder)) {
    await vscode.window.showErrorMessage('`draft/*.md` 파일에서만 보충할 수 있습니다.');
    return undefined;
  }

  const documentText = editor.document.getText();

  let draft: Draft;
  try {
    draft = parseDraft(documentText);
  } catch {
    await vscode.window.showErrorMessage(
      '드래프트 형식을 해석할 수 없습니다. frontmatter를 확인해 주세요.',
    );
    return undefined;
  }

  return { editor, workspaceFolder, documentText, draft };
}

interface AugmentSelection {
  readonly selectionRange: vscode.Selection | vscode.Range;
  readonly target: string;
}

async function resolveAugmentSelection(
  scope: DraftAugmentScope,
  editor: vscode.TextEditor,
  draft: Draft,
  rangeArg: vscode.Range | undefined,
  instruction: string | undefined,
): Promise<AugmentSelection | undefined> {
  const selectionRange = resolveExpandRange(editor, rangeArg);

  if (scope === 'selection' && selectionRange.isEmpty) {
    await vscode.window.showInformationMessage(
      instruction ? '수정할 영역을 먼저 선택해 주세요.' : '보충할 영역을 먼저 선택해 주세요.',
    );
    return undefined;
  }

  const target =
    scope === 'selection' ? editor.document.getText(selectionRange).trim() : draft.body.trim();

  if (target.length === 0) {
    await vscode.window.showInformationMessage('보충할 본문이 비어 있습니다.');
    return undefined;
  }

  return { selectionRange, target };
}

async function resolveAugmentTarget(
  scope: DraftAugmentScope,
  invokedSceneUri: vscode.Uri | undefined,
  invokedDraftUri: vscode.Uri | undefined,
  rangeArg: vscode.Range | undefined,
  instruction: string | undefined,
): Promise<AugmentTarget | undefined> {
  const context = await resolveAugmentEditorContext(invokedDraftUri);

  if (!context) {
    return undefined;
  }

  const { editor, workspaceFolder, documentText, draft } = context;

  const selection = await resolveAugmentSelection(scope, editor, draft, rangeArg, instruction);

  if (!selection) {
    return undefined;
  }

  const sceneUri = invokedSceneUri ?? deriveSceneUri(workspaceFolder, documentText);

  if (!sceneUri) {
    await vscode.window.showErrorMessage('연결된 씬 파일을 찾을 수 없습니다.');
    return undefined;
  }

  return {
    editor,
    workspaceFolder,
    documentText,
    draft,
    selectionRange: selection.selectionRange,
    target: selection.target,
    sceneUri,
  };
}

interface AugmentLabels {
  readonly progressTitle: string;
  readonly diffTitle: string;
  readonly confirmPrompt: string;
  readonly successMessage: string;
}

export function buildAugmentLabels(
  scope: DraftAugmentScope,
  instruction: string | undefined,
): AugmentLabels {
  if (instruction) {
    return {
      progressTitle: 'Storyboard 선택 영역 편집',
      diffTitle: '초안 ↔ 수정 제안',
      confirmPrompt: '수정 결과를 적용하시겠습니까?',
      successMessage: '선택 영역을 수정했습니다.',
    };
  }

  const isSelection = scope === 'selection';

  return {
    progressTitle: isSelection ? 'Storyboard 선택 영역 보충' : 'Storyboard 초안 보충',
    diffTitle: '초안 ↔ 보충 제안',
    confirmPrompt: '보충 결과를 적용하시겠습니까?',
    successMessage: isSelection ? '선택 영역을 보충했습니다.' : '초안을 보충했습니다.',
  };
}

async function runAugmentation(
  useCase: AugmentDraftUseCase,
  progressTitle: string,
  request: AugmentDraftRequest,
): Promise<AugmentDraftResult> {
  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: progressTitle,
      cancellable: false,
    },
    async () => await useCase.prepareAugmentedDraft(request),
  );
}

async function presentAugmentDiff(
  previewProvider: VirtualDocumentStore,
  draftUri: vscode.Uri,
  documentText: string,
  proposedFullText: string,
  diffTitle: string,
): Promise<void> {
  const beforeUri = augmentBeforeUri(draftUri);
  const afterUri = augmentAfterUri(draftUri);

  previewProvider.setContent(beforeUri, documentText);
  previewProvider.setContent(afterUri, proposedFullText);

  await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, diffTitle, {
    preview: true,
  });
}

async function applyAugmentation(
  useCase: AugmentDraftUseCase,
  target: AugmentTarget,
  replacement: AugmentReplacement,
  successMessage: string,
): Promise<void> {
  await useCase.applyAugmentedDraft({
    draftUri: target.editor.document.uri,
    sceneStem: target.draft.sceneStem,
    workspaceRoot: target.workspaceFolder.uri,
  });

  const edit = new vscode.WorkspaceEdit();
  edit.replace(target.editor.document.uri, replacement.range, replacement.text);
  const applied = await vscode.workspace.applyEdit(edit);

  if (!applied) {
    await vscode.window.showErrorMessage('보충 결과를 적용하지 못했습니다.');
    return;
  }

  await target.editor.document.save();
  await vscode.window.showInformationMessage(successMessage);
}

async function reportAugmentFailure(
  dependencies: RegisterAugmentDraftCommandDependencies,
  result: Extract<AugmentDraftResult, { ok: false }>,
): Promise<void> {
  if (result.kind === 'empty') {
    await vscode.window.showWarningMessage('보충 결과가 비어 있어 적용하지 않았습니다.');
    return;
  }

  dependencies.logger.show();
  await showStoryboardFailure(`초안 보충에 실패했습니다: ${result.message}`);
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
  const target = await resolveAugmentTarget(
    scope,
    invokedSceneUri,
    invokedDraftUri,
    rangeArg,
    instruction,
  );

  if (!target) {
    return;
  }

  const { editor, workspaceFolder, documentText, draft, selectionRange } = target;
  const labels = buildAugmentLabels(scope, instruction);

  const result = await runAugmentation(dependencies.augmentDraftUseCase, labels.progressTitle, {
    draftSceneStem: draft.sceneStem,
    instruction,
    sceneUri: target.sceneUri,
    scope,
    target: target.target,
    workspaceRoot: workspaceFolder.uri,
  });

  if (!result.ok) {
    await reportAugmentFailure(dependencies, result);
    return;
  }

  const replacement = buildReplacement(scope, editor.document, selectionRange, draft, result.text);
  const proposedFullText = applyReplacementToText(documentText, editor.document, replacement);

  await presentAugmentDiff(
    previewProvider,
    editor.document.uri,
    documentText,
    proposedFullText,
    labels.diffTitle,
  );

  const decision = await vscode.window.showInformationMessage(labels.confirmPrompt, '적용', '취소');

  if (decision !== '적용') {
    return;
  }

  await applyAugmentation(
    dependencies.augmentDraftUseCase,
    target,
    replacement,
    labels.successMessage,
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
