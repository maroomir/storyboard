import { pointOfViewLabels } from '@storyboard/story-format';
import type { OutlineBrief } from '@storyboard/story-format';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const OutlineSynopsisPrompt = {
  config: promptTuning('outlineSynopsis'),
  build(brief: OutlineBrief, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('outlineSynopsis', variant, { view: { brief: briefToUserBlock(brief) } });
  },
} as const;

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
  appendField(
    lines,
    '구성',
    brief.chapterCount === undefined && brief.scenesPerChapter === undefined
      ? undefined
      : [
          brief.chapterCount === undefined ? undefined : `${brief.chapterCount}장`,
          brief.scenesPerChapter === undefined ? undefined : `장당 ${brief.scenesPerChapter}씬`,
        ]
          .filter((part): part is string => part !== undefined)
          .join(', '),
  );
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
