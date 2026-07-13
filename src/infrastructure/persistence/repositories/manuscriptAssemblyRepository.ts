import * as vscode from 'vscode';

import type {
  IManuscriptAssemblyRepository,
  ManuscriptAssemblySource,
} from '../../../application/manuscript/assembleManuscriptUseCase';
import type {
  IManuscriptExportRepository,
  ManuscriptExportSource,
} from '../../../application/manuscript/exportManuscriptUseCase';
import type {
  IManuscriptReviewRepository,
  ManuscriptReviewSource,
} from '../../../application/manuscript/reviewManuscriptUseCase';
import type { IChapterSummaryRepository } from '../../../application/manuscript/summarizeChaptersUseCase';
import { summaryFileName } from '../../../domain/chapterSummaries';
import type { StoryboardLogger } from '../../vscode/logger';
import type { AssembledManuscript } from '../../../domain/manuscriptAssembly';
import { collectDraftsByOrder } from '../manuscriptDrafts';
import { getStoryboardProjectPaths } from '../../vscode/pathConventions';
import { uriExists } from '../../vscode/workspace';
import { readBibleFile, type BibleFileSystem } from '../../../domain/files/bible';
import type { DraftFileSystem } from '../../../domain/files/draft';
import { readChapterPlanFile, type OutlineFileSystem } from '../../../domain/files/outline';
import { readProjectJson } from '../../../files/projectJson';

const VSCODE_FILE_SYSTEM: DraftFileSystem & OutlineFileSystem & BibleFileSystem = {
  readFile: (uri): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri, content): Thenable<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export class ManuscriptAssemblyRepository
  implements
    IManuscriptAssemblyRepository,
    IChapterSummaryRepository,
    IManuscriptReviewRepository,
    IManuscriptExportRepository
{
  public async hasChapterPlan(workspaceRoot: vscode.Uri): Promise<boolean> {
    return await uriExists(getStoryboardProjectPaths(workspaceRoot).outlineChapters);
  }

  public async hasManuscriptVolume(workspaceRoot: vscode.Uri): Promise<boolean> {
    return await uriExists(getStoryboardProjectPaths(workspaceRoot).manuscriptVolume);
  }

  public async loadVolume(workspaceRoot: vscode.Uri): Promise<ManuscriptExportSource> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const [project, volumeBytes] = await Promise.all([
      readProjectJson(paths.projectJson),
      vscode.workspace.fs.readFile(paths.manuscriptVolume),
    ]);

    return { markdown: new TextDecoder().decode(volumeBytes), projectName: project.name };
  }

  public async saveExport(targetUri: vscode.Uri, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(content));
  }

  public async loadAssemblySource(
    workspaceRoot: vscode.Uri,
    logger?: Pick<StoryboardLogger, 'warn'>,
  ): Promise<ManuscriptAssemblySource> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const [project, plan, draftsByOrder] = await Promise.all([
      readProjectJson(paths.projectJson),
      readChapterPlanFile(paths.outlineChapters, VSCODE_FILE_SYSTEM),
      collectDraftsByOrder(paths, VSCODE_FILE_SYSTEM, logger ?? { warn: (): void => undefined }),
    ]);

    return { draftsByOrder, plan, projectName: project.name };
  }

  public async loadReviewSource(
    workspaceRoot: vscode.Uri,
    logger: Pick<StoryboardLogger, 'warn'>,
  ): Promise<ManuscriptReviewSource> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const [project, plan, draftsByOrder, canonFactLines] = await Promise.all([
      readProjectJson(paths.projectJson),
      readChapterPlanFile(paths.outlineChapters, VSCODE_FILE_SYSTEM),
      collectDraftsByOrder(paths, VSCODE_FILE_SYSTEM, logger),
      this.loadCanonFactLines(paths.bibleCanon),
    ]);

    return {
      source: { draftsByOrder, plan, projectName: project.name },
      styleConstraints: project.setting?.styleConstraints ?? [],
      qualityCriteria: project.setting?.qualityCriteria ?? [],
      canonFactLines,
    };
  }

  public async saveReview(workspaceRoot: vscode.Uri, markdown: string): Promise<vscode.Uri> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory);
    const reportUri = vscode.Uri.joinPath(paths.manuscriptDirectory, 'REVIEW.md');
    await vscode.workspace.fs.writeFile(reportUri, new TextEncoder().encode(markdown));
    return reportUri;
  }

  public async saveChapterSummaries(
    workspaceRoot: vscode.Uri,
    markdown: string,
  ): Promise<vscode.Uri> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory);
    const summaryUri = vscode.Uri.joinPath(paths.manuscriptDirectory, summaryFileName);
    await vscode.workspace.fs.writeFile(summaryUri, new TextEncoder().encode(markdown));
    return summaryUri;
  }

  public async saveAssembly(
    workspaceRoot: vscode.Uri,
    manuscript: AssembledManuscript,
    foreshadowingMarkdown: string,
  ): Promise<vscode.Uri> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory);

    for (const chapter of manuscript.chapters) {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(paths.manuscriptDirectory, chapter.fileName),
        new TextEncoder().encode(chapter.markdown),
      );
    }
    await vscode.workspace.fs.writeFile(
      paths.manuscriptVolume,
      new TextEncoder().encode(manuscript.volumeMarkdown),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(paths.manuscriptDirectory, 'FORESHADOWING.md'),
      new TextEncoder().encode(foreshadowingMarkdown),
    );

    return paths.manuscriptVolume;
  }

  private async loadCanonFactLines(bibleCanonUri: vscode.Uri): Promise<string[]> {
    if (!(await uriExists(bibleCanonUri))) {
      return [];
    }

    const bible = await readBibleFile(bibleCanonUri, VSCODE_FILE_SYSTEM);
    return bible.facts
      .filter((fact) => fact.status === 'canon')
      .map((fact) => `${fact.subject.id} — ${fact.key}: ${fact.value}`);
  }
}
