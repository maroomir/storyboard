import * as vscode from 'vscode';

import type { CardManager, CardReading, RunGate } from '@storyboard/story-app';
import type { CardRemovalPlan, RemoveCardResult } from '@storyboard/story-engine';
import { parseCardIdFromPath } from '@storyboard/story-model';
import { runHoldingWorkspaceLock } from '@/presentation/commands/workspaceRunLock';

export interface CardRemovalPromptDependencies {
  readonly cards: Pick<CardManager, 'remove' | 'read'>;
  readonly runGate: Pick<RunGate, 'hold'>;
}

const removeLabel: string = '삭제';
const removeAndCleanLabel: string = '삭제하고 함께 정리';

export function describeRemovalPrompt(name: string, plan: CardRemovalPlan): string {
  const referenceCount: number = plan.referencingPaths.length;
  const droppedCount: number = plan.droppedLines.length;

  return [
    `${plan.path}/ 폴더를 지웁니다.`,
    referenceCount === 0
      ? undefined
      : `${name}를 가리키는 곳이 ${referenceCount}곳 있습니다(${plan.referencingPaths.join(', ')}). 그 참조를 함께 걷어 냅니다.`,
    droppedCount === 0
      ? undefined
      : `${name}만 알던 줄 ${droppedCount}개는 함께 지웁니다: ${plan.droppedLines.map((line) => line.value).join(' / ')}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

export class CardRemovalPrompt {
  public constructor(private readonly dependencies: CardRemovalPromptDependencies) {}

  public async confirmAndRemove(workspaceRoot: vscode.Uri, cardUri: vscode.Uri): Promise<void> {
    const slug: string | undefined = parseCardIdFromPath(cardUri);
    if (slug === undefined) {
      await vscode.window.showWarningMessage('지울 카드를 찾을 수 없습니다.');
      return;
    }

    const preview: RemoveCardResult = await this.dependencies.cards.remove({
      workspaceRoot,
      slug,
      shouldForce: false,
      isPreview: true,
    });
    if (!preview.ok) {
      await vscode.window.showWarningMessage(preview.message);
      return;
    }

    if (await this.confirm(workspaceRoot, slug, preview.plan)) {
      await runHoldingWorkspaceLock(this.dependencies.runGate, workspaceRoot, '카드 삭제', () =>
        this.remove(workspaceRoot, slug),
      );
    }
  }

  private async confirm(
    workspaceRoot: vscode.Uri,
    slug: string,
    plan: CardRemovalPlan,
  ): Promise<boolean> {
    const reading: CardReading | undefined = await this.dependencies.cards.read(
      workspaceRoot,
      slug,
    );
    const name: string = reading?.card.name ?? slug;
    const hasCleanup: boolean = plan.referencingPaths.length > 0 || plan.droppedLines.length > 0;
    const actionLabel: string = hasCleanup ? removeAndCleanLabel : removeLabel;
    const choice: string | undefined = await vscode.window.showWarningMessage(
      `${name}를 삭제할까요?`,
      { modal: true, detail: describeRemovalPrompt(name, plan) },
      actionLabel,
    );

    return choice === actionLabel;
  }

  private async remove(workspaceRoot: vscode.Uri, slug: string): Promise<void> {
    const removed: RemoveCardResult = await this.dependencies.cards.remove({
      workspaceRoot,
      slug,
      shouldForce: true,
    });
    if (!removed.ok) {
      await vscode.window.showWarningMessage(removed.message);
    }
  }
}
