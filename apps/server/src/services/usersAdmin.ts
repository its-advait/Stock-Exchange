import type { Pool } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { cancelOrder } from '../engine/matching.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { iso } from '../lib/json.js';
import { USER_COLUMNS, type UserRow } from './accounts.js';
import { hashPassword } from './passwords.js';
import { revokeAllSessions } from './sessions.js';

export function userView(u: UserRow) {
  return { id: u.id, username: u.username, role: u.role, accountType: u.account_type, status: u.status, createdAt: iso(u.created_at)! };
}

export async function listUsers(pool: Pool, limit: number, offset: number) {
  const r = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC, id LIMIT $1 OFFSET $2`, [limit, offset]);
  return r.rows.map(userView);
}

export async function updateUser(
  pool: Pool,
  actor: { adminId: string; ip?: string | null },
  userId: string,
  patch: { role?: 'USER' | 'ADMIN'; status?: 'ACTIVE' | 'DISABLED'; password?: string },
) {
  if (userId === actor.adminId && (patch.status === 'DISABLED' || patch.role === 'USER')) {
    throw badRequest('SELF_LOCKOUT', 'Admins cannot disable or demote themselves');
  }
  const passwordHash = patch.password ? await hashPassword(patch.password) : null;
  const user = await withTx(pool, async (c) => {
    const cur = await c.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND account_type = 'HUMAN' FOR UPDATE`, [userId]);
    if (!cur.rows[0]) throw notFound('User');
    const r = await c.query<UserRow>(
      `UPDATE users SET role = COALESCE($2, role), status = COALESCE($3, status), password_hash = COALESCE($4, password_hash)
        WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [userId, patch.role ?? null, patch.status ?? null, passwordHash],
    );
    if (patch.status === 'DISABLED' || patch.password) await revokeAllSessions(c, userId);
    await audit(c, {
      actorUserId: actor.adminId,
      action: 'USER_UPDATE',
      targetType: 'user',
      targetId: userId,
      details: { role: patch.role, status: patch.status, passwordReset: Boolean(patch.password) },
      ip: actor.ip,
    });
    return r.rows[0]!;
  });
  if (patch.status === 'DISABLED') {
    // Disabled accounts must not keep liquidity resting in the book.
    const open = await pool.query<{ id: string }>(`SELECT id FROM orders WHERE user_id = $1 AND status IN ('OPEN', 'PARTIALLY_FILLED')`, [userId]);
    for (const o of open.rows) {
      await cancelOrder(pool, { orderId: o.id, actorUserId: actor.adminId, actorIsAdmin: true, reason: 'ACCOUNT_DISABLED' }).catch(() => undefined);
    }
  }
  return userView(user);
}
