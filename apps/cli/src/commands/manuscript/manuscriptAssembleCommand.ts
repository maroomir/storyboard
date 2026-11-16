import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import type { AssembleManuscriptResult } from '@storyboard/story-engine';

function describeAssembly(assembly: AssembleManuscriptResult): string {
  switch (assembly.kind) {
    case 'assembled':
      return '원고를 조립했습니다.';
    case 'missing_outline':
      return '장 계획(chapters.yaml)이 없어 조립하지 못했습니다. storyboard outline generate 를 먼저 실행해 주세요.';
    case 'missing_drafts':
      return '조립할 초안이 없습니다. storyboard draft generate --all 을 먼저 실행해 주세요.';
    case 'failed':
      return `조립하지 못했습니다: ${assembly.message}`;
  }
}

export class ManuscriptAssembleCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'manuscript assemble',
    writesWorkspace: true,
    group: '원고',
    usage: 'manuscript assemble',
    summary: 'draft/ 를 원고로 조립합니다',
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const assembly: AssembleManuscriptResult = await container.manuscript.assemble({
      workspaceRoot: container.workspaceRoot,
    });
    return {
      ok: assembly.ok,
      message: describeAssembly(assembly),
      data: assembly,
    };
  }
}
