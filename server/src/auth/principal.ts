import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';

export interface Principal { id: string; role: 'admin' | 'user'; sessionId: string }
export const principalContext = new AsyncLocalStorage<Principal>();
export function principalOf(req?: Request): Principal | undefined {
  return req ? (req as Request & { principal?: Principal }).principal : principalContext.getStore();
}
export function ownerId(): string {
  const principal = principalContext.getStore();
  if (!principal) throw new Error('Authenticated owner context required');
  return principal.id;
}
