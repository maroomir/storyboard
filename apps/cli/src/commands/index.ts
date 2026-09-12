import { resolve } from 'node:path';

import { ensureGitRepository, type GitRepositoryOutcome } from '@/adapters/gitRepository';

import {
  applyStoryCardChanges,
  backgroundCardPath,
  characterCardPath,
  draftPath,
  analyzeSlop,
  buildCompositionPreset,
  buildSceneSeeds,
  createDefaultProjectJson,
  diffCandidatesAgainstCanon,
  isIgnoredSampleCardFileName,
  joinStoryPath,
  migrateCardTextFieldsToList,
  createStoryboardDirectories,
  createWorkspaceReadme,
  ensureWorkspaceGitignore,
  getStoryboardProjectPaths,
  NodeUri,
  sceneFilePath,
  sceneContextPaths,
  sealStoryMemory,
  scenePath,
  readProjectJson,
  resealStoryMemory,
  writeProjectJson,
  type StoryUri,
} from '@storyboard/story-engine';

import { aiProviderIds, integerSettingDefault, type AiProviderId } from '@storyboard/story-ai';
import {
  compositionKinds,
  formatSceneOrderRanges,
  mainThreadId,
  pointOfViews,
  serializeNarratorCard,
  type CompositionKind,
  type NarratorCard,
  type PointOfView,
  type ProjectSetting,
} from '@storyboard/story-format';
import {
  convertLegacySceneText,
  createEmptyBackground,
  extractInlineSceneSummary,
  createEmptyCharacter,
  isLegacySceneFileName,
  isLegacySeedPlaceholderSummary,
  stripLegacySeedPlaceholder,
  readChapterPlanFile,
  resolveScenePrefixDigitCount,
  serializeSceneCard,
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  parseCard,
  parseDraft,
  readSceneFile,
  rewriteCardIdReferences,
  serializeCard,
  serializeDraft,
  setCardId,
} from '@storyboard/story-format';
import { parseSceneFileName } from '@storyboard/story-format';

import type { CliContainer } from '@/container';
import { flagBoolean, flagString, type ParsedArguments } from '@/cliArguments';

import type { CommandHandler, CommandOutcome } from './outcome';
import {
  addNarrator,
  describeSceneNarration,
  listNarrators,
  removeNarrator,
  showNarrator,
} from './narrators';
import { applySim, reportSim, runSim, screenSim, sweepSim } from './sim';
import { readSceneCards } from './sceneCards';
import { runConfigSet, runConfigShow, runDoctor, runSetup } from './setup';

export type { CommandContext, CommandHandler, CommandOutcome } from './outcome';

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

// 한 씬이 10~25분 걸리는데 --verbose 로도 아무 것도 찍히지 않아, 멈춘 것인지 도는 것인지
// 구분할 수 없었다. 엔진은 이미 단계와 구간 번호를 알려 준다.
// CLI 는 story-pipeline 을 직접 import 할 수 없어(아키텍처 검사) 단계 이름을 문자열로 받는다.
const sceneStageLabels: Record<string, string> = {
  buildPersonas: '인물 기억',
  draftSkeleton: '뼈대',
  polishDialogue: '대사 다듬기',
  expandSection: '살붙임',
  attributeDialogue: '화자 붙이기',
};

