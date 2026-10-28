import { ensureGitRepository, type GitRepositoryOutcome } from '@/adapters/gitRepository';
import type { IPrompter } from '@/adapters/prompter';
import { flagBoolean, flagString, type ParsedArguments } from '@/cliArguments';
import { readContractInput, type ContractInput } from '@/commands/contractInput';
import { runNoteAbsorb } from '@/commands/notes';
import type { CommandHandler, CommandOutcome } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import {
  createStoryboardDirectories,
  createWorkspace,
  ensureWorkspaceGitignore,
  mergeProjectSetting,
  sealStoryMemory,
  writeWorkspaceAgentGuidesIfMissing,
  ProjectRepository,
} from '@storyboard/story-engine';
import {
  compositionCatalog,
  compositionKinds,
  formatSceneOrderRanges,
  pointOfViewCatalog,
  pointOfViews,
  type CompositionKind,
  getStoryboardProjectPaths,
  type PointOfView,
  type ProjectSetting,
  type StoryboardProject,
  type StoryboardProjectPaths,
} from '@storyboard/story-model';

async function sealWorkspaceStoryState(
  container: CliContainer,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
): Promise<readonly number[]> {
  const project: StoryboardProject | undefined = await new ProjectRepository(container.fileSystem)
    .read(paths.projectJson)
    .catch(() => undefined);

  if (project === undefined) {
    return [];
  }

  return await sealStoryMemory({
    fileSystem: container.fileSystem,
    paths,
    format: project.format,
    sceneBreakJoiner: container.configBridge.getDraftSceneBreakSeparator(),
  });
}

export const initProject: CommandHandler = async ({ container, args }) => {
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(container.workspaceRoot);

  const isExistingWorkspace: boolean = await container.fileSystem.exists(paths.projectJson);

  if (flagBoolean(args.flags, 'repair')) {
    if (!isExistingWorkspace) {
      return failure('Storyboard 워크스페이스가 아닙니다: storyboard init --title "작품 이름"');
    }

    await createStoryboardDirectories(container.fileSystem, paths);
    await ensureWorkspaceGitignore(container.fileSystem, paths.gitignore);
    const addedAgentGuides: string[] = await writeWorkspaceAgentGuidesIfMissing(
      container.fileSystem,
      paths,
    );
    const gitRepository: GitRepositoryOutcome = ensureGitRepository(container.workspaceRoot.fsPath);
    const sealedSceneOrders: readonly number[] = await sealWorkspaceStoryState(container, paths);

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

  if (isExistingWorkspace) {
    return failure(
      '이미 Storyboard 워크스페이스입니다. 발판만 보수하려면 storyboard init --repair',
    );
  }

  const name: string | undefined = flagString(args.flags, 'title') ?? args.positionals[0];
  const hasName: boolean = name !== undefined && name.trim().length > 0;

  if (!hasName && container.prompter !== undefined) {
    const answers: Record<string, string> | undefined = await askInitContract(
      container.prompter,
      args,
    );

    return answers === undefined
      ? { ok: false, message: '취소했습니다. 아무것도 만들지 않았습니다.', stop: 'cancelled' }
      : initProject({ container, args: { ...args, flags: { ...args.flags, ...answers } } });
  }

  if (name === undefined || !hasName) {
    return failure('작품 이름이 필요합니다: storyboard init --title "작품 이름"');
  }

  const contract: ContractInput = await readContractInput(container, args);

  if ('message' in contract) {
    return failure(contract.message);
  }

  const language: string | undefined = flagString(args.flags, 'language');
  const setting: ProjectSetting | undefined =
    contract.setting === undefined ? undefined : mergeProjectSetting(undefined, contract.setting);
  const { project, createdNarrators } = await createWorkspace({
    fileSystem: container.fileSystem,
    workspaceRoot: container.workspaceRoot,
    name,
    ...(language === undefined ? {} : { language }),
    ...(setting === undefined ? {} : { setting }),
    narratorCards: contract.narratorCards ?? [],
  });
  const gitRepository: GitRepositoryOutcome = ensureGitRepository(container.workspaceRoot.fsPath);
  const fromNotes: string | undefined = flagString(args.flags, 'from-notes');

  if (fromNotes !== undefined) {
    const absorbed: CommandOutcome = await runNoteAbsorb(container, args, fromNotes, {
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
};

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

async function askInitContract(
  prompter: IPrompter,
  args: ParsedArguments,
): Promise<Record<string, string> | undefined> {
  const later: string = '';
  prompter.announce('┌  새 작품 만들기');

  const title: string | undefined = await prompter.askText({ title: '작품 이름' });
  if (title === undefined || title.length === 0) {
    return undefined;
  }
  prompter.announce(`◇  작품 이름  › ${title}`);
  const answers: Record<string, string> = { title };

  if (flagString(args.flags, 'genre') === undefined) {
    const genre: string | undefined = await prompter.askText({
      title: '장르',
      hint: '비우면 나중에',
    });
    if (genre === undefined) {
      return undefined;
    }
    prompter.announce(`◇  장르  › ${genre.length > 0 ? genre : '나중에'}`);
    if (genre.length > 0) {
      answers.genre = genre;
    }
  }

  if (flagString(args.flags, 'pov') === undefined) {
    const pov: string | undefined = await prompter.choose<string>({
      title: '시점',
      details: [],
      options: [
        ...pointOfViews.map((value) => ({ label: pointOfViewCatalog[value].optionLabel, value })),
        { label: '나중에 정하기', value: later },
      ],
    });
    if (pov === undefined) {
      return undefined;
    }
    prompter.announce(
      `◇  시점  › ${pov === later ? '나중에' : pointOfViewCatalog[pov as PointOfView].label}`,
    );
    if (pov !== later) {
      answers.pov = pov;
    }
  }

  if (flagString(args.flags, 'composition') === undefined) {
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
    answers.composition = composition;
  }

  prompter.announce('└  만드는 중…');
  return answers;
}
