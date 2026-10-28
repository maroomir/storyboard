import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import type { GenerateOutlineResult } from '@storyboard/story-engine';

function describeOutlineResult(kind: string): string {
  switch (kind) {
    case 'generated':
      return '아웃라인을 생성했습니다.';
    case 'existing':
      return '아웃라인이 이미 있습니다. 덮어쓰려면 --force 를 주세요.';
    case 'missing_contract':
      return '작품 계약이 비어 아웃라인을 만들 수 없습니다. .storyboard/project.json 의 setting 을 채워 주세요.';
    default:
      return `아웃라인을 생성하지 못했습니다 (${kind}).`;
  }
}

export class OutlineGenerateCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'outline generate',
    writesWorkspace: true,
    group: '기획',
    usage: 'outline generate',
    summary: '작품 계약에서 시놉시스와 챕터 계획을 만듭니다',
    flags: ['force'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const outlineGeneration: GenerateOutlineResult = await container.novel.generateOutline({
      workspaceRoot: container.workspaceRoot,
      overwrite: flagBoolean(args.flags, 'force'),
      onProgress: (message: string) => container.progress.update({ line: message, step: message }),
    });

    return {
      ok: outlineGeneration.ok,
      message: describeOutlineResult(outlineGeneration.kind),
      data: outlineGeneration,
    };
  }
}
