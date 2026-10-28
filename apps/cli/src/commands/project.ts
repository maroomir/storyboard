import { WorkspaceInput, type ContractInput } from '@/commands/workspaceInput';
import type { CommandHandler } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import type { UpdateProjectContractResult } from '@storyboard/story-engine';
import {
  compositionKindLabels,
  contractFieldLabels,
  pointOfViewLabels,
  validateGenerationContract,
  type ProjectSetting,
  type StoryboardProject,
} from '@storyboard/story-model';

export const setProjectContract: CommandHandler = async ({ container, args }) => {
  const contract: ContractInput = await new WorkspaceInput(container).readContract(args);

  if ('message' in contract) {
    return failure(contract.message);
  }

  if (contract.setting === undefined) {
    return failure(
      '바꿀 값을 지정해 주세요. --genre --audience --pov --target-words --chapters --scenes-per-chapter --concept --description --composition 또는 --from <json>.',
    );
  }

  const updated: UpdateProjectContractResult = await container.novel.updateContract({
    workspaceRoot: container.workspaceRoot,
    setting: contract.setting,
    ...(contract.narratorCards === undefined ? {} : { narratorCards: contract.narratorCards }),
  });

  if (!updated.ok) {
    return failure(updated.message);
  }

  return success('작품 계약을 갱신했습니다.', updated.setting);
};

export const showProject: CommandHandler = async ({ container }) => {
  const project: StoryboardProject = await container.novel.readProject(container.workspaceRoot);
  const setting: ProjectSetting | undefined = project.setting;
  const { missing } = validateGenerationContract(setting);
  const rows: readonly (readonly [string, string | number | undefined])[] = [
    [contractFieldLabels.genre, setting?.genre],
    [contractFieldLabels.audience, setting?.audience],
    [contractFieldLabels.pov, setting?.pov && `${setting.pov} (${pointOfViewLabels[setting.pov]})`],
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
};
