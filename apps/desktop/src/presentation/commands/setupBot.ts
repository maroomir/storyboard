import { existsSync } from 'node:fs';
import { join } from 'node:path';

import * as vscode from 'vscode';

import {
  resolveStorygramPaths,
  type StorygramPaths,
} from '../../infrastructure/storygram/storygramConfigFile';
import {
  BOT_PROVIDER_IDS,
  buildStorygramConfig,
  fetchTelegramBotUsername,
  isPlausibleBotToken,
  parseChatIds,
  sendTelegramTestMessage,
  writeStorygramConfigFile,
  type BotProviderId,
} from '../../infrastructure/storygram/storygramSetup';

export function registerSetupBotCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('storyboard.bot.setup', async (): Promise<void> => {
    const paths = resolveStorygramPaths();

    if (existsSync(paths.configFile) && !(await confirmOverwrite(paths.configFile))) {
      return;
    }

    const botToken = await askBotToken();
    if (botToken === undefined) {
      return;
    }
    if (!(await verifyBotToken(botToken))) {
      return;
    }

    const chatIds = await askChatIds();
    if (chatIds === undefined) {
      return;
    }

    const workspacePath = await askWorkspacePath();
    if (workspacePath === undefined) {
      return;
    }

    const provider = await askDefaultProvider();
    if (provider === undefined) {
      return;
    }

    const config = buildStorygramConfig({
      botToken,
      allowedChatIds: chatIds,
      workspacePath,
      defaultProvider: provider,
    });
    await writeStorygramConfigFile(paths.home, paths.configFile, config);

    await offerTestMessage(botToken, chatIds[0]);
    await offerAutostartInstall(paths);
  });
}

async function confirmOverwrite(configFile: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `storygram 설정이 이미 있습니다 (${configFile}). 덮어쓸까요?`,
    { modal: true },
    '덮어쓰기',
  );
  return choice === '덮어쓰기';
}

async function askBotToken(): Promise<string | undefined> {
  const token = await vscode.window.showInputBox({
    title: 'storygram 설정 1/4 — 봇 토큰',
    prompt: '텔레그램 @BotFather에서 발급받은 봇 토큰을 입력하세요.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value): string | undefined =>
      isPlausibleBotToken(value) ? undefined : '토큰 형식이 아닙니다 (예: 123456789:AA...).',
  });
  return token?.trim();
}

async function verifyBotToken(botToken: string): Promise<boolean> {
  const username = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '텔레그램에서 토큰 확인 중…' },
    (): Promise<string | undefined> => fetchTelegramBotUsername(botToken),
  );
  if (username !== undefined) {
    void vscode.window.showInformationMessage(`봇 확인됨: @${username}`);
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    '토큰을 확인하지 못했습니다 (토큰 오류 또는 네트워크 문제). 그대로 저장할까요?',
    { modal: true },
    '그대로 저장',
  );
  return choice === '그대로 저장';
}

async function askChatIds(): Promise<number[] | undefined> {
  const input = await vscode.window.showInputBox({
    title: 'storygram 설정 2/4 — 허용 채팅 ID',
    prompt:
      '봇을 쓸 텔레그램 chat id를 입력하세요 (쉼표로 여러 개). 자신의 id는 @userinfobot에서 확인할 수 있습니다.',
    ignoreFocusOut: true,
    validateInput: (value): string | undefined =>
      parseChatIds(value) === undefined
        ? '정수 id를 쉼표로 구분해 입력하세요 (예: 123456789).'
        : undefined,
  });
  if (input === undefined) {
    return undefined;
  }
  return parseChatIds(input);
}

