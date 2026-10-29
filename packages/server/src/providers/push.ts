import type { ServerConfig } from '../config';
import { describeError, logger } from '../logger';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Navigation data only (e.g. visit id). Never identity details. */
  data: Record<string, string>;
}

export interface PushProvider {
  readonly enabled: boolean;
  /** Returns tokens the service reported as no longer registered. */
  send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }>;
}

export class NoopPushProvider implements PushProvider {
  readonly enabled = false;
  async send(): Promise<{ invalidTokens: string[] }> {
    return { invalidTokens: [] };
  }
}

/** Expo Push Service. Requires the mobile app to be built with an EAS project id. */
export class ExpoPushProvider implements PushProvider {
  readonly enabled = true;
  constructor(private readonly accessToken: string | null) {}

  async send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }> {
    const invalidTokens: string[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(chunk.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: 'default', priority: 'high' }))),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          logger.warn('push.http_error', { status: res.status });
          continue;
        }
        const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
        json.data?.forEach((ticket, idx) => {
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') invalidTokens.push(chunk[idx]!.to);
        });
      } catch (err) {
        logger.warn('push.send_failed', describeError(err));
      }
    }
    return { invalidTokens };
  }
}

export function createPushProvider(config: ServerConfig): PushProvider {
  return config.push.provider === 'expo' ? new ExpoPushProvider(config.push.expoAccessToken) : new NoopPushProvider();
}
