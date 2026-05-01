import { and, eq } from 'drizzle-orm';
import type { SolanaNetwork } from '@metaplex-agent/shared';
import type { Db } from '../db/index.js';
import { characters } from '../db/schema.js';
import { normalizeName, tokenize } from './normalize.js';

const ALIAS_DICTIONARY: Record<string, string[]> = {
  'abraham lincoln': ['abe lincoln', 'honest abe'],
  'george washington': ['washington'],
  'albert einstein': ['einstein'],
  'isaac newton': ['newton', 'sir isaac newton'],
  'leonardo da vinci': ['da vinci', 'leonardo'],
  'napoleon bonaparte': ['napoleon'],
  'nikola tesla': ['tesla'],
  'marie curie': ['madame curie', 'marie sklodowska curie'],
  'sun tzu': ['suntzu'],
  'cleopatra': ['cleopatra vii'],
  'john f kennedy': ['jfk', 'kennedy'],
};

export interface FuzzyMatchHit {
  id: string;
  slug: string;
  canonicalName: string;
  matchedOn: 'exact' | 'token_set' | 'levenshtein' | 'alias';
  similarity?: number;
}

/** Token-set Jaccard similarity on normalized tokens. */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return inter / union;
}

/** Standard iterative Levenshtein. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Run the multi-stage fuzzy-match guard. Returns a hit if the candidate
 * name conflicts with any existing character.
 *
 * Algorithm (per design doc §5.1):
 *   1. Exact normalized-name match -> reject.
 *   2. Token-set Jaccard >= 0.85 -> reject.
 *   3. Levenshtein <= 2 with length-ratio in [0.8, 1.25] and shared first
 *      token -> reject.
 *   4. Alias dictionary substring -> reject.
 */
export async function fuzzyMatchCheck(
  db: Db,
  candidateCanonicalName: string,
  network: SolanaNetwork,
): Promise<FuzzyMatchHit | null> {
  const normalized = normalizeName(candidateCanonicalName);
  const candidateTokens = tokenize(candidateCanonicalName);

  // 1. Exact match — scoped to the current network.
  const exactRows = await db
    .select({
      id: characters.id,
      slug: characters.slug,
      canonicalName: characters.canonicalName,
      normalizedName: characters.normalizedName,
    })
    .from(characters)
    .where(
      and(
        eq(characters.network, network),
        eq(characters.normalizedName, normalized),
      ),
    )
    .limit(1);
  if (exactRows[0]) {
    return {
      id: exactRows[0].id,
      slug: exactRows[0].slug,
      canonicalName: exactRows[0].canonicalName,
      matchedOn: 'exact',
      similarity: 1,
    };
  }

  // For 2-4, scan the character table for this network only. At low
  // cardinality this is fine; at 100k+ rows we'd want a trigram index.
  const allRows = await db
    .select({
      id: characters.id,
      slug: characters.slug,
      canonicalName: characters.canonicalName,
      normalizedName: characters.normalizedName,
      aliases: characters.aliases,
    })
    .from(characters)
    .where(eq(characters.network, network));

  // 4. Alias dictionary check (cheap, do first to short-circuit).
  const candidateLower = candidateCanonicalName.trim().toLowerCase();
  for (const row of allRows) {
    const all = [row.canonicalName.toLowerCase(), ...row.aliases.map((a) => a.toLowerCase())];
    if (all.includes(candidateLower)) {
      return {
        id: row.id,
        slug: row.slug,
        canonicalName: row.canonicalName,
        matchedOn: 'alias',
      };
    }
    // Also check the curated alias dictionary in either direction.
    const dictAliases = ALIAS_DICTIONARY[row.canonicalName.toLowerCase()] ?? [];
    if (dictAliases.includes(candidateLower)) {
      return {
        id: row.id,
        slug: row.slug,
        canonicalName: row.canonicalName,
        matchedOn: 'alias',
      };
    }
  }

  // 2. Token-set similarity.
  for (const row of allRows) {
    const sim = jaccard(candidateTokens, tokenize(row.canonicalName));
    if (sim >= 0.85) {
      return {
        id: row.id,
        slug: row.slug,
        canonicalName: row.canonicalName,
        matchedOn: 'token_set',
        similarity: sim,
      };
    }
  }

  // 3. Levenshtein guard for typos / minor variants.
  for (const row of allRows) {
    const a = normalized;
    const b = row.normalizedName;
    if (a.length === 0 || b.length === 0) continue;
    const ratio = a.length / b.length;
    if (ratio < 0.8 || ratio > 1.25) continue;
    const aFirst = candidateTokens[0];
    const bFirst = tokenize(row.canonicalName)[0];
    if (!aFirst || !bFirst || aFirst !== bFirst) continue;
    const dist = levenshtein(a, b);
    if (dist <= 2) {
      return {
        id: row.id,
        slug: row.slug,
        canonicalName: row.canonicalName,
        matchedOn: 'levenshtein',
        similarity: 1 - dist / Math.max(a.length, b.length),
      };
    }
  }

  return null;
}
