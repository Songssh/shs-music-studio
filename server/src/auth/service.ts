import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins/admin';
import { getMigrations } from 'better-auth/db/migration';
import { SqliteDialect } from 'kysely';
import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareIdentitySchema } from './migration.js';
import { migrateOwnership } from './dataMigration.js';

export interface AuthOptions { db: Database.Database; dataDir: string; baseURL: string; secret?: string; allowHttpLoopback?: boolean; workerToken?:string }
type IdentityAuth = Pick<ReturnType<typeof betterAuth>, 'handler' | 'api'> & { api: {
  setUserPassword(args:{headers:Headers;body:{userId:string;newPassword:string}}):Promise<unknown>;
  revokeUserSessions(args:{headers:Headers;body:{userId:string}}):Promise<unknown>;
} };
export interface IdentityService { auth:IdentityAuth; db:Database.Database; authDir:string; setupFile:string; origin:string; workerToken?:string }
export async function createIdentityService(options: AuthOptions): Promise<IdentityService> {
  const url = new URL(options.baseURL);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(options.allowHttpLoopback && loopback)) {
    throw new Error('Authentication requires HTTPS; HTTP is only allowed for explicit loopback development');
  }
  const authDir = path.join(options.dataDir, 'auth-private');
  fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
  const secretFile = path.join(authDir, 'session-secret');
  if (!options.secret && !fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(48).toString('base64url'), { flag: 'wx', mode: 0o600 });
  const secret = options.secret ?? fs.readFileSync(secretFile, 'utf8').trim();
  if (secret.length < 32) throw new Error('Authentication secret must contain at least 32 characters');
  prepareIdentitySchema(options.db);
  migrateOwnership(options.db,options.dataDir);
  const auth = betterAuth({
    appName: 'HOT-Step', baseURL: options.baseURL, basePath: '/api/auth', secret,
    database: { dialect: new SqliteDialect({ database: options.db }), type: 'sqlite', transaction: true },
    trustedOrigins: [url.origin],
    user: { modelName: 'users', fields: { name: 'username', image: 'avatar_url', createdAt: 'auth_created_at', updatedAt: 'auth_updated_at' } },
    session: { modelName: 'auth_sessions', expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    account: { modelName: 'auth_accounts' }, verification: { modelName: 'auth_verifications' },
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, autoSignIn: true },
    plugins: [admin({ defaultRole: 'user', adminRoles: ['admin'] })],
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60,
      customRules: { '/sign-in/email': { window: 60, max: 5 } } },
    advanced: { useSecureCookies: url.protocol === 'https:',
      ipAddress: { ipAddressHeaders: ['x-hotstep-client-ip'] },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:' } },
    logger: { disabled: true }, telemetry: { enabled: false },
  });
  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
  const setupFile = path.join(authDir, 'bootstrap-token');
  const state = options.db.prepare('SELECT bootstrap_complete FROM registration_settings WHERE id=1').get() as {bootstrap_complete: number};
  if (!state.bootstrap_complete && !fs.existsSync(setupFile)) fs.writeFileSync(setupFile, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  return { auth:auth as IdentityAuth, db: options.db, authDir, setupFile, origin: url.origin, workerToken:options.workerToken };
}
