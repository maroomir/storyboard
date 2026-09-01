import type { StoryUri } from '../storyUri';
import yaml from 'js-yaml';
import { ZodError } from 'zod';

import {
  chapterPlanSchema,
  pointOfViewLabels,
  type ChapterPlan,
  type OutlineSynopsis,
} from '../outline';
import type { PointOfView } from '../project';

export type ChapterPlanParseErrorCode = 'invalid-yaml' | 'invalid-chapter-plan-schema';

export interface OutlineFileSystem {
  readonly readFile: (uri: StoryUri) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: StoryUri, content: Uint8Array) => PromiseLike<void>;
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
  uri: StoryUri,
  fileSystem: OutlineFileSystem,
): Promise<ChapterPlan> {
  const bytes = await fileSystem.readFile(uri);
  return parseChapterPlan(new TextDecoder().decode(bytes));
}

export async function writeChapterPlanFile(
  uri: StoryUri,
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
  uri: StoryUri,
  fileSystem: OutlineFileSystem,
  synopsis: OutlineSynopsis,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeSynopsisMarkdown(synopsis)));
}

function appendTextSection(sections: string[], heading: string, value: string): void {
  const trimmed = value.trim();
  sections.push(
    `## ${heading}\n\n${trimmed.length > 0 ? escapeSynopsisValue(trimmed) : '_미작성_'}`,
  );
}

function appendListSection(sections: string[], heading: string, values: readonly string[]): void {
  const body =
    values.length > 0
      ? values.map((value) => `- ${escapeSynopsisValue(value)}`).join('\n')
      : '_미작성_';
  sections.push(`## ${heading}\n\n${body}`);
}

// The markdown form uses three in-band markers: '## ' opens a section, '- ' opens a list item and
// '_미작성_' means "empty". A VALUE containing any of those would corrupt the round trip, so
// serialization escapes them and parsing reverses it — parse(serialize(x)) must equal x.
function escapeSynopsisValue(value: string): string {
  let escaped = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
  if (escaped.startsWith('#') || escaped === '_미작성_') {
    escaped = `\\${escaped}`;
  }
  return escaped;
}

function unescapeSynopsisValue(value: string): string {
  return value.replace(/\\(.)/g, (_match, next: string) => (next === 'n' ? '\n' : next));
}

export type SynopsisParseErrorCode = 'invalid-synopsis-markdown';

export class SynopsisParseError extends Error {
  public constructor(
    public readonly code: SynopsisParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SynopsisParseError';
  }
}

// Inverse of serializeSynopsisMarkdown, so a synopsis written by one app can seed chapter planning
// in the other. Only the exact sectioned format that serializer emits is accepted.
export function parseSynopsisMarkdown(rawSynopsis: string): OutlineSynopsis {
  const sections = new Map<string, string>();
  let currentHeading: string | undefined;
  let currentLines: string[] = [];

  const flush = (): void => {
    if (currentHeading !== undefined) {
      sections.set(currentHeading, currentLines.join('\n').trim());
    }
    currentLines = [];
  };

  for (const line of rawSynopsis.replace(/\r\n/g, '\n').split('\n')) {
    const heading = line.match(/^## (.+)$/);
    if (heading?.[1] !== undefined) {
      flush();
      currentHeading = heading[1].trim();
      continue;
    }
    currentLines.push(line);
  }
  flush();

  const text = (heading: string): string => {
    const value = sections.get(heading) ?? '';
    return value === '_미작성_' ? '' : unescapeSynopsisValue(value);
  };
  const list = (heading: string): string[] => {
    const raw = sections.get(heading) ?? '';
    if (raw === '_미작성_') {
      return [];
    }
    return raw
      .split('\n')
      .map((line) => line.replace(/^- /, '').trim())
      .filter((line) => line.length > 0)
      .map((line) => unescapeSynopsisValue(line));
  };

  if (!sections.has('로그라인')) {
    throw new SynopsisParseError(
      'invalid-synopsis-markdown',
      'synopsis.md가 Storyboard 시놉시스 형식이 아닙니다. (## 로그라인 섹션 없음)',
    );
  }

  const povLabel = text('시점');
  const pov = (Object.entries(pointOfViewLabels) as [PointOfView, string][]).find(
    ([, label]) => label === povLabel,
  )?.[0];

  return {
    logline: text('로그라인'),
    genrePromise: text('장르 약속'),
    mainConflicts: list('주요 갈등'),
    ending: text('결말'),
    theme: text('주제'),
    tone: text('톤'),
    ...(pov !== undefined ? { pov } : {}),
    styleRules: list('문체 규칙'),
  };
}
