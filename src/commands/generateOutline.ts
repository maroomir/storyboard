import * as vscode from 'vscode';

import type {
  GenerateOutlineResult,
  GenerateOutlineUseCase,
} from '../application/novel/generateOutlineUseCase';
import type { StoryboardLogger } from '../core/logger';
import { resolveStoryboardWorkspaceRoot } from '../core/workspace';
import type { ContractFieldKey } from '../shared/project';

const GENERATE_OUTLINE_COMMAND = 'storyboard.outline.generate';

const CONTRACT_FIELD_LABELS: Record<ContractFieldKey, string> = {
  genre: '장르',
  audience: '독자층',
  pov: '시점',
  targetWordCount: '목표 분량',
};

export type RegisterGenerateOutlineCommandDependencies = {
  readonly generateOutlineUseCase: GenerateOutlineUseCase;
  readonly logger: StoryboardLogger;
};

export function registerGenerateOutlineCommand(
  dependencies: RegisterGenerateOutlineCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(GENERATE_OUTLINE_COMMAND, () =>
    runGenerateOutline(dependencies),
  );
}

async function runGenerateOutline(
  dependencies: RegisterGenerateOutlineCommandDependencies,
): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
    return;
  }

  let result = await runWithProgress(workspaceRoot, dependencies, false);

  if (!result.ok && result.kind === 'existing') {
    const overwrite = await vscode.window.showWarningMessage(
      '이미 아웃라인 파일이 있습니다. 덮어쓸까요?',
      { modal: true },
      '덮어쓰기',
    );

    if (overwrite !== '덮어쓰기') {
      return;
    }

    result = await runWithProgress(workspaceRoot, dependencies, true);
  }

  await reportResult(result, dependencies.logger);
}

async function runWithProgress(
  workspaceRoot: vscode.Uri,
  dependencies: RegisterGenerateOutlineCommandDependencies,
  overwrite: boolean,
): Promise<GenerateOutlineResult> {
  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Storyboard 아웃라인 생성',
      cancellable: false,
    },
    async (progress) =>
      await dependencies.generateOutlineUseCase.execute(workspaceRoot, {
        overwrite,
        onProgress: (message) => progress.report({ message }),
      }),
  );
}

async function reportResult(
  result: GenerateOutlineResult,
  logger: StoryboardLogger,
): Promise<void> {
  if (result.ok) {
    const document = await vscode.workspace.openTextDocument(result.synopsisUri);
    await vscode.window.showTextDocument(document);
    await vscode.window.showInformationMessage(
      '아웃라인을 생성했습니다 (synopsis.md, chapters.yaml).',
    );
    return;
  }

  if (result.kind === 'missing_contract') {
    const openSettings = '설정 열기';
    const labels = result.missing.map((key) => CONTRACT_FIELD_LABELS[key]).join(', ');
    const choice = await vscode.window.showWarningMessage(
      `생성 계약에 필요한 항목이 비어 있습니다: ${labels}. 설정에서 채운 뒤 다시 시도해 주세요.`,
      openSettings,
    );
    if (choice === openSettings) {
      await vscode.commands.executeCommand('storyboard.settings.open');
    }
    return;
  }

  if (result.kind === 'failed') {
    logger.error('Outline generation failed', new Error(result.message));
    logger.show();
    await vscode.window.showErrorMessage(`아웃라인 생성에 실패했습니다: ${result.message}`);
  }
}
