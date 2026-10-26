import { flagBoolean, flagString } from '@/cliArguments';
import { describeSceneNarration } from '@/commands/narrator';
import type { CommandHandler } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import { sceneStemFrom, sceneUriFor } from '@/commands/sceneArguments';
import type { CliContainer } from '@/container';
import type {
  CompleteStoryScenesProposal,
  CreateSceneResult,
  GenerateSceneBeatsResult,
  RenameSceneResult,
  SeedScenesResult,
} from '@storyboard/story-engine';
import {
  mainThreadId,
  slugify,
  type SceneFile,
  type SceneListItem,
  type StoryUri,
} from '@storyboard/story-model';

export const generateSceneBeats: CommandHandler = async ({ container, args }) => {
  const force: boolean = flagBoolean(args.flags, 'force');
  const dryRun: boolean = flagBoolean(args.flags, 'dry-run');

  if (flagBoolean(args.flags, 'all')) {
    const stems: string[] = (await container.drafts.listScenes(container.workspaceRoot)).map(
      (scene) => scene.stem,
    );
    const beatsByStem: Record<string, unknown> = {};
    const failures: string[] = [];
    let proposed: number = 0;

    for (const stem of stems) {
      const beatGeneration: GenerateSceneBeatsResult = await runSceneBeats(
        container,
        stem,
        force,
        dryRun,
      );
      beatsByStem[stem] = beatGeneration;
      if (!beatGeneration.ok) {
        failures.push(stem);
      } else if (beatGeneration.kind === 'proposed') {
        proposed += 1;
        container.logger.info(`${stem}: 비트 ${beatGeneration.beats.length}개`);
      }
    }

    return {
      ok: failures.length === 0,
      message:
        failures.length === 0
          ? `씬 ${proposed}개의 비트를 ${dryRun ? '제안했습니다 (적용하지 않음)' : '썼습니다'}, ${stems.length - proposed}개는 그대로 둡니다.`
          : `${failures.length}건 실패 (비트 ${proposed}개 처리): ${failures.join(', ')}`,
      data: { proposed, failures, results: beatsByStem },
    };
  }

  const stem: string | undefined = sceneStemFrom(args);
  if (stem === undefined) {
    return failure('씬 stem을 지정해 주세요. 예: storyboard scene plot 01-scene-1-1');
  }

  const beatGeneration: GenerateSceneBeatsResult = await runSceneBeats(
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
};

function runSceneBeats(
  container: CliContainer,
  stem: string,
  force: boolean,
  dryRun: boolean,
): ReturnType<CliContainer['drafts']['generateBeats']> {
  return container.drafts.generateBeats({
    workspaceRoot: container.workspaceRoot,
    sceneUri: sceneUriFor(container.workspaceRoot, stem),
    fileName: `${stem}.card`,
    force,
    dryRun,
  });
}

export const showScene: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);

  if (stem === undefined) {
    return failure('씬 stem 을 지정해 주세요.');
  }

  const scene: SceneFile | undefined = await container.drafts.readScene(
    container.workspaceRoot,
    stem,
  );

  if (scene === undefined) {
    return failure(`씬을 찾을 수 없습니다: ${stem}`);
  }
  const narration: string = await describeSceneNarration(
    container,
    scene.card.narrator,
    scene.frontmatter.povCharacter,
  );
  const thread: string = scene.card.thread ?? mainThreadId;

  return success(
    [
      `${scene.card.title ?? stem} (${stem})`,
      `시점: ${narration}`,
      `줄기: ${thread}`,
      ...(scene.card.characters && scene.card.characters.length > 0
        ? [`인물: ${scene.card.characters.join(', ')}`]
        : []),
      ...(scene.card.location === undefined ? [] : [`배경: ${scene.card.location}`]),
      ...(scene.card.summary === undefined ? [] : ['', scene.card.summary]),
    ].join('\n'),
    {
      stem,
      title: scene.card.title ?? null,
      narrator: scene.card.narrator ?? null,
      narration,
      thread,
      characters: scene.card.characters ?? [],
    },
  );
};

