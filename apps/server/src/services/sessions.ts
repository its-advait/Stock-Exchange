import crypto from 'node:crypto';
import type { Pool, Queryable } from '../db/pool.js';
import { unauthorized } from '../lib/errors.js';
import { USER_COLUMNS, type UserRow } from './accounts.js';
import { verifyAgainstDummy, verifyPassword } from './passwords.js';

export interface SessionPolicy {
  ttlHours: number;
  idleHours: number;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
  createdAt: Date;
  sessionId: string;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Returns the raw token (cookie value). Only its SHA-256 hash is stored. */
export async function createSession(
  q: Queryable,
  userId: string,
  policy: SessionPolicy,
  meta: { ip?: string; userAgent?: string },
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + policy.ttlHours * 3600_000);
  await q.query(`INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`, [
    id,
    userId,
    expiresAt,
    meta.ip ?? null,
    meta.userAgent?.slice(0, 300) ?? null,
  ]);
  return { token, sessionId: id, expiresAt };
}

export async function resolveSession(q: Queryable, token: string | undefined, policy: SessionPolicy): Promise<AuthenticatedUser | null> {
  if (!token || token.length > 200) return null;
  const id = hashToken(token);
  const r = await q.query<{
    id: string;
    username: string;
    role: 'USER' | 'ADMIN';
    created_at: Date;
    last_seen_at: Date;
  }>(
    `SELECT u.id, u.username, u.role, u.created_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        AND s.last_seen_at > now() - make_interval(hours => $2)
        AND u.status = 'ACTIVE' AND u.account_type = 'HUMAN'`,
    [id, policy.idleHours],
  );
  const row = r.rows[0];
  if (!row) return null;
  // Sliding idle timeout, throttled to one write per 5 minutes.
  if (Date.now() - row.last_seen_at.getTime() > 5 * 60_000) {
    await q.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [id]);
  }
  return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at, sessionId: id };
}

export async function revokeSession(q: Queryable, sessionId: string): Promise<void> {
  await q.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
}

export async function revokeAllSessions(q: Queryable, userId: string): Promise<void> {
  await q.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}

/** Verify credentials. Uniform error for unknown user / bad password / disabled account. */
export async function authenticate(pool: Pool, username: string, password: string): Promise<UserRow> {
  const r = await pool.query<UserRow & { password_hash: string | null }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE lower(username) = lower($1)`,
    [username],
  );
  const row = r.rows[0];
  if (!row || !row.password_hash) {
    await verifyAgainstDummy(password);
    throw unauthorized('Invalid username or password');
  }
  const ok = await verifyPassword(row.password_hash, password);
  if (!ok || row.status !== 'ACTIVE' || row.account_type !== 'HUMAN') throw unauthorized('Invalid username or password');
  await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [row.id]);
  const { password_hash: _ph, ...user } = row;
  return user;
}
