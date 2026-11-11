import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import {
  ChapterMemoryAuditor,
  createDefaultProjectJson,
  serializeProjectJson,
} from '@storyboard/story-engine';
import {
  getStoryboardProjectPaths,
  createDraft,
  serializeDraft,
  type ChapterSummary,
} from '@storyboard/story-model';
import type {
  ChapterSummaryLedger,
  FileSystemDirectoryEntry,
  IFileSystem,
  WorkspaceScenes,
} from '@storyboard/story-engine';
import { memorySummaries } from '../../../stubs/summaries';
import { stubScenes } from '../../../stubs/scenes';
import { unseededOutlineYaml } from '../../../stubs/chapterOutline';

class MemoryWorkspace implements IFileSystem {
  private readonly files = new Map<string, string>();

  public write(path: string, content: string): void {
    this.files.set(path, content);
  }

  public read(path: string): string | undefined {
    return this.files.get(path);
  }

  public async readFile(uri: { path: string }): Promise<Uint8Array> {
    const content = this.files.get(uri.path);

    if (content === undefined) {
      throw new Error(`ENOENT: ${uri.path}`);
    }

    return new TextEncoder().encode(content);
  }

  public async writeFile(uri: { path: string }, content: Uint8Array): Promise<void> {
    this.files.set(uri.path, new TextDecoder().decode(content));
  }

  public async createDirectory(): Promise<void> {}

  public async exists(uri: { path: string }): Promise<boolean> {
    return this.files.has(uri.path);
  }

  public async listFileNames(uri: { path: string }): Promise<string[]> {
    return (await this.readDirectory(uri)).map(([name]) => name);
  }

  public async readDirectory(uri: { path: string }): Promise<FileSystemDirectoryEntry[]> {
    const prefix = `${uri.path}/`;
    const names = [...this.files.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map((path) => path.slice(prefix.length));

    if (names.length === 0) {
      throw new Error(`ENOENT: ${uri.path}`);
    }

    return names.map((name) => [name, { type: 'file' as const }]);
  }

  public async delete(uri: { path: string }): Promise<void> {
    this.files.delete(uri.path);
  }

  public async modifiedTime(): Promise<number> {
    return 0;
  }

  public async isRealPathInside(): Promise<boolean> {
    return true;
  }
}

const workspaceRoot = vscode.Uri.file('/workspace');
const paths = getStoryboardProjectPaths(workspaceRoot);

const chapterPlan = `version: 1.0.0
acts:
  - id: act-1
    title: 1막
    chapters:
      - id: chapter-1
        title: 1장
        scenes:
          - id: s1
            title: 첫 씬
      - id: chapter-2
        title: 2장
        scenes:
          - id: s2
            title: 둘째 씬
`;

describe('chapter summary audit over a workspace', () => {
  let fileSystem: MemoryWorkspace;
  let summaries: ReturnType<typeof memorySummaries>;

  const request = (): {
    fileSystem: IFileSystem;
    scenes: WorkspaceScenes;
    summaries: ChapterSummaryLedger;
    paths: typeof paths;
  } => ({
    fileSystem,
    scenes: stubScenes(),
    summaries,
    paths,
  });

  const writeDraft = (stem: string, body: string): void => {
    fileSystem.write(
      `${paths.draftDirectory.path}/${stem}.md`,
      serializeDraft(createDraft({ sceneStem: stem, format: 'novel', body })),
    );
  };

  const readSummaries = (): readonly ChapterSummary[] => summaries.rows.get('main') ?? [];

  beforeEach(async () => {
    fileSystem = new MemoryWorkspace();
    summaries = memorySummaries();
    fileSystem.write(
      paths.projectJson.path,
      serializeProjectJson(createDefaultProjectJson({ name: '작품' })),
    );
    fileSystem.write(paths.outlineChapters.path, unseededOutlineYaml(chapterPlan));
    fileSystem.write(paths.pendingChapterPlan.path, chapterPlan);
    writeDraft('01-first', '첫 장 본문');
    writeDraft('02-second', '둘째 장 본문');

    await sealSummaries();
  });

  async function sealSummaries(): Promise<void> {
    const current = await new ChapterMemoryAuditor(request()).collectCurrentChapterHashes('작품');

    summaries.rows.set('main', [
      { chapterTitle: '1장', summary: '1장 요약', sourceHash: current.get('1장') },
      { chapterTitle: '2장', summary: '2장 요약', sourceHash: current.get('2장') },
    ]);
  }

  it('leaves a summary alone while its chapter drafts are unchanged', async () => {
    const audit = await new ChapterMemoryAuditor(request()).audit();

    expect(audit.audit.staleChapterTitles).toEqual([]);
    expect(audit.staleWarning).toBeUndefined();
    expect(audit.needsMarking).toBe(false);
  });

  it('marks the summary of a chapter whose draft was rewritten', async () => {
    writeDraft('01-first', '고쳐 쓴 첫 장 본문');

    const audit = await new ChapterMemoryAuditor(request()).audit();

    expect(audit.audit.staleChapterTitles).toEqual(['1장']);
    expect(audit.staleWarning).toContain('1장');
    expect(audit.needsMarking).toBe(true);
  });

  it('drops the stale summary so the next generation summarizes that chapter again', async () => {
    writeDraft('01-first', '고쳐 쓴 첫 장 본문');

    await new ChapterMemoryAuditor(request()).markStale(await new ChapterMemoryAuditor(request()).audit());

    expect(readSummaries().map((summary) => summary.chapterTitle)).toEqual(['2장']);
  });

  it('keeps every summary when nothing became stale', async () => {
    const before = readSummaries();

    await new ChapterMemoryAuditor(request()).markStale(await new ChapterMemoryAuditor(request()).audit());

    expect(readSummaries()).toEqual(before);
  });

  it('treats a chapter as stale when its draft is deleted', async () => {
    await fileSystem.delete({ path: `${paths.draftDirectory.path}/02-second.md` });

    const audit = await new ChapterMemoryAuditor(request()).audit();

    expect(audit.audit.staleChapterTitles).toEqual(['2장']);
  });

  it('skips the audit when the workspace keeps no chapter plan', async () => {
    await fileSystem.delete({ path: paths.outlineChapters.path });

    const audit = await new ChapterMemoryAuditor(request()).audit();

    expect(audit.audit.summaries).toEqual([]);
    expect(audit.needsMarking).toBe(false);
  });
});
