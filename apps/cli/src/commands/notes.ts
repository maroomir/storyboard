import { NoteAbsorber, quoteShellValue } from '@/commands/noteAbsorber';
import { resolve } from 'node:path';
import { NodeUri } from '@storyboard/story-model';
import { type ExportNotesResult } from '@storyboard/story-engine';
import type { CliContainer } from '@/container';
import { defaultNoteSource, noteSources } from './catalog';
import type { CommandHandler } from './outcome';
import { askSecret, readStdin } from './prompt';
import { failure, success } from '@/commands/outcomes';

function canAsk(container: CliContainer): boolean {
  return container.canPrompt && process.stdin.isTTY === true;
}

export const absorbNotes: CommandHandler = async ({ container, args }) => {
  const rawLocation: string | undefined = args.positionals[0];

  if (rawLocation === undefined) {
    return failure(
      '노트 위치를 지정해 주세요: storyboard notes absorb <Obsidian 폴더·노트 | Notion 페이지 주소 | Notion 내보내기 zip>',
    );
  }

  return await new NoteAbsorber(container).absorb(args, rawLocation, {
    shouldFillContract: false,
    retryCommand: `storyboard notes absorb ${quoteShellValue(rawLocation)} --yes`,
  });
};

export const exportNotes: CommandHandler = async ({ container, args }) => {
  const rawTarget: string | undefined = args.positionals[0];

  if (rawTarget === undefined) {
    return failure('내보낼 폴더를 지정해 주세요: storyboard notes export <folder>');
  }

  const target: NodeUri = NodeUri.file(resolve(rawTarget));
  const notesExport: ExportNotesResult = await container.notes.export({
    workspaceRoot: container.workspaceRoot,
    target,
  });

  if (!notesExport.ok) {
    return failure(notesExport.message);
  }

  return success(
    `${target.fsPath} 에 노트 ${notesExport.written.length}장을 썼습니다. Obsidian 에서 폴더를 열거나 Notion 의 가져오기(Markdown)에 넣으세요. 다시 흡수하면 같은 카드로 이어집니다.`,
    { target: target.fsPath, written: notesExport.written },
  );
};

export const connectNotes: CommandHandler = async ({ container, args }) => {
  const source: string = args.positionals[0] ?? defaultNoteSource;

  if (!noteSources.some((candidate) => candidate === source)) {
    return failure(
      `연결할 수 있는 노트 출처가 아닙니다: ${source}\n쓸 수 있는 값: ${noteSources.join(', ')}`,
    );
  }

  const token: string = (
    canAsk(container)
      ? await askSecret(
          'Notion 통합 토큰을 붙여 넣고 Enter (입력은 화면에 보이지 않습니다. 비워 두면 삭제): ',
        )
      : await readStdin()
  ).trim();

  await container.notes.connectNotion(token);

  return token.length === 0
    ? success('Notion 토큰을 지웠습니다.')
    : success(
        [
          `Notion 토큰을 저장했습니다: ${container.homePaths.secretsFile}`,
          '읽을 페이지마다 Notion 에서 「연결」에 이 통합을 추가해야 합니다.',
        ].join('\n'),
      );
};
