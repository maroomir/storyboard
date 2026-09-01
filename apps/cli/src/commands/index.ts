import {
  draftPath,
  getStoryboardProjectPaths,
  scenePath,
  readProjectJson,
  type StoryUri,
} from '@storyboard/story-engine';

import { parseSceneFileName } from '@storyboard/story-format';

import type { CliContainer } from '../container';
import { flagBoolean, flagString, type ParsedArguments } from '../cliArguments';

export interface CommandOutcome {
  readonly ok: boolean;
  readonly message: string;
  readonly data?: unknown;
}

export interface CommandContext {
  readonly container: CliContainer;
  readonly args: ParsedArguments;
}

type CommandHandler = (context: CommandContext) => Promise<CommandOutcome>;

function sceneStemFrom(args: ParsedArguments): string | undefined {
  const raw = args.positionals[0];
  if (raw === undefined) {
    return undefined;
  }
  const fileName = raw.endsWith('.card') ? raw : `${raw}.card`;
  return parseSceneFileName(fileName)?.stem ?? raw.replace(/\.card$/, '');
}

function sceneUriFor(root: StoryUri, stem: string): StoryUri {
  return scenePath(root, stem);
}

const generateScene: CommandHandler = async ({ container, args }) => {
  if (flagBoolean(args.flags, 'all')) {
    const result = await container.generateAllDraftsUseCase.execute({
      onProgress: (progress) => container.logger.info(JSON.stringify(progress)),
    });

    if (!result.ok) {
      return { ok: false, message: describeBatchFailure(result.kind), data: result };
    }

    // A batch where scenes failed is not a success, however many others went through.
    const { cacheHits, failureLabels, failures, generated } = result.summary;

    return {
      ok: failures === 0,
      message:
        failures === 0
          ? `초안 ${generated}건 생성, ${cacheHits}건은 입력이 같아 그대로 둡니다.`
          : `${failures}건 실패 (생성 ${generated}건, 캐시 ${cacheHits}건): ${failureLabels.join(', ')}`,
      data: result.summary,
    };
  }

  const stem = sceneStemFrom(args);
  if (stem === undefined) {
    return {
      ok: false,
      message: '씬 stem을 지정해 주세요. 예: storyboard scene generate 01-scene-1-1',
    };
  }

  const result = await container.generateDraftUseCase.execute(
    sceneUriFor(container.workspaceRoot, stem),
    { force: flagBoolean(args.flags, 'force') },
  );

  if (!result.ok) {
    return { ok: false, message: result.kind === 'failed' ? result.message : '취소했습니다.' };
  }

  // `--no-revise` overrides the setting; without it the workspace's `draft.reviseAfterGenerate`
  // decides, exactly as it does in the extension and the bot.
  const reviseRequested =
    !flagBoolean(args.flags, 'no-revise') && container.configBridge.isReviseAfterGenerateEnabled();

  if (result.kind === 'generated' && reviseRequested) {
    const revised = await container.reviseAfterGenerateGate.runForScene(
      container.workspaceRoot,
      stem,
    );

    // A rejected candidate means the original was kept. Saying nothing would let an unattended run
    // record a revision that never happened.
    if (revised?.preservedOriginal === true && revised.rejection !== undefined) {
      container.logger.warn(
        `검수 재작성 결과가 안전 기준을 통과하지 않아 원본을 유지했습니다 ` +
          `(${revised.rejection.candidateLength}자 / 원본 ${revised.rejection.originalLength}자).`,
      );
    }
  }

  return {
    ok: true,
    message:
      result.kind === 'cache_hit' ? '입력이 같아 기존 초안을 씁니다.' : '초안을 생성했습니다.',
    data: { draft: (result.draftUri as StoryUri).fsPath },
  };
};

const reviseScene: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);
  if (stem === undefined) {
    return { ok: false, message: '씬 stem을 지정해 주세요.' };
  }

  const result = await container.reviseAfterGenerateGate.runForScene(container.workspaceRoot, stem);
  return result === undefined
    ? { ok: false, message: '초안이 없어 검수를 건너뛰었습니다.' }
    : { ok: true, message: '검수와 재작성을 마쳤습니다.', data: result };
};

const generateOutline: CommandHandler = async ({ container, args }) => {
  const result = await container.generateOutlineUseCase.execute(container.workspaceRoot, {
    overwrite: flagBoolean(args.flags, 'force'),
    onProgress: (message: string) => container.logger.info(message),
  });

  return { ok: result.ok, message: describeOutlineResult(result.kind), data: result };
};

function describeBatchFailure(kind: 'no_projects' | 'no_scenes'): string {
  return kind === 'no_projects'
    ? 'Storyboard 프로젝트를 찾을 수 없습니다.'
    : '생성할 씬이 없습니다. scene/*.card 를 먼저 만들어 주세요.';
}

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

const assembleManuscript: CommandHandler = async ({ container }) => {
  const result = await container.assembleManuscriptUseCase.execute(container.workspaceRoot);
  return {
    ok: result.ok,
    message: result.ok ? '원고를 조립했습니다.' : '조립하지 못했습니다.',
    data: result,
  };
};

const reviewManuscript: CommandHandler = async ({ container }) => {
  const result = await container.reviewManuscriptUseCase.execute(container.workspaceRoot);
  return {
    ok: result.ok,
    message: result.ok ? '원고 검사를 마쳤습니다.' : '검사하지 못했습니다.',
    data: result,
  };
};

const summarizeChapters: CommandHandler = async ({ container }) => {
  const result = await container.summarizeChaptersUseCase.execute(container.workspaceRoot);
  return {
    ok: result.ok,
    message: result.ok ? '장별 요약을 만들었습니다.' : '요약하지 못했습니다.',
    data: result,
  };
};

const generateNovel: CommandHandler = async ({ container, args }) => {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const project = await readProjectJson(container.fileSystem, paths.projectJson);
  const result = await container.novelPipeline.run({
    workspaceUri: container.workspaceRoot,
    project,
    // Every gate is auto-approved: a CLI run is unattended, and stopping to ask would stall a queue.
    runMode: 'auto',
    reviseMaxIterations: Number(flagString(args.flags, 'revise-iterations') ?? '2'),
    onProgress: (stage, message) => container.logger.info(`${stage}: ${message}`),
    requestApproval: async () => true,
    shouldCancel: () => false,
  });
  return {
    ok: result.outcome === 'completed',
    message: `장편 생성 ${result.outcome}: ${result.message}`,
    data: result,
  };
};

const showDraftPath: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);
  if (stem === undefined) {
    return { ok: false, message: '씬 stem을 지정해 주세요.' };
  }
  const uri = draftPath(container.workspaceRoot, stem) as StoryUri;
  return {
    ok: await container.fileSystem.exists(uri),
    message: uri.fsPath,
    data: { path: uri.fsPath },
  };
};

export const commands: Readonly<Record<string, CommandHandler>> = {
  'scene generate': generateScene,
  'scene revise': reviseScene,
  'scene draft': showDraftPath,
  'outline generate': generateOutline,
  'novel generate': generateNovel,
  'manuscript assemble': assembleManuscript,
  'manuscript review': reviewManuscript,
  'manuscript summaries': summarizeChapters,
};