const generateScene: CommandHandler = async ({ container, args }) => {
  if (flagBoolean(args.flags, 'all')) {
    const result = await container.generateAllDraftsUseCase.execute({
      onProgress: (progress) =>
        container.logger.info(`${progress.current}/${progress.total} ${progress.label}`),
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
    {
      force: flagBoolean(args.flags, 'force'),
      onPipelineProgress: (stage, current, total) =>
        container.logger.info(`${sceneStageLabels[stage] ?? stage} ${current}/${total}`),
    },
  );

  if (!result.ok) {
    return { ok: false, message: result.kind === 'failed' ? result.message : '취소했습니다.' };
  }

  // 초안 앞머리에만 남기면 아무도 보지 않는다. 경고는 stderr로 알리되 생성 자체는 성공이다 —
  // 분량 미달은 모델 편차에서도 나오므로 게이트로 쓰면 정상 결과까지 실패로 만든다. 검수
  // 재작성 뒤에 찍으면 이미 고쳐진 문제를 다시 알리는 꼴이라 생성 직후에 낸다.
  const warnings = result.kind === 'generated' ? result.warnings : [];
  for (const warning of warnings) {
    container.logger.warn(warning);
  }

  // `--no-revise` overrides the setting; without it the workspace's `draft.reviseAfterGenerate`
  // decides, exactly as it does in the extension.
  const reviseRequested =
    !flagBoolean(args.flags, 'no-revise') && container.configBridge.isReviseAfterGenerateEnabled();

  if (result.kind === 'generated' && reviseRequested) {
    const revised = await container.reviseAfterGenerateGate.runForScene(
      container.workspaceRoot,
      stem,
      { onProgress: (message) => container.logger.info(message) },
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
    data: { draft: (result.draftUri as StoryUri).fsPath, warnings },
  };
};

// 비트는 `scene generate` 가 비어 있을 때 자동으로 채우지만, 생성 전에 사건 전개를 검수하려는
// 창작자를 위해 verb 로도 노출한다. --all 은 비트 없는 씬만 고르고, --force 가 있어야 다시 뽑는다.
const generateSceneBeats: CommandHandler = async ({ container, args }) => {
  const force = flagBoolean(args.flags, 'force');
  const dryRun = flagBoolean(args.flags, 'dry-run');

  if (flagBoolean(args.flags, 'all')) {
    const paths = getStoryboardProjectPaths(container.workspaceRoot);
    const names = await container.fileSystem
      .listFileNames(paths.sceneDirectory)
      .catch(() => [] as readonly string[]);
    const stems = names
      .map((fileName) => parseSceneFileName(fileName)?.stem)
      .filter((stem): stem is string => stem !== undefined)
      .sort();
    const results: Record<string, unknown> = {};
    const failures: string[] = [];
    let proposed = 0;

    for (const stem of stems) {
      const result = await runSceneBeats(container, stem, force, dryRun);
      results[stem] = result;
      if (!result.ok) {
        failures.push(stem);
      } else if (result.kind === 'proposed') {
        proposed += 1;
        container.logger.info(`${stem}: 비트 ${result.beats.length}개`);
      }
    }

    return {
      ok: failures.length === 0,
      message:
        failures.length === 0
          ? `씬 ${proposed}개의 비트를 ${dryRun ? '제안했습니다 (적용하지 않음)' : '썼습니다'}, ${stems.length - proposed}개는 그대로 둡니다.`
          : `${failures.length}건 실패 (비트 ${proposed}개 처리): ${failures.join(', ')}`,
      data: { proposed, failures, results },
    };
  }

  const stem = sceneStemFrom(args);
  if (stem === undefined) {
    return {
      ok: false,
      message: '씬 stem을 지정해 주세요. 예: storyboard scene beats 01-scene-1-1',
    };
  }

  const result = await runSceneBeats(container, stem, force, dryRun);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  if (result.kind === 'kept') {
    return {
      ok: true,
      message: `이미 비트 ${result.beats.length}개가 있습니다 (--force 로 다시 뽑습니다).`,
      data: { stem, beats: result.beats, written: false },
    };
  }

  return {
    ok: true,
    message: result.written
      ? `비트 ${result.beats.length}개를 카드에 썼습니다.`
      : `비트 ${result.beats.length}개를 제안했습니다 (적용하지 않음).`,
    data: { stem, beats: result.beats, written: result.written },
  };
};

function runSceneBeats(
  container: CliContainer,
  stem: string,
  force: boolean,
  dryRun: boolean,
): ReturnType<CliContainer['generateSceneBeatsUseCase']['execute']> {
  return container.generateSceneBeatsUseCase.execute({
    workspaceRoot: container.workspaceRoot,
    sceneUri: sceneUriFor(container.workspaceRoot, stem),
    fileName: `${stem}.card`,
    force,
    dryRun,
  });
}

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
    reviseMaxIterations: Number(
      flagString(args.flags, 'revise-iterations') ??
        integerSettingDefault('draft.reviseMaxIterations'),
    ),
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
  const uri = draftPath(container.workspaceRoot, stem);
  return {
    ok: await container.fileSystem.exists(uri),
    message: uri.fsPath,
    data: { path: uri.fsPath },
  };
};

// 파생이 어떻게 됐는지 확인하는 자리. 서술자 카드를 만들지 않은 작품도 계약의 시점 하나가 어떤
// 서술로 풀리는지 여기서 볼 수 있다.
const showScene: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  const uri = scenePath(container.workspaceRoot, stem);

  if (!(await container.fileSystem.exists(uri))) {
    return { ok: false, message: `씬을 찾을 수 없습니다: ${stem}` };
  }

  const scene = await readSceneFile(uri, container.fileSystem, `${stem}.card`);
  const narration = await describeSceneNarration(
    container,
    scene.card.narrator,
    scene.frontmatter.povCharacter,
  );
  const thread = scene.card.thread ?? mainThreadId;

  return {
    ok: true,
    message: [
      `${scene.card.title ?? stem} (${stem})`,
      `시점: ${narration}`,
      `줄기: ${thread}`,
      ...(scene.card.characters && scene.card.characters.length > 0
        ? [`인물: ${scene.card.characters.join(', ')}`]
        : []),
      ...(scene.card.location === undefined ? [] : [`배경: ${scene.card.location}`]),
      ...(scene.card.summary === undefined ? [] : ['', scene.card.summary]),
    ].join('\n'),
    data: {
      stem,
      title: scene.card.title ?? null,
      narrator: scene.card.narrator ?? null,
      narration,
      thread,
      characters: scene.card.characters ?? [],
    },
  };
};

// An unattended run has nobody to pick from a list, so promotion applies everything the prepare
// step judged new. `--dry-run` is how an agent inspects first.
const promoteCards: CommandHandler = async ({ container, args }) => {
  const prepared = await container.promoteCardCandidatesUseCase.prepare(container.workspaceRoot);

  if (prepared.kind !== 'ready') {
    return { ok: true, message: describeNothingToPromote(prepared.kind), data: prepared };
  }

  if (flagBoolean(args.flags, 'dry-run')) {
    return { ok: true, message: `승격 후보 ${prepared.items.length}건`, data: prepared.items };
  }

  const result = await container.promoteCardCandidatesUseCase.promote(
    container.workspaceRoot,
    prepared.items,
  );

  return {
    ok: result.kind === 'promoted',
    message:
      result.kind === 'promoted'
        ? `카드 ${result.updatedCardCount}개를 갱신했습니다.`
        : '카드를 저장하지 못했습니다.',
    data: result,
  };
};

const promoteBible: CommandHandler = async ({ container, args }) => {
  const prepared = await container.promoteBibleCandidatesUseCase.prepare(container.workspaceRoot);

  if (prepared.kind !== 'ready') {
    return { ok: true, message: describeNothingToPromote(prepared.kind), data: prepared };
  }

  if (flagBoolean(args.flags, 'dry-run')) {
    return { ok: true, message: `승격 후보 ${prepared.facts.length}건`, data: prepared.facts };
  }

  await container.promoteBibleCandidatesUseCase.promote(container.workspaceRoot, prepared.facts);
  return {
    ok: true,
    message: `정전에 ${prepared.facts.length}건을 반영했습니다.`,
    data: prepared.facts,
  };
};

// Read-only: an agent uses this to decide whether a card is worth creating, so it never writes.
const recommendCards: CommandHandler = async ({ container, args }) => {
  const category = args.path[2] ?? args.positionals[0];

  if (category !== 'character' && category !== 'background') {
    return { ok: false, message: 'character 또는 background 중 하나를 지정해 주세요.' };
  }

  const result = await container.recommendCardsUseCase.execute({
    category,
    workspaceRoot: container.workspaceRoot,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.kind === 'cancelled' ? '취소했습니다.' : result.message,
      data: result,
    };
  }

  return result.kind === 'no_sources'
    ? { ok: true, message: '훑을 씬이나 초안이 없습니다.', data: [] }
    : {
        ok: true,
        message: `카드가 없는 ${category} ${result.recommendations.length}건`,
        data: result.recommendations,
      };
};

// Renaming a card is a workspace-wide edit: the file moves, its own id changes, and every card
// that references it is rewritten. The editor does this in one WorkspaceEdit; here the writes are
// sequential, so a crash mid-rename leaves references half-updated — run it on a clean tree.
const cardIdPattern = /^[a-z0-9][a-z0-9-]*$/;

const renameCard: CommandHandler = async ({ container, args }) => {
  const kind = args.path[2];
  const oldId = args.positionals[0];
  const newId = flagString(args.flags, 'to');

  if (kind !== 'character' && kind !== 'background') {
    return { ok: false, message: 'character 또는 background 중 하나를 지정해 주세요.' };
  }

  if (oldId === undefined || newId === undefined) {
    return { ok: false, message: '바꿀 id 와 --to <새 id> 를 지정해 주세요.' };
  }

  if (!cardIdPattern.test(newId)) {
    return {
      ok: false,
      message: 'ID 는 영문 소문자, 숫자, 하이픈만 쓸 수 있고 숫자나 문자로 시작해야 합니다.',
    };
  }

  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const directory = kind === 'character' ? paths.characterDirectory : paths.backgroundDirectory;
  const oldUri = joinStoryPath(directory, `${oldId}.card`);
  const newUri = joinStoryPath(directory, `${newId}.card`);

  if (!(await container.fileSystem.exists(oldUri))) {
    return { ok: false, message: `카드가 없습니다: ${oldId}` };
  }

  if (await container.fileSystem.exists(newUri)) {
    return { ok: false, message: `이미 있습니다: ${newId}` };
  }

  const renamed = setCardId(
    parseCard(new TextDecoder().decode(await container.fileSystem.readFile(oldUri))),
    newId,
  );

  await container.fileSystem.writeFile(newUri, new TextEncoder().encode(serializeCard(renamed)));
  await container.fileSystem.delete(oldUri);

  // Only a character id is referenced from other cards; a background id is not.
  const rewritten =
    kind === 'character'
      ? await rewriteCharacterReferences(container, paths, oldId, newId, newUri)
      : 0;

  return {
    ok: true,
    message: `${oldId} → ${newId}${rewritten > 0 ? ` (참조 ${rewritten}건 갱신)` : ''}`,
    data: { oldId, newId, rewritten },
  };
};

async function rewriteCharacterReferences(
  container: CliContainer,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
  oldId: string,
  newId: string,
  renamedUri: StoryUri,
): Promise<number> {
  let rewritten = 0;

  for (const directory of [paths.characterDirectory, paths.backgroundDirectory]) {
    rewritten += await eachCardFile(container, directory, async (uri) => {
      if (uri.path === renamedUri.path) {
        return false;
      }

      const raw = new TextDecoder().decode(await container.fileSystem.readFile(uri));
      let next: string;

      try {
        next = serializeCard(rewriteCardIdReferences(parseCard(raw), oldId, newId));
      } catch (error) {
        // One unreadable card must not abort a rename that already moved the file. Report it and
        // keep going; the operator fixes that card and re-runs.
        container.logger.warn(`참조를 갱신하지 못했습니다: ${uri.fsPath} — ${String(error)}`);
        return false;
      }

      if (next === raw) {
        return false;
      }

      await container.fileSystem.writeFile(uri, new TextEncoder().encode(next));
      return true;
    });
  }

  return rewritten;
}

// The editor names a region by dragging; a terminal names it by line numbers. `--lines 40-60` is
// the same input in the form this host has.
interface LineRange {
  readonly from: number;
  readonly to: number;
}

function parseLineRange(raw: string | undefined): LineRange | undefined | 'invalid' {
  if (raw === undefined) {
    return undefined;
  }

  const match = /^(\d+)-(\d+)$/.exec(raw.trim());

  if (!match) {
    return 'invalid';
  }

  const from = Number(match[1]);
  const to = Number(match[2]);
  return from >= 1 && to >= from ? { from, to } : 'invalid';
}

function sliceLines(body: string, range: LineRange | undefined): string {
  if (range === undefined) {
    return body;
  }

  return body
    .split('\n')
    .slice(range.from - 1, range.to)
    .join('\n');
}

function replaceLines(body: string, range: LineRange | undefined, replacement: string): string {
  if (range === undefined) {
    return replacement;
  }

  const lines = body.split('\n');
  return [
    ...lines.slice(0, range.from - 1),
    ...replacement.split('\n'),
    ...lines.slice(range.to),
  ].join('\n');
}

// Rewrites the draft in place. `--lines` narrows it; without one the whole body is the target,
// which is the shape a terminal caller usually wants.
async function rewriteDraft(
  container: CliContainer,
  stem: string,
  range: LineRange | undefined,
  transform: (target: string) => Promise<{ ok: boolean; text?: string; message: string }>,
): Promise<CommandOutcome> {
  const body = await readDraftBody(container, stem);

  if (body === undefined) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  const target = sliceLines(body, range);

  if (target.trim().length === 0) {
    return { ok: false, message: '대상 구간이 비어 있습니다.' };
  }

  const result = await transform(target);

  if (!result.ok || result.text === undefined) {
    return { ok: false, message: result.message };
  }

  const draftUri = draftPath(container.workspaceRoot, stem);
  const existing = parseDraft(
    new TextDecoder().decode(await container.fileSystem.readFile(draftUri)),
  );

  await container.fileSystem.writeFile(
    draftUri,
    new TextEncoder().encode(
      serializeDraft({ ...existing, body: replaceLines(body, range, result.text) }),
    ),
  );

  return { ok: true, message: result.message, data: { draft: draftUri.fsPath } };
}

function rangeFrom(args: ParsedArguments): LineRange | undefined | 'invalid' {
  return parseLineRange(flagString(args.flags, 'lines'));
}

const condenseDraft: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);
  const range = rangeFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  if (range === 'invalid') {
    return { ok: false, message: '--lines 는 40-60 형식이어야 합니다.' };
  }

  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const project = await readProjectJson(container.fileSystem, paths.projectJson);

  return rewriteDraft(container, stem, range, async (target) => {
    const result = await container.condenseDraftUseCase.execute({
      workspaceRoot: container.workspaceRoot,
      sceneStem: stem,
      format: project.format,
      body: target,
      maxCompressionPercent: container.configBridge.getMaxCompressionPercent(),
    });

    return result.ok
      ? { ok: true, text: result.text, message: '초안을 압축했습니다.' }
      : { ok: false, message: `압축하지 못했습니다 (${result.kind}).` };
  });
};

