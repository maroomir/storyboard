import { extractDraftBody } from '@storyboard/story-format';

import type { ChatContext } from '@/chat/context';
import { commandArgs, isCommand, type ICommandHandler } from '@/chat/registry';
import type { IncomingUpdate, InlineKeyboard } from '@/chat/ports';
import { formatJobUsage } from '@/gen/types';
import { enqueueDraftJob } from './generate';

function handler(
  command: string,
  description: string,
  execute: (ctx: ChatContext) => Promise<void>,
): ICommandHandler {
  return {
    command,
    description,
    match: (update: IncomingUpdate) => isCommand(update, command),
    execute,
  };
}

export function createStartHandler(): ICommandHandler {
  const base = handler('/start', '봇 소개와 사용 가능한 명령', async (ctx) => {
    const project = await ctx.store.readProject();
    await ctx.reply({
      text: [
        `📖 *${project.value.name}*`,
        '',
        'Storyboard 워크스페이스에 직접 연결되어 있습니다. 저장하면 곧바로 커밋되고 VSCode에도 즉시 보입니다.',
        '',
        '📚 조회',
        '/cards — 카드 목록',
        '/show <id> — 카드 상세',
        '/scenes — 씬 목록',
        '/read <씬 stem> — 초안 열람 (장문은 파일 첨부)',
        '/bible — 스토리 바이블(정사) 조회',
        '/status — 워크스페이스 상태',
        '',
        '✏️ 편집',
        '/rename <id> <새 이름> — 카드 이름 변경',
        '/set <id> <항목> <값1> | <값2> — 카드 목록 항목 수정',
        '/scene new <slug> — 씬 시드 생성 (본문은 다음 줄부터)',
        '/scene edit·append <씬 stem> — 씬 본문 교체·덧붙이기',
        '',
        '🤖 생성',
        '/draft <씬 stem> — 씬 초안 생성 (all = 초안 없는 전체)',
        '/review <씬 stem> — 기존 초안 검수·수정',
        '/outline — 시놉시스 생성',
        '/plan — 챕터 계획 생성',
        '/manuscript — 원고 조립',
        '/jobs — 최근 생성 작업 목록',
        '/log <작업 번호> — 작업 단계 이력',
        '/stop <작업 번호> — 진행 중 작업 취소',
        '',
        '🛠 운영',
        '/sync — 원격 동기화',
        '/usage — 기간별 토큰·비용 사용량',
        '/doctor — 워크스페이스·git 점검 (init·format)',
      ].join('\n'),
    });
  });

  // `/help` is the name new users guess first; both spellings land on the same summary.
  return {
    ...base,
    match: (update: IncomingUpdate) => isCommand(update, '/start') || isCommand(update, '/help'),
  };
}

export function createCardsHandler(): ICommandHandler {
  return handler('/cards', '캐릭터·배경 카드 목록', async (ctx) => {
    const cards = await ctx.content.listCards();

    if (cards.length === 0) {
      await ctx.reply({ text: '아직 카드가 없습니다.' });
      return;
    }

    const characters = cards.filter((card) => card.kind === 'character');
    const backgrounds = cards.filter((card) => card.kind === 'background');
    const lines: string[] = [];

    if (characters.length > 0) {
      lines.push(`👤 캐릭터 (${characters.length})`);
      lines.push(...characters.map((card) => `  • ${card.id}`));
    }
    if (backgrounds.length > 0) {
      if (lines.length > 0) {
        lines.push('');
      }
      lines.push(`🏙 배경 (${backgrounds.length})`);
      lines.push(...backgrounds.map((card) => `  • ${card.id}`));
    }

    await ctx.reply({ text: lines.join('\n') });
  });
}

export function createShowHandler(): ICommandHandler {
  return handler('/show', '카드 상세 보기 (/show <id>)', async (ctx) => {
    const id = commandArgs(ctx.update);
    if (id.length === 0) {
      await ctx.reply({ text: '사용법: /show <카드 id>' });
      return;
    }

    const summary = (await ctx.content.listCards()).find((card) => card.id === id);
    if (!summary) {
      await ctx.reply({ text: `카드를 찾을 수 없습니다: ${id}` });
      return;
    }

    const card = await ctx.content.readCard(summary.kind, id);
    await ctx.reply({ text: renderCard(card.value, summary.relativePath) });
  });
}

