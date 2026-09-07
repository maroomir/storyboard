import { describeNarration } from '@storyboard/story-ai';
import {
  STORYBOARD_RELATIVE_PATHS,
  clampScenePrefixDigits,
  mainThreadId,
  resolveNarration,
  computeNextSceneOrderFromSceneFileNames,
  formatSceneOrderPrefix,
  parseSceneCard,
  sceneFileRelativePath,
  sceneRelativePath,
  sceneSummaryFileName,
  sceneSummaryReference,
  serializeSceneCard,
  validateSceneSlugInput,
  type SceneCard,
} from '@storyboard/story-format';

import type { WorkspaceWrite } from '@/workspace/workspaceChanges';
import { hashContent } from '@/workspace/workspaceStore';
import type { ChatContext } from '@/chat/context';
import type { IncomingUpdate } from '@/chat/ports';
import { commandArgs, isCommand, type ICommandHandler } from '@/chat/registry';
import { describeOutcome } from './edit';
import { enqueueBeatsJob } from './generate';

const USAGE = [
  '사용법:',
  '/scene new <slug>',
  '<컨셉 본문…>',
  '',
  '/scene show <씬 stem> — 이 씬에 적용될 시점·줄기',
  '/scene edit <씬 stem> — 본문 전체 교체',
  '/scene append <씬 stem> — 본문 끝에 덧붙이기',
  '(본문은 scene/<stem>.summary.md 에 저장되며, 명령 다음 줄부터 여러 줄로 씁니다)',
  '',
  '/scene beats <씬 stem> — 카드 재료와 본문으로 사건 비트 전개',
  '/scene beats <씬 stem> force — 이미 있는 비트를 다시 뽑기',
].join('\n');

export function createSceneCommandHandler(): ICommandHandler {
  return {
    command: '/scene',
    description: '씬 시드 생성·편집·비트 전개 (/scene new · edit · append · beats)',
    match: (update: IncomingUpdate) => isCommand(update, '/scene'),
    execute: async (ctx) => {
      const parsed = parseSceneCommand(commandArgs(ctx.update));
      if (parsed === undefined) {
        await ctx.reply({ text: USAGE });
        return;
      }

      if (parsed.action === 'new') {
        await createScene(ctx, parsed.target, parsed.body);
        return;
      }

      if (parsed.action === 'beats') {
        await expandSceneBeats(ctx, parsed.target, parsed.force);
        return;
      }

      if (parsed.action === 'show') {
        await showScene(ctx, parsed.target);
        return;
      }

      await updateScene(ctx, parsed.action, parsed.target, parsed.body);
    },
  };
}

type SceneCommand =
  | {
      readonly action: 'new' | 'show' | 'edit' | 'append';
      readonly target: string;
      readonly body: string;
    }
  | { readonly action: 'beats'; readonly target: string; readonly force: boolean };

const bodyActions = ['new', 'show', 'edit', 'append'] as const;

function isBodyAction(value: string | undefined): value is 'new' | 'show' | 'edit' | 'append' {
  return value !== undefined && (bodyActions as readonly string[]).includes(value);
}

// `/scene <action> <target>` on the first line, the body on the lines after it. Telegram sends the
// whole message as one text, so multi-line bodies arrive naturally.
function parseSceneCommand(args: string): SceneCommand | undefined {
  const firstLineEnd = args.indexOf('\n');
  const firstLine = (firstLineEnd === -1 ? args : args.slice(0, firstLineEnd)).trim();
  const body = firstLineEnd === -1 ? '' : args.slice(firstLineEnd + 1).trim();

  const [action, target, ...rest] = firstLine.split(/\s+/).filter((token) => token.length > 0);
  if (target === undefined) {
    return undefined;
  }

  if (action === 'beats') {
    const force = rest.length === 1 && rest[0] === 'force';
    return force || rest.length === 0 ? { action, target, force } : undefined;
  }

  if (!isBodyAction(action) || rest.length > 0) {
    return undefined;
  }

  return { action, target, body };
}

// 씬이 어떤 시점으로 생성될지는 씬 카드 > 프로젝트 기본 순으로 정해진다. 결과가 어긋나 보일 때
// 어느 단계에서 온 값인지 확인하는 자리다.
async function showScene(ctx: ChatContext, sceneStem: string): Promise<void> {
  const scene = await ctx.store.readScene(sceneStem);
  const project = await ctx.store.readProject();
  const narrators = new Map(
    (await ctx.content.listNarrators()).map((card) => [card.id, card] as const),
  );

  let narration: string;
  try {
    const resolved = resolveNarration({
      ...(scene.value.card.narrator === undefined
        ? {}
        : { sceneNarrator: scene.value.card.narrator }),
      ...(project.value.setting?.narration?.defaultNarrator === undefined
        ? {}
        : { defaultNarrator: project.value.setting.narration.defaultNarrator }),
      ...(project.value.setting?.pov === undefined ? {} : { pov: project.value.setting.pov }),
      ...(scene.value.frontmatter.povCharacter === undefined
        ? {}
        : { focalFallback: scene.value.frontmatter.povCharacter }),
      narrators,
    });
    narration = resolved ? describeNarration(resolved) : '지정 없음';
  } catch (error) {
    narration = error instanceof Error ? error.message : String(error);
  }

  await ctx.reply({
    text: [
      `🎬 ${scene.value.card.title ?? sceneStem} (${sceneStem})`,
      `시점: ${narration}`,
      `줄기: ${scene.value.card.thread ?? mainThreadId}`,
      ...(scene.value.card.characters && scene.value.card.characters.length > 0
        ? [`인물: ${scene.value.card.characters.join(', ')}`]
        : []),
      ...(scene.value.card.summary === undefined ? [] : ['', scene.value.card.summary]),
    ].join('\n'),
  });
}

