import { describe, expect, it } from 'vitest';

import { enMessages } from '@/shared/i18n/en';
import { koMessages, type MessageKey } from '@/shared/i18n/ko';
import { resolveUiLanguage, translate } from '@/shared/i18n/translate';

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

describe('UI messages', () => {
  // The type already forces the same keys; a translation that drops a placeholder would silently
  // lose the number or name the author needs to see.
  it('keep the same placeholders in both languages and no empty text', () => {
    for (const key of Object.keys(koMessages) as MessageKey[]) {
      expect(placeholders(enMessages[key]), key).toEqual(placeholders(koMessages[key]));
      expect(enMessages[key].trim().length, key).toBeGreaterThan(0);
      expect(koMessages[key].trim().length, key).toBeGreaterThan(0);
    }
  });

  it('fill placeholders and leave a missing one visible', () => {
    expect(translate('ko', 'desk.sceneNumber', { order: 3 })).toBe('씬 3');
    expect(translate('en', 'desk.sceneNumber')).toBe('Scene {order}');
  });

  it('follow a Korean system locale and default to English otherwise', () => {
    expect(resolveUiLanguage('ko-KR')).toBe('ko');
    expect(resolveUiLanguage('en-US')).toBe('en');
    expect(resolveUiLanguage(undefined)).toBe('en');
  });
});
