import {
  normalizeCardListText,
  sceneBeatText,
  type InterviewBeatSituation,
  type SceneBeat,
  type SceneFile,
  type StoryboardCard,
} from '@storyboard/story-model';
import type { InterviewQuestionPresence } from '@storyboard/story-ai';

import { cardTokens } from '#engine/application/interviews/interviewCoverage';

export interface InterviewPartner {
  readonly card: StoryboardCard;
  readonly speech: string | undefined;
}

const quotedTermPattern: RegExp = /['‘’"“”«»「」『』]([^'‘’"“”«»「」『』\n]{1,12})['‘’"“”«»「」『』]/g;
const shortestFlaggedTermLength: number = 2;

function findCardByRef(ref: string, cards: readonly StoryboardCard[]): StoryboardCard | undefined {
  const token: string = normalizeCardListText(ref);

  return cards.find((card) => cardTokens(card).has(token));
}

function isCardPresent(card: StoryboardCard, situation: InterviewBeatSituation): boolean {
  const tokens: Set<string> = cardTokens(card);

  return situation.cast.some((ref) => tokens.has(normalizeCardListText(ref)));
}

function findPrecedingBeat(
  situation: InterviewBeatSituation,
  scenes: readonly SceneFile[],
): SceneBeat | undefined {
  const scene: SceneFile | undefined = scenes.find((candidate) => candidate.stem === situation.sceneStem);

  return situation.beatIndex > 0 ? scene?.card.beats?.[situation.beatIndex - 1] : undefined;
}

export function describePresence(
  situation: InterviewBeatSituation,
  scenes: readonly SceneFile[],
  characters: readonly StoryboardCard[],
): InterviewQuestionPresence {
  const presentNames: string[] = [
    ...new Set(
      situation.cast
        .map((ref) => findCardByRef(ref, characters)?.name ?? ref.trim())
        .filter((name) => name.length > 0),
    ),
  ];
  if (presentNames.length > 0) {
    return { presentNames };
  }

  const precedingBeat: SceneBeat | undefined = findPrecedingBeat(situation, scenes);

  return precedingBeat === undefined
    ? { presentNames }
    : { presentNames, precedingBeat: sceneBeatText(precedingBeat) };
}

export function extractQuotedTerms(speech: string): string[] {
  return [...speech.matchAll(quotedTermPattern)].map((match) => (match[1] ?? '').trim());
}

export function collectAbsentPartnerTerms(input: {
  readonly subject: StoryboardCard;
  readonly situation: InterviewBeatSituation;
  readonly partners: readonly InterviewPartner[];
}): string[] {
  const { subject, situation, partners } = input;
  if (situation.cast.length === 0) {
    return [];
  }

  const subjectTokens: Set<string> = cardTokens(subject);
  const terms: string[] = partners
    .filter((partner) => !isCardPresent(partner.card, situation))
    .flatMap((partner) => [
      partner.card.name,
      ...(partner.card.aliases ?? []),
      ...extractQuotedTerms(partner.speech ?? ''),
    ])
    .map((term) => term.trim())
    .filter(
      (term) =>
        term.length >= shortestFlaggedTermLength &&
        !situation.text.includes(term) &&
        !subjectTokens.has(normalizeCardListText(term)),
    );

  return [...new Set(terms)];
}

export function isOptionAddressingAbsentPartner(text: string, absentTerms: readonly string[]): boolean {
  return absentTerms.some((term) => text.includes(term));
}
