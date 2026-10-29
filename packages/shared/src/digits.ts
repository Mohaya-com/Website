const ARABIC_INDIC_ZERO = 0x0660; // ٠
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0; // ۰ (Persian / Urdu)

/**
 * Converts Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits to Western digits (0-9).
 * Other characters are preserved.
 */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    } else {
      out += ch;
    }
  }
  return out;
}

/** Normalizes digits and removes whitespace, dashes, dots and bidi control characters. */
export function normalizeIdentifier(input: string): string {
  return normalizeDigits(input)
    .replace(/[\s‎‏‪-‮⁦-⁩\-_.]/g, '')
    .trim();
}

/** Keeps only Western digits after normalizing. */
export function onlyDigits(input: string): string {
  return normalizeDigits(input).replace(/\D/g, '');
}

/** Formats Western digits as Arabic-Indic digits (display only). */
export function toArabicDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => String.fromCharCode(ARABIC_INDIC_ZERO + Number(d)));
}
