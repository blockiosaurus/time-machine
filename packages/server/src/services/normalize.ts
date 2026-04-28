/**
 * Name normalization shared between canonicalizer output and the fuzzy-match
 * algorithm. The "normalized name" is the unique key in `characters`.
 */

const DIACRITICS_RE = /[\u0300-\u036f]/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;

/** Lowercase, strip diacritics, drop punctuation/whitespace. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(NON_ALNUM_RE, '');
}

/** Build a URL-safe slug. "Albert Einstein" -> "albert-einstein". */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Tokenize for token-set Jaccard similarity. */
export function tokenize(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}
