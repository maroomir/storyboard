import type {
  BibleSubjectKind,
  CharacterRole,
  MergedNoteCardCandidate,
} from '@storyboard/story-model';

export function describeNoteConflicts(cards: readonly MergedNoteCardCandidate[]): string[] {
  const lines: string[] = cards.flatMap((card) =>
    card.conflicts.flatMap((conflict) => [
      `  보류      ${card.cardId} ${conflict.key} — 노트마다 값이 다릅니다`,
      ...conflict.options.map(
        (option) => `    [${option.ref}] ${option.value} ← ${option.locations.join(', ')}`,
      ),
    ]),
  );

  return lines.length === 0
    ? []
    : [...lines, '  하나만 남기려면: storyboard card discard <id> --change <ref>'];
}

export function describeCardBuild(writtenCount: number, needsId: readonly string[]): string {
  if (needsId.length === 0) {
    return `카드 ${writtenCount}개를 갱신했습니다.`;
  }

  return (
    `카드 ${writtenCount}개를 갱신했습니다. id 를 정할 수 없어 건너뛴 새 카드: ${needsId.join(', ')}. ` +
    'card create 로 --id 를 지정해 만든 뒤 다시 실행해 주세요.'
  );
}

export const cardCategoryLabels: Readonly<Record<BibleSubjectKind, string>> = {
  character: '인물',
  background: '배경',
};

export function cardIdFromUnreadableFileName(fileName: string): string {
  return fileName.replace(/\.card$/, '');
}

export interface CardListRow {
  readonly category: BibleSubjectKind;
  readonly id: string;
  readonly name: string | null;
  readonly role: CharacterRole | null;
  readonly error: string | null;
}
