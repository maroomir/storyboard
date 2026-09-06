import {
  GitClient,
  inspectWorkspaceRepository,
  initializeWorkspaceRepository,
} from '@storyboard/story-git';

import { collectPermissionWarnings } from '@/config/config';
import { collectCliProviderCommands, findExecutableOnPath } from '@/config/environment';
import { listProvidersInUse } from '@/config/sharedConfig';
import type { ChatContext } from '@/chat/context';
import { isCliProvider, type AiProviderId, type ConfigBridge } from '@storyboard/story-ai';

import type { IncomingUpdate } from '@/chat/ports';
import { commandArgs, isCommand, type ICommandHandler } from '@/chat/registry';
import { describeOutcome } from './edit';

// Everything the report needs that does not live in the workspace: the bot's own config file and
// the provider selection it was booted with.
export interface DoctorEnvironment {
  readonly configFile: string;
  readonly configBridge: ConfigBridge;
  readonly hasApiKey: (providerId: AiProviderId) => Promise<boolean>;
  readonly remote: string | undefined;
}

// Reports whether the bot can actually do its job right now, and — only on explicit confirmation —
// performs the one repair it is allowed to make (turning the workspace into a git repository).
export function createDoctorHandler(environment: DoctorEnvironment): ICommandHandler {
  return {
    command: '/doctor',
    description: '워크스페이스·git·프로바이더 점검 (/doctor init · format · migrate)',
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

      if (commandArgs(ctx.update) === 'migrate') {
        await runMigrate(ctx);
        return;
      }

      await ctx.reply({ text: (await buildReport(ctx, environment)).join('\n') });
    },
  };
}

async function buildReport(ctx: ChatContext, environment: DoctorEnvironment): Promise<string[]> {
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

  // A tracked change sitting uncommitted is usually the user's own work-in-progress from the
  // extension; the bot will not sweep it up, so it only reports it.
  if (repository.status === 'ready' && git.hasTrackedChanges()) {
    lines.push('⚠️ 커밋되지 않은 변경이 있습니다 (봇 커밋에는 포함되지 않습니다).');
  }

  lines.push(...describeRemote(git, environment.remote));
  lines.push(`✅ 동기화 상태: ${ctx.sync.getState()}`);
  lines.push(...(await describeProviders(environment)));
  lines.push(...describeJobs(ctx));

  for (const warning of collectPermissionWarnings(environment.configFile)) {
    lines.push(`⚠️ ${warning}`);
  }

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

  const legacyScenes = await ctx.content.listLegacySceneTexts();
  if (legacyScenes.length > 0) {
    lines.push(`⚠️ 구형 씬(.txt) ${legacyScenes.length}개: ${legacyScenes.join(', ')}`);
    lines.push('   → `/doctor migrate` 로 scene.card로 변환할 수 있습니다.');
  }

  return lines;
}

function describeRemote(git: GitClient, remote: string | undefined): string[] {
  if (remote === undefined) {
    return ['ℹ️ 원격 없음: 로컬 커밋만 하고 `/sync`는 no-remote로 끝납니다.'];
  }

  return git.hasRemote(remote)
    ? [`✅ 원격: ${remote}`]
    : [`❌ 원격 \`${remote}\`이 저장소에 없습니다 — \`/sync\`가 실패합니다.`];
}

async function describeProviders(environment: DoctorEnvironment): Promise<string[]> {
  const { configBridge } = environment;
  if (!configBridge.isDefaultProviderConfigured()) {
    return [
      '❌ 프로바이더: 기본 AI 제공자가 설정되지 않아 생성 작업이 거부됩니다. ~/.storyboard/config.json 의 defaultProvider 를 채우세요.',
    ];
  }

  const cliLines = collectCliProviderCommands(configBridge).map(({ providerId, command }) => {
    const resolved = findExecutableOnPath(command);
    return resolved === undefined
      ? `❌ 프로바이더 ${providerId}: \`${command}\`을 PATH에서 찾을 수 없어 생성이 실패합니다.`
      : `✅ 프로바이더 ${providerId}: ${resolved}`;
  });

  const apiKeyLines: string[] = [];
  for (const providerId of listProvidersInUse(configBridge)) {
    if (!requiresApiKey(providerId)) {
      continue;
    }
    apiKeyLines.push(
      (await environment.hasApiKey(providerId))
        ? `✅ 프로바이더 ${providerId}: API 키 있음`
        : `❌ 프로바이더 ${providerId}: ~/.storyboard/secrets.json 에 API 키가 없어 생성이 실패합니다.`,
    );
  }

  const lines = [...cliLines, ...apiKeyLines];
  return lines.length > 0
    ? lines
    : [`ℹ️ 프로바이더: ${configBridge.getDefaultProvider()} (키·실행 파일 불필요)`];
}

function requiresApiKey(providerId: AiProviderId): boolean {
  return providerId !== 'mock' && providerId !== 'ollama' && !isCliProvider(providerId);
}

function describeJobs(ctx: ChatContext): string[] {
  if (!ctx.jobs) {
    return [];
  }

  const recent = ctx.jobs.getRecent(20);
  const queued = recent.filter(({ job }) => job.state === 'queued').length;
  const running = recent.filter(({ job }) => job.state === 'running').length;
  if (queued === 0 && running === 0) {
    return ['✅ 작업: 대기 없음'];
  }

  return [`⏳ 작업: 실행 ${running} · 대기 ${queued} (\`/jobs\`로 확인)`];
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

async function runMigrate(ctx: ChatContext): Promise<void> {
  const result = await ctx.content.migrateLegacyScenes();

  if (!result) {
    await ctx.reply({ text: '✅ 변환할 구형 씬(.txt)이 없습니다.' });
    return;
  }

  if (result.outcome.status !== 'committed' && result.outcome.status !== 'written') {
    await ctx.reply({ text: describeOutcome(result.outcome) });
    return;
  }

  const lines = [
    `✅ 씬 ${result.stems.length}개를 scene.card로 변환했습니다.`,
    `   ${result.stems.join(', ')}`,
    result.outcome.status === 'committed'
      ? '   커밋 1건으로 기록했습니다.'
      : '   (커밋 없이 저장했습니다.)',
  ];

  if (result.failures.length > 0) {
    lines.push(`⚠️ 변환 실패 ${result.failures.length}개: ${result.failures.join(', ')}`);
  }

  await ctx.reply({ text: lines.join('\n') });
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