const expandDraft: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);
  const range = rangeFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  if (range === 'invalid') {
    return { ok: false, message: '--lines 는 40-60 형식이어야 합니다.' };
  }

  return rewriteDraft(container, stem, range, async (target) => {
    const result = await container.expandDraftUseCase.execute({
      workspaceRoot: container.workspaceRoot,
      sceneStem: stem,
      selectedText: target,
    });

    return result.ok
      ? { ok: true, text: result.text, message: '구간을 늘렸습니다.' }
      : { ok: false, message: `늘리지 못했습니다 (${result.kind}).` };
  });
};

// Both migrations rewrite files in place and are idempotent — a second run reports zero. They are
// deterministic, so no provider is involved.
async function eachCardFile(
  container: CliContainer,
  directory: StoryUri,
  visit: (uri: StoryUri, fileName: string) => Promise<boolean>,
): Promise<number> {
  const names = await container.fileSystem
    .listFileNames(directory)
    .catch(() => [] as readonly string[]);
  let changed = 0;

  for (const fileName of names) {
    if (!fileName.endsWith('.card') || isIgnoredSampleCardFileName(fileName)) {
      continue;
    }

    if (await visit(joinStoryPath(directory, fileName), fileName)) {
      changed += 1;
    }
  }

  return changed;
}

const migrateCardText: CommandHandler = async ({ container }) => {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  let migrated = 0;

  for (const directory of [paths.characterDirectory, paths.backgroundDirectory]) {
    migrated += await eachCardFile(container, directory, async (uri) => {
      const raw = new TextDecoder().decode(await container.fileSystem.readFile(uri));
      const result = migrateCardTextFieldsToList(raw);

      if (!result.changed) {
        return false;
      }

      await container.fileSystem.writeFile(uri, new TextEncoder().encode(result.yaml));
      return true;
    });
  }

  return {
    ok: true,
    message:
      migrated === 0 ? '바꿀 카드가 없습니다.' : `카드 ${migrated}개를 목록 형식으로 옮겼습니다.`,
    data: { migrated },
  };
};

