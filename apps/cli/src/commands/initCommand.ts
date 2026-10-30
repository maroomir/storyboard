import type { WorkspaceRepairResult } from '@storyboard/story-app';
import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { ensureGitRepository, type GitRepositoryOutcome } from '@/adapters/gitRepository';
import type { IPrompter } from '@/adapters/prompter';
import { flagBoolean, flagString, type ParsedArguments } from '@/cliArguments';
import { WorkspaceInput, type ContractInput } from '@/commands/workspaceInput';
import { NoteAbsorber } from '@/commands/noteAbsorber';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import { mergeProjectSetting } from '@storyboard/story-engine';
import {
  compositionCatalog,
  compositionKinds,
  formatSceneOrderRanges,
  pointOfViewCatalog,
  type CompositionKind,
  getStoryboardProjectPaths,
  type PointOfView,
  type ProjectSetting,
  type StoryboardProject,
  type StoryboardProjectPaths,
  pointOfViews,
} from '@storyboard/story-model';

function describeGitRepository(outcome: GitRepositoryOutcome): string {
  switch (outcome) {
    case 'initialized':
      return ' git 저장소도 만들었습니다(main). 첫 커밋은 직접 남기세요.';
    case 'unavailable':
      return ' git 을 실행하지 못해 저장소는 만들지 않았습니다.';
    case 'exists':
      return '';
  }
}

type ContractAnswers = Record<string, string>;

interface ContractQuestion {
  readonly flag: string;
  readonly ask: (prompter: IPrompter) => Promise<ContractAnswers | undefined>;
}

const decideLater: string = '';

async function askGenre(prompter: IPrompter): Promise<ContractAnswers | undefined> {
  const genre: string | undefined = await prompter.askText({
    title: '장르',
    hint: '비우면 나중에',
  });
  if (genre === undefined) {
    return undefined;
  }
  prompter.announce(`◇  장르  › ${genre.length > 0 ? genre : '나중에'}`);
  return genre.length > 0 ? { genre } : {};
}

async function askPointOfView(prompter: IPrompter): Promise<ContractAnswers | undefined> {
  const pov: string | undefined = await prompter.choose<string>({
    title: '시점',
    details: [],
    options: [
      ...pointOfViews.map((value) => ({ label: pointOfViewCatalog[value].optionLabel, value })),
      { label: '나중에 정하기', value: decideLater },
    ],
  });
  if (pov === undefined) {
    return undefined;
  }
  prompter.announce(
    `◇  시점  › ${pov === decideLater ? '나중에' : pointOfViewCatalog[pov as PointOfView].label}`,
  );
  return pov === decideLater ? {} : { pov };
}

async function askComposition(prompter: IPrompter): Promise<ContractAnswers | undefined> {
  const composition: CompositionKind | undefined = await prompter.choose<CompositionKind>({
    title: '구성',
    details: [],
    options: compositionKinds.map((value) => ({
      label: compositionCatalog[value].optionLabel,
      value,
    })),
  });
  if (composition === undefined) {
    return undefined;
  }
  prompter.announce(`◇  구성  › ${compositionCatalog[composition].label}`);
  return { composition };
}

const contractQuestions: readonly ContractQuestion[] = [
  { flag: 'genre', ask: askGenre },
  { flag: 'pov', ask: askPointOfView },
  { flag: 'composition', ask: askComposition },
];

