import { storyboardCommandIds } from '@/contributionIds';
import * as vscode from 'vscode';

import {
  AugmentDraftCommandBase,
  type AugmentDraftCommandDependencies,
} from '@/presentation/commands/augmentDraftCommandBase';
import type { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

export class EditSelectionCommand extends AugmentDraftCommandBase {
  public readonly id: string = storyboardCommandIds.draftEditSelection;

  public constructor(
    dependencies: AugmentDraftCommandDependencies,
    previewProvider: VirtualDocumentStore,
  ) {
    super(dependencies, previewProvider);
  }

  public async run(
    sceneUri?: vscode.Uri,
    draftUri?: vscode.Uri,
    rangeArg?: vscode.Range,
    instructionArg?: string,
  ): Promise<void> {
    const instruction: string | undefined =
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
    return this.augment('selection', sceneUri, draftUri, rangeArg, instruction);
  }
}
