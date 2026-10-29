import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import { sceneStemFrom, sceneUriFor } from '@/commands/sceneArguments';
import type { CliContainer } from '@/container';
import type { GenerateSceneBeatsResult } from '@storyboard/story-engine';

class ScenePlotTally {
  private readonly beatsByStem: Record<string, unknown> = {};
  private readonly failures: string[] = [];
  private proposed: number = 0;

  public record(stem: string, beatGeneration: GenerateSceneBeatsResult): void {
    this.beatsByStem[stem] = beatGeneration;
    if (!beatGeneration.ok) {
      this.failures.push(stem);
    } else if (beatGeneration.kind === 'proposed') {
      this.proposed += 1;
    }
  }

  public toOutcome(sceneCount: number, dryRun: boolean): CommandOutcome {
    const { failures, proposed } = this;

    return {
      ok: failures.length === 0,
      message:
        failures.length === 0
          ? `씬 ${proposed}개의 비트를 ${dryRun ? '제안했습니다 (적용하지 않음)' : '썼습니다'}, ${sceneCount - proposed}개는 그대로 둡니다.`
          : `${failures.length}건 실패 (비트 ${proposed}개 처리): ${failures.join(', ')}`,
      data: { proposed, failures, results: this.beatsByStem },
    };
  }
}

export class ScenePlotCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene plot',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene plot <stem> | --all',
    summary:
      '씬 카드의 사건 비트를 전개해 beats 필드에 씁니다 (--force 로 다시, --dry-run 은 제안만)',
    flags: ['all', 'force', 'dry-run'],
    examples: ['storyboard scene plot 01-scene-1-1', 'storyboard scene plot --all --dry-run'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const force: boolean = flagBoolean(args.flags, 'force');
    const dryRun: boolean = flagBoolean(args.flags, 'dry-run');

    if (flagBoolean(args.flags, 'all')) {
      return this.plotAllScenes(container, force, dryRun);
    }

    const stem: string | undefined = sceneStemFrom(args);
    if (stem === undefined) {
      return failure('씬 stem을 지정해 주세요. 예: storyboard scene plot 01-scene-1-1');
    }

    const beatGeneration: GenerateSceneBeatsResult = await this.generateBeats(
      container,
      stem,
      force,
      dryRun,
    );
    if (!beatGeneration.ok) {
      return failure(beatGeneration.message);
    }

    if (beatGeneration.kind === 'kept') {
      return success(
        `이미 비트 ${beatGeneration.beats.length}개가 있습니다 (--force 로 다시 뽑습니다).`,
        { stem, beats: beatGeneration.beats, written: false },
      );
    }

    return success(
      beatGeneration.written
        ? `비트 ${beatGeneration.beats.length}개를 카드에 썼습니다.`
        : `비트 ${beatGeneration.beats.length}개를 제안했습니다 (적용하지 않음).`,
      { stem, beats: beatGeneration.beats, written: beatGeneration.written },
    );
  }

  private async plotAllScenes(
    container: CliContainer,
    force: boolean,
    dryRun: boolean,
  ): Promise<CommandOutcome> {
    const stems: string[] = (await container.drafts.listScenes(container.workspaceRoot)).map(
      (scene) => scene.stem,
    );
    const tally: ScenePlotTally = new ScenePlotTally();

    for (const stem of stems) {
      const beatGeneration: GenerateSceneBeatsResult = await this.generateBeats(
        container,
        stem,
        force,
        dryRun,
      );
      tally.record(stem, beatGeneration);
      if (beatGeneration.ok && beatGeneration.kind === 'proposed') {
        container.logger.info(`${stem}: 비트 ${beatGeneration.beats.length}개`);
      }
    }

    return tally.toOutcome(stems.length, dryRun);
  }

  private generateBeats(
    container: CliContainer,
    stem: string,
    force: boolean,
    dryRun: boolean,
  ): Promise<GenerateSceneBeatsResult> {
    return container.drafts.generateBeats({
      workspaceRoot: container.workspaceRoot,
      sceneUri: sceneUriFor(container.workspaceRoot, stem),
      fileName: `${stem}.card`,
      force,
      dryRun,
    });
  }
}
