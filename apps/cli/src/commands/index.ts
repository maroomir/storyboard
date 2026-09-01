import {
  draftPath,
  analyzeSlop,
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
  scenePath,
  readProjectJson,
  writeProjectJson,
  type StoryUri,
} from '@storyboard/story-engine';

import { aiProviderIds, type AiProviderId } from '@storyboard/story-ai';
import {
  convertLegacySceneText,
  createEmptyBackground,
  createEmptyCharacter,
  isLegacySceneFileName,
  readChapterPlanFile,
  resolveScenePrefixDigitCount,
  serializeSceneCard,
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  parseDraft,
  readSceneFile,
} from '@storyboard/story-format';
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

  return {
    ok: true,
    message:
      converted.length === 0
        ? '바꿀 씬이 없습니다.'
        : `씬 ${converted.length}개를 카드로 옮겼습니다.`,
    data: converted,
  };
};

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

// Read-only proposals: both of these read the scene corpus and suggest, they never write. An agent
// inspects the JSON and decides.
const completeStory: CommandHandler = async ({ container }) => {
  const proposal = await container.completeStoryScenesUseCase.execute(container.workspaceRoot);
  return { ok: true, message: `완결 씬 제안 ${proposal.scenes.length}건`, data: proposal };
};

const buildStoryCards: CommandHandler = async ({ container }) => {
  const proposal = await container.buildStoryCardsUseCase.execute(container.workspaceRoot);
  return { ok: true, message: '씬에서 카드 구성안을 만들었습니다.', data: proposal };
};

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
  // `deriveUniqueId` treats 'new-card' as "no usable suggestion" and falls back to the second
  // argument, then numbers it — the same path the extension takes for a name with no ascii in it.
  const id = await container.createCardUseCase.deriveUniqueId(
    container.workspaceRoot,
    cardType,
    suggested,
    'new-card',
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
  const prefix = String(highest + 1).padStart(digitCount, '0');
  const slug = slugify(name);
  const uri = sceneFilePath(container.workspaceRoot, prefix, slug) as StoryUri;

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

// Card ids are file names, so they stay ascii-safe and lowercase; a Korean title falls back to the
// card kind plus a number, which `deriveUniqueId` then makes unique.
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : 'new-card';
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

  const draftUri = draftPath(container.workspaceRoot, stem) as StoryUri;
  const body = await readDraftBody(container, stem);

  if (body === undefined) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  const prepared = await container.augmentDraftUseCase.prepareAugmentedDraft({
    draftSceneStem: stem,
    sceneUri: scenePath(container.workspaceRoot, stem),
    scope: 'draft',
    target: body,
    workspaceRoot: container.workspaceRoot,
    ...(flagString(args.flags, 'instruction') === undefined
      ? {}
      : { instruction: flagString(args.flags, 'instruction') }),
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
// a workspace the extension already created.
const initProject: CommandHandler = async ({ container, args }) => {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);

  if (await container.fileSystem.exists(paths.projectJson)) {
    return { ok: false, message: '이미 Storyboard 워크스페이스입니다.' };
  }

  const name = flagString(args.flags, 'title') ?? args.positionals[0];

  if (name === undefined || name.trim().length === 0) {
    return { ok: false, message: '--title 로 작품 이름을 지정해 주세요.' };
  }

  const project = createDefaultProjectJson({
    name,
    ...(flagString(args.flags, 'language') === undefined
      ? {}
      : { language: flagString(args.flags, 'language') }),
  });

  await container.fileSystem.createDirectory(paths.metadataDirectory);
  await createStoryboardDirectories(container.fileSystem, paths);
  await writeProjectJson(container.fileSystem, paths.projectJson, project);
  await ensureWorkspaceGitignore(container.fileSystem, paths.gitignore);
  await container.fileSystem.writeFile(
    paths.readme,
    new TextEncoder().encode(createWorkspaceReadme(project.name)),
  );

  return {
    ok: true,
    message: `${project.name} 워크스페이스를 만들었습니다: ${container.workspaceRoot.fsPath}`,
    data: { id: project.id, name: project.name, format: project.format },
  };
};

// Diagnostics the editor paints as squiggles have no terminal form, but the analysis behind them
// does — and an agent that can check its own output is the whole point of the CLI. Findings go out
// as data; the exit code says whether the draft is clean.
type CheckKind = 'grammar' | 'continuity' | 'slop';

async function readDraftBody(container: CliContainer, stem: string): Promise<string | undefined> {
  const uri = draftPath(container.workspaceRoot, stem) as StoryUri;

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
  'scene generate': generateScene,
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
  'scene seeds': generateSceneSeeds,
  'scene complete': completeStory,
  'cards build': buildStoryCards,
  'canon diff': canonDiff,
  'cards migrate': migrateCardText,
  'scene migrate': migrateScenes,
  'card create character': createCard,
  'card create background': createCard,
  'scene create': createScene,
  'draft format': applyDraftFormat,
  'draft augment': augmentDraft,
  'manuscript export': exportManuscript,
};
