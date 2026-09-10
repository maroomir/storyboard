import type {
  OutlineBrief,
  OutlineCharacterBrief,
  OutlineSynopsis,
} from '@storyboard/story-format';
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
    return variant === 'xs'
      ? buildXs(brief, synopsis, characters)
      : buildGeneric(brief, synopsis, characters);
  },
} as const;

function buildGeneric(
  brief: OutlineBrief,
  synopsis: OutlineSynopsis,
  characters: readonly OutlineCharacterBrief[],
): PromptArtifact {
  return {
    system: [
      '장편 소설의 전체 플롯을 act/chapter/scene 단위로 분해하는 도우미다.',
      '시놉시스와 등장 인물을 바탕으로 막-장-씬 구조를 설계한다.',
      '각 씬에는 목적(purpose), 등장 인물(characters: 인물 id 배열), 배경(location), 갈등(conflict), 반전(twist), 감정 변화(emotionalShift), 회수할 복선(foreshadowing), 필요한 설정 사실(neededCanon)을 적는다.',
      'characters에는 아래 [등장 인물]의 id만 사용하라. 설명 없이 JSON 객체 하나만 출력하라.',
      chapterPlanShape(brief),
      '전체 목표 분량이 주어지면 장(chapter)·씬(scene)의 targetWordCount(글자 수)에 배분하고, 모르면 생략하라.',
      chapterStructureLine(brief),
      ...compositionLines(brief),
      'id는 영소문자/숫자/하이픈만 사용하고, 막→장→씬 순서가 이야기 흐름과 일치하게 작성하라.',
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
    user: planToUserBlock(brief, synopsis, characters),
  };
}

function buildXs(
  brief: OutlineBrief,
  synopsis: OutlineSynopsis,
  characters: readonly OutlineCharacterBrief[],
): PromptArtifact {
  return {
    system:
      'act/chapter/scene 구조를 JSON 객체로 반환: {"acts":[{"id":"","title":"","chapters":[{"id":"","title":"","scenes":[{"id":"","title":"","purpose":"","characters":[],"foreshadowing":[]}]}]}]} (characters는 인물 id).',
    user: planToUserBlock(brief, synopsis, characters),
  };
}

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

function compositionLines(brief: OutlineBrief): string[] {
  const threadList = brief.threads.map((thread) => `${thread.id}(${thread.title})`).join(', ');

  switch (brief.composition) {
    case 'omnibus':
      return brief.threads.length > 0
        ? [
            `이 작품은 옴니버스다. 편은 ${brief.threads.length}개이며 각 편은 자기 사건과 결말을 스스로 닫는다: ${threadList}.`,
            '한 편은 막(act) 하나에 대응시키고, 그 막에 속한 모든 장(chapter)의 thread에 그 편의 id를 적어라.',
            '편끼리는 세계와 인물만 공유하고 사건은 이어지지 않는다. 앞 편을 읽지 않아도 읽히게 하라.',
          ]
        : [];
    case 'alternating-pov':
      return brief.narratorIds.length > 0
        ? [
            `이 작품은 시점 교차다. 장(chapter)마다 서술자를 번갈아 배정하고 그 장의 narrator에 id를 적어라: ${brief.narratorIds.join(', ')}.`,
            '한 장 안에서는 서술자를 바꾸지 마라. 같은 사건을 두 서술자가 각각 서술하는 장은 두지 마라.',
          ]
        : [];
    case 'frame':
      return brief.threads.length > 0
        ? [
            `이 작품은 액자식이다. 줄기는 다음과 같다: ${threadList}.`,
            '외화(다른 줄기를 감싸는 줄기)는 첫 장과 마지막 장에만 두고, 그 장의 thread에 외화 줄기의 id를 적어라.',
            '가운데 장들은 내화 줄기의 id를 적고, 외화가 내화를 여는 이유와 닫는 결말이 서로 맞물리게 하라.',
          ]
        : [];
    default:
      return [];
  }
}

// 계약이 장·씬 개수를 정해 두었으면 그대로 지키게 한다. 자연어 설명에 섞어 부탁하는 것과 달리
// 이 줄은 지시로 읽히고, 값이 없으면 아예 나가지 않는다.
function chapterStructureLine(brief: OutlineBrief): string | undefined {
  const { chapterCount, scenesPerChapter } = brief;

  if (chapterCount === undefined && scenesPerChapter === undefined) {
    return undefined;
  }

  const demands = [
    chapterCount === undefined ? undefined : `장(chapter)은 정확히 ${chapterCount}개`,
    scenesPerChapter === undefined ? undefined : `각 장의 씬(scene)은 정확히 ${scenesPerChapter}개`,
  ].filter((part): part is string => part !== undefined);

  return `${demands.join(', ')}로 만들어라. 이 개수는 반드시 지켜야 한다.`;
}

function planToUserBlock(
  brief: OutlineBrief,
  synopsis: OutlineSynopsis,
  characters: readonly OutlineCharacterBrief[],
): string {
  const sections: string[] = [
    '[작품 계약]',
    briefToUserBlock(brief),
    '',
    '[시놉시스]',
    synopsisToBlock(synopsis),
  ];

  sections.push(
    '',
    '[등장 인물]',
    characters.length > 0 ? charactersToBlock(characters) : '(등록된 인물 없음)',
  );

  return sections.join('\n');
}

function synopsisToBlock(synopsis: OutlineSynopsis): string {
  const lines: string[] = [];

  if (synopsis.logline.length > 0) {
    lines.push(`로그라인: ${synopsis.logline}`);
  }
  if (synopsis.mainConflicts.length > 0) {
    lines.push(`주요 갈등: ${synopsis.mainConflicts.join(', ')}`);
  }
  if (synopsis.ending.length > 0) {
    lines.push(`결말: ${synopsis.ending}`);
  }
  if (synopsis.theme.length > 0) {
    lines.push(`주제: ${synopsis.theme}`);
  }

  return lines.length > 0 ? lines.join('\n') : '(시놉시스 정보 없음)';
}

function charactersToBlock(characters: readonly OutlineCharacterBrief[]): string {
  return characters
    .map((character) => {
      const role = character.role ? ` (${character.role})` : '';
      return `- ${character.id}: ${character.name}${role}`;
    })
    .join('\n');
}
