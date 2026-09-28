import type {
  OutlineBrief,
  OutlineCharacterBrief,
  OutlineSynopsis,
} from '@storyboard/story-format';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';
import { briefToUserBlock } from './outlineSynopsis';

export const ChapterPlanPrompt = {
  config: promptTuning('chapterPlan'),
  build(
    brief: OutlineBrief,
    synopsis: OutlineSynopsis,
    characters: readonly OutlineCharacterBrief[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    const { chapterCount, scenesPerChapter, threads, narratorIds } = brief;
    const hasSynopsisLines =
      synopsis.logline.length > 0 ||
      synopsis.mainConflicts.length > 0 ||
      synopsis.ending.length > 0 ||
      synopsis.theme.length > 0;

    return renderPrompt('chapterPlan', variant, {
      view: {
        chapterPlanShape: chapterPlanShape(brief),
        hasCountDemand: chapterCount !== undefined || scenesPerChapter !== undefined,
        hasBothCounts: chapterCount !== undefined && scenesPerChapter !== undefined,
        chapterCount: chapterCount === undefined ? undefined : String(chapterCount),
        scenesPerChapter: scenesPerChapter === undefined ? undefined : String(scenesPerChapter),
        isOmnibus: brief.composition === 'omnibus' && threads.length > 0,
        isAlternatingPov: brief.composition === 'alternating-pov' && narratorIds.length > 0,
        isFrame: brief.composition === 'frame' && threads.length > 0,
        threadCount: threads.length,
        threadList: threads.map((thread) => `${thread.id}(${thread.title})`).join(', '),
        narratorList: narratorIds.join(', '),
        logline: synopsis.logline,
        hasMainConflicts: synopsis.mainConflicts.length > 0,
        mainConflicts: synopsis.mainConflicts.join(', '),
        ending: synopsis.ending,
        theme: synopsis.theme,
        hasSynopsisLines,
        characterList: charactersToBlock(characters),
      },
      partials: { brief: briefToUserBlock(brief) },
    });
  },
} as const;

// 구성이 정해졌을 때만 장에 narrator·thread를 요구한다. 선형 작품에 빈 필드를 요구하면 모델이
// 아무 값이나 채워 넣어 씬 시드가 존재하지 않는 서술자를 참조한다.
function chapterPlanShape(brief: OutlineBrief): string {
  const chapterFields = needsChapterNarration(brief)
    ? '"id":"","title":"","summary":"","narrator":"","thread":"","targetWordCount":0'
    : '"id":"","title":"","summary":"","targetWordCount":0';

  return `{"acts":[{"id":"","title":"","summary":"","chapters":[{${chapterFields},"scenes":[{"id":"","title":"","purpose":"","characters":[""],"location":"","conflict":"","twist":"","emotionalShift":"","foreshadowing":[""],"neededCanon":[""],"targetWordCount":0}]}]}]}`;
}

function needsChapterNarration(brief: OutlineBrief): boolean {
  return (
    brief.composition !== undefined &&
    brief.composition !== 'linear' &&
    (brief.threads.length > 0 || brief.narratorIds.length > 0)
  );
}

function charactersToBlock(characters: readonly OutlineCharacterBrief[]): string {
  return characters
    .map((character) => {
      const role = character.role ? ` (${character.role})` : '';
      return `- ${character.id}: ${character.name}${role}`;
    })
    .join('\n');
}
