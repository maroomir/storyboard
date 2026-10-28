import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { resolve } from 'node:path';
import { NodeUri } from '@storyboard/story-model';
import type { ExportNotesResult } from '@storyboard/story-engine';
import { failure, success } from '@/commands/outcomes';

export class NotesExportCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'notes export',
    group: '노트',
    usage: 'notes export <folder>',
    summary:
      '인물·배경·씬 카드와 시놉시스를 Obsidian 형식 Markdown 폴더로 내보냅니다 (AI 없음, Notion 가져오기에도 그대로 쓸 수 있음)',
    examples: ['storyboard notes export ~/Vault/달의문-내보내기'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
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
  }
}
