import {
  joinStoryPath,
  type StoryUri,
  parseSceneCard,
  type SceneCard,
} from '@storyboard/story-model';
import type { CliContainer } from '@/container';
import type { CommandOutcome } from '@/commands/outcome';
import type { WorkspaceStatus } from '@storyboard/story-app';
import type { AiProviderId } from '@storyboard/story-model';
import { flagString, type ParsedArguments } from '@/cliArguments';
import { buildCompositionPreset, type CompositionPreset } from '@storyboard/story-engine';
import {
  compositionKinds,
  extractErrorMessage,
  NodeUri,
  pointOfViews,
  type CompositionKind,
  type NarratorCard,
  type PointOfView,
  type ProjectSetting,
} from '@storyboard/story-model';
import { resolve } from 'node:path';

export interface ReadSceneCardsResult {
  readonly cards: readonly { readonly fileName: string; readonly card: SceneCard }[];
  readonly unreadable: readonly string[];
}

export type ContractInput =
  | {
      readonly setting: Partial<ProjectSetting> | undefined;
      readonly narratorCards?: readonly NarratorCard[];
    }
  | { readonly message: string };

interface PaidRunSummary {
  readonly title: string;
  readonly details: readonly string[];
}

export const cancelledBeforeRun: CommandOutcome = {
  ok: false,
  message: '취소했습니다. 아무것도 생성하지 않았습니다.',
  stop: 'cancelled',
};

export class WorkspaceInput {
  public constructor(private readonly container: CliContainer) {}

  public async readSceneCards(
    sceneDirectory: StoryUri,
    fileNames: readonly string[],
  ): Promise<ReadSceneCardsResult> {
    const cards: { fileName: string; card: SceneCard }[] = [];
    const unreadable: string[] = [];

    for (const fileName of fileNames.filter((name) => name.endsWith('.card'))) {
      const uri: StoryUri = joinStoryPath(sceneDirectory, fileName);
      const text: string = new TextDecoder().decode(await this.container.fileSystem.readFile(uri));

      try {
        cards.push({ fileName, card: parseSceneCard(text) });
      } catch {
        unreadable.push(fileName);
      }
    }

    return { cards, unreadable };
  }

  public async readContract(args: ParsedArguments): Promise<ContractInput> {
    const fromPath: string | undefined = flagString(args.flags, 'from');
    let fromFile: Partial<ProjectSetting> | undefined;

    if (fromPath !== undefined) {
      try {
        const bytes: Uint8Array = await this.container.fileSystem.readFile(
          NodeUri.file(resolve(fromPath)),
        );
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return { message: `${fromPath} 의 최상위는 객체여야 합니다.` };
        }

        const record: Record<string, unknown> = parsed as Record<string, unknown>;
        fromFile = (record.setting ?? record) as Partial<ProjectSetting>;
      } catch (error) {
        return {
          message: `${fromPath} 를 읽지 못했습니다: ${extractErrorMessage(error)}`,
        };
      }
    }

    const pov: string | undefined = flagString(args.flags, 'pov');

    if (pov !== undefined && !pointOfViews.includes(pov as PointOfView)) {
      return { message: `--pov 는 ${pointOfViews.join(', ')} 중 하나여야 합니다.` };
    }

    const numbers: Array<[keyof ProjectSetting, string]> = [
      ['targetWordCount', 'target-words'],
      ['chapterCount', 'chapters'],
      ['scenesPerChapter', 'scenes-per-chapter'],
    ];
    const parsedNumbers: Record<string, number> = {};

    for (const [key, flag] of numbers) {
      const raw: string | undefined = flagString(args.flags, flag);

      if (raw === undefined) {
        continue;
      }

      const parsedNumber: number = Number(raw);

      if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
        return { message: `--${flag} 는 양의 정수여야 합니다: ${raw}` };
      }

      parsedNumbers[key] = parsedNumber;
    }

    const composition: string | undefined = flagString(args.flags, 'composition');

    if (composition !== undefined && !compositionKinds.includes(composition as CompositionKind)) {
      return { message: `--composition 은 ${compositionKinds.join(', ')} 중 하나여야 합니다.` };
    }

    const episodesRaw: string | undefined = flagString(args.flags, 'episodes');
    const episodeCount: number | undefined =
      episodesRaw === undefined ? undefined : Number(episodesRaw);

    if (episodeCount !== undefined && (!Number.isInteger(episodeCount) || episodeCount <= 0)) {
      return { message: `--episodes 는 양의 정수여야 합니다: ${episodesRaw}` };
    }

    const povCharacters: string[] = (flagString(args.flags, 'pov-characters') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const preset: CompositionPreset | undefined =
      composition === undefined
        ? undefined
        : buildCompositionPreset({
            composition: composition as CompositionKind,
            ...(episodeCount === undefined ? {} : { episodeCount }),
            ...(povCharacters.length > 0 ? { povCharacters } : {}),
            ...(pov === undefined ? {} : { pov: pov as PointOfView }),
          });

    const fromFlags: Partial<ProjectSetting> = {
      ...(flagString(args.flags, 'genre') === undefined
        ? {}
        : { genre: flagString(args.flags, 'genre') }),
      ...(flagString(args.flags, 'audience') === undefined
        ? {}
        : { audience: flagString(args.flags, 'audience') }),
      ...(pov === undefined ? {} : { pov: pov as PointOfView }),
      ...(flagString(args.flags, 'concept') === undefined
        ? {}
        : { concept: flagString(args.flags, 'concept') }),
      ...(flagString(args.flags, 'description') === undefined
        ? {}
        : { description: flagString(args.flags, 'description') }),
      ...parsedNumbers,
      ...(preset?.setting ?? {}),
    };

    const merged: Partial<ProjectSetting> = { ...(fromFile ?? {}), ...fromFlags };

    return {
      setting: Object.keys(merged).length === 0 ? undefined : merged,
      ...(preset && preset.narratorCards.length > 0 ? { narratorCards: preset.narratorCards } : {}),
    };
  }

  public async confirmPaidRun(
    summarize: (status: WorkspaceStatus) => PaidRunSummary,
  ): Promise<boolean> {
    const { prompter } = this.container;

    if (prompter === undefined || !prompter.shouldConfirmPaidRuns) {
      return true;
    }

    const { title, details } = summarize(await this.container.describeWorkspace());
    const answer: boolean | undefined = await prompter.choose({
      title,
      details: [...details, `모델  ${this.describeModel()}`],
      options: [
        { label: '진행', value: true },
        { label: '취소', value: false },
      ],
    });
    return answer === true;
  }

  private describeModel(): string {
    const { configBridge } = this.container;
    const provider: AiProviderId = configBridge.getDefaultProvider();
    const model: string | undefined = configBridge.getProviderConfig(provider).model;
    return model === undefined ? provider : `${provider} · ${model}`;
  }
}
