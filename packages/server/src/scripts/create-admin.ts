/**
 * Creates an administrator account from the command line (recommended first-administrator setup).
 *
 *   pnpm admin:create -- --username admin --name "مدير النظام"
 *
 * The password is read from a hidden prompt (entered twice). Without an interactive terminal,
 * a strong temporary password is generated, printed once, and must be changed at first sign-in.
 */
import { stdin, stdout } from 'node:process';
import readline from 'node:readline';
import { eq } from 'drizzle-orm';
import { users } from '@vms/db';
import { fullNameSchema, passwordSchema } from '@vms/shared';
import { loadRootEnv } from '../config';
import { createServerContext, inTransaction } from '../context';
import { generateTemporaryPassword, hashPassword } from '../crypto';
import { audit } from '../services/audit';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function promptHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  const rlAny = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  rlAny._writeToOutput = (s: string) => {
    if (!muted || s.includes(question)) rlAny.output.write(s);
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  loadRootEnv();
  const username = (arg('username') ?? 'admin').toLowerCase();
  const fullName = fullNameSchema.parse(arg('name') ?? 'مدير النظام الرئيسي');
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new Error('Invalid username (lowercase letters, digits, . _ -)');

  let password: string;
  let mustChange = false;
  if (stdin.isTTY) {
    password = await promptHidden('Password (min 10 chars, letters and digits): ');
    const confirm = await promptHidden('Confirm password: ');
    if (password !== confirm) throw new Error('Passwords do not match');
    const check = passwordSchema.safeParse(password);
    if (!check.success) throw new Error('Password must be at least 10 characters and contain letters and digits');
  } else {
    password = generateTemporaryPassword();
    mustChange = true;
  }

  const ctx = createServerContext();
  try {
    const [existing] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (existing) throw new Error(`User "${username}" already exists`);
    const passwordHash = await hashPassword(password);
    await inTransaction(ctx, async ({ tx, now }) => {
      const [created] = await tx
        .insert(users)
        .values({ username, fullName, role: 'admin', passwordHash, mustChangePassword: mustChange, createdAt: now, updatedAt: now })
        .returning();
      await audit(tx, { actor: { type: 'system' }, action: 'auth.first_admin_created', entityType: 'user', entityId: created!.id, metadata: { via: 'cli' }, at: now });
    });
    console.log(`✔ Administrator "${username}" created.`);
    if (mustChange) {
      console.log(`  Temporary password (shown once, must be changed at first sign-in): ${password}`);
    }
  } finally {
    await ctx.close();
  }
}

main().catch((err: Error) => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
