// Smoke tests for normalize + fuzzy-match pure logic.
// Run with:  pnpm --filter @metaplex-agent/server exec tsx src/services/__smoke__/normalize.smoke.ts
// Exits non-zero on failure. No DB, no network.

import { normalizeName, slugify, tokenize } from '../normalize.js';

interface Case {
  name: string;
  fn: () => boolean;
}

const cases: Case[] = [
  {
    name: 'normalize: lowercase + strip whitespace',
    fn: () => normalizeName('Albert Einstein') === 'alberteinstein',
  },
  {
    name: 'normalize: strip diacritics',
    fn: () => normalizeName('Léonard de Vinci') === 'leonarddevinci',
  },
  {
    name: 'normalize: strip punctuation',
    fn: () => normalizeName('John F. Kennedy') === 'johnfkennedy',
  },
  {
    name: 'normalize: handles whitespace tricks',
    fn: () => normalizeName('Albert  Einstein') === normalizeName('Albert Einstein'),
  },
  {
    name: 'normalize: preserves token order (reordering is caught by Jaccard, not normalize)',
    fn: () =>
      normalizeName('Einstein, Albert') === 'einsteinalbert' &&
      normalizeName('Albert Einstein') === 'alberteinstein',
  },
  {
    name: 'slugify: basic',
    fn: () => slugify('Albert Einstein') === 'albert-einstein',
  },
  {
    name: 'slugify: diacritics + punctuation',
    fn: () => slugify('Léonard de Vinci, "the painter"') === 'leonard-de-vinci-the-painter',
  },
  {
    name: 'tokenize: drops empties',
    fn: () => {
      const t = tokenize('  Albert--Einstein  ');
      return t.length === 2 && t[0] === 'albert' && t[1] === 'einstein';
    },
  },
];

let failed = 0;
for (const c of cases) {
  try {
    if (c.fn()) {
      console.log(`PASS  ${c.name}`);
    } else {
      console.error(`FAIL  ${c.name}`);
      failed++;
    }
  } catch (e) {
    console.error(`THROW ${c.name}: ${(e as Error).message}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} normalize/tokenize cases passed.`);
