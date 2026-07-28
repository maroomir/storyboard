import {
  GitClient,
  inspectWorkspaceRepository,
  initializeWorkspaceRepository,
} from '@storyboard/story-git';

import type { ChatContext } from '../context';
import type { IncomingUpdate } from '../ports';
import { commandArgs, isCommand, type ICommandHandler } from '../registry';
import { describeOutcome } from './edit';

// Reports whether the bot can actually do its job right now, and — only on explicit confirmation —
// performs the one repair it is allowed to make (turning the workspace into a git repository).
export function createDoctorHandler(): ICommandHandler {
  return {
    command: '/doctor',
    description: '워크스페이스·git 점검 (/doctor init · /doctor format)',
    match: (update: IncomingUpdate) => isCommand(update, '/doctor'),
    execute: async (ctx) => {
      if (commandArgs(ctx.update) === 'init') {
        await runInit(ctx);
        return;
      }

      if (commandArgs(ctx.update) === 'format') {
        await runFormat(ctx);
        return;
      }

      await ctx.reply({ text: (await buildReport(ctx)).join('\n') });
    },
  };
}

async function buildReport(ctx: ChatContext): Promise<string[]> {
  const lines = ['🩺 진단'];

  try {
    const project = await ctx.store.readProject();
    lines.push(`✅ 워크스페이스: ${project.value.name}`);
    lines.push(`   ${ctx.store.root}`);
  } catch {
    lines.push(`❌ 워크스페이스를 읽을 수 없습니다: ${ctx.store.root}`);
    return lines;
  }

  const repository = inspectWorkspaceRepository(ctx.store.root);
  lines.push(repository.status === 'ready' ? '✅ git: 커밋 가능' : `❌ git: ${repository.detail}`);
  if (repository.status === 'needs-init') {
    lines.push('   → `/doctor init` 으로 초기화할 수 있습니다.');
  }

  const git = new GitClient(ctx.store.root);
  const head = git.headCommit();
  if (head) {
    lines.push(`   마지막 커밋: ${head.hash} ${head.subject}`);
  }

  lines.push(`✅ 동기화 상태: ${ctx.sync.getState()}`);

  const cards = await ctx.content.listCards();
  const scenes = await ctx.content.listScenes();
  lines.push(`✅ 콘텐츠: 카드 ${cards.length} · 씬 ${scenes.length}`);

  // Hand-authored cards serialize to a different (canonical) shape, so warn before that shows up
  // folded into someone's content edit.
  const unformatted = await ctx.content.listUnformattedCardIds();
  if (unformatted.length > 0) {
    lines.push(`⚠️ 표준 서식이 아닌 카드 ${unformatted.length}개: ${unformatted.join(', ')}`);
    lines.push('   → `/doctor format` 으로 한 커밋에 정리할 수 있습니다.');
  }

  return lines;
}

async function runFormat(ctx: ChatContext): Promise<void> {
  const result = await ctx.content.normalizeCardFormatting();

  if (!result) {
    await ctx.reply({ text: '✅ 모든 카드가 이미 표준 서식입니다.' });
    return;
  }

  if (result.outcome.status !== 'committed' && result.outcome.status !== 'written') {
    await ctx.reply({ text: describeOutcome(result.outcome) });
    return;
  }

  await ctx.reply({
    text: [
      `✅ 카드 ${result.ids.length}개를 표준 서식으로 정리했습니다.`,
      `   ${result.ids.join(', ')}`,
      result.outcome.status === 'committed'
        ? '   커밋 1건으로 기록했습니다.'
        : '   (커밋 없이 저장했습니다.)',
    ].join('\n'),
  });
}

async function runInit(ctx: ChatContext): Promise<void> {
  const before = inspectWorkspaceRepository(ctx.store.root);

  if (before.status === 'ready') {
    await ctx.reply({ text: '이미 커밋 가능한 상태입니다.' });
    return;
  }

  if (before.status === 'needs-identity' || before.status === 'busy') {
    await ctx.reply({ text: `⚠️ 먼저 해결이 필요합니다: ${before.detail}` });
    return;
  }

  const result = initializeWorkspaceRepository(ctx.store.root);
  const after = inspectWorkspaceRepository(ctx.store.root);

  await ctx.reply({
    text: [
      result.initialized ? '✅ git 저장소를 초기화했습니다.' : 'ℹ️ 이미 git 저장소였습니다.',
      result.gitignoreUpdated
        ? '✅ .gitignore에 Storyboard 생성물 제외 규칙을 추가했습니다.'
        : 'ℹ️ .gitignore는 이미 설정되어 있었습니다.',
      result.committed
        ? '✅ 현재 내용으로 초기 커밋을 만들었습니다.'
        : 'ℹ️ 커밋할 변경이 없었습니다.',
      after.status === 'ready' ? '✅ 이제 편집 명령을 쓸 수 있습니다.' : `⚠️ ${after.detail}`,
    ].join('\n'),
  });
}
