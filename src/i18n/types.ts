/**
 * Public i18n contract for `@rhythm-archive/bms-player`.
 *
 * See `bms-editor/src/i18n/types.ts` for the design rationale — this file
 * mirrors the same shape so consumers can use a unified translator across
 * both packages.
 */

import type { BmsPlayerMessages } from './defaults';

export type BmsPlayerI18nKey = NestedKeyOf<BmsPlayerMessages>;

export type Translator = (
  key: BmsPlayerI18nKey,
  params?: Record<string, string | number>,
) => string;

export interface I18nProvider {
  t: Translator;
  locale?: string;
}

type Primitive = string | number | boolean | null | undefined;

type NestedKeyOf<T> = T extends Primitive
  ? never
  : {
      [K in keyof T & string]: T[K] extends Primitive ? `${K}` : `${K}.${NestedKeyOf<T[K]>}`;
    }[keyof T & string];
