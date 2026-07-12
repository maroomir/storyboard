import {
  type OutlineBrief,
  type OutlineCharacterBrief,
  type OutlineSynopsis,
} from '@/shared/outline';
import { type PromptArtifact, type PromptVariantId } from './types';
import { briefToUserBlock } from './outlineSynopsis';

export const ChapterPlanPrompt = {
  config: {
    temperature: 0.6,
    maxTokens: 4000,
  },
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
      '{"acts":[{"id":"","title":"","summary":"","chapters":[{"id":"","title":"","summary":"","targetWordCount":0,"scenes":[{"id":"","title":"","purpose":"","characters":[""],"location":"","conflict":"","twist":"","emotionalShift":"","foreshadowing":[""],"neededCanon":[""],"targetWordCount":0}]}]}]}',
      '전체 목표 분량이 주어지면 장(chapter)·씬(scene)의 targetWordCount(글자 수)에 배분하고, 모르면 생략하라.',
      'id는 영소문자/숫자/하이픈만 사용하고, 막→장→씬 순서가 이야기 흐름과 일치하게 작성하라.',
    ].join('\n'),
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
