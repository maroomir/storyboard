import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { CardManager, NoteManager } from '@storyboard/story-app';
import type {
  IStoryboardLogger,
  PrepareCardCandidatePromotionResult,
  PrepareNoteCandidatePromotionResult,
  PromoteCardCandidatesResult,
  PromoteNoteCandidatesResult,
} from '@storyboard/story-engine';
import type { CardCandidateItem, MergedNoteCardCandidate } from '@storyboard/story-model';
import { getTargetWorkspaceFolder, hasStoryboardProject } from '@/infrastructure/vscode/workspace';

type CandidateQuickPickItem = vscode.QuickPickItem &
  (
    | { readonly origin: 'draft'; readonly item: CardCandidateItem }
    | { readonly origin: 'note'; readonly candidate: MergedNoteCardCandidate }
  );

type NoteCandidateManager = Pick<NoteManager, 'prepareCandidatePromotion' | 'promoteCandidates'>;

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
  notes: NoteCandidateManager,
): Promise<void> {
  const folder: vscode.WorkspaceFolder | undefined = await getTargetWorkspaceFolder();

  if (!folder) {
    await vscode.window.showErrorMessage('Storyboard 워크스페이스 폴더를 찾을 수 없습니다.');
    return;
  }

  if (!(await hasStoryboardProject(folder))) {
    await vscode.window.showErrorMessage('Storyboard 프로젝트가 없습니다. 먼저 초기화해 주세요.');
    return;
  }

  const preparation: PrepareCardCandidatePromotionResult = await cards.prepareCandidatePromotion(
    folder.uri,
  );
  const notePreparation: PrepareNoteCandidatePromotionResult =
    await notes.prepareCandidatePromotion(folder.uri);

  if (preparation.kind !== 'ready' && notePreparation.kind !== 'ready') {
    await vscode.window.showInformationMessage(
      preparation.kind === 'no_candidates' && notePreparation.kind === 'no_candidates'
        ? '승격할 카드 후보가 없습니다. 먼저 초안을 생성하거나 노트를 흡수해 주세요.'
        : '새로 승격할 후보가 없습니다. 이미 모두 카드에 반영되어 있습니다.',
    );
    return;
  }

  const draftItems: CandidateQuickPickItem[] =
    preparation.kind === 'ready'
      ? preparation.items.map((item) => ({
          origin: 'draft',
          label: describeItem(item),
          description: `후보 · ${item.sceneStem}`,
          item,
        }))
      : [];
  const noteItems: CandidateQuickPickItem[] =
    notePreparation.kind === 'ready'
      ? notePreparation.candidates.map((candidate) => ({
          origin: 'note',
          label: `${candidate.cardId} (${candidate.name}) — 노트의 변경 ${candidate.changes.length}건`,
          description: `노트 · ${candidate.locations.join(', ')}${
            candidate.conflicts.length > 0
              ? ` · 값이 갈리는 칸 ${candidate.conflicts.length}개는 남습니다`
              : ''
          }`,
          candidate,
        }))
      : [];
  const quickPickItems: CandidateQuickPickItem[] = [...draftItems, ...noteItems];

  const picked: CandidateQuickPickItem[] | undefined = await vscode.window.showQuickPick(
    quickPickItems,
    {
      canPickMany: true,
      title: '카드에 반영할 후보 선택',
      placeHolder: '캐릭터 카드에 추가할 관계·아크·속성을 선택하세요.',
    },
  );

  if (!picked || picked.length === 0) {
    return;
  }

  const pickedDrafts: CardCandidateItem[] = picked.flatMap((entry) =>
    entry.origin === 'draft' ? [entry.item] : [],
  );
  const pickedNotes: MergedNoteCardCandidate[] = picked.flatMap((entry) =>
    entry.origin === 'note' ? [entry.candidate] : [],
  );
  const outcome: PromotionOutcome = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '카드에 반영 중…' },
    async () => {
      const drafts: PromoteCardCandidatesResult | undefined =
        pickedDrafts.length > 0
          ? await cards.promoteCandidates(folder.uri, pickedDrafts)
          : undefined;
      const noteResult: PromoteNoteCandidatesResult | undefined =
        pickedNotes.length > 0 ? await notes.promoteCandidates(folder.uri, pickedNotes) : undefined;
      return { drafts, noteResult };
    },
  );

  if (outcome.drafts !== undefined && outcome.drafts.kind === 'save_failed') {
    logger.show();
    await vscode.window.showErrorMessage('카드 저장에 실패했습니다. Output 패널을 확인해 주세요.');
    return;
  }

  const updatedCardCount: number =
    (outcome.drafts?.kind === 'promoted' ? outcome.drafts.updatedCardCount : 0) +
    (outcome.noteResult?.updatedCardIds.length ?? 0);
  await vscode.window.showInformationMessage(
    `후보 ${picked.length}개를 카드 ${updatedCardCount}개에 반영했습니다.`,
  );
}

interface PromotionOutcome {
  readonly drafts: PromoteCardCandidatesResult | undefined;
  readonly noteResult: PromoteNoteCandidatesResult | undefined;
}

export class PromoteCardCandidatesCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.cardsPromoteCandidates;

  public constructor(
    private readonly dependencies: {
      readonly logger: IStoryboardLogger;
      readonly cards: Pick<CardManager, 'prepareCandidatePromotion' | 'promoteCandidates'>;
      readonly notes: NoteCandidateManager;
    },
  ) {}

  public run(): unknown {
    return runPromote(this.dependencies.logger, this.dependencies.cards, this.dependencies.notes);
  }
}
