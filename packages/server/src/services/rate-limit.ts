import { createHash } from 'node:crypto';
import { and, eq, gte, count } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { chatSessions, messages } from '../db/schema.js';

/** SHA-256 hash of (ip + salt). Stored in chat_sessions.ip_hash. */
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${ip}:${salt}`).digest('hex');
}

export interface RateLimitConfig {
  perTenMin: number;
  perDay: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  reason?: 'ten_min' | 'day';
  resetMs?: number;
}

/**
 * Check rate-limit by counting recent user-role messages for the same IP-hash
 * across all of that IP's sessions for this character. Tally is cheap because
 * we have the (session_id, created_at) index and join against chat_sessions
 * filtered by ip_hash.
 */
export async function checkRateLimit(
  db: Db,
  characterId: string,
  ipHash: string,
  cfg: RateLimitConfig,
): Promise<RateLimitVerdict> {
  const now = Date.now();
  const tenMinAgo = new Date(now - 10 * 60 * 1000);
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  // Count user messages in the last 10 minutes belonging to sessions of
  // this (ipHash, characterId).
  const tenMinRows = await db
    .select({ c: count() })
    .from(messages)
    .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
    .where(
      and(
        eq(chatSessions.ipHash, ipHash),
        eq(chatSessions.characterId, characterId),
        eq(messages.role, 'user'),
        gte(messages.createdAt, tenMinAgo),
      ),
    );
  if ((tenMinRows[0]?.c ?? 0) >= cfg.perTenMin) {
    return { allowed: false, reason: 'ten_min', resetMs: 10 * 60 * 1000 };
  }

  const dayRows = await db
    .select({ c: count() })
    .from(messages)
    .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
    .where(
      and(
        eq(chatSessions.ipHash, ipHash),
        eq(chatSessions.characterId, characterId),
        eq(messages.role, 'user'),
        gte(messages.createdAt, dayAgo),
      ),
    );
  if ((dayRows[0]?.c ?? 0) >= cfg.perDay) {
    return { allowed: false, reason: 'day', resetMs: 24 * 60 * 60 * 1000 };
  }

  return { allowed: true };
}
