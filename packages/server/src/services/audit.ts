import { auditLogs, type DbExecutor } from '@vms/db';
import type { Principal } from '../auth/principal';

export type Actor = { type: 'user'; userId: string } | { type: 'visitor'; visitorId: string } | { type: 'system' };

export function actorOf(principal: Principal | null | undefined): Actor {
  if (!principal) return { type: 'system' };
  if (principal.kind === 'staff') return { type: 'user', userId: principal.userId };
  if (principal.kind === 'visitor') return { type: 'visitor', visitorId: principal.visitorId };
  return { type: 'system' };
}

export interface AuditEntry {
  actor: Actor;
  action: string;
  entityType: 'visit' | 'visitor' | 'user' | 'gate' | 'villa' | 'settings' | 'session' | 'arrival';
  entityId?: string | null;
  /** Masked or non-identifying values only. */
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
  at: Date;
}

/** Appends an audit record inside the caller's transaction (the table is append-only at the database level). */
export async function audit(tx: DbExecutor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    occurredAt: entry.at,
    actorType: entry.actor.type,
    actorUserId: entry.actor.type === 'user' ? entry.actor.userId : null,
    actorVisitorId: entry.actor.type === 'visitor' ? entry.actor.visitorId : null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    ipHash: entry.ipHash ?? null,
  });
}
