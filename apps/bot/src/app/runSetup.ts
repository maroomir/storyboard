import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { aiProviderIds, isAiProviderId, isCliProvider, type AiProviderId } from '@storyboard/story-ai';

import {
  buildBotConfig,
  fetchTelegramBotUsername,
  isPlausibleBotToken,
  parseChatIds,
  sendTelegramTestMessage,
  writeBotConfigFile,
} from '@/config/setup';
import { writeSharedDefaultProvider } from '@/config/sharedConfig';
import { expandHome, resolvePaths } from '@/config/paths';

interface Prompter {
  ask(question: string): Promise<string>;
  close(): void;
}

function createPrompter(): Prompter {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (question) => rl.question(question),
    close: () => rl.close(),
  };
}

async function askUntilValid<T>(
  prompter: Prompter,
  question: string,
  parse: (answer: string) => T | undefined,
  complaint: string,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = (await prompter.ask(question)).trim();
    if (answer.length === 0) {
      return undefined;
    }
    const parsed = parse(answer);
    if (parsed !== undefined) {
      return parsed;
    }
    process.stdout.write(`  ${complaint}\n`);
  }
  return undefined;
}

function parseWorkspacePath(answer: string): string | undefined {
  const expanded = expandHome(answer);
  if (!isAbsolute(expanded)) {
    return undefined;
  }
  return existsSync(join(expanded, '.storyboard', 'project.json')) ? expanded : undefined;
}

function parseProvider(answer: string): AiProviderId | undefined {
  return isAiProviderId(answer) ? answer : undefined;
}

function requiresApiKey(providerId: AiProviderId): boolean {
  return providerId !== 'mock' && providerId !== 'ollama' && !isCliProvider(providerId);
}

// The wizard refuses rather than guesses: an unusable answer three times in a row aborts with a
// non-zero exit so a scripted install cannot end up with a half-written config.
export async function runSetup(): Promise<number> {
  // A closed stdin never resolves a readline question, so the wizard would exit silently with 0
  // and a scripted install would read that as success. Refuse before asking anything.
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'setup 은 대화형 터미널에서만 동작합니다. 비대화형 환경에서는 config.example.json 을 복사해 직접 채워 주세요.\n',
    );
    return 1;
  }

  const paths = resolvePaths();
  const prompter = createPrompter();

  process.stdout.write(`Storyboard 봇 설정 — ${paths.configFile}\n\n`);

  try {
    if (existsSync(paths.configFile)) {
      const overwrite = (
        await prompter.ask('설정 파일이 이미 있습니다. 덮어쓸까요? [y/N] ')
      ).trim();
      if (overwrite.toLowerCase() !== 'y') {
        process.stdout.write('취소했습니다.\n');
        return 0;
      }
    }

    const botToken = await askUntilValid(
      prompter,
      'BotFather 토큰: ',
      (answer) => (isPlausibleBotToken(answer) ? answer.trim() : undefined),
      '토큰 형태가 아닙니다 (예: 123456789:AA...).',
    );
    if (botToken === undefined) {
      process.stdout.write('토큰이 없어 중단합니다.\n');
      return 1;
    }

    const username = await fetchTelegramBotUsername(botToken);
    process.stdout.write(
      username === undefined
        ? '  경고: Telegram에 토큰을 확인하지 못했습니다. 그대로 진행합니다.\n'
        : `  확인됨: @${username}\n`,
    );

    const allowedChatIds = await askUntilValid(
      prompter,
      '허용할 chat id (쉼표나 공백으로 구분): ',
      parseChatIds,
      '정수만 넣어 주세요.',
    );
    if (allowedChatIds === undefined) {
      process.stdout.write('허용 목록이 비어 중단합니다. 아무나 봇을 쓰게 둘 수는 없습니다.\n');
      return 1;
    }

    const workspacePath = await askUntilValid(
      prompter,
      'Storyboard 워크스페이스 절대 경로: ',
      parseWorkspacePath,
      '절대 경로여야 하고 그 안에 .storyboard/project.json 이 있어야 합니다.',
    );
    if (workspacePath === undefined) {
      process.stdout.write('워크스페이스를 확인하지 못해 중단합니다.\n');
      return 1;
    }

    const defaultProvider =
      (await askUntilValid(
        prompter,
        `기본 프로바이더 [${aiProviderIds.join(' | ')}] (기본 codex): `,
        parseProvider,
        '목록에 있는 값을 넣어 주세요.',
      )) ?? 'codex';

    await writeBotConfigFile(
      paths.home,
      paths.configFile,
      buildBotConfig({ botToken, allowedChatIds, workspacePath }),
    );
    process.stdout.write(`\n저장했습니다: ${paths.configFile} (0600)\n`);

    const sharedConfigFile = await writeSharedDefaultProvider(defaultProvider);
    process.stdout.write(
      `기본 프로바이더 ${defaultProvider} 를 ${sharedConfigFile} 에 저장했습니다 (익스텐션·CLI와 공유).\n`,
    );
    if (requiresApiKey(defaultProvider)) {
      process.stdout.write(
        `${defaultProvider} 는 API 키가 필요합니다. 익스텐션 설정 패널이나 \`storyboard apikey set ${defaultProvider}\` 로 ~/.storyboard/secrets.json 에 넣어 주세요.\n`,
      );
    }

    const firstChatId = allowedChatIds[0];
    if (firstChatId !== undefined) {
      const delivered = await sendTelegramTestMessage(
        botToken,
        firstChatId,
        'Storyboard 봇 설정이 끝났습니다.',
      );
      process.stdout.write(
        delivered
          ? '테스트 메시지를 보냈습니다.\n'
          : '테스트 메시지를 보내지 못했습니다. chat id를 다시 확인해 주세요.\n',
      );
    }

    process.stdout.write('\n실행: storyboard-bot\n');
    return 0;
  } finally {
    prompter.close();
  }
}