const migrateScenes: CommandHandler = async ({ container }) => {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const names = await container.fileSystem
    .listFileNames(paths.sceneDirectory)
    .catch(() => [] as readonly string[]);
  const legacy = names.filter((name) => isLegacySceneFileName(name));
  const converted: string[] = [];

  for (const fileName of legacy) {
    const legacyUri = joinStoryPath(paths.sceneDirectory, fileName);
    const raw = new TextDecoder().decode(await container.fileSystem.readFile(legacyUri));
    const conversion = convertLegacySceneText(raw, fileName);

    await container.fileSystem.writeFile(
      joinStoryPath(paths.sceneDirectory, conversion.fileName),
      new TextEncoder().encode(conversion.text),
    );
    await container.fileSystem.delete(legacyUri);
    converted.push(conversion.fileName);
  }

  const { cleared } = await clearLegacySeedPlaceholders(container, paths.sceneDirectory);
  const { extracted, unreadable } = await extractInlineSceneSummaries(
    container,
    paths.sceneDirectory,
  );

  return {
    ok: true,
    message: describeSceneMigration(converted.length, cleared.length, extracted.length, unreadable),
    data: { converted, clearedPlaceholders: cleared, extractedSummaries: extracted, unreadable },
  };
};

// 0.8 이전 시드의 안내 문구가 summary에 남아 있으면 초안이 그 한 줄만 서사 재료로 받는다.
async function clearLegacySeedPlaceholders(
  container: CliContainer,
  sceneDirectory: StoryUri,
): Promise<{ readonly cleared: readonly string[]; readonly unreadable: readonly string[] }> {
  const names = await container.fileSystem
    .listFileNames(sceneDirectory)
    .catch(() => [] as readonly string[]);
  const { cards, unreadable } = await readSceneCards(container, sceneDirectory, names);
  const cleared: string[] = [];

  for (const { fileName, card } of cards) {
    if (!isLegacySeedPlaceholderSummary(card.summary)) {
      continue;
    }

    await container.fileSystem.writeFile(
      joinStoryPath(sceneDirectory, fileName),
      new TextEncoder().encode(
        serializeSceneCard({ ...card, summary: stripLegacySeedPlaceholder(card.summary ?? '') }),
      ),
    );
    cleared.push(fileName);
  }

  return { cleared, unreadable };
}

// 인라인 summary 산문은 창작자의 사건 재료다. 기계가 펼친 beats 와 구별되도록 카드 옆
// `<stem>.summary.md` 로 옮기고 카드에는 파일명만 남긴다. 플레이스홀더를 걷어 낸 뒤에 돈다.
async function extractInlineSceneSummaries(
  container: CliContainer,
  sceneDirectory: StoryUri,
): Promise<{ readonly extracted: readonly string[]; readonly unreadable: readonly string[] }> {
  const names = await container.fileSystem
    .listFileNames(sceneDirectory)
    .catch(() => [] as readonly string[]);
  const { cards, unreadable } = await readSceneCards(container, sceneDirectory, names);
  const extracted: string[] = [];

  for (const { fileName, card } of cards) {
    const extraction = extractInlineSceneSummary(card);
    if (extraction === undefined) {
      continue;
    }

    await container.fileSystem.writeFile(
      joinStoryPath(sceneDirectory, extraction.summaryFileName),
      new TextEncoder().encode(extraction.summaryText),
    );
    await container.fileSystem.writeFile(
      joinStoryPath(sceneDirectory, fileName),
      new TextEncoder().encode(serializeSceneCard(extraction.card)),
    );
    extracted.push(extraction.summaryFileName);
  }

  return { extracted, unreadable };
}

function describeSceneMigration(
  converted: number,
  cleared: number,
  extracted: number,
  unreadable: readonly string[],
): string {
  const parts: string[] = [];
  if (converted > 0) {
    parts.push(`씬 ${converted}개를 카드로 옮겼습니다.`);
  }
  if (cleared > 0) {
    parts.push(`플레이스홀더 요약 ${cleared}개를 비웠습니다.`);
  }
  if (extracted > 0) {
    parts.push(`인라인 summary ${extracted}개를 summary 파일로 옮겼습니다.`);
  }
  if (parts.length === 0) {
    parts.push('바꿀 씬이 없습니다.');
  }
  if (unreadable.length > 0) {
    parts.push(`읽지 못한 카드는 건너뛰었습니다: ${unreadable.join(', ')}`);
  }

  return parts.join(' ');
}

// Seeds come from the outline, so an agent runs `outline generate` first. Writing them is not a
// generation — `buildSceneSeeds` is deterministic.
const generateSceneSeeds: CommandHandler = async ({ container, args }) => {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);

  if (!(await container.fileSystem.exists(paths.outlineChapters))) {
    return {
      ok: false,
      message: '아웃라인(chapters.yaml)이 없습니다. outline generate 를 먼저 실행해 주세요.',
    };
  }

  const project = await readProjectJson(container.fileSystem, paths.projectJson);
  const plan = await readChapterPlanFile(paths.outlineChapters, container.fileSystem);
  const seeds = buildSceneSeeds(
    plan,
    resolveScenePrefixDigitCount(project.editor.scenePrefixDigits, undefined),
  );

  if (seeds.length === 0) {
    return { ok: true, message: '아웃라인에 생성할 씬이 없습니다.', data: [] };
  }

  const existing = await container.fileSystem
    .listFileNames(paths.sceneDirectory)
    .catch(() => [] as readonly string[]);

  // Overwriting is what the editor asks about with a modal. Unattended, refuse unless told.
  if (existing.length > 0 && !flagBoolean(args.flags, 'force')) {
    return {
      ok: false,
      message: `씬 파일이 이미 ${existing.length}개 있습니다. 덮어쓰려면 --force 를 주세요.`,
    };
  }

  await container.fileSystem.createDirectory(paths.sceneDirectory);

  for (const seed of seeds) {
    await container.fileSystem.writeFile(
      joinStoryPath(paths.sceneDirectory, seed.fileName),
      new TextEncoder().encode(seed.content),
    );
  }

  return {
    ok: true,
    message: `씬 시드 ${seeds.length}개를 생성했습니다.`,
    data: seeds.map((seed) => seed.fileName),
  };
};

// 익스텐션은 제안을 QuickPick 으로 고르고 diff 로 검토한 뒤 쓴다. 무인 실행에는 그 자리가 없으니
// 제안 전체를 적용하고, 미리 보려면 --dry-run 을 쓴다 — card promote 와 같은 관례다.
const completeStory: CommandHandler = async ({ container, args }) => {
  const proposal = await container.completeStoryScenesUseCase.execute(container.workspaceRoot);

  if (flagBoolean(args.flags, 'dry-run')) {
    return { ok: true, message: `완결 씬 제안 ${proposal.scenes.length}건`, data: proposal };
  }

  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const written: string[] = [];
  const skipped: string[] = [];

  await container.fileSystem.createDirectory(paths.sceneDirectory);

  for (const scene of proposal.scenes) {
    const uri = joinStoryPath(paths.sceneDirectory, scene.fileName);

    // 완결 씬은 뒤에 덧붙이는 제안이다. 이미 있는 파일을 덮으면 쓰던 씬이 사라진다.
    if (await container.fileSystem.exists(uri)) {
      skipped.push(scene.fileName);
      continue;
    }

    await container.fileSystem.writeFile(uri, new TextEncoder().encode(scene.content));
    written.push(scene.fileName);
  }

  return {
    ok: true,
    message:
      skipped.length === 0
        ? `완결 씬 ${written.length}개를 만들었습니다.`
        : `완결 씬 ${written.length}개를 만들고 이미 있는 ${skipped.length}개는 건너뛰었습니다.`,
    data: {
      written,
      skipped,
      centralQuestion: proposal.centralQuestion,
      climaxChoice: proposal.climaxChoice,
    },
  };
};

