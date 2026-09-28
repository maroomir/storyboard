import * as vscode from 'vscode';

import type { CardManager } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import type { CardCandidateItem } from '@storyboard/story-engine';
import { getTargetWorkspaceFolder, hasStoryboardProject } from '@/infrastructure/vscode/workspace';

const promoteCommand = 'storyboard.cards.promoteCandidates';

interface CandidateQuickPickItem extends vscode.QuickPickItem {
  readonly item: CardCandidateItem;
}

function describeItem(item: CardCandidateItem): string {
  switch (item.kind) {
    case 'attribute':
      return `${item.cardId} — 속성 ${item.key}: ${item.value}`;
    case 'relation':
      return `${item.cardId} — 관계 ${item.target}: ${item.type}`;
    case 'arc':
      return `${item.cardId} — 아크 ${item.sceneRef}: ${item.summary}`;
  }
}

async function runPromote(
  logger: IStoryboardLogger,
  cards: Pick<CardManager, 'prepareCandidatePromotion' | 'promoteCandidates'>,
): Promise<void> {
  const folder = await getTargetWorkspaceFolder();

  if (!folder) {
    await vscode.window.showErrorMessage('Storyboard 워크스페이스 폴더를 찾을 수 없습니다.');
    return;
  }

  if (!(await hasStoryboardProject(folder))) {
    await vscode.window.showErrorMessage('Storyboard 프로젝트가 없습니다. 먼저 초기화해 주세요.');
    return;
  }

  const preparation = await cards.prepareCandidatePromotion(folder.uri);

  if (preparation.kind === 'no_candidates') {
    await vscode.window.showInformationMessage(
      '승격할 카드 후보가 없습니다. 먼저 초안을 생성해 주세요.',
    );
    return;
  }

  if (preparation.kind === 'no_new_candidates') {
    await vscode.window.showInformationMessage(
      '새로 승격할 후보가 없습니다. 이미 모두 카드에 반영되어 있습니다.',
    );
    return;
  }

  const quickPickItems: CandidateQuickPickItem[] = preparation.items.map((item) => ({
    label: describeItem(item),
    description: `후보 · ${item.sceneStem}`,
    item,
  }));

  const picked = await vscode.window.showQuickPick(quickPickItems, {
    canPickMany: true,
    title: '카드에 반영할 후보 선택',
    placeHolder: '캐릭터 카드에 추가할 관계·아크·속성을 선택하세요.',
  });

  if (!picked || picked.length === 0) {
    return;
  }

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '카드에 반영 중…' },
    () =>
      cards.promoteCandidates(
        folder.uri,
        picked.map((entry) => entry.item),
      ),
  );

  if (result.kind === 'save_failed') {
    logger.show();
    await vscode.window.showErrorMessage('카드 저장에 실패했습니다. Output 패널을 확인해 주세요.');
    return;
  }

  await vscode.window.showInformationMessage(
    `후보 ${picked.length}개를 카드 ${result.updatedCardCount}개에 반영했습니다.`,
  );
}

export function registerPromoteCardCandidatesCommand(dependencies: {
  readonly logger: IStoryboardLogger;
  readonly cards: Pick<CardManager, 'prepareCandidatePromotion' | 'promoteCandidates'>;
}): vscode.Disposable {
  return vscode.commands.registerCommand(promoteCommand, () =>
    runPromote(dependencies.logger, dependencies.cards),
  );
}
