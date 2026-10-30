import type { OutlineBrief, OutlineCastMember, OutlineSynopsis } from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { briefToUserBlock } from '#ai/ai/prompts/outlineSynopsis';

export const OutlineCharactersPrompt: PromptModule<
  [
    brief: OutlineBrief,
    synopsis: OutlineSynopsis,
    cast: readonly OutlineCastMember[],
    variant?: PromptVariantId,
  ]
> = {
  config: promptTuning('outlineCharacters'),
  build(
    brief: OutlineBrief,
    synopsis: OutlineSynopsis,
    cast: readonly OutlineCastMember[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('outlineCharacters', variant, {
      view: {
        synopsis: synopsisToBlock(synopsis),
        cast: cast
          .map((member) => `- ${member.id}: 나오는 씬 ${member.sceneTitles.join(', ')}`)
          .join('\n'),
      },
      partials: { brief: briefToUserBlock(brief) },
    });
  },
};

function synopsisToBlock(synopsis: OutlineSynopsis): string {
  const lines: string[] = [
    synopsis.logline.length > 0 ? `로그라인: ${synopsis.logline}` : undefined,
    synopsis.mainConflicts.length > 0
      ? `주요 갈등: ${synopsis.mainConflicts.join(', ')}`
      : undefined,
    synopsis.ending.length > 0 ? `결말: ${synopsis.ending}` : undefined,
  ].filter((line): line is string => line !== undefined);

  return lines.length > 0 ? lines.join('\n') : '(시놉시스 정보 없음)';
}
