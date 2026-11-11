import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { NoteManager } from '@storyboard/story-app';
import type {
  PrepareNoteCandidatePromotionResult,
  PromoteNoteCandidatesResult,
} from '@storyboard/story-engine';
import type { MergedNoteCardCandidate } from '@storyboard/story-model';
import { getTargetWorkspaceFolder, hasStoryboardProject } from '@/infrastructure/vscode/workspace';

type CandidateQuickPickItem = vscode.QuickPickItem & {
  readonly candidate: MergedNoteCardCandidate;
};

type NoteCandidateManager = Pick<NoteManager, 'prepareCandidatePromotion' | 'promoteCandidates'>;

export class PromoteCardCandidatesCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.cardsPromoteCandidates;

  public constructor(
    private readonly dependencies: {
      readonly notes: NoteCandidateManager;
    },
  ) {}

  public async run(): Promise<void> {
    const folder: vscode.WorkspaceFolder | undefined = await resolveProjectFolder();

    if (!folder) {
      return;
    }

    const notePreparation: PrepareNoteCandidatePromotionResult =
      await this.dependencies.notes.prepareCandidatePromotion(folder.uri);

    if (notePreparation.kind !== 'ready') {
      await vscode.window.showInformationMessage(
        notePreparation.kind === 'no_candidates'
          ? '승격할 카드 후보가 없습니다. 먼저 노트를 흡수하거나 인터뷰를 마쳐 주세요.'
          : '새로 승격할 후보가 없습니다. 이미 모두 카드에 반영되어 있습니다.',
      );
      return;
    }

    const picked: CandidateQuickPickItem[] | undefined = await vscode.window.showQuickPick(
      createCandidatePicks(notePreparation),
      {
        canPickMany: true,
        title: '카드에 반영할 후보 선택',
        placeHolder: '캐릭터 카드에 추가할 관계·아크·속성을 선택하세요.',
      },
    );

    if (!picked || picked.length === 0) {
      return;
    }

    const noteResult: PromoteNoteCandidatesResult = await this.promotePicked(folder, picked);
    await vscode.window.showInformationMessage(
      `후보 ${picked.length}개를 카드 ${noteResult.updatedCardIds.length}개에 반영했습니다.`,
    );
  }

  private async promotePicked(
    folder: vscode.WorkspaceFolder,
    picked: readonly CandidateQuickPickItem[],
  ): Promise<PromoteNoteCandidatesResult> {
    const pickedNotes: MergedNoteCardCandidate[] = picked.map((entry) => entry.candidate);
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '카드에 반영 중…' },
      async () => await this.dependencies.notes.promoteCandidates(folder.uri, pickedNotes),
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

function createCandidatePicks(
  notePreparation: Extract<PrepareNoteCandidatePromotionResult, { readonly kind: 'ready' }>,
): CandidateQuickPickItem[] {
  return notePreparation.candidates.map((candidate) => ({
    label: `${candidate.cardId} (${candidate.name}) — 노트의 변경 ${candidate.changes.length}건`,
    description: `노트 · ${candidate.locations.join(', ')}${
      candidate.conflicts.length > 0
        ? ` · 값이 갈리는 칸 ${candidate.conflicts.length}개는 남습니다`
        : ''
    }`,
    candidate,
  }));
}
