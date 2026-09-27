import type { UiLanguage } from '@/shared/dto';

import { enMessages } from './en';
import { koMessages, type MessageKey } from './ko';

export type { MessageKey } from './ko';

export type MessageParams = Readonly<Record<string, string | number>>;

const tables: Readonly<Record<UiLanguage, Readonly<Record<MessageKey, string>>>> = {
  ko: koMessages,
  en: enMessages,
};

// `{name}` placeholders are filled from params; a missing param stays visible rather than vanishing,
// so a wrong call shows up on screen instead of silently dropping information.
export function translate(language: UiLanguage, key: MessageKey, params: MessageParams = {}): string {
  return tables[language][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    params[name] === undefined ? placeholder : String(params[name]),
  );
}

export function resolveUiLanguage(locale: string | undefined): UiLanguage {
  return locale?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}
