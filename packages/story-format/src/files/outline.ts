import yaml from 'js-yaml';
import { ZodError } from 'zod';

import {
  chapterPlanSchema,
  pointOfViewLabels,
  type ChapterPlan,
  type OutlineSynopsis,
} from '../outline';

export type ChapterPlanParseErrorCode = 'invalid-yaml' | 'invalid-chapter-plan-schema';

export interface OutlineFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>;
}

export class ChapterPlanParseError extends Error {
  public constructor(
    public readonly code: ChapterPlanParseErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ChapterPlanParseError';
  }
}

export function serializeChapterPlan(plan: ChapterPlan): string {
  const parsedPlan = chapterPlanSchema.parse(plan);

  return yaml.dump(parsedPlan, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

export function parseChapterPlan(rawChapterPlan: string): ChapterPlan {
  let parsedYaml: unknown;

  try {
    parsedYaml = yaml.load(rawChapterPlan);
  } catch (error) {
    throw new ChapterPlanParseError('invalid-yaml', 'chapters.yaml을 파싱할 수 없습니다.', error);
  }

  try {
    return chapterPlanSchema.parse(parsedYaml);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ChapterPlanParseError(
        'invalid-chapter-plan-schema',
        'chapters.yaml 스키마가 올바르지 않습니다.',
        error,
      );
    }

    throw error;
  }
}

export async function readChapterPlanFile(
  uri: unknown,
  fileSystem: OutlineFileSystem,
): Promise<ChapterPlan> {
  const bytes = await fileSystem.readFile(uri);
  return parseChapterPlan(new TextDecoder().decode(bytes));
}

export async function writeChapterPlanFile(
  uri: unknown,
  fileSystem: OutlineFileSystem,
  plan: ChapterPlan,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeChapterPlan(plan)));
}

export function serializeSynopsisMarkdown(synopsis: OutlineSynopsis): string {
  const sections: string[] = ['# 시놉시스'];

  appendTextSection(sections, '로그라인', synopsis.logline);
  appendTextSection(sections, '장르 약속', synopsis.genrePromise);
  appendListSection(sections, '주요 갈등', synopsis.mainConflicts);
  appendTextSection(sections, '결말', synopsis.ending);
  appendTextSection(sections, '주제', synopsis.theme);
  appendTextSection(sections, '톤', synopsis.tone);
  appendTextSection(sections, '시점', synopsis.pov ? pointOfViewLabels[synopsis.pov] : '');
  appendListSection(sections, '문체 규칙', synopsis.styleRules);

  return `${sections.join('\n\n')}\n`;
}

export async function writeSynopsisFile(
  uri: unknown,
  fileSystem: OutlineFileSystem,
  synopsis: OutlineSynopsis,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeSynopsisMarkdown(synopsis)));
}

function appendTextSection(sections: string[], heading: string, value: string): void {
  sections.push(`## ${heading}\n\n${value.trim().length > 0 ? value.trim() : '_미작성_'}`);
}

function appendListSection(sections: string[], heading: string, values: readonly string[]): void {
  const body = values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '_미작성_';
  sections.push(`## ${heading}\n\n${body}`);
}