export function createScenesHandler(): ICommandHandler {
  return handler('/scenes', '씬 목록', async (ctx) => {
    const scenes = await ctx.content.listScenes();

    if (scenes.length === 0) {
      await ctx.reply({ text: '아직 씬이 없습니다.' });
      return;
    }

    const lines = await Promise.all(
      scenes.map(async (scene) => {
        const draft = await ctx.store.readDraft(scene.stem);
        return `  ${String(scene.order).padStart(2, '0')} ${scene.slug}${draft ? ' ✅' : ''}`;
      }),
    );

    await ctx.reply({ text: [`🎬 씬 (${scenes.length}) — ✅는 초안 있음`, ...lines].join('\n') });
  });
}

// Fits under Telegram's 4096 limit with the header line; anything longer reads badly as chat
// messages anyway, so it switches to a preview plus a Markdown attachment.
const DRAFT_SINGLE_MESSAGE_LIMIT = 3500;
const DRAFT_PREVIEW_LENGTH = 600;
const DRAFT_CHOICE_LIMIT = 12;

export interface ReadDraftOptions {
  readonly minimizeChatBody: boolean;
}

// Also matches its own inline-button callbacks (rd:<stem> opens, rd:gen:<stem> generates), so the
// router stays untouched — the registry's match() is the single dispatch point.
export function createReadDraftHandler(options: ReadDraftOptions): ICommandHandler {
  return {
    command: '/read',
    description: '초안 열람 (/read <씬 stem>)',
    match: (update: IncomingUpdate) =>
      isCommand(update, '/read') || (update.kind === 'callback' && update.data.startsWith('rd:')),
    execute: async (ctx) => {
      if (ctx.update.kind === 'callback') {
        await handleReadCallback(ctx, ctx.update.data, options);
        return;
      }

      const sceneStem = commandArgs(ctx.update);
      if (sceneStem.length === 0) {
        await offerDraftChoices(ctx);
        return;
      }

      await deliverDraft(ctx, sceneStem, options);
    },
  };
}

async function handleReadCallback(
  ctx: ChatContext,
  data: string,
  options: ReadDraftOptions,
): Promise<void> {
  const generate = data.match(/^rd:gen:(.+)$/);
  if (generate) {
    await ctx.answerCallback('생성을 시작합니다.');
    await enqueueDraftJob(ctx, generate[1] ?? '');
    return;
  }

  const open = data.match(/^rd:(.+)$/);
  if (open) {
    await ctx.answerCallback();
    await deliverDraft(ctx, open[1] ?? '', options);
    return;
  }

  await ctx.answerCallback();
}

async function offerDraftChoices(ctx: ChatContext): Promise<void> {
  const scenes = await ctx.content.listScenes();
  const drafted: string[] = [];
  for (const scene of scenes) {
    if ((await ctx.store.readDraft(scene.stem)) !== undefined) {
      drafted.push(scene.stem);
    }
  }

  if (drafted.length === 0) {
    await ctx.reply({ text: '아직 초안이 없습니다. /draft <씬 stem> 으로 생성해주세요.' });
    return;
  }

  const keyboard: InlineKeyboard = drafted
    .slice(0, DRAFT_CHOICE_LIMIT)
    .map((stem) => [{ text: stem, callbackData: `rd:${stem}` }]);
  const overflow =
    drafted.length > DRAFT_CHOICE_LIMIT
      ? [`… 외 ${drafted.length - DRAFT_CHOICE_LIMIT}개는 /read <씬 stem> 으로 열람합니다.`]
      : [];

  await ctx.reply({
    text: [`📄 초안 (${drafted.length}) — 읽을 초안을 선택하세요.`, ...overflow].join('\n'),
    keyboard,
  });
}

async function deliverDraft(
  ctx: ChatContext,
  sceneStem: string,
  options: ReadDraftOptions,
): Promise<void> {
  const scenes = await ctx.content.listScenes();
  if (!scenes.some((scene) => scene.stem === sceneStem)) {
    await ctx.reply({ text: `씬을 찾을 수 없습니다: ${sceneStem}` });
    return;
  }

  const draft = await ctx.store.readDraft(sceneStem);
  if (draft === undefined) {
    await ctx.reply({
      text: `아직 초안이 없습니다: ${sceneStem}`,
      keyboard: [[{ text: '지금 생성', callbackData: `rd:gen:${sceneStem}` }]],
    });
    return;
  }

  const body = extractDraftBody(draft.value);
  const header = `📄 ${sceneStem} (${body.length.toLocaleString()}자)`;
  const attachment = {
    bytes: new TextEncoder().encode(body),
    fileName: `${sceneStem}.md`,
    caption: header,
  };

  // Privacy mode (BG-05): the manuscript body stays out of the chat transcript; only the file
  // attachment carries it.
  if (options.minimizeChatBody) {
    await ctx.replyDocument(attachment);
    return;
  }

  if (body.length > DRAFT_SINGLE_MESSAGE_LIMIT) {
    await ctx.reply({ text: `${header}\n\n${body.slice(0, DRAFT_PREVIEW_LENGTH)}…` });
    await ctx.replyDocument({ ...attachment, caption: '전문 첨부' });
    return;
  }

  await ctx.reply({ text: `${header}\n\n${body}` });
}

