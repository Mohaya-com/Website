import type { SessionInfoDTO } from '@vms/shared';
import { getServerContext } from '../context';
import { getSettings } from '../services/settings';
import { resolveSession, toSessionInfo } from './sessions';

/** Used by server-rendered layouts to guard routes and pre-render the right shell. */
export async function getSessionFromToken(token: string | null | undefined): Promise<SessionInfoDTO | null> {
  if (!token) return null;
  const ctx = getServerContext();
  const principal = await resolveSession(ctx, token);
  if (!principal) return null;
  const settings = await getSettings(ctx);
  return toSessionInfo(principal, ctx.clock.now(), settings.timezone);
}

export function sessionCookieName(): string {
  return getServerContext().config.cookieName;
}