const buildStoryCards: CommandHandler = async ({ container, args }) => {
  const proposal = await container.buildStoryCardsUseCase.execute(container.workspaceRoot);

  if (flagBoolean(args.flags, 'dry-run')) {
    return { ok: true, message: `카드 구성안 ${proposal.targets.length}건`, data: proposal };
  }

  const written: string[] = [];
  // 이름에서 id 를 못 만드는 새 카드는 익스텐션이 사람에게 물어보는 자리다. 여기서 짐작해
  // new-card-2 같은 id 를 박아 넣는 대신, 이름을 돌려주고 card create --id 를 거치게 한다.
  const needsId: string[] = [];

  for (const target of proposal.targets) {
    if (target.isNew && target.requiresIdConfirmation) {
      needsId.push(target.card.name);
      continue;
    }

    const card = applyStoryCardChanges(
      target,
      target.changes.map((change) => change.proposal),
    );
    const uri =
      card.type === 'character'
        ? characterCardPath(container.workspaceRoot, card.id)
        : backgroundCardPath(container.workspaceRoot, card.id);

    await container.fileSystem.writeFile(uri, new TextEncoder().encode(serializeCard(card)));
    written.push(card.id);
  }

  return {
    ok: true,
    message: describeCardBuild(written.length, needsId),
    data: { written, needsId },
  };
};

function describeCardBuild(writtenCount: number, needsId: readonly string[]): string {
  if (needsId.length === 0) {
    return `카드 ${writtenCount}개를 갱신했습니다.`;
  }

  return (
    `카드 ${writtenCount}개를 갱신했습니다. id 를 정할 수 없어 건너뛴 새 카드: ${needsId.join(', ')}. ` +
    'card create 로 --id 를 지정해 만든 뒤 다시 실행해 주세요.'
  );
}

const canonDiff: CommandHandler = async ({ container }) => {
  const canon = await container.bibleCandidateRepository.loadCanon(container.workspaceRoot);
  const candidates = await container.bibleCandidateRepository.loadRecords(container.workspaceRoot);
  const { pending } = diffCandidatesAgainstCanon(canon, candidates);

  return {
    ok: true,
    message:
      pending.length === 0 ? '정전과 어긋나는 후보가 없습니다.' : `미승격 후보 ${pending.length}건`,
    data: pending,
  };
};

// Cards start empty and get filled by the studio or by hand; creating one is a file write, not a
// generation, so no provider is involved.
const createCard: CommandHandler = async ({ container, args }) => {
  const kind = args.path[2];
  const name = flagString(args.flags, 'name') ?? args.positionals[0];

  if (kind !== 'character' && kind !== 'background') {
    return { ok: false, message: 'character 또는 background 중 하나를 지정해 주세요.' };
  }

  if (name === undefined || name.trim().length === 0) {
    return { ok: false, message: '--name 으로 이름을 지정해 주세요.' };
  }

  const cardType = kind === 'character' ? 'character' : 'location';
  const suggested = flagString(args.flags, 'id') ?? slugify(name);

  // 한글 이름은 ascii 슬러그를 내지 못한다. 예전에는 이때 new-card, new-card-2 로 번호를 붙여
  // 이름과 무관한 id 가 조용히 만들어졌고, 씬 카드가 그 id 로 인물을 참조했다. 짐작하는 대신
  // 거부하고 --id 를 요구한다.
  if (suggested === undefined) {
    return {
      ok: false,
      message: `'${name.trim()}' 에서 id 를 만들 수 없습니다. --id 로 영소문자 id 를 지정해 주세요 (예: --id seo-jina).`,
    };
  }

  if (!cardIdPattern.test(suggested)) {
    return {
      ok: false,
      message: `id 는 영소문자·숫자·하이픈만 쓸 수 있습니다: ${suggested}`,
    };
  }

  const id = await container.createCardUseCase.deriveUniqueId(
    container.workspaceRoot,
    cardType,
    suggested,
    suggested,
  );
  const card =
    kind === 'character'
      ? createEmptyCharacter(id, name.trim())
      : createEmptyBackground(id, name.trim());
  const uri = await container.createCardUseCase.write(container.workspaceRoot, card);

  return {
    ok: true,
    message: `${id} 카드를 만들었습니다.`,
    data: { id, path: (uri as StoryUri).fsPath },
  };
};

// The prefix is the workspace's own numbering, so a new scene lands after the highest one rather
// than at a number the author has to pick.
const createScene: CommandHandler = async ({ container, args }) => {
  const name = flagString(args.flags, 'name') ?? args.positionals[0];

  if (name === undefined || name.trim().length === 0) {
    return { ok: false, message: '--name 으로 씬 이름을 지정해 주세요.' };
  }

  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const project = await readProjectJson(container.fileSystem, paths.projectJson);
  const existing = await container.fileSystem
    .listFileNames(paths.sceneDirectory)
    .catch(() => [] as readonly string[]);

  const digitCount = resolveScenePrefixDigitCount(project.editor.scenePrefixDigits, undefined);
  const highest = existing
    .map((fileName) => parseSceneFileName(fileName)?.order)
    .filter((order): order is number => order !== undefined)
    .reduce((max, order) => Math.max(max, order), 0);
  const order = highest + 1;
  const prefix = String(order).padStart(digitCount, '0');
  // 씬은 번호가 정체성을 지니므로 이름에서 슬러그를 못 만들어도 거부하지 않는다.
  // sceneSeedFactory 의 폴백과 같은 모양을 쓴다.
  const slug = slugify(name) ?? `scene-${order}`;
  const uri = sceneFilePath(container.workspaceRoot, prefix, slug);

  if (await container.fileSystem.exists(uri)) {
    return { ok: false, message: `이미 있습니다: ${prefix}-${slug}.card` };
  }

  await container.fileSystem.writeFile(
    uri,
    new TextEncoder().encode(serializeSceneCard({ type: 'scene', id: `${prefix}-${slug}` })),
  );

  return {
    ok: true,
    message: `${prefix}-${slug}.card 를 만들었습니다.`,
    data: { stem: `${prefix}-${slug}`, path: uri.fsPath },
  };
};

// Card ids are file names, so they stay ascii-safe and lowercase. A name with no ascii yields
// nothing usable; the caller refuses rather than inventing a name-shaped id.
function slugify(name: string): string | undefined {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : undefined;
}

const applyDraftFormat: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  const result = await container.applyDraftFormatUseCase.execute({
    workspaceRoot: container.workspaceRoot,
    sceneStem: stem,
  });

  return {
    ok: result.ok,
    message: result.ok
      ? '초안 형식을 다시 적용했습니다.'
      : `형식을 적용하지 못했습니다 (${result.kind}).`,
    data: result,
  };
};

