import * as vscode from 'vscode';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import {
  augmentPreviewScheme,
  buildAugmentLabels,
  type AugmentLabels,
} from '@/presentation/commands/augmentDraft';

import type { AugmentDraftRequest, AugmentDraftResult } from '@storyboard/story-engine';
import type { DraftManager } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { deriveSceneUri } from '@/infrastructure/vscode/draftSceneLink';
import {
  isDraftMarkdownFile,
  createDraft,
  parseDraft,
  serializeDraft,
} from '@storyboard/story-model';
import { hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import type { Draft } from '@storyboard/story-model';
import { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';
import type { DraftAugmentScope } from '@storyboard/story-ai';
import { resolveExpandRange } from './expandDraftCommand';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';

export interface AugmentDraftCommandDependencies {
  readonly drafts: Pick<DraftManager, 'prepareAugmentation' | 'applyAugmentation'>;
  readonly logger: IStoryboardLogger;
}

function augmentBeforeUri(draftUri: vscode.Uri): vscode.Uri {
  const baseName: string = (draftUri.path.split('/').at(-1) ?? 'draft.md').replace(/\.md$/, '');
  return vscode.Uri.from({
    scheme: augmentPreviewScheme,
    path: `/${baseName}-before.md`,
    query: draftUri.toString(),
  });
}

function augmentAfterUri(draftUri: vscode.Uri): vscode.Uri {
  const baseName: string = (draftUri.path.split('/').at(-1) ?? 'draft.md').replace(/\.md$/, '');
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

  const fullRange: vscode.Range = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  const serialized: string = serializeDraft(
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
  const startOffset: number = document.offsetAt(replacement.range.start);
  const endOffset: number = document.offsetAt(replacement.range.end);

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
  const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

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

  const workspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(
    editor.document.uri,
  );

  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('워크스페이스 폴더를 찾을 수 없습니다.');
    return undefined;
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
    return undefined;
  }

  if (!isDraftMarkdownFile(editor.document.uri, workspaceFolder)) {
    await vscode.window.showErrorMessage('`draft/*.md` 파일에서만 보충할 수 있습니다.');
    return undefined;
  }

  const documentText: string = editor.document.getText();

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
  const selectionRange: vscode.Selection | vscode.Range = resolveExpandRange(editor, rangeArg);

  if (scope === 'selection' && selectionRange.isEmpty) {
    await vscode.window.showInformationMessage(
      instruction ? '수정할 영역을 먼저 선택해 주세요.' : '보충할 영역을 먼저 선택해 주세요.',
    );
    return undefined;
  }

  const target: string =
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
  const context: AugmentEditorContext | undefined =
    await resolveAugmentEditorContext(invokedDraftUri);

  if (!context) {
    return undefined;
  }

  const { editor, workspaceFolder, documentText, draft } = context;

  const selection: AugmentSelection | undefined = await resolveAugmentSelection(
    scope,
    editor,
    draft,
    rangeArg,
    instruction,
  );

  if (!selection) {
    return undefined;
  }

  const sceneUri: vscode.Uri | undefined =
    invokedSceneUri ?? deriveSceneUri(workspaceFolder, documentText);

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

export abstract class AugmentDraftCommandBase implements IExtensionCommand {
  public abstract readonly id: string;

  protected constructor(
    private readonly dependencies: AugmentDraftCommandDependencies,
    private readonly previewProvider: VirtualDocumentStore,
  ) {}

  public abstract run(...args: never[]): unknown;

  protected async augment(
    scope: DraftAugmentScope,
    invokedSceneUri?: vscode.Uri,
    invokedDraftUri?: vscode.Uri,
    rangeArg?: vscode.Range,
    instruction?: string,
  ): Promise<void> {
    const target: AugmentTarget | undefined = await resolveAugmentTarget(
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
    const labels: AugmentLabels = buildAugmentLabels(scope, instruction);

    const augmentation: AugmentDraftResult = await this.runAugmentation(labels.progressTitle, {
      draftSceneStem: draft.sceneStem,
      instruction,
      sceneUri: target.sceneUri,
      scope,
      target: target.target,
      workspaceRoot: workspaceFolder.uri,
    });

    if (!augmentation.ok) {
      await this.reportAugmentFailure(augmentation);
      return;
    }

    const replacement: AugmentReplacement = buildReplacement(
      scope,
      editor.document,
      selectionRange,
      draft,
      augmentation.text,
    );
    const proposedFullText: string = applyReplacementToText(
      documentText,
      editor.document,
      replacement,
    );

    await this.presentAugmentDiff(
      editor.document.uri,
      documentText,
      proposedFullText,
      labels.diffTitle,
    );

    const decision: '적용' | '취소' | undefined = await vscode.window.showInformationMessage(
      labels.confirmPrompt,
      '적용',
      '취소',
    );

    if (decision !== '적용') {
      return;
    }

    await this.applyAugmentation(target, replacement, labels.successMessage);
  }

  private async runAugmentation(
    progressTitle: string,
    request: AugmentDraftRequest,
  ): Promise<AugmentDraftResult> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: progressTitle,
        cancellable: false,
      },
      async () => await this.dependencies.drafts.prepareAugmentation(request),
    );
  }

  private async presentAugmentDiff(
    draftUri: vscode.Uri,
    documentText: string,
    proposedFullText: string,
    diffTitle: string,
  ): Promise<void> {
    const beforeUri: vscode.Uri = augmentBeforeUri(draftUri);
    const afterUri: vscode.Uri = augmentAfterUri(draftUri);

    this.previewProvider.setContent(beforeUri, documentText);
    this.previewProvider.setContent(afterUri, proposedFullText);

    await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, diffTitle, {
      preview: true,
    });
  }

  private async applyAugmentation(
    target: AugmentTarget,
    replacement: AugmentReplacement,
    successMessage: string,
  ): Promise<void> {
    await this.dependencies.drafts.applyAugmentation({
      draftUri: target.editor.document.uri,
      sceneStem: target.draft.sceneStem,
      workspaceRoot: target.workspaceFolder.uri,
    });

    const edit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
    edit.replace(target.editor.document.uri, replacement.range, replacement.text);
    const applied: boolean = await vscode.workspace.applyEdit(edit);

    if (!applied) {
      await vscode.window.showErrorMessage('보충 결과를 적용하지 못했습니다.');
      return;
    }

    await target.editor.document.save();
    await vscode.window.showInformationMessage(successMessage);
  }

  private async reportAugmentFailure(
    failure: Extract<AugmentDraftResult, { ok: false }>,
  ): Promise<void> {
    if (failure.kind === 'empty') {
      await vscode.window.showWarningMessage('보충 결과가 비어 있어 적용하지 않았습니다.');
      return;
    }

    this.dependencies.logger.show();
    await showStoryboardFailure(`초안 보충에 실패했습니다: ${failure.message}`);
  }
}
