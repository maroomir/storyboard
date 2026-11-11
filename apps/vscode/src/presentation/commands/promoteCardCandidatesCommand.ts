import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { CardManager } from '@storyboard/story-app';
import type { PendingCardSummary } from '@storyboard/story-engine';
import { getTargetWorkspaceFolder, hasStoryboardProject } from '@/infrastructure/vscode/workspace';

type CandidateQuickPickItem = vscode.QuickPickItem & {
  readonly card: PendingCardSummary;
};

type PendingCardManager = Pick<CardManager, 'listPendingCards' | 'applyPending'>;

export class PromoteCardCandidatesCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.cardsPromoteCandidates;

  public constructor(
    private readonly dependencies: {
      readonly cards: PendingCardManager;
    },
  ) {}

  public async run(): Promise<void> {
    const folder: vscode.WorkspaceFolder | undefined = await resolveProjectFolder();

    if (!folder) {
      return;
    }

    const pending: readonly PendingCardSummary[] = await this.dependencies.cards.listPendingCards(
      folder.uri,
    );

    if (pending.length === 0) {
      await vscode.window.showInformationMessage(
        '반영할 카드 제안이 없습니다. 먼저 노트를 흡수하거나 인터뷰를 마쳐 주세요.',
      );
      return;
    }

    const picked: CandidateQuickPickItem[] | undefined = await vscode.window.showQuickPick(
      createCandidatePicks(pending),
      {
        canPickMany: true,
        title: '카드에 반영할 제안 선택',
        placeHolder: '제안을 반영할 카드를 선택하세요.',
      },
    );

    if (!picked || picked.length === 0) {
      return;
    }

    await this.applyPicked(folder, picked);
    await vscode.window.showInformationMessage(`카드 ${picked.length}개에 제안을 반영했습니다.`);
  }

  private async applyPicked(
    folder: vscode.WorkspaceFolder,
    picked: readonly CandidateQuickPickItem[],
  ): Promise<void> {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '카드에 반영 중…' },
      async () => {
        for (const entry of picked) {
          await this.dependencies.cards.applyPending(folder.uri, entry.card.slug);
        }
      },
    );
  }
}

async function resolveProjectFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folder: vscode.WorkspaceFolder | undefined = await getTargetWorkspaceFolder();

  if (!folder) {
    await vscode.window.showErrorMessage('Storyboard 워크스페이스 폴더를 찾을 수 없습니다.');
    return undefined;
  }

  if (!(await hasStoryboardProject(folder))) {
    await vscode.window.showErrorMessage('Storyboard 프로젝트가 없습니다. 먼저 초기화해 주세요.');
    return undefined;
  }

  return folder;
}

function createCandidatePicks(pending: readonly PendingCardSummary[]): CandidateQuickPickItem[] {
  return pending.map((card) => ({
    label: `${card.slug} (${card.name}) — 제안 ${card.changeCount}건`,
    description: card.origins.join(', '),
    card,
  }));
}
