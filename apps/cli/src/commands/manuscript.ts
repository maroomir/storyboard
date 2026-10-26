import { flagString } from '@/cliArguments';
import type { CommandHandler } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import type {
  AssembleManuscriptResult,
  ExportManuscriptResult,
  LoadExportSourceResult,
  ReviewManuscriptResult,
  SummarizeChaptersResult,
} from '@storyboard/story-engine';
import { NodeUri, type ManuscriptExportFormat } from '@storyboard/story-model';
import { resolve } from 'node:path';

export const assembleManuscript: CommandHandler = async ({ container }) => {
  const assembly: AssembleManuscriptResult = await container.manuscript.assemble({
    workspaceRoot: container.workspaceRoot,
  });
  return {
    ok: assembly.ok,
    message: assembly.ok ? '원고를 조립했습니다.' : '조립하지 못했습니다.',
    data: assembly,
  };
};

export const reviewManuscript: CommandHandler = async ({ container }) => {
  const manuscriptReview: ReviewManuscriptResult = await container.manuscript.review({
    workspaceRoot: container.workspaceRoot,
  });
  return {
    ok: manuscriptReview.ok,
    message: manuscriptReview.ok ? '원고 검사를 마쳤습니다.' : '검사하지 못했습니다.',
    data: manuscriptReview,
  };
};

export const summarizeChapters: CommandHandler = async ({ container }) => {
  const chapterSummaries: SummarizeChaptersResult = await container.manuscript.summarizeChapters({
    workspaceRoot: container.workspaceRoot,
  });
  return {
    ok: chapterSummaries.ok,
    message: chapterSummaries.ok ? '장별 요약을 만들었습니다.' : '요약하지 못했습니다.',
    data: chapterSummaries,
  };
};

export const exportManuscript: CommandHandler = async ({ container, args }) => {
  const source: LoadExportSourceResult = await container.manuscript.loadExportSource(
    container.workspaceRoot,
  );

  if (!source.ok) {
    return failure(`내보낼 원고가 없습니다 (${source.kind}).`, source);
  }

  const target: string | undefined = flagString(args.flags, 'out');

  if (target === undefined) {
    process.stdout.write(source.markdown);
    return success('', { projectName: source.projectName });
  }

  const format: ManuscriptExportFormat = target.toLowerCase().endsWith('.txt') ? 'txt' : 'md';
  const exported: ExportManuscriptResult = await container.manuscript.writeExport(
    NodeUri.file(resolve(target)),
    source.markdown,
    format,
  );

  if (!exported.ok) {
    return failure(`내보내지 못했습니다: ${exported.message}`);
  }

  return success(`${target} 로 내보냈습니다.`, { path: target, format });
};
