import yaml from 'js-yaml';
import { ZodError } from 'zod';

import {
  legacySceneFileNamePattern,
  sceneFrontmatterSchema,
  sceneSeedSectionLabels,
  type SceneCard,
  type SceneFrontmatter,
} from '#format/scene';
import { SceneParseError, serializeSceneCard } from './scene';

export interface LegacySceneConversion {
  readonly stem: string;
  readonly legacyFileName: string;
  readonly fileName: string;
  readonly card: SceneCard;
  readonly text: string;
}

export function isLegacySceneFileName(fileName: string): boolean {
  return legacySceneFileNamePattern.test(fileName);
}

// 결정적 변환기: 시드 방언(`[목적]` 라벨 블록)은 구조 필드로 매핑하고, 자유 산문은 해석 없이
// summary로 옮긴다. AI 구조화는 카드 에디터의 온디맨드 기능이 담당한다.
export function convertLegacySceneText(rawScene: string, fileName: string): LegacySceneConversion {
  const match = legacySceneFileNamePattern.exec(fileName);

  if (!match) {
    throw new SceneParseError(
      'invalid-scene-file-name',
      '구형 씬 파일명은 `NN-slug.txt` 형식이어야 합니다.',
    );
  }

  const stem = `${match[1]}-${match[2]}`;
  const { frontmatter, body } = parseLegacySceneContent(rawScene);
  const sections = parseSeedSections(body);

  const card: SceneCard = {
    type: 'scene',
    id: stem,
    ...(frontmatter.title === undefined ? {} : { title: frontmatter.title }),
    ...(frontmatter.characters === undefined ? {} : { characters: frontmatter.characters }),
    ...(frontmatter.location === undefined ? {} : { location: frontmatter.location }),
    ...(frontmatter.mood === undefined ? {} : { mood: frontmatter.mood }),
    ...(frontmatter.relationStage === undefined
      ? {}
      : { relationStage: frontmatter.relationStage }),
    ...(resolveTargetWordCount(frontmatter, sections) ?? {}),
    ...(frontmatter.grounding === undefined ? {} : { grounding: frontmatter.grounding }),
    ...(sections.purpose === undefined ? {} : { purpose: sections.purpose }),
    ...(sections.conflict === undefined ? {} : { conflict: sections.conflict }),
    ...(sections.twist === undefined ? {} : { twist: sections.twist }),
    ...(sections.emotionalShift === undefined ? {} : { emotionalShift: sections.emotionalShift }),
    ...(sections.foreshadowing.length > 0 ? { foreshadowing: sections.foreshadowing } : {}),
    ...(sections.neededCanon.length > 0 ? { neededCanon: sections.neededCanon } : {}),
    ...(sections.summary === undefined ? {} : { summary: sections.summary }),
  };

  return {
    stem,
    legacyFileName: fileName,
    fileName: `${stem}.card`,
    card,
    text: serializeSceneCard(card),
  };
}

function parseLegacySceneContent(rawScene: string): {
  readonly frontmatter: SceneFrontmatter;
  readonly body: string;
} {
  const normalizedScene = rawScene.replace(/\r\n/g, '\n');

  if (!normalizedScene.startsWith('---\n')) {
    return { frontmatter: {}, body: normalizedScene };
  }

  const closingFenceIndex = normalizedScene.indexOf('\n---', '---\n'.length);

  if (closingFenceIndex === -1) {
    return { frontmatter: {}, body: normalizedScene };
  }

  const rawFrontmatter = normalizedScene.slice('---\n'.length, closingFenceIndex);
  const body = normalizedScene.slice(closingFenceIndex + '\n---'.length).replace(/^\n/, '');

  return { frontmatter: parseLegacyFrontmatter(rawFrontmatter), body };
}

function parseLegacyFrontmatter(rawFrontmatter: string): SceneFrontmatter {
  let parsedYaml: unknown;

  try {
    parsedYaml = yaml.load(rawFrontmatter) ?? {};
  } catch (error) {
    throw new SceneParseError(
      'invalid-scene-card-yaml',
      '구형 씬 frontmatter YAML을 파싱할 수 없습니다.',
      error,
    );
  }

  try {
    return sceneFrontmatterSchema.parse(parsedYaml);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new SceneParseError(
        'invalid-scene-card-schema',
        '구형 씬 frontmatter 스키마가 올바르지 않습니다.',
        error,
      );
    }

    throw error;
  }
}

