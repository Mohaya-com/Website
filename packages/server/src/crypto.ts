import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/** URL-safe random token (base64url, no padding). 32 bytes → 43 characters. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function hmacBase64Url(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Numeric one-time code with uniform distribution. */
export function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Random Crockford base32 string (no I, L, O, U) — readable over the phone or at the gate. */
export function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CROCKFORD[bytes[i]! % 32];
  return out;
}

/** Strong temporary password (letters, digits, symbols), shown once to the administrator. */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(14);
  let core = '';
  for (let i = 0; i < 14; i++) core += alphabet[bytes[i]! % alphabet.length];
  return `${core.slice(0, 5)}-${core.slice(5, 10)}-${core.slice(10)}${randomInt(10, 99)}`;
}

// ───────────────────────────── Secrets at rest (AES-256-GCM) ─────────────────────────────

function sealKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'vms-sealed-secret', purpose, 32));
}

/** Encrypts a credential for storage. The key is derived from a server secret and a purpose label. */
export function sealSecret(secret: string, purpose: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('base64url')}.${body.toString('base64url')}`;
}

/** Returns null when the value was sealed with another secret or has been altered. */
export function openSecret(secret: string, purpose: string, sealed: string): string | null {
  const [version, ivPart, bodyPart] = sealed.split('.');
  if (version !== 'v1' || !ivPart || !bodyPart) return null;
  try {
    const iv = Buffer.from(ivPart, 'base64url');
    const body = Buffer.from(bodyPart, 'base64url');
    if (iv.length !== 12 || body.length < 17) return null;
    const decipher = createDecipheriv('aes-256-gcm', sealKey(secret, purpose), iv);
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ───────────────────────────── Password hashing (scrypt) ─────────────────────────────

const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT_PARAMS;
  const key = await scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  const key = await scrypt(password.normalize('NFKC'), salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

let dummyHash: Promise<string> | null = null;
/** Spends the same work as a real verification so unknown usernames are not distinguishable by timing. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalization');
  await verifyPassword(password, await dummyHash);
}
