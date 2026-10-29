import { maskPhone, type DevOtpMessageDTO } from '@vms/shared';
import type { ServerConfig, SmsProviderName } from '../config';
import { describeError, logger } from '../logger';
import { sendAuthCode, type WhatsAppConnection } from './whatsapp';

export interface SmsMessage {
  to: string;
  body: string;
  /** The verification code: template-based channels (WhatsApp) and the /dev/otp page send it on its own. */
  code: string;
}

export interface SmsProvider {
  readonly name: SmsProviderName;
  /** Whether OTP sign-in can be offered at all. */
  readonly available: boolean;
  /** True for the development provider: nothing is actually delivered. */
  readonly isDevelopment: boolean;
  send(message: SmsMessage): Promise<void>;
}

/**
 * DEVELOPMENT ONLY. Does not send SMS. Codes are printed to the server log and kept in memory
 * for the /dev/otp page. The configuration loader refuses this provider when NODE_ENV=production,
 * and the factory below refuses it again as a second guard.
 */
export class DevSmsProvider implements SmsProvider {
  readonly name = 'dev' as const;
  readonly available = true;
  readonly isDevelopment = true;
  readonly outbox: DevOtpMessageDTO[] = [];

  async send(message: SmsMessage): Promise<void> {
    const entry: DevOtpMessageDTO = { to: maskPhone(message.to), code: message.code, createdAt: new Date().toISOString() };
    this.outbox.unshift(entry);
    this.outbox.length = Math.min(this.outbox.length, 50);
    // eslint-disable-next-line no-console
    console.log(`\n[DEV SMS — NOT SENT] to ${entry.to}: verification code ${entry.code}\n`);
  }
}

export class DisabledSmsProvider implements SmsProvider {
  readonly name = 'disabled' as const;
  readonly available = false;
  readonly isDevelopment = false;
  async send(): Promise<void> {
    throw new Error('SMS provider is disabled');
  }
}

/** Twilio Programmable Messaging (REST API). Requires real credentials; delivery is not verified by this code. */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio' as const;
  readonly available = true;
  readonly isDevelopment = false;
  constructor(private readonly cfg: ServerConfig['sms']['twilio']) {}

  async send(message: SmsMessage): Promise<void> {
    const params = new URLSearchParams({ To: message.to, Body: message.body });
    if (this.cfg.messagingServiceSid) params.set('MessagingServiceSid', this.cfg.messagingServiceSid);
    else params.set('From', this.cfg.from);
    const auth = Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Do not log the response body: it echoes the destination number.
      throw new Error(`Twilio responded with HTTP ${res.status}`);
    }
  }
}

/** WhatsApp Cloud API (Meta) with an approved authentication template. Delivery is not verified by this code. */
export class WhatsAppCloudProvider implements SmsProvider {
  readonly name = 'whatsapp' as const;
  readonly available = true;
  readonly isDevelopment = false;
  constructor(
    private readonly conn: WhatsAppConnection,
    private readonly hooks: { onSent?(): void; onFailed?(err: unknown): void } = {},
  ) {}

  async send(message: SmsMessage): Promise<void> {
    try {
      await sendAuthCode(this.conn, message.to, message.code);
    } catch (err) {
      this.hooks.onFailed?.(err);
      throw err;
    }
    this.hooks.onSent?.();
  }
}

export function createSmsProvider(config: ServerConfig): SmsProvider {
  switch (config.sms.provider) {
    case 'dev':
      if (config.isProduction) throw new Error('The development SMS provider cannot be used in production');
      return new DevSmsProvider();
    case 'twilio':
      return new TwilioSmsProvider(config.sms.twilio);
    case 'whatsapp':
      return new WhatsAppCloudProvider(config.sms.whatsapp);
    default:
      return new DisabledSmsProvider();
  }
}

/** Sends without blocking the response so that timing does not reveal whether a code was dispatched. */
export function sendInBackground(provider: SmsProvider, message: SmsMessage): void {
  void provider.send(message).catch((err) => logger.error('sms.send_failed', { provider: provider.name, ...describeError(err) }));
}
