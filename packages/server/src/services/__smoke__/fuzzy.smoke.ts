// Smoke test for fuzzy-match pure-logic stages (token-set + Levenshtein +
// alias dictionary). Stubs the DB call so it runs without Postgres.

import type { Db } from '../../db/index.js';
import { fuzzyMatchCheck } from '../fuzzy-match.js';

interface FakeRow {
  id: string;
  slug: string;
  canonicalName: string;
  normalizedName: string;
  aliases: string[];
}

function buildFakeDb(rows: FakeRow[]): Db {
  // We mimic just the chained .select/.from/.where/.limit/.then shape that
  // fuzzy-match.ts uses. Drizzle returns a thenable Builder; here we return
  // arrays directly. The check uses two query shapes:
  //   - exact:  select(...).from(characters).where(eq(...)).limit(1) -> [row]
  //   - all:    select(...).from(characters)                          -> [rows]
  let pendingFilter: ((r: FakeRow) => boolean) | null = null;
  let pendingLimit: number | null = null;

  const builder: any = {
    select() {
      pendingFilter = null;
      pendingLimit = null;
      return builder;
    },
    from() {
      return builder;
    },
    where(predicate: any) {
      // We assume predicate is `eq(characters.normalizedName, x)` — pull the
      // expected normalized name out via toString() heuristic.
      const s = predicate?.queryChunks
        ? predicate.queryChunks.map((c: any) => c.value).join('')
        : String(predicate);
      const m = /["']([a-z0-9]+)["']/.exec(s) ?? /([a-z0-9]+)$/.exec(s);
      const want = m?.[1];
      pendingFilter = (r: FakeRow) => r.normalizedName === want;
      return builder;
    },
    limit(n: number) {
      pendingLimit = n;
      return builder;
    },
    then(resolve: (rows: FakeRow[]) => void) {
      let result = pendingFilter ? rows.filter(pendingFilter) : rows.slice();
      if (pendingLimit !== null) result = result.slice(0, pendingLimit);
      resolve(result);
      return Promise.resolve(result);
    },
  };
  return builder as Db;
}

const seed: FakeRow[] = [
  {
    id: 'einstein-id',
    slug: 'albert-einstein',
    canonicalName: 'Albert Einstein',
    normalizedName: 'alberteinstein',
    aliases: ['Einstein', 'A. Einstein'],
  },
  {
    id: 'lincoln-id',
    slug: 'abraham-lincoln',
    canonicalName: 'Abraham Lincoln',
    normalizedName: 'abrahamlincoln',
    aliases: [],
  },
];

interface Case {
  name: string;
  fn: () => Promise<boolean>;
}

const cases: Case[] = [
  {
    name: 'exact normalized match rejects',
    fn: async () => {
      const hit = await fuzzyMatchCheck(buildFakeDb(seed), 'Albert Einstein');
      return hit?.matchedOn === 'exact';
    },
  },
  {
    name: 'token-reorder caught by token_set Jaccard',
    fn: async () => {
      const hit = await fuzzyMatchCheck(buildFakeDb(seed), 'Einstein Albert');
      return hit?.matchedOn === 'token_set';
    },
  },
  {
    name: 'minor typo caught by levenshtein',
    fn: async () => {
      const hit = await fuzzyMatchCheck(buildFakeDb(seed), 'Albert Einstien');
      // 'alberteinstien' vs 'alberteinstein' — distance 2.
      return hit?.matchedOn === 'levenshtein' || hit?.matchedOn === 'token_set';
    },
  },
  {
    name: 'alias substring match rejects',
    fn: async () => {
      const hit = await fuzzyMatchCheck(buildFakeDb(seed), 'A. Einstein');
      return hit?.matchedOn === 'alias';
    },
  },
  {
    name: 'unrelated name passes',
    fn: async () => {
      const hit = await fuzzyMatchCheck(buildFakeDb(seed), 'Marie Curie');
      return hit === null;
    },
  },
];

let failed = 0;
for (const c of cases) {
  try {
    const ok = await c.fn();
    if (ok) console.log(`PASS  ${c.name}`);
    else {
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
console.log(`\nAll ${cases.length} fuzzy-match cases passed.`);
