import type { Queryable } from '../db/pool.js';
import { toJson } from './json.js';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(c: Queryable, e: AuditEntry): Promise<void> {
  await c.query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, ip)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [e.actorUserId, e.action, e.targetType ?? null, e.targetId ?? null, toJson(e.details ?? {}), e.ip ?? null],
  );
}
