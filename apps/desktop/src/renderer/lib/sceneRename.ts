import { sceneStemPattern } from '@storyboard/story-model/contracts';

// The author edits the number and the file name apart; the stem is put back together with at
// least as many digits as the scene had, so `03` stays two-digit when it becomes `04`.
export function composeSceneStem(orderText: string, slug: string, minimumDigits: number): string | undefined {
  const trimmedOrder = orderText.trim();
  const order = Number(trimmedOrder);

  if (!/^\d+$/.test(trimmedOrder) || !Number.isInteger(order) || order < 1) {
    return undefined;
  }

  const stem = `${String(order).padStart(minimumDigits, '0')}-${slug.trim()}`;

  return sceneStemPattern.test(stem) ? stem : undefined;
}
