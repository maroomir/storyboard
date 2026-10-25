import type {
  OutlineBrief,
  OutlineCharacterBrief,
  OutlineSynopsis,
} from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';
import { briefToUserBlock } from './outlineSynopsis';

export const ChapterPlanPrompt: PromptModule<[brief: OutlineBrief, synopsis: OutlineSynopsis, characters: readonly OutlineCharacterBrief[], variant?: PromptVariantId]> = {
  config: promptTuning('chapterPlan'),
  build(
    brief: OutlineBrief,
    synopsis: OutlineSynopsis,
    characters: readonly OutlineCharacterBrief[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    const { chapterCount, scenesPerChapter, threads, narratorIds } = brief;
    const hasSynopsisLines: boolean =
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
};

function chapterPlanShape(brief: OutlineBrief): string {
  const chapterFields: string = needsChapterNarration(brief)
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
      const role: string = character.role ? ` (${character.role})` : '';
      return `- ${character.id}: ${character.name}${role}`;
    })
    .join('\n');
}
