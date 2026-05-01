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
  network: string;
}

function buildFakeDb(rows: FakeRow[]): Db {
  // We mimic just the chained .select/.from/.where/.limit/.then shape that
  // fuzzy-match.ts uses. The query now compounds network + normalizedName
  // via `and(eq(network), eq(normalizedName))`; we treat the .where() as an
  // opaque predicate and just match on `normalizedName`-shaped values that
  // we find in the predicate's query chunks. Network filtering is folded
  // into the implicit "rows belong to one network" assumption — we only
  // seed devnet rows.
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
      // Find every quoted/string-literal value in the predicate; the
      // longest one is the normalized-name candidate (network values are
      // short like "devnet").
      const chunks: string[] = [];
      function walk(node: any) {
        if (!node) return;
        if (typeof node === 'string') chunks.push(node);
        if (Array.isArray(node?.queryChunks)) node.queryChunks.forEach(walk);
        if (node?.value !== undefined) chunks.push(String(node.value));
      }
      walk(predicate);
      const candidates = chunks
        .map((c) => /([a-z0-9]+)/.exec(c)?.[1])
        .filter((s): s is string => !!s && s !== 'devnet' && s !== 'mainnet' && s !== 'testnet');
      const want = candidates.sort((a, b) => b.length - a.length)[0];
      pendingFilter = (r: FakeRow) => !want || r.normalizedName === want;
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
    network: 'devnet',
  },
  {
    id: 'lincoln-id',
    slug: 'abraham-lincoln',
    canonicalName: 'Abraham Lincoln',
    normalizedName: 'abrahamlincoln',
    aliases: [],
    network: 'devnet',
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
      const hit = await fuzzyMatchCheck(buildFakeDb(seed), 'Albert Einstein', 'devnet');
      return hit?.matchedOn === 'exact';
    },
  },
  {
    name: 'token-reorder caught by token_set Jaccard',
    fn: async () => {
      const hit = await fuzzyMatchCheck(buildFakeDb(seed), 'Einstein Albert', 'devnet');
      return hit?.matchedOn === 'token_set';
    },
  },
  {
    name: 'minor typo caught by levenshtein',
    fn: async () => {
      const hit = await fuzzyMatchCheck(buildFakeDb(seed), 'Albert Einstien', 'devnet');
      // 'alberteinstien' vs 'alberteinstein' — distance 2.
      return hit?.matchedOn === 'levenshtein' || hit?.matchedOn === 'token_set';
    },
  },
  {
    name: 'alias substring match rejects',
    fn: async () => {
      const hit = await fuzzyMatchCheck(buildFakeDb(seed), 'A. Einstein', 'devnet');
      return hit?.matchedOn === 'alias';
    },
  },
  {
    name: 'unrelated name passes',
    fn: async () => {
      const hit = await fuzzyMatchCheck(buildFakeDb(seed), 'Marie Curie', 'devnet');
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
