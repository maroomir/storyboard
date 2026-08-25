import {
  STORYBOARD_RELATIVE_PATHS,
  clampScenePrefixDigits,
  computeNextSceneOrderFromSceneFileNames,
  formatSceneOrderPrefix,
  parseSceneCard,
  sceneFileRelativePath,
  sceneRelativePath,
  serializeSceneCard,
  validateSceneSlugInput,
} from '@storyboard/story-format';

import { hashContent } from '../../workspace/workspaceStore';
import type { ChatContext } from '../context';
import type { IncomingUpdate } from '../ports';
import { commandArgs, isCommand, type ICommandHandler } from '../registry';
import { describeOutcome } from './edit';

const USAGE = [
  '사용법:',
  '/scene new <slug>',
  '<컨셉 본문…>',
  '',
  '/scene edit <씬 stem> — 본문 전체 교체',
  '/scene append <씬 stem> — 본문 끝에 덧붙이기',
  '(본문은 명령 다음 줄부터 여러 줄로 씁니다)',
].join('\n');

export function createSceneCommandHandler(): ICommandHandler {
  return {
    command: '/scene',
    description: '씬 시드 생성·편집 (/scene new · edit · append)',
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

      await updateScene(ctx, parsed.action, parsed.target, parsed.body);
    },
  };
}

interface SceneCommand {
  readonly action: 'new' | 'edit' | 'append';
  readonly target: string;
  readonly body: string;
}

// `/scene <action> <target>` on the first line, the body on the lines after it. Telegram sends the
// whole message as one text, so multi-line bodies arrive naturally.
function parseSceneCommand(args: string): SceneCommand | undefined {
  const firstLineEnd = args.indexOf('\n');
  const firstLine = (firstLineEnd === -1 ? args : args.slice(0, firstLineEnd)).trim();
  const body = firstLineEnd === -1 ? '' : args.slice(firstLineEnd + 1).trim();

  const [action, target, ...rest] = firstLine.split(/\s+/).filter((token) => token.length > 0);
  if (
    (action !== 'new' && action !== 'edit' && action !== 'append') ||
    target === undefined ||
    rest.length > 0
  ) {
    return undefined;
  }

  return { action, target, body };
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

  // baselineHash 없음 = 생성 전용: 같은 이름이 그 사이 생겼다면 게이트가 거부한다.
  const outcome = await ctx.content.writeTracked(
    relativePath,
    serializeSceneCard({ type: 'scene', id: `${prefix}-${slug}`, summary: body }),
    undefined,
    `storygram: create ${relativePath}`,
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
  const nextContent = applySceneSummaryEdit(raw, action, body);

  const outcome = await ctx.content.writeTracked(
    relativePath,
    nextContent,
    hashContent(raw),
    `storygram: update ${relativePath}`,
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

// NOTE: /scene edit·append는 자유 산문 채널이므로 카드의 summary 필드만 다룬다. 구조 필드
// (purpose/conflict/…)는 카드 에디터가 담당한다.
function applySceneSummaryEdit(raw: string, action: 'edit' | 'append', body: string): string {
  const card = parseSceneCard(raw);
  const existingSummary = card.summary?.trim() ?? '';
  const summary =
    action === 'edit' || existingSummary.length === 0 ? body : `${existingSummary}\n\n${body}`;

  return serializeSceneCard({ ...card, summary });
}
