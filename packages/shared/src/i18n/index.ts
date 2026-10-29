import type { Locale } from '../constants';
import { ar } from './ar';
import { en } from './en';
import type { MessageKey, Messages } from './types';

export type { MessageKey, Messages } from './types';
export { ar, en };

const dictionaries: Record<Locale, Messages> = { ar, en };

export type TranslateParams = Record<string, string | number | null | undefined>;

function lookup(dict: Messages, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      // Keys may themselves contain dots (e.g. audit actions "visit.approved").
      return lookupWithDottedLeaf(dict, key);
    }
  }
  return typeof node === 'string' ? node : undefined;
}

function lookupWithDottedLeaf(dict: Messages, key: string): string | undefined {
  const parts = key.split('.');
  for (let split = parts.length - 1; split >= 1; split--) {
    let node: unknown = dict;
    for (const part of parts.slice(0, split)) {
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
    }
    const leaf = node && typeof node === 'object' ? (node as Record<string, unknown>)[parts.slice(split).join('.')] : undefined;
    if (typeof leaf === 'string') return leaf;
  }
  return undefined;
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Translates a runtime key (e.g. an API error message key). Falls back to Arabic, then to the key itself. */
export function translateDynamic(locale: Locale, key: string, params?: TranslateParams): string {
  const value = lookup(dictionaries[locale], key) ?? lookup(ar, key);
  return interpolate(value ?? key, params);
}

export function translate(locale: Locale, key: MessageKey, params?: TranslateParams): string {
  return translateDynamic(locale, key, params);
}

export interface Translator {
  (key: MessageKey, params?: TranslateParams): string;
  dynamic: (key: string, params?: TranslateParams) => string;
  has: (key: string) => boolean;
  locale: Locale;
  dir: 'rtl' | 'ltr';
}

export function createTranslator(locale: Locale): Translator {
  const fn = ((key: MessageKey, params?: TranslateParams) => translate(locale, key, params)) as Translator;
  fn.dynamic = (key, params) => translateDynamic(locale, key, params);
  fn.has = (key) => lookup(dictionaries[locale], key) !== undefined;
  fn.locale = locale;
  fn.dir = directionOf(locale);
  return fn;
}

export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function isLocale(value: unknown): value is Locale {
  return value === 'ar' || value === 'en';
}

/** Server-side rendering of notification text (push previews never include identity details). */
export function renderNotificationText(locale: Locale, type: string, params: TranslateParams): { title: string; body: string } {
  return {
    title: translateDynamic(locale, `notifications.types.${type}.title`, params),
    body: translateDynamic(locale, `notifications.types.${type}.body`, params),
  };
}
