import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { success } from '@/commands/outcomes';
import {
  compositionKindLabels,
  contractFieldLabels,
  pointOfViewLabels,
  validateGenerationContract,
  type ProjectSetting,
  type StoryboardProject,
} from '@storyboard/story-model';

export class ProjectShowCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'project show',
    group: '기획',
    usage: 'project show',
    summary: '작품 이름과 계약(장르·독자층·시점·분량·구성)을 보여 줍니다',
    examples: ['storyboard project show', 'storyboard project show --json'],
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const project: StoryboardProject = await container.project.read(container.workspaceRoot);
    const setting: ProjectSetting | undefined = project.setting;
    const { missing } = validateGenerationContract(setting);
    const rows: readonly (readonly [string, string | number | undefined])[] = [
      [contractFieldLabels.genre, setting?.genre],
      [contractFieldLabels.audience, setting?.audience],
      [
        contractFieldLabels.pov,
        setting?.pov && `${setting.pov} (${pointOfViewLabels[setting.pov]})`,
      ],
      [contractFieldLabels.targetWordCount, setting?.targetWordCount],
      [
        '구성',
        setting?.composition &&
          `${setting.composition} (${compositionKindLabels[setting.composition]})`,
      ],
      ['장 수', setting?.chapterCount],
      ['장당 씬 수', setting?.scenesPerChapter],
      ['콘셉트', setting?.concept],
      ['설명', setting?.description],
    ];

    return success(
      [
        `${project.name} (${project.format}, ${project.language})`,
        ...rows.map(([label, value]) => `${label}: ${value ?? '—'}`),
        ...(missing.length === 0
          ? []
          : [
              '',
              `비어 있어 생성할 수 없는 항목: ${missing.map((key) => contractFieldLabels[key]).join(', ')} (storyboard project set)`,
            ]),
      ].join('\n'),
      {
        id: project.id,
        name: project.name,
        format: project.format,
        language: project.language,
        setting: setting ?? null,
        missing,
      },
    );
  }
}
