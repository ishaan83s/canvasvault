export type StorageMode = 'local' | 'drive';

export type AuthMode = 'anonymous' | 'authenticated';

/**
 * Resolves the logical storage mode from authentication status.
 */
export function resolveStorageMode(isAuthenticated: boolean): StorageMode {
  return isAuthenticated ? 'drive' : 'local';
}

/**
 * Resolves the auth mode from authentication status.
 */
export function resolveAuthMode(isAuthenticated: boolean): AuthMode {
  return isAuthenticated ? 'authenticated' : 'anonymous';
}
