import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { NoteAbsorber, quoteShellValue } from '@/commands/noteAbsorber';
import { failure } from '@/commands/outcomes';

export class NotesAbsorbCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'notes absorb',
    writesWorkspace: true,
    group: '노트',
    usage: 'notes absorb <path|url|zip>',
    summary:
      'Obsidian 폴더·노트, Notion 페이지, Notion 내보내기 zip 을 하위 페이지까지 읽어 인물·배경·씬 카드와 시놉시스로 옮깁니다 (견적을 먼저 보여 줍니다, 기존 카드는 후보로만)',
    flags: ['yes', 'dry-run', 'replace-candidates'],
    examples: [
      'storyboard notes absorb ~/Vault/달의문',
      'storyboard notes absorb ~/Downloads/Export-달의문.zip',
      'storyboard notes absorb https://www.notion.so/team/Moon-Gate-1429989fe8ac4effbc8f57f56486db54 --yes',
      'storyboard notes absorb ~/Vault/달의문 --yes --dry-run',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
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
  }
}
