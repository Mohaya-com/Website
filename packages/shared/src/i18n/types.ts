import type { ar } from './ar';

type Widen<T> = { -readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Shape of a translation dictionary (derived from the Arabic source). */
export type Messages = Widen<typeof ar>;

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : Join<K, Paths<T[K]>>;
}[keyof T & string];

/** Every valid translation key, e.g. "status.pending". */
export type MessageKey = Paths<Messages>;