async function createScene(ctx: ChatContext, slug: string, body: string): Promise<void> {
  const slugError = validateSceneSlugInput(slug);
  if (slugError !== undefined) {
    await ctx.reply({ text: slugError });
    return;
  }
  if (body.length === 0) {
    await ctx.reply({ text: '컨셉 본문을 명령 다음 줄부터 함께 보내주세요.\n\n' + USAGE });
    return;
  }

  const project = await ctx.store.readProject();
  const digitCount = clampScenePrefixDigits(project.value.editor?.scenePrefixDigits ?? 2);
  const sceneFileNames = await ctx.store.listDirectoryNames(
    STORYBOARD_RELATIVE_PATHS.sceneDirectory,
  );
  const order = computeNextSceneOrderFromSceneFileNames(sceneFileNames);
  const prefix = formatSceneOrderPrefix(order, digitCount);
  const relativePath = sceneFileRelativePath(prefix, slug);
  const stem = `${prefix}-${slug}`;
  const summaryFileName = sceneSummaryFileName(stem);

  // baselineHash 없음 = 생성 전용: 같은 이름이 그 사이 생겼다면 게이트가 거부한다.
  const outcome = await ctx.content.writeTrackedSet(
    [
      {
        relativePath,
        content: serializeSceneCard({ type: 'scene', id: stem, summary: summaryFileName }),
        baselineHash: undefined,
      },
      {
        relativePath: summaryRelativePath(summaryFileName),
        content: `${body}\n`,
        baselineHash: undefined,
      },
    ],
    `storyboard-bot: create ${relativePath}`,
  );

  if (outcome.status !== 'committed' && outcome.status !== 'written') {
    await ctx.reply({ text: describeOutcome(outcome) });
    return;
  }

  await ctx.reply({
    text: [
      `✅ 씬을 만들었습니다: ${prefix}-${slug}`,
      `   ${relativePath}`,
      `/draft ${prefix}-${slug} 로 초안을 생성할 수 있습니다.`,
    ].join('\n'),
  });
}

async function updateScene(
  ctx: ChatContext,
  action: 'edit' | 'append',
  sceneStem: string,
  body: string,
): Promise<void> {
  if (body.length === 0) {
    await ctx.reply({ text: '새 본문을 명령 다음 줄부터 함께 보내주세요.\n\n' + USAGE });
    return;
  }

  const scenes = await ctx.content.listScenes();
  if (!scenes.some((scene) => scene.stem === sceneStem)) {
    await ctx.reply({ text: `씬을 찾을 수 없습니다: ${sceneStem}` });
    return;
  }

  const relativePath = sceneRelativePath(sceneStem);
  const raw = await ctx.store.readText(relativePath);
  const card = parseSceneCard(raw);
  const existingSummary = (await ctx.store.readSceneSummaryText(card.summary)) ?? card.summary;
  const summaryText = mergeSummaryEdit(existingSummary, action, body);

  const outcome = await ctx.content.writeTrackedSet(
    await planSummaryWrites(ctx, relativePath, raw, card, summaryText),
    `storyboard-bot: update ${relativePath}`,
  );

  if (outcome.status !== 'committed' && outcome.status !== 'written') {
    await ctx.reply({ text: describeOutcome(outcome) });
    return;
  }

  await ctx.reply({
    text:
      action === 'edit'
        ? `✅ 본문을 교체했습니다: ${sceneStem}`
        : `✅ 본문 끝에 덧붙였습니다: ${sceneStem}`,
  });
}

// NOTE: /scene edit·append는 자유 산문 채널이므로 카드의 summary 만 다룬다. 구조 필드
// (purpose/conflict/…)는 카드 에디터가 담당한다. 산문은 `<stem>.summary.md` 에 두고 카드에는
// 파일 이름만 남기므로, 인라인 summary 를 가진 구형 카드는 첫 편집에서 파일로 옮겨진다.
function mergeSummaryEdit(
  existingSummary: string | undefined,
  action: 'edit' | 'append',
  body: string,
): string {
  const existing = existingSummary?.trim() ?? '';
  return action === 'edit' || existing.length === 0 ? body : `${existing}\n\n${body}`;
}

async function planSummaryWrites(
  ctx: ChatContext,
  cardRelativePath: string,
  raw: string,
  card: SceneCard,
  summaryText: string,
): Promise<WorkspaceWrite[]> {
  const summaryFileName = sceneSummaryReference(card.summary) ?? sceneSummaryFileName(card.id);
  const summaryPath = summaryRelativePath(summaryFileName);
  const summaryWrite: WorkspaceWrite = {
    relativePath: summaryPath,
    content: `${summaryText}\n`,
    baselineHash: await readBaselineHash(ctx, summaryPath),
  };

  if (card.summary === summaryFileName) {
    return [summaryWrite];
  }

  return [
    {
      relativePath: cardRelativePath,
      content: serializeSceneCard({ ...card, summary: summaryFileName }),
      baselineHash: hashContent(raw),
    },
    summaryWrite,
  ];
}

async function readBaselineHash(
  ctx: ChatContext,
  relativePath: string,
): Promise<string | undefined> {
  try {
    return hashContent(await ctx.store.readText(relativePath));
  } catch {
    return undefined;
  }
}

function summaryRelativePath(summaryFileName: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/${summaryFileName}`;
}

async function expandSceneBeats(
  ctx: ChatContext,
  sceneStem: string,
  force: boolean,
): Promise<void> {
  const scenes = await ctx.content.listScenes();
  if (!scenes.some((scene) => scene.stem === sceneStem)) {
    await ctx.reply({ text: `씬을 찾을 수 없습니다: ${sceneStem}` });
    return;
  }

  await enqueueBeatsJob(ctx, sceneStem, force);
}