export function createBibleHandler(): ICommandHandler {
  return handler('/bible', '스토리 바이블(정사) 조회', async (ctx) => {
    const bible = await ctx.store.readBible();

    if (!bible) {
      await ctx.reply({
        text: '아직 스토리 바이블이 없습니다. Desktop에서 정사를 작성하면 여기서 조회할 수 있습니다.',
      });
      return;
    }

    const facts = bible.value.facts ?? [];
    if (facts.length === 0) {
      await ctx.reply({ text: '스토리 바이블에 등록된 정사가 없습니다.' });
      return;
    }

    const lines = facts
      .slice(0, 40)
      .map((fact) => `  • [${fact.subject.kind}] ${fact.key}: ${fact.value}`);
    const overflow = facts.length > 40 ? [`  … 외 ${facts.length - 40}건`] : [];

    await ctx.reply({
      text: [
        `📚 정사 (${facts.length}건) — 편집은 Desktop에서 합니다.`,
        ...lines,
        ...overflow,
      ].join('\n'),
    });
  });
}

export function createSyncHandler(): ICommandHandler {
  return handler('/sync', '원격 동기화', async (ctx) => {
    const report = await ctx.sync.syncNow();

    switch (report.state) {
      case 'no-remote':
        await ctx.reply({
          text: '원격이 설정되어 있지 않습니다. 저장은 계속 로컬 커밋으로 남습니다.',
        });
        return;
      case 'clean':
        await ctx.reply({
          text: report.pushed ? '✅ 원격에 반영했습니다.' : '✅ 이미 최신입니다.',
        });
        return;
      case 'offline':
        await ctx.reply({
          text: [
            '⚠️ 원격에 연결할 수 없습니다. 로컬 커밋은 그대로 보존됩니다.',
            ...(report.detail === undefined ? [] : [`(${report.detail})`]),
          ].join('\n'),
        });
        return;
      case 'dirty':
        await ctx.reply({
          text: [
            '⚠️ Desktop에서 저장 중인(커밋되지 않은) 변경이 있어 원격 변경을 적용하지 않았습니다.',
            'Desktop에서 변경을 정리한 뒤 다시 /sync 해주세요. 로컬 파일은 건드리지 않았습니다.',
          ].join('\n'),
        });
        return;
      case 'error':
        await ctx.reply({
          text: `⚠️ 동기화할 수 없습니다: ${report.detail ?? '원인 미상'}
/doctor 로 워크스페이스 상태를 확인해주세요.`,
        });
        return;
      case 'conflict':
        await ctx.reply({
          text: `⚠️ 충돌로 원격 변경을 적용하지 못했습니다: ${report.conflicts.join(', ')}
Desktop에서 해결해주세요.`,
        });
        return;
    }
  });
}

export function createStatusHandler(): ICommandHandler {
  return handler('/status', '워크스페이스 상태', async (ctx) => {
    const project = await ctx.store.readProject();
    const cards = await ctx.content.listCards();
    const scenes = await ctx.content.listScenes();

    const lines = [
      `📖 ${project.value.name}`,
      `경로: ${ctx.store.root}`,
      `카드 ${cards.length} · 씬 ${scenes.length}`,
      `동기화: ${ctx.sync.getState()}`,
    ];

    const usage = ctx.jobs?.getUsageSince(Date.now() - 24 * 60 * 60 * 1000);
    if (usage) {
      lines.push(`24시간 사용량: ${formatJobUsage(usage)}`);
    }

    await ctx.reply({ text: lines.join('\n') });
  });
}

function renderCard(card: { readonly [key: string]: unknown }, relativePath: string): string {
  const lines = [
    `🗂 ${String(card.name ?? card.id)} (${String(card.type)})`,
    `파일: ${relativePath}`,
  ];

  for (const field of ['aliases', 'tags', 'description', 'traits', 'voice', 'desire']) {
    const value = card[field];
    if (Array.isArray(value) && value.length > 0) {
      lines.push('', `${field}:`);
      lines.push(...value.map((entry) => `  • ${String(entry)}`));
    }
  }

  return lines.join('\n');
}
