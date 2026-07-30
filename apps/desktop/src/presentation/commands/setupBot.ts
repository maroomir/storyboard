import { existsSync } from 'node:fs';
import { join } from 'node:path';

import * as vscode from 'vscode';

import {
  resolveStorygramPaths,
  type StorygramPaths,
} from '../../infrastructure/storygram/storygramConfigFile';
import { checkStorygramHealth } from '../../infrastructure/storygram/storygramHealth';
import {
  buildInstallSteps,
  runInstallSteps,
  waitForStorygramOnline,
} from '../../infrastructure/storygram/storygramInstaller';
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
import { buildWorkspacePickOptions } from './setupBotHelpers';

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

function hasStoryboardProject(folderPath: string): boolean {
  return existsSync(join(folderPath, '.storyboard', 'project.json'));
}

async function askWorkspacePath(): Promise<string | undefined> {
  const options = buildWorkspacePickOptions(
    (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      path: folder.uri.fsPath,
      hasProject: hasStoryboardProject(folder.uri.fsPath),
    })),
  );

  const picked = await vscode.window.showQuickPick(options, {
    title: 'storygram 설정 3/4 — 봇이 편집할 Storyboard 워크스페이스',
    ignoreFocusOut: true,
  });
  if (picked === undefined) {
    return undefined;
  }

  const folderPath = picked.path ?? (await browseForFolder());
  if (folderPath === undefined) {
    return undefined;
  }

  if (hasStoryboardProject(folderPath)) {
    return folderPath;
  }
  return initializeWorkspace(folderPath);
}

async function browseForFolder(): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Storyboard 워크스페이스 폴더 선택',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
  });
  return picked?.[0]?.fsPath;
}

// storyboard.init only targets folders that are open in the workspace, so a browsed-in folder
// outside the workspace has to be opened first — say that instead of failing silently.
async function initializeWorkspace(folderPath: string): Promise<string | undefined> {
  const isOpenInWorkspace = (vscode.workspace.workspaceFolders ?? []).some(
    (folder) => folder.uri.fsPath === folderPath,
  );
  if (!isOpenInWorkspace) {
    await vscode.window.showErrorMessage(
      `Storyboard 워크스페이스가 아닙니다: ${folderPath} (.storyboard/project.json 없음). ` +
        '이 폴더를 VSCode에서 먼저 열면 마법사가 초기화까지 처리합니다.',
    );
    return undefined;
  }

  const choice = await vscode.window.showInformationMessage(
    `${folderPath}는 아직 Storyboard 프로젝트가 아닙니다. 지금 초기화할까요?`,
    { modal: true },
    '초기화',
  );
  if (choice !== '초기화') {
    return undefined;
  }

  await vscode.commands.executeCommand('storyboard.init');
  if (!hasStoryboardProject(folderPath)) {
    await vscode.window.showErrorMessage(
      '워크스페이스 초기화가 완료되지 않았습니다. Storyboard: Init 명령을 직접 실행한 뒤 다시 시도하세요.',
    );
    return undefined;
  }
  return folderPath;
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
// asks where that repository is and runs the repo's own installer.
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
    '봇을 지금 설치해 실행할까요? 빌드와 로그인 시 자동 시작(launchd) 등록까지 진행한 뒤 대시보드를 엽니다.',
    '설치하고 실행',
    '나중에',
  );
  if (choice !== '설치하고 실행') {
    return;
  }

  const repoRoot = await askRepoRoot();
  if (repoRoot === undefined) {
    return;
  }

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'storygram 설치', cancellable: false },
    (progress) =>
      runInstallSteps(
        repoRoot,
        buildInstallSteps({ repoRoot, hasNodeModules: existsSync(join(repoRoot, 'node_modules')) }),
        {
          onStepStart: (step, index, total): void =>
            progress.report({ message: `${index + 1}/${total} ${step.title}…` }),
        },
      ),
  );

  if (!result.ok) {
    await showInstallFailure(`설치 실패 — ${result.failedStep}`, result.output);
    return;
  }

  await openDashboardWhenOnline(result.output);
}

async function askRepoRoot(): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    title: 'storyboard 레포 루트 선택 (apps/bot이 있는 폴더)',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
  });
  const repoRoot = picked?.[0]?.fsPath;
  if (repoRoot === undefined) {
    return undefined;
  }

  if (!existsSync(join(repoRoot, 'apps', 'bot', 'scripts', 'install-launchd.sh'))) {
    await vscode.window.showErrorMessage(
      `storyboard 레포가 아닙니다: ${repoRoot} (apps/bot/scripts/install-launchd.sh 없음).`,
    );
    return undefined;
  }
  return repoRoot;
}

const ONLINE_POLL_ATTEMPTS = 10;
const ONLINE_POLL_DELAY_MS = 1_000;

async function openDashboardWhenOnline(installOutput: string): Promise<void> {
  const online = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '봇이 올라오기를 기다리는 중…' },
    () =>
      waitForStorygramOnline({
        check: () => checkStorygramHealth(),
        isOnline: (health) => health.status === 'online',
        attempts: ONLINE_POLL_ATTEMPTS,
        delayMs: ONLINE_POLL_DELAY_MS,
      }),
  );

  if (!online) {
    await showInstallFailure(
      '설치는 끝났지만 봇이 응답하지 않습니다. 로그(~/Library/Logs/storygram/)를 확인하세요.',
      installOutput,
    );
    return;
  }

  await vscode.commands.executeCommand('storyboard.bot.openDashboard');
}

async function showInstallFailure(message: string, output: string): Promise<void> {
  const choice = await vscode.window.showErrorMessage(message, '로그 보기');
  if (choice !== '로그 보기') {
    return;
  }

  const document = await vscode.workspace.openTextDocument({ content: output });
  await vscode.window.showTextDocument(document);
}
