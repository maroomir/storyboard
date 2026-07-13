import type * as vscode from 'vscode';

import type { ManuscriptDraftEntry } from '../../core/manuscriptAssembly';
import type { GeneratedSceneSeed } from '../../core/sceneSeedFactory';
import type { NovelRunState } from '../../domain/files/novelRunState';
import type { ChapterPlan, OutlineCharacterBrief, OutlineSynopsis } from '../../shared/outline';
import type { StoryboardProject } from '../../shared/project';

export interface INovelRunStateRepository {
  readExisting(workspaceRoot: vscode.Uri): Promise<NovelRunState | undefined>;
  loadProject(workspaceRoot: vscode.Uri): Promise<StoryboardProject>;
  save(workspaceRoot: vscode.Uri, state: NovelRunState): Promise<void>;
}

export interface INovelOutlineRepository {
  loadCharacterBriefs(workspaceRoot: vscode.Uri): Promise<readonly OutlineCharacterBrief[]>;
  loadChapterPlan(workspaceRoot: vscode.Uri): Promise<ChapterPlan>;
  save(
    workspaceRoot: vscode.Uri,
    synopsis: OutlineSynopsis,
    chapterPlan: ChapterPlan,
  ): Promise<vscode.Uri>;
}

export interface ISceneSeedRepository {
  saveSeeds(workspaceRoot: vscode.Uri, seeds: readonly GeneratedSceneSeed[]): Promise<void>;
}

export interface NovelReviewSource {
  readonly draftsByOrder: ReadonlyMap<number, ManuscriptDraftEntry>;
  readonly canonFactLines: readonly string[];
}

export interface INovelReviewRepository {
  loadReviewSource(workspaceRoot: vscode.Uri): Promise<NovelReviewSource>;
  saveReview(workspaceRoot: vscode.Uri, markdown: string): Promise<void>;
}