export class InitCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'init',
    group: '시작하기',
    usage: 'init --title <name> | init --repair',
    summary:
      '현재 디렉터리를 Storyboard 워크스페이스로 만듭니다 (작품 계약도 함께 받고, git 저장소가 아니면 git init 도 합니다 — 첫 커밋은 직접). --repair 는 0.8 이전 워크스페이스의 발판을 보수하고 이야기 상태 원장을 봉인합니다',
    flags: [
      'title',
      'repair',
      'language',
      'from',
      'genre',
      'audience',
      'pov',
      'target-words',
      'chapters',
      'scenes-per-chapter',
      'concept',
      'description',
      'composition',
      'episodes',
      'pov-characters',
      'from-notes',
      'yes',
      'dry-run',
    ],
    examples: [
      'storyboard init --title "밤의 항해"',
      'storyboard init --title "밤의 항해" --genre 미스터리 --audience 성인 --pov third-limited --target-words 300000',
      'storyboard init --repair',
      'storyboard init --title "달의 문" --from-notes ~/Vault/달의문',
      'storyboard init --title "네 개의 밤" --composition omnibus --episodes 4',
    ],
    needsWorkspace: false,
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(container.workspaceRoot);

    const isExistingWorkspace: boolean = await container.fileSystem.exists(paths.projectJson);

    if (flagBoolean(args.flags, 'repair')) {
      return this.repairWorkspace(container, paths, isExistingWorkspace);
    }

    if (isExistingWorkspace) {
      return failure(
        '이미 Storyboard 워크스페이스입니다. 발판만 보수하려면 storyboard init --repair',
      );
    }

    const name: string | undefined = flagString(args.flags, 'title') ?? args.positionals[0];
    const hasName: boolean = name !== undefined && name.trim().length > 0;

    if (!hasName && container.prompter !== undefined) {
      const answers: ContractAnswers | undefined = await this.askContract(container.prompter, args);

      return answers === undefined
        ? { ok: false, message: '취소했습니다. 아무것도 만들지 않았습니다.', stop: 'cancelled' }
        : this.execute({ container, args: { ...args, flags: { ...args.flags, ...answers } } });
    }

    if (name === undefined || !hasName) {
      return failure('작품 이름이 필요합니다: storyboard init --title "작품 이름"');
    }

    return this.createWorkspace(container, args, name);
  }

  private async repairWorkspace(
    container: CliContainer,
    paths: StoryboardProjectPaths,
    isExistingWorkspace: boolean,
  ): Promise<CommandOutcome> {
    if (!isExistingWorkspace) {
      return failure('Storyboard 워크스페이스가 아닙니다: storyboard init --title "작품 이름"');
    }

    const { addedAgentGuides, sealedSceneOrders }: WorkspaceRepairResult =
      await container.workspace.repair(container.workspaceRoot);
    const gitRepository: GitRepositoryOutcome = ensureGitRepository(container.workspaceRoot.fsPath);

    return success(
      (sealedSceneOrders.length === 0
        ? '디렉터리와 .gitignore 를 최신으로 맞췄습니다. 작품 계약은 그대로입니다.'
        : `디렉터리와 .gitignore 를 최신으로 맞추고, 이야기 상태 원장의 씬 ${formatSceneOrderRanges(sealedSceneOrders)}를 지금의 카드·씬으로 봉인했습니다. 작품 계약은 그대로입니다.`) +
        (addedAgentGuides.length === 0
          ? ''
          : ` 에이전트 지침 ${addedAgentGuides.join(', ')} 를 추가했습니다.`) +
        describeGitRepository(gitRepository),
      { repaired: true, sealedSceneOrders, addedAgentGuides, gitRepository },
    );
  }

  private async createWorkspace(
    container: CliContainer,
    args: ParsedArguments,
    name: string,
  ): Promise<CommandOutcome> {
    const contract: ContractInput = await new WorkspaceInput(container).readContract(args);

    if ('message' in contract) {
      return failure(contract.message);
    }

    const language: string | undefined = flagString(args.flags, 'language');
    const setting: ProjectSetting | undefined =
      contract.setting === undefined ? undefined : mergeProjectSetting(undefined, contract.setting);
    const { project, createdNarrators } = await container.workspace.create({
      workspaceRoot: container.workspaceRoot,
      name,
      ...(language === undefined ? {} : { language }),
      ...(setting === undefined ? {} : { setting }),
      narratorCards: contract.narratorCards ?? [],
    });
    const gitRepository: GitRepositoryOutcome = ensureGitRepository(container.workspaceRoot.fsPath);
    const fromNotes: string | undefined = flagString(args.flags, 'from-notes');

    if (fromNotes !== undefined) {
      return this.absorbNotesIntoCreated(container, args, fromNotes, project, gitRepository);
    }

    return this.describeCreatedWorkspace(container, project, createdNarrators, gitRepository);
  }

  private async absorbNotesIntoCreated(
    container: CliContainer,
    args: ParsedArguments,
    fromNotes: string,
    project: StoryboardProject,
    gitRepository: GitRepositoryOutcome,
  ): Promise<CommandOutcome> {
    const absorbed: CommandOutcome = await new NoteAbsorber(container).absorb(args, fromNotes, {
      shouldFillContract: true,
      retryCommand: `storyboard notes absorb '${fromNotes.replace(/'/g, `'\\''`)}' --yes`,
    });

    return {
      ok: absorbed.ok,
      message:
        `${project.name} 워크스페이스를 만들었습니다: ${container.workspaceRoot.fsPath}` +
        `${describeGitRepository(gitRepository)}\n${absorbed.message}`,
      data: { id: project.id, name: project.name, gitRepository, notes: absorbed.data ?? null },
    };
  }

  private describeCreatedWorkspace(
    container: CliContainer,
    project: StoryboardProject,
    createdNarrators: readonly string[],
    gitRepository: GitRepositoryOutcome,
  ): CommandOutcome {
    return success(
      [
        `${project.name} 워크스페이스를 만들었습니다: ${container.workspaceRoot.fsPath}` +
          describeGitRepository(gitRepository),
        ...(createdNarrators.length > 0
          ? [`서술자 카드를 만들었습니다: ${createdNarrators.join(', ')}`]
          : []),
        ...(container.configBridge.isDefaultProviderConfigured()
          ? []
          : ['AI 프로바이더가 아직 없습니다: `storyboard setup`']),
      ].join('\n'),
      {
        id: project.id,
        name: project.name,
        format: project.format,
        setting: project.setting,
        gitRepository,
      },
    );
  }

  private async askContract(
    prompter: IPrompter,
    args: ParsedArguments,
  ): Promise<ContractAnswers | undefined> {
    prompter.announce('┌  새 작품 만들기');

    const title: string | undefined = await prompter.askText({ title: '작품 이름' });
    if (title === undefined || title.length === 0) {
      return undefined;
    }
    prompter.announce(`◇  작품 이름  › ${title}`);
    const answers: ContractAnswers = { title };

    for (const question of contractQuestions) {
      if (flagString(args.flags, question.flag) !== undefined) {
        continue;
      }

      const answer: ContractAnswers | undefined = await question.ask(prompter);
      if (answer === undefined) {
        return undefined;
      }
      Object.assign(answers, answer);
    }

    prompter.announce('└  만드는 중…');
    return answers;
  }
}
