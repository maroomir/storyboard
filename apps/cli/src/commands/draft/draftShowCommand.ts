import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { failure, success } from '@/commands/outcomes';
import type { DraftReading } from '@storyboard/story-app';
import type { StoryUri } from '@storyboard/story-model';

export class DraftShowCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'draft show',
    group: '초안',
    usage: 'draft show <stem>',
    summary: '초안 본문을 출력합니다 (--json 이면 경로·분량·생성 정보도)',
    examples: [
      'storyboard draft show 01-scene-1-1',
      'storyboard draft show 01-scene-1-1 --json | jq -r .data.path',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const stem: string | undefined = args.positionals[0]?.replace(/\.card$/, '');

    if (stem === undefined) {
      return failure('씬 stem 을 지정해 주세요: storyboard draft show <stem>');
    }

    const reading: DraftReading | undefined = await container.drafts.readDraft(
      container.workspaceRoot,
      stem,
    );

    if (reading === undefined) {
      return failure(`초안이 없습니다: ${stem}`);
    }

    const { draft } = reading;

    return success(draft.body.trimEnd(), {
      stem,
      path: (reading.uri as StoryUri).fsPath,
      characterCount: draft.body.length,
      generatedAt: draft.generatedAt,
      providerId: draft.providerId ?? null,
      model: draft.model ?? null,
      warnings: draft.warnings ?? [],
      body: draft.body,
    });
  }
}
