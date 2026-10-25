import { sceneStemPattern } from '@storyboard/story-model/contracts';

export function composeSceneStem(orderText: string, slug: string, minimumDigits: number): string | undefined {
  const trimmedOrder: string = orderText.trim();
  const order: number = Number(trimmedOrder);

  if (!/^\d+$/.test(trimmedOrder) || !Number.isInteger(order) || order < 1) {
    return undefined;
  }

  const stem: string = `${String(order).padStart(minimumDigits, '0')}-${slug.trim()}`;

  return sceneStemPattern.test(stem) ? stem : undefined;
}
