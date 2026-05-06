import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { defaultMessages } from './defaults';
import type { BmsPlayerI18nKey, I18nProvider as I18nProviderValue, Translator } from './types';

const I18nContext = createContext<I18nProviderValue | null>(null);

interface I18nProviderProps {
  value: I18nProviderValue;
  children: ReactNode;
}

export function I18nProvider({ value, children }: I18nProviderProps) {
  const memoized = useMemo<I18nProviderValue>(
    () => ({ t: value.t, locale: value.locale }),
    [value.t, value.locale],
  );
  return <I18nContext.Provider value={memoized}>{children}</I18nContext.Provider>;
}

export function fallbackTranslate(
  key: BmsPlayerI18nKey,
  _params?: Record<string, string | number>,
): string {
  const parts = key.split('.');
  let cursor: unknown = defaultMessages;
  for (const part of parts) {
    if (cursor && typeof cursor === 'object' && part in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof cursor === 'string' ? cursor : key;
}

const fallbackProvider: I18nProviderValue = {
  t: fallbackTranslate as Translator,
  locale: 'en',
};

export function useI18n(): I18nProviderValue {
  return useContext(I18nContext) ?? fallbackProvider;
}
