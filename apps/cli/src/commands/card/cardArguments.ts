import type { ParsedArguments } from '@/cliArguments';
import { cardCategories } from '@/commands/catalog';
import type { BibleSubjectKind } from '@storyboard/story-model';

export const cardIdPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

export function cardCategoryFrom(args: ParsedArguments): BibleSubjectKind | undefined {
  return cardCategories.find((category) => category === args.positionals[0]);
}

export function describeMissingCardCategory(verb: string): string {
  return `카드 종류를 지정해 주세요: storyboard ${verb} <${cardCategories.join('|')}>`;
}
