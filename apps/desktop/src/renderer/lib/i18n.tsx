import { createContext, useContext, type ReactNode } from 'react';

import type { UiLanguage } from '@/shared/dto';
import { translate, type MessageKey, type MessageParams } from '@/shared/i18n/translate';

export type Translate = (key: MessageKey, params?: MessageParams) => string;

interface I18nValue {
  readonly language: UiLanguage;
  readonly t: Translate;
}

const I18nContext = createContext<I18nValue>({
  language: 'ko',
  t: (key, params) => translate('ko', key, params),
});

export function I18nProvider(props: { readonly language: UiLanguage; readonly children: ReactNode }): JSX.Element {
  const value: I18nValue = {
    language: props.language,
    t: (key, params) => translate(props.language, key, params),
  };

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
