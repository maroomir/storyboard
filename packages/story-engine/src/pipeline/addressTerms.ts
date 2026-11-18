import {
  escapeRegExp,
  sceneBeatText,
  type CharacterCard,
  type SceneBeat,
} from '@storyboard/story-model';

const quotedAddressPattern: RegExp =
  /['"‘’“”]([^'"‘’“”\n]{1,12})['"‘’“”]\s*(?:이?라고?|으로)\s*(?:부르|불러|부른|부름|호칭)/g;
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

export function findBeatCoinedAddressTerms(beats: readonly SceneBeat[]): string[] {
  const coined: string[] = [];

  beats.forEach((beat, index) => {
    const earlierText: string = beats.slice(0, index).map(sceneBeatText).join('\n');
    const isFirstBeat: boolean = index === 0;
    for (const term of extractQuotedAddressTerms(sceneBeatText(beat))) {
      const isNewTerm: boolean = !earlierText.includes(term) && !coined.includes(term);
      if (!isFirstBeat && isNewTerm) {
        coined.push(term);
      }
    }
  });

  return coined;
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