// Card-based augmentation rewrites the whole draft from updated cards and canon, without
// regenerating it. The editor shows a diff first; unattended, the caller asked for it, so it lands.
const augmentDraft: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  const draftUri = draftPath(container.workspaceRoot, stem);
  const body = await readDraftBody(container, stem);

  if (body === undefined) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  const range = rangeFrom(args);

  if (range === 'invalid') {
    return { ok: false, message: '--lines 는 40-60 형식이어야 합니다.' };
  }

  const instruction = flagString(args.flags, 'instruction');
  const prepared = await container.augmentDraftUseCase.prepareAugmentedDraft({
    draftSceneStem: stem,
    sceneUri: scenePath(container.workspaceRoot, stem),
    scope: range === undefined ? 'draft' : 'selection',
    target: sliceLines(body, range),
    workspaceRoot: container.workspaceRoot,
    ...(instruction === undefined ? {} : { instruction }),
  });

  if (!prepared.ok) {
    return { ok: false, message: `보충하지 못했습니다 (${prepared.kind}).`, data: prepared };
  }

  if (flagBoolean(args.flags, 'dry-run')) {
    return { ok: true, message: '보충안을 만들었습니다 (적용하지 않음).', data: prepared };
  }

  await container.augmentDraftUseCase.applyAugmentedDraft({
    draftUri,
    sceneStem: stem,
    workspaceRoot: container.workspaceRoot,
  });

  return { ok: true, message: '카드 기반 보충을 반영했습니다.', data: { draft: draftUri.fsPath } };
};

// The editor asks for the instruction in a prompt box; here it is a flag. Everything else is the
// selection-scoped augmentation the editor runs.
const editDraft: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);
  const range = rangeFrom(args);
  const instruction = flagString(args.flags, 'instruction');

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  if (range === 'invalid') {
    return { ok: false, message: '--lines 는 40-60 형식이어야 합니다.' };
  }

  if (instruction === undefined || instruction.trim().length === 0) {
    return { ok: false, message: '--instruction 으로 어떻게 고칠지 알려 주세요.' };
  }

  const body = await readDraftBody(container, stem);

  if (body === undefined) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  const prepared = await container.augmentDraftUseCase.prepareAugmentedDraft({
    draftSceneStem: stem,
    sceneUri: scenePath(container.workspaceRoot, stem),
    scope: 'selection',
    target: sliceLines(body, range),
    workspaceRoot: container.workspaceRoot,
    instruction,
  });

  if (!prepared.ok) {
    return { ok: false, message: `고치지 못했습니다 (${prepared.kind}).`, data: prepared };
  }

  if (flagBoolean(args.flags, 'dry-run')) {
    return { ok: true, message: '수정안을 만들었습니다 (적용하지 않음).', data: prepared };
  }

  await container.augmentDraftUseCase.applyAugmentedDraft({
    draftUri: draftPath(container.workspaceRoot, stem),
    sceneStem: stem,
    workspaceRoot: container.workspaceRoot,
  });

  return { ok: true, message: '지시대로 고쳤습니다.', data: { stem } };
};

const exportManuscript: CommandHandler = async ({ container, args }) => {
  const source = await container.exportManuscriptUseCase.loadSource(container.workspaceRoot);

  if (!source.ok) {
    return { ok: false, message: `내보낼 원고가 없습니다 (${source.kind}).`, data: source };
  }

  const target = flagString(args.flags, 'out');

  if (target === undefined) {
    process.stdout.write(source.markdown);
    return { ok: true, message: '', data: { projectName: source.projectName } };
  }

  await container.fileSystem.writeFile(
    NodeUri.file(target),
    new TextEncoder().encode(source.markdown),
  );

  return { ok: true, message: `${target} 로 내보냈습니다.`, data: { path: target } };
};

