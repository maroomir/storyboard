import { pointOfViewLabels, type OutlineBrief } from '@/shared/outline';
import { type PromptArtifact, type PromptVariantId } from './types';

export const OutlineSynopsisPrompt = {
  config: {
    temperature: 0.7,
    maxTokens: 2000,
  },
  build(brief: OutlineBrief, variant: PromptVariantId = 'generic'): PromptArtifact {
    return variant === 'xs' ? buildXs(brief) : buildGeneric(brief);
  },
} as const;

function buildGeneric(brief: OutlineBrief): PromptArtifact {
  return {
    system: [
      '장편 소설의 시놉시스를 설계하는 도우미다.',
      '작품 생성 계약을 바탕으로 로그라인, 장르 약속, 주요 갈등, 결말, 주제, 톤, 문체 규칙을 정한다.',
      '설명 없이 JSON 객체 하나만 출력하라.',
      '{"logline":"","genrePromise":"","mainConflicts":[""],"ending":"","theme":"","tone":"","styleRules":[""]}',
      'logline은 한 문장, mainConflicts와 styleRules는 짧은 항목 배열이다. 계약과 모순되지 않게 작성하라.',
    ].join('\n'),
    user: briefToUserBlock(brief),
  };
}

function buildXs(brief: OutlineBrief): PromptArtifact {
  return {
    system:
      '작품 계약으로 시놉시스를 JSON 객체로 반환: {"logline":"","genrePromise":"","mainConflicts":[],"ending":"","theme":"","tone":"","styleRules":[]}',
    user: briefToUserBlock(brief),
  };
}

export function briefToUserBlock(brief: OutlineBrief): string {
  const lines: string[] = [
    `제목: ${brief.projectName}`,
    `형식: ${brief.format}`,
    `언어: ${brief.language}`,
  ];

  appendField(lines, '장르', brief.genre);
  appendField(lines, '독자층', brief.audience);
  appendField(lines, '시점', brief.pov ? pointOfViewLabels[brief.pov] : undefined);
  appendField(lines, '목표 분량', brief.targetWordCount ? `${brief.targetWordCount}자` : undefined);
  appendField(lines, '컨셉', brief.concept);
  appendField(lines, '설명', brief.description);
  appendField(lines, '태그', brief.tags.length > 0 ? brief.tags.join(', ') : undefined);
  appendField(
    lines,
    '금지 조건',
    brief.prohibitions.length > 0 ? brief.prohibitions.join(', ') : undefined,
  );
  appendField(
    lines,
    '문체 제약',
    brief.styleConstraints.length > 0 ? brief.styleConstraints.join(', ') : undefined,
  );
  appendField(
    lines,
    '품질 기준',
    brief.qualityCriteria.length > 0 ? brief.qualityCriteria.join(', ') : undefined,
  );

  return lines.join('\n');
}

function appendField(lines: string[], label: string, value: string | undefined): void {
  if (value !== undefined && value.trim().length > 0) {
    lines.push(`${label}: ${value}`);
  }
}
