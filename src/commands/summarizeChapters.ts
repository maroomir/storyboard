import * as vscode from 'vscode';

import {
  buildChapterSummariesMarkdown,
  summaryFileName,
  type ChapterSummary,
} from '../core/chapterSummaries';
import type { StoryboardLogger } from '../core/logger';
import { assembleManuscript } from '../core/manuscriptAssembly';
import { collectDraftsByOrder } from '../core/manuscriptDrafts';
import { getStoryboardProjectPaths } from '../core/pathConventions';
import { resolveStoryboardWorkspaceRoot, uriExists } from '../core/workspace';
import { type DraftFileSystem } from '../files/draft';
import { readChapterPlanFile, type OutlineFileSystem } from '../files/outline';
import { readProjectJson } from '../files/projectJson';
import { StoryboardAIService } from '../services/ai/AIService';
import type { AiProviderRegistry } from '../services/ai/providerRegistry';

const summarizeChaptersCommand = 'storyboard.manuscript.summaries';

const fileSystem: DraftFileSystem & OutlineFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> =>
    vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export interface RegisterSummarizeChaptersCommandDependencies {
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly logger: StoryboardLogger;
}

export function registerSummarizeChaptersCommand(
  dependencies: RegisterSummarizeChaptersCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(summarizeChaptersCommand, () =>
    runSummarizeChapters(dependencies),
  );
}

async function runSummarizeChapters(
  dependencies: RegisterSummarizeChaptersCommandDependencies,
): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
    return;
  }

  const paths = getStoryboardProjectPaths(workspaceRoot);

  if (!(await uriExists(paths.outlineChapters))) {
    await vscode.window.showWarningMessage(
      '아웃라인(chapters.yaml)이 없습니다. 먼저 Generate Novel Outline을 실행해 주세요.',
    );
    return;
  }

  try {
    const project = await readProjectJson(paths.projectJson);
    const plan = await readChapterPlanFile(paths.outlineChapters, fileSystem);
    const draftsByOrder = await collectDraftsByOrder(paths, fileSystem, dependencies.logger);

    if (draftsByOrder.size === 0) {
      await vscode.window.showInformationMessage(
        '요약할 초안이 없습니다. 먼저 Generate (All) Drafts를 실행해 주세요.',
      );
      return;
    }

    const manuscript = assembleManuscript({ plan, projectName: project.name, draftsByOrder });
    const aiService = new StoryboardAIService(dependencies.aiProviderRegistry);
    const providerId = dependencies.aiProviderRegistry.getTaskProvider('chapterSummary');

    const summaries = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Storyboard 장별 요약',
        cancellable: true,
      },
      async (progress, token) => {
        const results: ChapterSummary[] = [];

        for (const [index, chapter] of manuscript.chapters.entries()) {
          if (token.isCancellationRequested) {
            break;
          }

          progress.report({ message: `요약 중 (${index + 1}/${manuscript.chapters.length})…` });
          const summary = await aiService.summarizeChapter(
            { chapterTitle: chapter.chapterTitle, body: chapter.markdown },
            { providerId },
          );
          results.push({ chapterTitle: chapter.chapterTitle, summary });
        }

        return results;
      },
    );

    await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory);
    const summaryUri = vscode.Uri.joinPath(paths.manuscriptDirectory, summaryFileName);
    await vscode.workspace.fs.writeFile(
      summaryUri,
      new TextEncoder().encode(buildChapterSummariesMarkdown(project.name, summaries)),
    );

    const document = await vscode.workspace.openTextDocument(summaryUri);
    await vscode.window.showTextDocument(document);

    await vscode.window.showInformationMessage(`장 ${summaries.length}개를 요약했습니다.`);
  } catch (error) {
    dependencies.logger.error('Chapter summarize failed', error);
    dependencies.logger.show();
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`장별 요약에 실패했습니다: ${message}`);
  }
}
