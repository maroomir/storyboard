import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import {
  auditChapterMemory,
  buildChapterSummariesMarkdown,
  collectCurrentChapterHashes,
  createDefaultProjectJson,
  getStoryboardProjectPaths,
  markStaleChapterSummaries,
  parseChapterSummariesMarkdown,
  serializeProjectJson,
} from '@storyboard/story-engine';
import type { FileSystemDirectoryEntry, IFileSystem } from '@storyboard/story-engine';
import { createDraft, serializeDraft } from '@storyboard/story-model';

// 감사는 초안을 다시 조립해 해시를 계산한다. 초안 내용을 흉내 내면 그 계산이 무엇에 반응하는지
// 검증할 수 없으므로 진짜 파일 내용을 담은 메모리 파일 시스템을 쓴다.
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

  const request = (): { fileSystem: IFileSystem; paths: typeof paths } => ({
    fileSystem,
    paths,
  });

  const writeDraft = (stem: string, body: string): void => {
    fileSystem.write(
      `${paths.draftDirectory.path}/${stem}.md`,
      serializeDraft(createDraft({ sceneStem: stem, format: 'novel', body })),
    );
  };

  const readSummaries = (): ReturnType<typeof parseChapterSummariesMarkdown> =>
    parseChapterSummariesMarkdown(fileSystem.read(paths.chapterSummaries.path) ?? '');

  beforeEach(async () => {
    fileSystem = new MemoryWorkspace();
    fileSystem.write(
      paths.projectJson.path,
      serializeProjectJson(createDefaultProjectJson({ name: '작품' })),
    );
    fileSystem.write(paths.outlineChapters.path, chapterPlan);
    writeDraft('01-first', '첫 장 본문');
    writeDraft('02-second', '둘째 장 본문');

    // 지금의 초안으로 봉인된 요약을 만든다: 감사가 계산하는 해시를 그대로 기록한 상태.
    await sealSummaries();
  });

  async function sealSummaries(): Promise<void> {
    const current = await collectCurrentChapterHashes(request(), '작품');

    fileSystem.write(
      paths.chapterSummaries.path,
      buildChapterSummariesMarkdown('작품', [
        { chapterTitle: '1장', summary: '1장 요약', sourceHash: current.get('1장'), isStale: false },
        { chapterTitle: '2장', summary: '2장 요약', sourceHash: current.get('2장'), isStale: false },
      ]),
    );
  }

  it('leaves a summary alone while its chapter drafts are unchanged', async () => {
    const audit = await auditChapterMemory(request());

    expect(audit.audit.staleChapterTitles).toEqual([]);
    expect(audit.staleWarning).toBeUndefined();
    expect(audit.needsMarking).toBe(false);
  });

  it('marks the summary of a chapter whose draft was rewritten', async () => {
    writeDraft('01-first', '고쳐 쓴 첫 장 본문');

    const audit = await auditChapterMemory(request());

    expect(audit.audit.staleChapterTitles).toEqual(['1장']);
    expect(audit.staleWarning).toContain('1장');
    expect(audit.needsMarking).toBe(true);
  });

  it('writes the mark into the file so the next scene prompt drops that chapter', async () => {
    writeDraft('01-first', '고쳐 쓴 첫 장 본문');

    await markStaleChapterSummaries(request(), await auditChapterMemory(request()));

    expect(readSummaries()[0]?.isStale).toBe(true);
    expect(readSummaries()[1]?.isStale).toBe(false);
  });

  it('does not rewrite the file when nothing became stale', async () => {
    const before = fileSystem.read(paths.chapterSummaries.path);

    await markStaleChapterSummaries(request(), await auditChapterMemory(request()));

    expect(fileSystem.read(paths.chapterSummaries.path)).toBe(before);
  });

  it('treats a chapter as stale when its draft is deleted', async () => {
    await fileSystem.delete({ path: `${paths.draftDirectory.path}/02-second.md` });

    const audit = await auditChapterMemory(request());

    expect(audit.audit.staleChapterTitles).toEqual(['2장']);
  });

  it('skips the audit when the workspace keeps no chapter plan', async () => {
    await fileSystem.delete({ path: paths.outlineChapters.path });

    const audit = await auditChapterMemory(request());

    expect(audit.audit.summaries).toEqual([]);
    expect(audit.needsMarking).toBe(false);
  });
});
