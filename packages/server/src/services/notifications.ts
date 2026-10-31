import { and, count, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { notifications, pushTokens, users, visitors, type DbExecutor } from '@vms/db';
import { renderNotificationText, type Locale, type NotificationType, type StaffRole } from '@vms/shared';
import type { Principal } from '../auth/principal';
import type { ServerContext, TxScope } from '../context';
import { paginate, toNotificationDTO } from '../dto';
import { publish } from '../realtime';

/** Notification parameters are limited to non-identifying values (request reference, villa number, record id). */
export interface NotificationParams {
  reference?: string;
  villa?: string;
  /** A gate entry / resident invitation the notification opens. */
  entry?: string;
}

interface Recipient {
  userId?: string;
  visitorId?: string;
  locale: Locale;
}

async function insertAndQueuePush(
  ctx: ServerContext,
  scope: TxScope,
  recipients: Recipient[],
  type: NotificationType,
  params: NotificationParams,
  visitId: string | null,
): Promise<void> {
  if (recipients.length === 0) return;
  const cleanParams: Record<string, string> = {
    ...(params.reference ? { reference: params.reference } : {}),
    ...(params.villa ? { villa: params.villa } : {}),
    ...(params.entry ? { entry: params.entry } : {}),
  };
  await scope.tx.insert(notifications).values(
    recipients.map((r) => ({
      recipientUserId: r.userId ?? null,
      recipientVisitorId: r.visitorId ?? null,
      type,
      params: cleanParams,
      visitId,
      createdAt: scope.now,
    })),
  );
  for (const r of recipients) {
    await publish(scope.tx, r.userId ? { t: 'notification', userId: r.userId } : { t: 'notification', visitorId: r.visitorId! });
  }
  if (!ctx.push.enabled) return;

  const userIds = recipients.flatMap((r) => (r.userId ? [r.userId] : []));
  const visitorIds = recipients.flatMap((r) => (r.visitorId ? [r.visitorId] : []));
  const localeByOwner = new Map(recipients.map((r) => [r.userId ?? r.visitorId!, r.locale]));
  scope.effects.push(async () => {
    const tokens = await ctx.db
      .select()
      .from(pushTokens)
      .where(
        or(
          userIds.length ? inArray(pushTokens.userId, userIds) : undefined,
          visitorIds.length ? inArray(pushTokens.visitorId, visitorIds) : undefined,
        ),
      );
    if (!tokens.length) return;
    const messages = tokens.map((t) => {
      const locale = localeByOwner.get(t.userId ?? t.visitorId!) ?? 'ar';
      const text = renderNotificationText(locale, type, cleanParams);
      return { to: t.token, title: text.title, body: text.body, data: { type, ...(visitId ? { visitId } : {}), ...(cleanParams.entry ? { entryId: cleanParams.entry } : {}) } };
    });
    const { invalidTokens } = await ctx.push.send(messages);
    if (invalidTokens.length) await ctx.db.delete(pushTokens).where(inArray(pushTokens.token, invalidTokens));
  });
}

export async function notifyStaff(
  ctx: ServerContext,
  scope: TxScope,
  roles: StaffRole[],
  type: NotificationType,
  params: NotificationParams,
  visitId: string | null,
): Promise<void> {
  const staff = await scope.tx
    .select({ id: users.id, locale: users.locale })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, roles)));
  await insertAndQueuePush(ctx, scope, staff.map((s) => ({ userId: s.id, locale: s.locale })), type, params, visitId);
}

export async function notifyVisitor(
  ctx: ServerContext,
  scope: TxScope,
  visitorId: string,
  type: NotificationType,
  params: NotificationParams,
  visitId: string,
): Promise<void> {
  const [v] = await scope.tx.select({ id: visitors.id, locale: visitors.locale }).from(visitors).where(eq(visitors.id, visitorId));
  if (v) await insertAndQueuePush(ctx, scope, [{ visitorId: v.id, locale: v.locale }], type, params, visitId);
}

function recipientFilter(principal: Principal) {
  if (principal.kind === 'staff') return eq(notifications.recipientUserId, principal.userId);
  if (principal.kind === 'visitor') return eq(notifications.recipientVisitorId, principal.visitorId);
  return null;
}

export async function listNotifications(db: DbExecutor, principal: Principal, page: number, pageSize: number) {
  const filter = recipientFilter(principal);
  if (!filter) return paginate([], 0, page, pageSize);
  const [totalRow] = await db.select({ n: count() }).from(notifications).where(filter);
  const rows = await db
    .select()
    .from(notifications)
    .where(filter)
    .orderBy(desc(notifications.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return paginate(rows.map(toNotificationDTO), Number(totalRow?.n ?? 0), page, pageSize);
}

export async function unreadCount(db: DbExecutor, principal: Principal): Promise<number> {
  const filter = recipientFilter(principal);
  if (!filter) return 0;
  const [row] = await db.select({ n: count() }).from(notifications).where(and(filter, isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}

export async function markRead(db: DbExecutor, principal: Principal, now: Date, id?: string): Promise<void> {
  const filter = recipientFilter(principal);
  if (!filter) return;
  const conditions = [filter, isNull(notifications.readAt)];
  if (id) conditions.push(eq(notifications.id, id));
  await db.update(notifications).set({ readAt: now }).where(and(...conditions));
}

export async function registerPushToken(db: DbExecutor, principal: Principal, token: string, platform: string, now: Date): Promise<void> {
  if (principal.kind === 'registrant' || principal.kind === 'resident') return;
  const owner = principal.kind === 'staff' ? { userId: principal.userId, visitorId: null } : { userId: null, visitorId: principal.visitorId };
  await db
    .insert(pushTokens)
    .values({ token, platform, ...owner, createdAt: now, lastSeenAt: now })
    .onConflictDoUpdate({ target: pushTokens.token, set: { ...owner, platform, lastSeenAt: now } });
}

export async function unregisterPushToken(db: DbExecutor, principal: Principal, token: string): Promise<void> {
  const owner = principal.kind === 'staff' ? eq(pushTokens.userId, principal.userId) : principal.kind === 'visitor' ? eq(pushTokens.visitorId, principal.visitorId) : null;
  if (!owner) return;
  await db.delete(pushTokens).where(and(eq(pushTokens.token, token), owner));
}