interface ParsedSeedSections {
  readonly purpose?: string;
  readonly conflict?: string;
  readonly twist?: string;
  readonly emotionalShift?: string;
  readonly foreshadowing: string[];
  readonly neededCanon: string[];
  readonly targetWordCount?: number;
  readonly summary?: string;
}

const seedLabelToField: Readonly<Record<string, string>> = {
  [sceneSeedSectionLabels.purpose]: 'purpose',
  [sceneSeedSectionLabels.conflict]: 'conflict',
  [sceneSeedSectionLabels.twist]: 'twist',
  [sceneSeedSectionLabels.emotionalShift]: 'emotionalShift',
  [sceneSeedSectionLabels.foreshadowing]: 'foreshadowing',
  [sceneSeedSectionLabels.neededCanon]: 'neededCanon',
  [sceneSeedSectionLabels.targetWordCount]: 'targetWordCount',
};

function parseSeedSections(body: string): ParsedSeedSections {
  const lines = body.split('\n');
  const blocks = new Map<string, string[]>();
  const summaryLines: string[] = [];
  let currentField: string | undefined;

  for (const line of lines) {
    const labelMatch = /^\[(.+)\]\s*$/.exec(line);
    const field = labelMatch?.[1] === undefined ? undefined : seedLabelToField[labelMatch[1]];

    if (field !== undefined) {
      currentField = field;
      blocks.set(field, []);
      continue;
    }

    if (currentField !== undefined) {
      blocks.get(currentField)?.push(line);
    } else {
      summaryLines.push(line);
    }
  }

  const scalar = (field: string): string | undefined => {
    const text = blocks.get(field)?.join('\n').trim();
    return text !== undefined && text.length > 0 && text !== '_미작성_' ? text : undefined;
  };
  const list = (field: string): string[] =>
    (blocks.get(field) ?? [])
      .map((line) => line.replace(/^\s*-\s+/, '').trim())
      .filter((line) => line.length > 0);

  const purpose = scalar('purpose');
  const conflict = scalar('conflict');
  const twist = scalar('twist');
  const emotionalShift = scalar('emotionalShift');

  // 분량 블록은 `약 N자` 한 줄만 값이다. 뒤따르는 텍스트(자동 생성 노트 등)는 잃지 않도록
  // summary로 넘긴다.
  const targetWordCountLines = blocks.get('targetWordCount') ?? [];
  const countLineIndex = targetWordCountLines.findIndex((line) => wordCountPattern.test(line));
  const countLine = countLineIndex === -1 ? undefined : targetWordCountLines[countLineIndex];
  summaryLines.push(...targetWordCountLines.filter((_, index) => index !== countLineIndex));

  return {
    ...(purpose === undefined ? {} : { purpose }),
    ...(conflict === undefined ? {} : { conflict }),
    ...(twist === undefined ? {} : { twist }),
    ...(emotionalShift === undefined ? {} : { emotionalShift }),
    foreshadowing: list('foreshadowing'),
    neededCanon: list('neededCanon'),
    ...(parseTargetWordCount(countLine) ?? {}),
    ...(buildSummary(summaryLines) ?? {}),
  };
}

const wordCountPattern = /(?:약\s*)?([\d,]+)\s*자/;

function parseTargetWordCount(text: string | undefined): { targetWordCount: number } | undefined {
  if (text === undefined) {
    return undefined;
  }

  const match = wordCountPattern.exec(text);
  const parsed = match?.[1] === undefined ? NaN : Number.parseInt(match[1].replace(/,/g, ''), 10);

  return Number.isInteger(parsed) && parsed > 0 ? { targetWordCount: parsed } : undefined;
}

function buildSummary(summaryLines: readonly string[]): { summary: string } | undefined {
  const summary = summaryLines.join('\n').trim();
  return summary.length > 0 ? { summary } : undefined;
}

function resolveTargetWordCount(
  frontmatter: SceneFrontmatter,
  sections: ParsedSeedSections,
): { targetWordCount: number } | undefined {
  const targetWordCount = frontmatter.targetWordCount ?? sections.targetWordCount;
  return targetWordCount === undefined ? undefined : { targetWordCount };
}
