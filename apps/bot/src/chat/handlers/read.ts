import type { ChatContext } from '../context';
import { commandArgs, isCommand, type ICommandHandler } from '../registry';
import type { IncomingUpdate } from '../ports';

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
  return handler('/start', '봇 소개와 사용 가능한 명령', async (ctx) => {
    const project = await ctx.store.readProject();
    await ctx.reply({
      text: [
        `📖 *${project.value.name}*`,
        '',
        'Storyboard 워크스페이스에 직접 연결되어 있습니다. 저장하면 곧바로 커밋되고 VSCode에도 즉시 보입니다.',
        '',
        '/cards — 카드 목록',
        '/show <id> — 카드 상세',
        '/scenes — 씬 목록',
        '/bible — 스토리 바이블(정사) 조회',
        '/sync — 원격 동기화 상태',
        '/status — 워크스페이스 상태',
      ].join('\n'),
    });
  });
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
    const report = ctx.sync.syncNow();

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
        await ctx.reply({ text: '⚠️ 원격에 연결할 수 없습니다. 로컬 커밋은 그대로 보존됩니다.' });
        return;
      case 'conflict':
        await ctx.reply({
          text: `⚠️ 충돌로 원격 변경을 적용하지 못했습니다: ${report.conflicts.join(', ')}\nDesktop에서 해결해주세요.`,
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

    await ctx.reply({
      text: [
        `📖 ${project.value.name}`,
        `경로: ${ctx.store.root}`,
        `카드 ${cards.length} · 씬 ${scenes.length}`,
        `동기화: ${ctx.sync.getState()}`,
      ].join('\n'),
    });
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
