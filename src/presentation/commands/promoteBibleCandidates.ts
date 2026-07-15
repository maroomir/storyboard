import * as vscode from 'vscode';

import type { PromoteBibleCandidatesUseCase } from '../../application/project/promoteBibleCandidatesUseCase';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import {
  getTargetWorkspaceFolder,
  hasStoryboardProject,
} from '../../infrastructure/vscode/workspace';
import type { BibleFact } from '../../shared/bible';

const promoteCommand = 'storyboard.bible.promoteCandidates';

interface CandidateQuickPickItem extends vscode.QuickPickItem {
  readonly fact: BibleFact;
}
async function runPromote(
  logger: StoryboardLogger,
  useCase: PromoteBibleCandidatesUseCase,
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

  const preparation = await useCase.prepare(folder.uri);

  if (preparation.kind === 'no_candidates') {
    await vscode.window.showInformationMessage(
      '승격할 설정 후보가 없습니다. 먼저 초안을 생성해 주세요.',
    );
    return;
  }

  if (preparation.kind === 'no_new_candidates') {
    await vscode.window.showInformationMessage(
      '새로 승격할 후보가 없습니다. 이미 모두 canon입니다.',
    );
    return;
  }

  const items: CandidateQuickPickItem[] = preparation.facts.map((fact) => ({
    label: `${fact.subject.id} — ${fact.key}: ${fact.value}`,
    description: fact.sourceScene ? `후보 · ${fact.sourceScene}` : '후보',
    fact,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: '스토리 바이블 canon으로 승격할 설정 선택',
    placeHolder: 'canon에 추가할 설정 사실을 선택하세요.',
  });

  if (!picked || picked.length === 0) {
    return;
  }

  try {
    await useCase.promote(
      folder.uri,
      picked.map((item) => item.fact),
    );
  } catch (error) {
    logger.error('Failed to write bible canon', error);
    logger.show();
    await vscode.window.showErrorMessage(
      'canon.yaml 저장에 실패했습니다. Output 패널을 확인해 주세요.',
    );
    return;
  }

  await vscode.window.showInformationMessage(`설정 ${picked.length}개를 canon으로 승격했습니다.`);
}

export function registerPromoteBibleCandidatesCommand(dependencies: {
  readonly logger: StoryboardLogger;
  readonly promoteBibleCandidatesUseCase: PromoteBibleCandidatesUseCase;
}): vscode.Disposable {
  return vscode.commands.registerCommand(promoteCommand, () =>
    runPromote(dependencies.logger, dependencies.promoteBibleCandidatesUseCase),
  );
}
