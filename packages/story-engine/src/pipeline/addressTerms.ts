import {
  escapeRegExp,
  sceneBeatText,
  type CharacterCard,
  type SceneBeat,
} from '@storyboard/story-model';

const quotedAddressPattern: RegExp =
  /['"‘’“”]([^'"‘’“”\n]{1,12})['"‘’“”]\s*(?:이?라고?|으로)\s*(?:부르|불러|부른|부름|호칭)/g;
const addressCoiningCuePattern: RegExp = /부르|불러|부른|별명|애칭|호칭/;
const quotedDialoguePattern: RegExp = /[“"]([^”"\n]*)[”"]/g;

const kinshipAddressGroups: readonly (readonly string[])[] = [
  ['엄마', '어머니', '어머님'],
  ['아빠', '아버지', '아버님'],
  ['누나', '누님'],
  ['오빠', '오라버니'],
  ['할머니', '할매'],
  ['할아버지', '할배'],
];

export interface AddressSubstitution {
  readonly written: string;
  readonly expected: string;
}

export function extractQuotedAddressTerms(text: string): string[] {
  return [...text.matchAll(quotedAddressPattern)].map((match) => (match[1] ?? '').trim());
}

function includesWordStart(text: string, term: string): boolean {
  return new RegExp(`(^|[^가-힣])${escapeRegExp(term)}`).test(text);
}

function extractDialogue(text: string): string {
  return [...text.matchAll(quotedDialoguePattern)].map((match) => match[1] ?? '').join('\n');
}

export interface CoinedAddress {
  readonly term: string;
  readonly beatIndex: number;
}

function cardAddressTerms(characters: readonly CharacterCard[]): string[] {
  return characters.flatMap((character) =>
    (character.relations ?? []).flatMap((relation) =>
      extractQuotedAddressTerms(relation.speech ?? ''),
    ),
  );
}

function beatCoinedTerms(beatBody: string, cardTerms: readonly string[]): string[] {
  const namesAnAddress: boolean = addressCoiningCuePattern.test(beatBody);
  const namedCardTerms: string[] = namesAnAddress
    ? cardTerms.filter((term) => term.length > 0 && beatBody.includes(term))
    : [];

  return [...extractQuotedAddressTerms(beatBody), ...namedCardTerms];
}

export function findBeatCoinedAddresses(
  beats: readonly SceneBeat[],
  characters: readonly CharacterCard[] = [],
): CoinedAddress[] {
  const cardTerms: string[] = cardAddressTerms(characters);
  const coined: CoinedAddress[] = [];

  beats.forEach((beat, beatIndex) => {
    const earlierText: string = beats.slice(0, beatIndex).map(sceneBeatText).join('\n');
    const isFirstBeat: boolean = beatIndex === 0;
    for (const term of beatCoinedTerms(sceneBeatText(beat), cardTerms)) {
      const isNewTerm: boolean =
        !earlierText.includes(term) && !coined.some((entry) => entry.term === term);
      if (!isFirstBeat && isNewTerm) {
        coined.push({ term, beatIndex });
      }
    }
  });

  return coined;
}

export function findBeatCoinedAddressTerms(
  beats: readonly SceneBeat[],
  characters: readonly CharacterCard[] = [],
): string[] {
  return findBeatCoinedAddresses(beats, characters).map((entry) => entry.term);
}

export function listAddressTermsCoinedAfter(
  coined: readonly CoinedAddress[],
  beatIndex: number,
): string[] {
  return coined.filter((entry) => entry.beatIndex > beatIndex).map((entry) => entry.term);
}

export function withholdCatchphrases(
  catchphrases: ReadonlyMap<string, readonly string[]>,
  withheldTerms: readonly string[],
): Map<string, readonly string[]> {
  return new Map(
    [...catchphrases].map(
      ([name, phrases]) =>
        [name, phrases.filter((phrase) => !withheldTerms.includes(phrase))] as const,
    ),
  );
}

export function findEarlyAddressTermsInLines(input: {
  readonly skeleton: string;
  readonly lineEnds: ReadonlyMap<number, number>;
  readonly rewrittenLines: ReadonlyMap<number, string>;
  readonly terms: readonly string[];
}): Map<number, string[]> {
  const earlyByLine: Map<number, string[]> = new Map<number, string[]>();

  for (const term of input.terms) {
    const firstUse: number = input.skeleton.indexOf(term);
    const firstUseOffset: number = firstUse < 0 ? Number.POSITIVE_INFINITY : firstUse;

    for (const [index, line] of input.rewrittenLines) {
      const endsBeforeFirstUse: boolean = (input.lineEnds.get(index) ?? 0) <= firstUseOffset;
      if (endsBeforeFirstUse && line.includes(term)) {
        earlyByLine.set(index, [...(earlyByLine.get(index) ?? []), term]);
      }
    }
  }

  return earlyByLine;
}

export function planSectionWithheldAddressTerms(input: {
  readonly skeleton: string;
  readonly sections: readonly string[];
  readonly terms: readonly string[];
}): string[][] {
  let searchFrom: number = 0;

  return input.sections.map((section): string[] => {
    const sectionStart: number = Math.max(0, input.skeleton.indexOf(section.trim(), searchFrom));
    const sectionEnd: number = sectionStart + section.trim().length;
    searchFrom = sectionEnd;

    return input.terms.filter((term) => {
      const firstUse: number = input.skeleton.indexOf(term);
      const isCoinedLater: boolean = firstUse < 0 || firstUse >= sectionEnd;
      return isCoinedLater && !section.includes(term);
    });
  });
}

export function findWithheldAddressTermsUsed(
  expanded: string,
  withheldTerms: readonly string[],
): string[] {
  return withheldTerms.filter((term) => expanded.includes(term));
}

export function findKinshipAddressSubstitutions(input: {
  readonly expanded: string;
  readonly section: string;
  readonly characters: readonly CharacterCard[];
}): AddressSubstitution[] {
  const cardTerms: Set<string> = new Set(
    input.characters.flatMap((character) =>
      (character.relations ?? []).flatMap((relation) =>
        extractQuotedAddressTerms(relation.speech ?? ''),
      ),
    ),
  );
  const writtenDialogue: string = extractDialogue(input.expanded);
  const sectionDialogue: string = extractDialogue(input.section);
  const substitutions: AddressSubstitution[] = [];

  for (const group of kinshipAddressGroups) {
    const expected: string | undefined = group.find((term) => cardTerms.has(term));
    if (expected === undefined) {
      continue;
    }

    for (const written of group) {
      const isSubstitute: boolean =
        !cardTerms.has(written) && !includesWordStart(sectionDialogue, written);
      if (isSubstitute && includesWordStart(writtenDialogue, written)) {
        substitutions.push({ written, expected });
      }
    }
  }

  return substitutions;
}