// An agent starting from an empty directory needs this first; without it the CLI can only work in
// 0.8 이전 원장에는 씬 입력 해시가 없어 낡음을 판정할 근거가 없다. 보수 시점의 카드·씬을
// 기준으로 삼는다 — 그 뒤에 고친 것부터 낡음으로 잡힌다.
async function sealWorkspaceStoryState(
  container: CliContainer,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
): Promise<readonly number[]> {
  const project = await readProjectJson(container.fileSystem, paths.projectJson).catch(
    () => undefined,
  );

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

// "5", "5-8", "5,7,9" 를 받는다. 형식이 어긋나면 undefined 로 알려 조용히 전체를 봉인하는 일을 막는다.
function parseSceneOrders(raw: string): readonly number[] | undefined {
  const orders = new Set<number>();

  for (const part of raw.split(',')) {
    const bounds = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    const start = Number(bounds?.[1]);

    if (bounds === undefined || bounds === null || !Number.isInteger(start)) {
      return undefined;
    }

    const end = bounds[2] === undefined ? start : Number(bounds[2]);

    if (end < start) {
      return undefined;
    }

    for (let order = start; order <= end; order += 1) {
      orders.add(order);
    }
  }

  return [...orders];
}

// 낡음 판정은 옳다. 사람이 "카드는 고쳤지만 이 초안이 맞다"고 판단했을 때 그 판단을 원장에 남기는
// 유일한 통로이므로, 자동으로 도는 곳이 없고 이 명령만 덮어쓴다.
const resealState: CommandHandler = async ({ container, args }) => {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const project = await readProjectJson(container.fileSystem, paths.projectJson);
  const rawOrders = args.positionals[0];
  const sceneOrders = rawOrders === undefined ? undefined : parseSceneOrders(rawOrders);

  if (rawOrders !== undefined && sceneOrders === undefined) {
    return {
      ok: false,
      message: `씬 범위를 알아볼 수 없습니다: ${rawOrders}\n  5 · 5-8 · 5,7,9 처럼 적어 주세요.`,
    };
  }

  const resealed = await resealStoryMemory({
    fileSystem: container.fileSystem,
    paths,
    format: project.format,
    sceneBreakJoiner: container.configBridge.getDraftSceneBreakSeparator(),
    ...(sceneOrders === undefined ? {} : { sceneOrders }),
  });

  return {
    ok: true,
    message:
      resealed.length === 0
        ? '다시 봉인할 낡은 항목이 없습니다.'
        : `씬 ${formatSceneOrderRanges(resealed)}의 원장 항목을 지금의 카드·씬으로 다시 봉인했습니다.`,
    data: { sceneOrders: resealed },
  };
};

// a workspace the extension already created.
const initProject: CommandHandler = async ({ container, args }) => {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);

  // `--repair` 는 계약은 손대지 않고 발판(디렉터리·.gitignore)만 채운다. 0.8 이전에 만든
  // 워크스페이스에는 생성물 무시 항목이 빠져 있어 원고가 통째로 커밋 대상에 남는다. 플래그 없이
  // 기존 워크스페이스에 오면 거부해, --title 이 조용히 무시된 채 exit 0 이 되는 일을 막는다.
  const isExistingWorkspace = await container.fileSystem.exists(paths.projectJson);

  if (flagBoolean(args.flags, 'repair')) {
    if (!isExistingWorkspace) {
      return {
        ok: false,
        message: 'Storyboard 워크스페이스가 아닙니다: storyboard init --title "작품 이름"',
      };
    }

    await createStoryboardDirectories(container.fileSystem, paths);
    await ensureWorkspaceGitignore(container.fileSystem, paths.gitignore);
    const gitRepository = ensureGitRepository(container.workspaceRoot.fsPath);
    const sealedSceneOrders = await sealWorkspaceStoryState(container, paths);

    return {
      ok: true,
      message:
        (sealedSceneOrders.length === 0
          ? '디렉터리와 .gitignore 를 최신으로 맞췄습니다. 작품 계약은 그대로입니다.'
          : `디렉터리와 .gitignore 를 최신으로 맞추고, 이야기 상태 원장의 씬 ${formatSceneOrderRanges(sealedSceneOrders)}를 지금의 카드·씬으로 봉인했습니다. 작품 계약은 그대로입니다.`) +
        describeGitRepository(gitRepository),
      data: { repaired: true, sealedSceneOrders, gitRepository },
    };
  }

  if (isExistingWorkspace) {
    return {
      ok: false,
      message: '이미 Storyboard 워크스페이스입니다. 발판만 보수하려면 storyboard init --repair',
    };
  }

  const name = flagString(args.flags, 'title') ?? args.positionals[0];

  if (name === undefined || name.trim().length === 0) {
    return {
      ok: false,
      message: '작품 이름이 필요합니다: storyboard init --title "작품 이름"',
    };
  }

  const contract = await readContractInput(container, args);

  if ('message' in contract) {
    return { ok: false, message: contract.message };
  }

  const base = createDefaultProjectJson({
    name,
    ...(flagString(args.flags, 'language') === undefined
      ? {}
      : { language: flagString(args.flags, 'language') }),
  });
  const setting = mergeSetting(undefined, contract.setting);
  const project = setting === undefined ? base : { ...base, setting };

  await container.fileSystem.createDirectory(paths.metadataDirectory);
  await createStoryboardDirectories(container.fileSystem, paths);
  await writeProjectJson(container.fileSystem, paths.projectJson, project);
  await ensureWorkspaceGitignore(container.fileSystem, paths.gitignore);
  await container.fileSystem.writeFile(
    paths.readme,
    new TextEncoder().encode(createWorkspaceReadme(project.name)),
  );
  const gitRepository = ensureGitRepository(container.workspaceRoot.fsPath);
  const createdNarrators = await writePresetNarratorCards(
    container,
    contract.narratorCards ?? [],
  );

  return {
    ok: true,
    message:
      `${project.name} 워크스페이스를 만들었습니다: ${container.workspaceRoot.fsPath}` +
      `${describeGitRepository(gitRepository)}\n` +
      (createdNarrators.length > 0
        ? `서술자 카드를 만들었습니다: ${createdNarrators.join(', ')}\n`
        : '') +
      '다음: `storyboard project set` 으로 작품 계약을 채우고 `storyboard outline generate` 를 실행하세요.' +
      (container.configBridge.isDefaultProviderConfigured()
        ? ''
        : '\nAI 프로바이더가 아직 없습니다: `storyboard setup`'),
    data: {
      id: project.id,
      name: project.name,
      format: project.format,
      setting: project.setting,
      gitRepository,
    },
  };
};

// The ignore block is in place before the repository exists, so nothing generated can slip into the
// user's first commit; the CLI itself never makes that commit.
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

// 계약은 outline generate 의 입구다. 이걸 채우는 길이 없으면 워크스페이스를 만들고도 CLI 만으로는
// 한 걸음도 못 나간다. init 이 처음 채우고, project set 이 나중에 고친다 — 둘 다 같은 입력을 읽는다.
const setProjectContract: CommandHandler = async ({ container, args }) => {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const contract = await readContractInput(container, args);

  if ('message' in contract) {
    return { ok: false, message: contract.message };
  }

  if (contract.setting === undefined) {
    return {
      ok: false,
      message:
        '바꿀 값을 지정해 주세요. --genre --audience --pov --target-words --chapters --scenes-per-chapter --concept --description --composition 또는 --from <json>.',
    };
  }

  const project = await readProjectJson(container.fileSystem, paths.projectJson);
  const setting = mergeSetting(project.setting, contract.setting);

  await writeProjectJson(container.fileSystem, paths.projectJson, { ...project, setting });
  await writePresetNarratorCards(container, contract.narratorCards ?? []);

  return { ok: true, message: '작품 계약을 갱신했습니다.', data: setting };
};

type ContractInput =
  | {
      readonly setting: Partial<ProjectSetting> | undefined;
      // 구성 프리셋이 함께 만들라고 내놓은 서술자 카드. init·project set 이 워크스페이스에 쓴다.
      readonly narratorCards?: readonly NarratorCard[];
    }
  | { readonly message: string };

async function writePresetNarratorCards(
  container: CliContainer,
  cards: readonly NarratorCard[],
): Promise<string[]> {
  if (cards.length === 0) {
    return [];
  }

  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  await container.fileSystem.createDirectory(paths.narratorDirectory);

  const written: string[] = [];
  for (const card of cards) {
    const uri = joinStoryPath(paths.narratorDirectory, `${card.id}.card`);

    // 이미 있는 서술자는 손대지 않는다. 프리셋을 다시 돌렸다고 작가가 고친 목소리를 잃으면 안 된다.
    if (await container.fileSystem.exists(uri)) {
      continue;
    }

    await container.fileSystem.writeFile(
      uri,
      new TextEncoder().encode(serializeNarratorCard(card)),
    );
    written.push(card.id);
  }

  return written;
}

