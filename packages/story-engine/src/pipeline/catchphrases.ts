import { escapeRegExp } from '@storyboard/story-model';

export interface CatchphraseCount {
  readonly phrase: string;
  readonly count: number;
}

export function countCatchphrase(text: string, phrase: string): number {
  return (text.match(new RegExp(`(^|[^가-힣])${escapeRegExp(phrase)}`, 'g')) ?? []).length;
}
