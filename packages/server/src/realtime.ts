import { EventEmitter } from 'node:events';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { DbExecutor } from '@vms/db';
import { describeError, logger } from './logger';

export const REALTIME_CHANNEL = 'vms_events';

/**
 * Change notifications fanned out to connected clients (Server-Sent Events).
 * Payloads carry identifiers only — clients re-fetch data through authorized endpoints.
 */
export type RealtimeEvent =
  | { t: 'visit'; visitId: string; visitorId: string; status: string }
  | { t: 'notification'; userId?: string; visitorId?: string }
  | { t: 'config' }
  | { t: 'arrival' }
  | { t: 'gate'; villaId?: string; /** Set when a visitor has just entered for this villa (their name, or empty). */ entered?: string }
  | { t: 'residents' }
  | { t: 'maintenance'; villaId?: string };

/** Queues a notification inside the current transaction. PostgreSQL delivers it only if the transaction commits. */
export async function publish(tx: DbExecutor, event: RealtimeEvent): Promise<void> {
  await tx.execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify(event)})`);
}

/** One LISTEN connection per server process, shared by all SSE subscribers. Works across multiple instances. */
export class RealtimeBus {
  private readonly emitter = new EventEmitter();
  private client: pg.Client | null = null;
  private starting: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly connectionString: string) {
    this.emitter.setMaxListeners(0);
  }

  subscribe(listener: (event: RealtimeEvent) => void): () => void {
    this.emitter.on('event', listener);
    void this.ensureStarted();
    return () => {
      this.emitter.off('event', listener);
    };
  }

  get listenerCount(): number {
    return this.emitter.listenerCount('event');
  }

  private ensureStarted(): Promise<void> {
    if (this.client || this.closed) return Promise.resolve();
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString, application_name: 'compound-vms-realtime' });
    client.on('notification', (msg) => {
      if (msg.channel !== REALTIME_CHANNEL || !msg.payload) return;
      try {
        this.emitter.emit('event', JSON.parse(msg.payload) as RealtimeEvent);
      } catch {
        // ignore malformed payloads
      }
    });
    const onFailure = (err?: Error) => {
      if (err) logger.warn('realtime.connection_lost', describeError(err));
      if (this.client === client) this.client = null;
      client.removeAllListeners();
      void client.end().catch(() => undefined);
      this.scheduleReconnect();
    };
    client.on('error', onFailure);
    client.on('end', () => onFailure());
    try {
      await client.connect();
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
      this.client = client;
    } catch (err) {
      onFailure(err as Error);
    }
  }

  private scheduleReconnect() {
    if (this.closed || this.retryTimer || this.listenerCount === 0) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.ensureStarted();
    }, 3000);
    this.retryTimer.unref?.();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const c = this.client;
    this.client = null;
    if (c) {
      c.removeAllListeners();
      await c.end().catch(() => undefined);
    }
  }
}
