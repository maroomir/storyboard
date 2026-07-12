import * as vscode from 'vscode';

import { validateGenerationContract } from '../core/generationContract';
import type { StoryboardLogger } from '../core/logger';
import {
  runNovelPipeline,
  type NovelApprovalKind,
  type NovelPipelineResult,
} from '../core/novelPipeline';
import { isResumable } from '../core/novelRunPlan';
import { getStoryboardProjectPaths } from '../core/pathConventions';
import { resolveStoryboardWorkspaceRoot, uriExists } from '../core/workspace';
import { readProjectJson } from '../files/projectJson';
import {
  readNovelRunState,
  type NovelRunMode,
  type NovelRunState,
  type NovelRunStateFileSystem,
} from '../files/novelRunState';
import type { AiProviderRegistry } from '../services/ai/providerRegistry';
import type { ConfigBridge } from '../services/settings/ConfigBridge';
import type { UsageRecorder } from '../services/ai/UsageRecorder';
import type { ContractFieldKey } from '../shared/project';
import { resolveReviseMaxIterations } from './reviseDraft';

const generateNovelCommand = 'storyboard.novel.generate';

const contractFieldLabels: Record<ContractFieldKey, string> = {
  genre: '장르',
  audience: '독자층',
  pov: '시점',
  targetWordCount: '목표 분량',
};

const runModeLabels: Record<NovelRunMode, string> = {
  auto: '전체 자동',
  'outline-approval': '아웃라인 승인 후 진행',
  'chapter-approval': '장별 승인 후 진행',
};

const fileSystem: NovelRunStateFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> =>
    vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export interface RegisterGenerateNovelCommandDependencies {
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly configBridge: ConfigBridge;
  readonly logger: StoryboardLogger;
  readonly usageRecorder: UsageRecorder;
}

export function registerGenerateNovelCommand(
  dependencies: RegisterGenerateNovelCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(generateNovelCommand, () =>
    runGenerateNovel(dependencies),
  );
}

async function runGenerateNovel(
  dependencies: RegisterGenerateNovelCommandDependencies,
): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
    return;
  }

  const paths = getStoryboardProjectPaths(workspaceRoot);
  const project = await readProjectJson(paths.projectJson);

  const readiness = validateGenerationContract(project.setting);
  if (readiness.missing.length > 0) {
    const openSettings = '설정 열기';
    const labels = readiness.missing.map((key) => contractFieldLabels[key]).join(', ');
    const choice = await vscode.window.showWarningMessage(
      `생성 계약에 필요한 항목이 비어 있습니다: ${labels}. 설정에서 채운 뒤 다시 시도해 주세요.`,
      openSettings,
    );
    if (choice === openSettings) {
      await vscode.commands.executeCommand('storyboard.settings.open');
    }
    return;
  }

  const decision = await decideRun(paths.novelRunState);
  if (!decision) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Storyboard 장편 생성',
      cancellable: true,
    },
    async (progress, token) => {
      const result = await runNovelPipeline({
        workspaceUri: workspaceRoot,
        project,
        deps: dependencies,
        runMode: decision.runMode,
        resumeState: decision.resumeState,
        reviseMaxIterations: resolveReviseMaxIterations(),
        onProgress: (stage, message) => progress.report({ message: `[${stage}] ${message}` }),
        requestApproval: (kind, info) => requestApproval(kind, info),
        shouldCancel: () => token.isCancellationRequested,
      });

      await reportResult(result, paths.manuscriptVolume);
    },
  );
}

interface RunDecision {
  readonly runMode: NovelRunMode;
  readonly resumeState?: NovelRunState;
}

async function decideRun(novelRunStateUri: vscode.Uri): Promise<RunDecision | undefined> {
  const existing = await readExistingRunState(novelRunStateUri);

  if (isResumable(existing)) {
    const resume = `이어서 진행 (${runModeLabels[existing.runMode]})`;
    const restart = '처음부터 다시';
    const choice = await vscode.window.showQuickPick([resume, restart], {
      placeHolder: '이전 실행이 중단되었습니다. 어떻게 할까요?',
    });

    if (choice === undefined) {
      return undefined;
    }
    if (choice === resume) {
      return { runMode: existing.runMode, resumeState: existing };
    }
  }

  const runMode = await pickRunMode();
  return runMode ? { runMode } : undefined;
}

async function pickRunMode(): Promise<NovelRunMode | undefined> {
  const items: (vscode.QuickPickItem & { readonly mode: NovelRunMode })[] = [
    { label: runModeLabels.auto, description: 'A~E를 끊김 없이 자동 실행', mode: 'auto' },
    {
      label: runModeLabels['outline-approval'],
      description: '아웃라인 생성 후 한 번 멈춰 승인',
      mode: 'outline-approval',
    },
    {
      label: runModeLabels['chapter-approval'],
      description: '각 장 초안·검수 후 멈춰 승인',
      mode: 'chapter-approval',
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: '실행 모드를 선택하세요.',
  });
  return picked?.mode;
}

async function readExistingRunState(uri: vscode.Uri): Promise<NovelRunState | undefined> {
  if (!(await uriExists(uri))) {
    return undefined;
  }
  try {
    return await readNovelRunState(uri, fileSystem);
  } catch {
    return undefined;
  }
}

async function requestApproval(_kind: NovelApprovalKind, info: string): Promise<boolean> {
  const proceed = '계속';
  const choice = await vscode.window.showInformationMessage(info, { modal: true }, proceed);
  return choice === proceed;
}

async function reportResult(
  result: NovelPipelineResult,
  manuscriptVolumeUri: vscode.Uri,
): Promise<void> {
  if (result.outcome === 'completed') {
    if (await uriExists(manuscriptVolumeUri)) {
      const document = await vscode.workspace.openTextDocument(manuscriptVolumeUri);
      await vscode.window.showTextDocument(document);
    }
    await vscode.window.showInformationMessage('장편 생성을 완료했습니다 (manuscript/).');
    return;
  }

  if (result.outcome === 'failed') {
    await vscode.window.showErrorMessage(
      `장편 생성에 실패했습니다: ${result.message} 다시 실행하면 중단 지점부터 재개합니다.`,
    );
    return;
  }

  await vscode.window.showWarningMessage(`${result.message} (다시 실행하면 이어서 진행합니다.)`);
}