async function askWorkspacePath(): Promise<string | undefined> {
  const candidates = (vscode.workspace.workspaceFolders ?? [])
    .map((folder) => folder.uri.fsPath)
    .filter((fsPath) => existsSync(join(fsPath, '.storyboard', 'project.json')));

  const PICK_FOLDER = '폴더 직접 선택…';
  let selected: string | undefined;
  if (candidates.length > 0) {
    selected = await vscode.window.showQuickPick([...candidates, PICK_FOLDER], {
      title: 'storygram 설정 3/4 — 봇이 편집할 Storyboard 워크스페이스',
      ignoreFocusOut: true,
    });
    if (selected === undefined) {
      return undefined;
    }
  } else {
    selected = PICK_FOLDER;
  }

  if (selected !== PICK_FOLDER) {
    return selected;
  }

  const picked = await vscode.window.showOpenDialog({
    title: 'Storyboard 워크스페이스 폴더 선택',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
  });
  const folder = picked?.[0]?.fsPath;
  if (folder === undefined) {
    return undefined;
  }

  if (!existsSync(join(folder, '.storyboard', 'project.json'))) {
    await vscode.window.showErrorMessage(
      `Storyboard 워크스페이스가 아닙니다: ${folder} (.storyboard/project.json 없음). ` +
        'Storyboard: Init 명령으로 먼저 초기화한 뒤 다시 실행하세요.',
    );
    return undefined;
  }
  return folder;
}

async function askDefaultProvider(): Promise<BotProviderId | undefined> {
  const descriptions: Record<BotProviderId, string> = {
    'claude-code': 'Claude Code CLI (권장)',
    codex: 'Codex CLI',
    mock: '생성 없이 흐름만 확인',
  };
  const picked = await vscode.window.showQuickPick(
    BOT_PROVIDER_IDS.map((id) => ({ label: id, description: descriptions[id] })),
    { title: 'storygram 설정 4/4 — 기본 생성 프로바이더', ignoreFocusOut: true },
  );
  return picked?.label;
}

async function offerTestMessage(botToken: string, chatId: number | undefined): Promise<void> {
  if (chatId === undefined) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `설정을 저장했습니다. 테스트 메시지를 chat ${chatId}로 보낼까요?`,
    '보내기',
    '건너뛰기',
  );
  if (choice !== '보내기') {
    return;
  }

  const sent = await sendTelegramTestMessage(
    botToken,
    chatId,
    'storygram 설정이 완료되었습니다. 봇을 시작한 뒤 /start를 보내보세요.',
  );
  if (sent) {
    void vscode.window.showInformationMessage('테스트 메시지를 보냈습니다. 텔레그램을 확인하세요.');
  } else {
    void vscode.window.showWarningMessage(
      '테스트 메시지 전송에 실패했습니다. chat id가 맞는지, 봇과 대화를 시작했는지(/start) 확인하세요.',
    );
  }
}

// The bot ships inside the storyboard repository, not inside the extension, so autostart install
// asks where that repository is and runs the repo's own installer in a visible terminal.
async function offerAutostartInstall(paths: StorygramPaths): Promise<void> {
  if (process.platform !== 'darwin') {
    void vscode.window.showInformationMessage(
      `설정 완료 (${paths.configFile}). 봇 실행: storyboard 레포에서 npm run bot:build 후 ` +
        'node apps/bot/dist/index.js — 자동 시작 스크립트는 macOS(launchd)용만 제공됩니다 ' +
        '(Linux는 systemd user unit, Windows는 작업 스케줄러/NSSM을 사용하세요).',
    );
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    '봇을 로그인 시 자동 시작(launchd)으로 설치할까요? storyboard 레포 위치가 필요합니다.',
    '설치',
    '나중에',
  );
  if (choice !== '설치') {
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    title: 'storyboard 레포 루트 선택 (apps/bot이 있는 폴더)',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
  });
  const repoRoot = picked?.[0]?.fsPath;
  if (repoRoot === undefined) {
    return;
  }

  const installerPath = join(repoRoot, 'apps', 'bot', 'scripts', 'install-launchd.sh');
  if (!existsSync(installerPath)) {
    await vscode.window.showErrorMessage(
      `storyboard 레포가 아닙니다: ${repoRoot} (apps/bot/scripts/install-launchd.sh 없음).`,
    );
    return;
  }

  const terminal = vscode.window.createTerminal({ name: 'storygram 설치', cwd: repoRoot });
  terminal.show();
  terminal.sendText('npm install && npm run bot:build && ./apps/bot/scripts/install-launchd.sh');
}
