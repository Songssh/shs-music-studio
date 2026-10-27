// Every personal browser store is bound before the music application is imported.
let owner: string | null = null;
let adoptLegacy = false;
const prefix = () => owner ? `hotstep:user:${encodeURIComponent(owner)}:` : null;
export function bindUserStorage(id: string, legacyOwner = false) {
  if (owner && owner !== id) throw new Error('Account changes require a document reload');
  owner = id; adoptLegacy = legacyOwner;
}
export function userDatabaseName(name: string): string {
  if (!owner) throw new Error('Sign in before opening personal databases');
  // Only the original owner may read the original queue database. It stays intact.
  return adoptLegacy ? name : `${prefix()}${name}`;
}
export function userStorageKeys(): string[] {
  if (!prefix()) return [];
  const keys = Object.keys(globalThis.localStorage);
  return [...new Set(keys.flatMap(k => k.startsWith(prefix()!) ? [k.slice(prefix()!.length)]
    : adoptLegacy && !k.startsWith('hotstep:') ? [k] : []))].filter(k=>!k.startsWith('__removed:') && !globalThis.localStorage.getItem(prefix()!+'__removed:'+k));
}
export const userStorage: Storage = {
  get length() { return userStorageKeys().length; },
  key(index) { return userStorageKeys()[index] ?? null; },
  getItem(key) {
    const p = prefix(); if (!p) return null;
    const value = globalThis.localStorage.getItem(p + key);
    if (value !== null || !adoptLegacy) return value;
    const legacy = globalThis.localStorage.getItem(key);
    // Copy once, preserving the original for rollback. A tombstone prevents reimport after removal.
    if (globalThis.localStorage.getItem(p + '__removed:' + key)) return null;
    if (legacy !== null) globalThis.localStorage.setItem(p + key, legacy);
    return legacy;
  },
  setItem(key, value) { const p = prefix(); if (!p) return; globalThis.localStorage.setItem(p + key, value); globalThis.localStorage.removeItem(p + '__removed:' + key); },
  removeItem(key) { const p = prefix(); if (!p) return; globalThis.localStorage.removeItem(p + key); if (adoptLegacy) globalThis.localStorage.setItem(p + '__removed:' + key, '1'); },
  clear() { for (const key of userStorageKeys()) this.removeItem(key); },
};

export const userSessionStorage={
 getItem(key:string){const p=prefix();return p?globalThis.sessionStorage.getItem(p+key):null;},
 setItem(key:string,value:string){const p=prefix();if(p)globalThis.sessionStorage.setItem(p+key,value);},
 removeItem(key:string){const p=prefix();if(p)globalThis.sessionStorage.removeItem(p+key);},
};
