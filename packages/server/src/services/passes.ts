import { and, eq } from 'drizzle-orm';
import { visitPasses, type DbExecutor, type VisitPass } from '@vms/db';
import { buildPassQrValue, extractPassToken } from '@vms/shared';
import type { ServerContext } from '../context';
import { hmacBase64Url, randomToken, sha256Hex } from '../crypto';

/**
 * Pass tokens are 256-bit values derived as HMAC(PASS_TOKEN_SECRET, passId.nonce).
 * The database stores only SHA-256(token), so a database leak alone cannot produce valid passes,
 * while the server can still re-display the QR code to its owner. Rotating the secret invalidates all passes.
 */
export function derivePassToken(ctx: ServerContext, passId: string, nonce: string): string {
  return hmacBase64Url(ctx.config.passTokenSecret, `pass|${passId}|${nonce}`);
}

export async function issuePass(ctx: ServerContext, tx: DbExecutor, visitId: string, now: Date): Promise<VisitPass> {
  const id = crypto.randomUUID();
  const nonce = randomToken(16);
  const token = derivePassToken(ctx, id, nonce);
  const [pass] = await tx
    .insert(visitPasses)
    .values({ id, visitId, nonce, tokenHash: sha256Hex(token), status: 'active', issuedAt: now })
    .returning();
  return pass!;
}

export async function revokeActivePass(tx: DbExecutor, visitId: string, reason: string, now: Date): Promise<void> {
  await tx
    .update(visitPasses)
    .set({ status: 'revoked', revokedAt: now, revokeReason: reason })
    .where(and(eq(visitPasses.visitId, visitId), eq(visitPasses.status, 'active')));
}

export async function consumePass(tx: DbExecutor, passId: string, now: Date): Promise<void> {
  await tx.update(visitPasses).set({ status: 'consumed', consumedAt: now }).where(and(eq(visitPasses.id, passId), eq(visitPasses.status, 'active')));
}

export async function getActivePass(db: DbExecutor, visitId: string): Promise<VisitPass | null> {
  const [pass] = await db
    .select()
    .from(visitPasses)
    .where(and(eq(visitPasses.visitId, visitId), eq(visitPasses.status, 'active')))
    .limit(1);
  return pass ?? null;
}

export function passQrValue(ctx: ServerContext, pass: VisitPass): string {
  return buildPassQrValue(ctx.config.appOrigin, derivePassToken(ctx, pass.id, pass.nonce));
}

/** Resolves scanned QR content to a pass (in any status). Unknown or malformed values return null. */
export async function findPassByScan(db: DbExecutor, raw: string): Promise<VisitPass | null> {
  const token = extractPassToken(raw);
  if (!token) return null;
  const [pass] = await db.select().from(visitPasses).where(eq(visitPasses.tokenHash, sha256Hex(token))).limit(1);
  return pass ?? null;
}