async function readContractInput(
  container: CliContainer,
  args: ParsedArguments,
): Promise<ContractInput> {
  const fromPath = flagString(args.flags, 'from');
  let fromFile: Partial<ProjectSetting> | undefined;

  if (fromPath !== undefined) {
    try {
      const bytes = await container.fileSystem.readFile(NodeUri.file(resolve(fromPath)));
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { message: `${fromPath} 의 최상위는 객체여야 합니다.` };
      }

      // setting 을 감싼 project.json 을 그대로 줘도 받는다.
      const record = parsed as Record<string, unknown>;
      fromFile = (record.setting ?? record) as Partial<ProjectSetting>;
    } catch (error) {
      return {
        message: `${fromPath} 를 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const pov = flagString(args.flags, 'pov');

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
    const raw = flagString(args.flags, flag);

    if (raw === undefined) {
      continue;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value <= 0) {
      return { message: `--${flag} 는 양의 정수여야 합니다: ${raw}` };
    }

    parsedNumbers[key] = value;
  }

  const composition = flagString(args.flags, 'composition');

  if (composition !== undefined && !compositionKinds.includes(composition as CompositionKind)) {
    return { message: `--composition 은 ${compositionKinds.join(', ')} 중 하나여야 합니다.` };
  }

  const episodesRaw = flagString(args.flags, 'episodes');
  const episodeCount = episodesRaw === undefined ? undefined : Number(episodesRaw);

  if (episodeCount !== undefined && (!Number.isInteger(episodeCount) || episodeCount <= 0)) {
    return { message: `--episodes 는 양의 정수여야 합니다: ${episodesRaw}` };
  }

  const povCharacters = (flagString(args.flags, 'pov-characters') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  // 프리셋이 줄기와 서술자 카드를 만든다. 창작자는 구성 하나만 고르면 된다.
  const preset =
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

  const merged = { ...(fromFile ?? {}), ...fromFlags };

  return {
    setting: Object.keys(merged).length === 0 ? undefined : merged,
    ...(preset && preset.narratorCards.length > 0 ? { narratorCards: preset.narratorCards } : {}),
  };
}

// 계약은 한 번에 다 채워지지 않는다. 주지 않은 키는 그대로 두고 준 키만 덮어쓴다.
function mergeSetting(
  current: ProjectSetting | undefined,
  patch: Partial<ProjectSetting> | undefined,
): ProjectSetting | undefined {
  if (patch === undefined) {
    return current;
  }

  return {
    tags: [],
    prohibitions: [],
    styleConstraints: [],
    qualityCriteria: [],
    ...(current ?? {}),
    ...patch,
  };
}

// Diagnostics the editor paints as squiggles have no terminal form, but the analysis behind them
// does — and an agent that can check its own output is the whole point of the CLI. Findings go out
// as data; the exit code says whether the draft is clean.
type CheckKind = 'grammar' | 'continuity' | 'slop';

async function readDraftBody(container: CliContainer, stem: string): Promise<string | undefined> {
  const uri = draftPath(container.workspaceRoot, stem);

  try {
    return parseDraft(new TextDecoder().decode(await container.fileSystem.readFile(uri))).body;
  } catch {
    return undefined;
  }
}

const checkDraft: CommandHandler = async ({ container, args }) => {
  const kind = args.path[1] as CheckKind | undefined;
  const stem = sceneStemFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  const body = await readDraftBody(container, stem);

  if (body === undefined) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  if (kind === 'slop') {
    // Deterministic, no provider call — the cheapest of the three.
    const findings = analyzeSlop(body);
    return {
      ok: findings.length === 0,
      message: findings.length === 0 ? '상투 표현을 찾지 못했습니다.' : `${findings.length}건`,
      data: findings,
    };
  }

  const service = container.aiGateway.createService(container.workspaceRoot);
  const attribution = { primary: { kind: 'scene' as const, id: stem } };

  if (kind === 'grammar') {
    const issues = await service.checkGrammar(body, {
      providerId: container.aiGateway.getTaskProvider('grammarCheck'),
      attribution,
    });
    return {
      ok: issues.length === 0,
      message: issues.length === 0 ? '문법 문제를 찾지 못했습니다.' : `${issues.length}건`,
      data: issues,
    };
  }

  const factLines = await loadCanonFactLines(container, stem);

  if (factLines.length === 0) {
    return { ok: true, message: '대조할 정전 사실이 없습니다.', data: [] };
  }

  const issues = await service.checkContinuity(body, factLines, {
    providerId: container.aiGateway.getTaskProvider('continuityCheck'),
    attribution,
  });

  return {
    ok: issues.length === 0,
    message: issues.length === 0 ? '연속성 문제를 찾지 못했습니다.' : `${issues.length}건`,
    data: issues,
  };
};

async function loadCanonFactLines(
  container: CliContainer,
  stem: string,
): Promise<readonly string[]> {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const fileName = `${stem}.card`;

  try {
    const scene = await readSceneFile(
      scenePath(container.workspaceRoot, stem),
      container.fileSystem,
      fileName,
    );
    const contextPaths = sceneContextPaths(paths);
    const context = await buildSceneContext(contextPaths, scene, container.fileSystem);
    const narrative = await buildNarrativeContext(contextPaths, context, container.fileSystem);
    return formatBibleFactLines(context, narrative.bibleFacts);
  } catch {
    return [];
  }
}

// SECURITY: the key is read from stdin, never from argv — an API key on a command line lands in
// the shell history and in the process list for every user on the machine.
const setApiKey: CommandHandler = async ({ container, args }) => {
  const provider = args.positionals[0];

  if (provider === undefined || !aiProviderIds.includes(provider as AiProviderId)) {
    return {
      ok: false,
      message: `프로바이더를 지정해 주세요: ${aiProviderIds.join(', ')}`,
    };
  }

  const key = (await readStdin()).trim();

  if (key.length === 0) {
    await container.secretStore.deleteApiKey(provider as AiProviderId);
    return { ok: true, message: `${provider} API 키를 지웠습니다.` };
  }

  await container.secretStore.setApiKey(provider as AiProviderId, key);
  return { ok: true, message: `${provider} API 키를 저장했습니다.` };
};

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    process.stderr.write('키를 입력하고 Ctrl-D 를 누르세요: ');
  }

  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function describeNothingToPromote(kind: 'no_candidates' | 'no_new_candidates'): string {
  return kind === 'no_candidates' ? '승격할 후보가 없습니다.' : '후보가 모두 이미 반영돼 있습니다.';
}

export const commands: Readonly<Record<string, CommandHandler>> = {
  setup: runSetup,
  doctor: runDoctor,
  'config show': runConfigShow,
  'config set': runConfigSet,
  'scene generate': generateScene,
  'scene beats': generateSceneBeats,
  'scene revise': reviseScene,
  'scene draft': showDraftPath,
  'outline generate': generateOutline,
  'novel generate': generateNovel,
  'manuscript assemble': assembleManuscript,
  'manuscript review': reviewManuscript,
  'manuscript summaries': summarizeChapters,
  'card recommend character': recommendCards,
  'card recommend background': recommendCards,
  'card promote': promoteCards,
  'bible promote': promoteBible,
  'apikey set': setApiKey,
  'check grammar': checkDraft,
  'check continuity': checkDraft,
  'check slop': checkDraft,
  init: initProject,
  'state reseal': resealState,
  'project set': setProjectContract,
  'scene seeds': generateSceneSeeds,
  'scene complete': completeStory,
  'cards build': buildStoryCards,
  'canon diff': canonDiff,
  'draft edit': editDraft,
  'draft condense': condenseDraft,
  'draft expand': expandDraft,
  'cards migrate': migrateCardText,
  'scene migrate': migrateScenes,
  'card rename character': renameCard,
  'card rename background': renameCard,
  'card create character': createCard,
  'card create background': createCard,
  'scene create': createScene,
  'scene show': showScene,
  'narrator list': listNarrators,
  'narrator show': showNarrator,
  'narrator add': addNarrator,
  'narrator remove': removeNarrator,
  'draft format': applyDraftFormat,
  'draft augment': augmentDraft,
  'manuscript export': exportManuscript,
  'sim run': runSim,
  'sim screen': screenSim,
  'sim sweep': sweepSim,
  'sim report': reportSim,
  'sim apply': applySim,
};