export const generateSceneSeeds: CommandHandler = async ({ container, args }) => {
  const seeding: SeedScenesResult = await container.novel.seedScenes({
    workspaceRoot: container.workspaceRoot,
    overwrite: flagBoolean(args.flags, 'force'),
  });

  switch (seeding.kind) {
    case 'seeded':
      return success(`씬 시드 ${seeding.fileNames.length}개를 생성했습니다.`, seeding.fileNames);
    case 'empty_plan':
      return success('아웃라인에 생성할 씬이 없습니다.', []);
    case 'missing_outline':
      return failure('아웃라인(chapters.yaml)이 없습니다. outline generate 를 먼저 실행해 주세요.');
    case 'existing_scenes':
      return failure(
        `씬 파일이 이미 ${seeding.existingCount}개 있습니다. 덮어쓰려면 --force 를 주세요.`,
      );
    case 'failed':
      return failure(seeding.message);
  }
};

export const completeStory: CommandHandler = async ({ container, args }) => {
  const proposal: CompleteStoryScenesProposal = await container.novel.completeScenes({
    workspaceRoot: container.workspaceRoot,
  });

  if (flagBoolean(args.flags, 'dry-run')) {
    return success(`완결 씬 제안 ${proposal.scenes.length}건`, proposal);
  }

  const { writtenFileNames: written, skippedFileNames: skipped } =
    await container.novel.applyCompletedScenes(container.workspaceRoot, proposal.scenes);

  return success(
    skipped.length === 0
      ? `완결 씬 ${written.length}개를 만들었습니다.`
      : `완결 씬 ${written.length}개를 만들고 이미 있는 ${skipped.length}개는 건너뛰었습니다.`,
    {
      written,
      skipped,
      centralQuestion: proposal.centralQuestion,
      climaxChoice: proposal.climaxChoice,
    },
  );
};

export const createScene: CommandHandler = async ({ container, args }) => {
  const name: string | undefined = flagString(args.flags, 'name') ?? args.positionals[0];

  if (name === undefined || name.trim().length === 0) {
    return failure('--name 으로 씬 이름을 지정해 주세요.');
  }

  const slug: string | undefined = slugify(name);
  const sceneCreation: CreateSceneResult = await container.drafts.createScene({
    workspaceRoot: container.workspaceRoot,
    ...(slug === undefined ? {} : { slug }),
  });

  if (!sceneCreation.ok) {
    return failure(sceneCreation.message);
  }

  return success(`${sceneCreation.stem}.card 를 만들었습니다.`, {
    stem: sceneCreation.stem,
    path: (sceneCreation.uri as StoryUri).fsPath,
  });
};

export const renameScene: CommandHandler = async ({ container, args }) => {
  const fromStem: string | undefined = args.positionals[0];
  const toStem: string | undefined = flagString(args.flags, 'to');

  if (fromStem === undefined || toStem === undefined) {
    return failure('바꿀 씬과 --to <새 이름> 을 지정해 주세요.');
  }

  const sceneRename: RenameSceneResult = await container.drafts.renameScene({
    workspaceRoot: container.workspaceRoot,
    fromStem,
    toStem,
  });

  if (!sceneRename.ok) {
    return failure(sceneRename.message);
  }

  const orderNote: '' | ' 번호가 바뀌었으므로 아웃라인의 자리와 장 배정도 새 번호를 따릅니다.' =
    sceneRename.hasOrderChanged
      ? ' 번호가 바뀌었으므로 아웃라인의 자리와 장 배정도 새 번호를 따릅니다.'
      : '';

  return success(
    `${sceneRename.fromStem} → ${sceneRename.toStem} (옮긴 파일 ${sceneRename.movedFiles.length}개, 고친 파일 ${sceneRename.rewrittenFiles.length}개).${orderNote}`,
    sceneRename,
  );
};

export const draftStatusLabels: Readonly<Record<SceneListItem['status'], string>> = {
  missing: '초안 없음',
  ready: '초안 있음',
  stale: '초안이 카드보다 오래됨',
};

export const listScenes: CommandHandler = async ({ container }) => {
  const scenes: SceneListItem[] = await container.drafts.listScenes(container.workspaceRoot);

  if (scenes.length === 0) {
    return success('씬 카드가 없습니다.', { scenes: [] });
  }

  return success(
    scenes
      .map((scene) => `${scene.stem}\t${scene.title ?? ''}\t${draftStatusLabels[scene.status]}`)
      .join('\n'),
    {
      scenes: scenes.map((scene) => ({
        stem: scene.stem,
        order: scene.order,
        title: scene.title ?? null,
        draft: scene.status,
      })),
    },
  );
};
