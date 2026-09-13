import { useState, useMemo, useContext } from 'react';
import { AuthContext } from '../auth/AuthContext';
import type { DrawingStorage } from '../storage/types';
import type { StorageMode, AuthMode } from '../storage/storageMode';
import { resolveStorageMode } from '../storage/storageMode';
import { StorageCoordinator } from '../storage/storageCoordinator';

export interface UseStorageSelectionOptions {
  localStorage?: DrawingStorage;
  driveAdapterFactory?: (getToken: () => string | null) => DrawingStorage;
}

export interface UseStorageSelectionResult {
  storageMode: StorageMode;
  authMode: AuthMode;
  generation: number;
  activeStorage: DrawingStorage;
  driveAdapter: DrawingStorage | null;
  localStorage: DrawingStorage;
  latestTokenRef: { current: string | null };
}

/**
 * Hook providing authenticated storage selection foundation:
 * - Anonymous / Authenticated mode represented explicitly.
 * - Active storage is selected strictly by storageMode, not raw token values.
 * - Token refresh updates latestTokenRef synchronously without recreating the Drive adapter.
 * - Generation increments ONLY for actual backend transitions (local <-> drive).
 */
export function useStorageSelection(options: UseStorageSelectionOptions = {}): UseStorageSelectionResult {
  const auth = useContext(AuthContext);
  const isAuthenticated = auth?.state.status === 'authenticated' && !!auth.state.accessToken;
  const accessToken = auth?.state.accessToken ?? null;

  const [coordinator] = useState(
    () =>
      new StorageCoordinator({
        initialMode: resolveStorageMode(isAuthenticated),
        initialToken: accessToken,
        localStorage: options.localStorage,
        createDriveAdapter: options.driveAdapterFactory,
      })
  );

  // Synchronously update token and handle actual backend transitions
  coordinator.syncAuthState(isAuthenticated, accessToken);

  const tokenRefProxy = useMemo(
    () => ({
      get current() {
        return coordinator.getLatestToken();
      },
      set current(val: string | null) {
        coordinator.setToken(val);
      },
    }),
    [coordinator]
  );

  return {
    storageMode: coordinator.getStorageMode(),
    authMode: coordinator.getAuthMode(),
    generation: coordinator.getGeneration(),
    activeStorage: coordinator.getActiveStorage(),
    driveAdapter: coordinator.getDriveAdapter(),
    localStorage: coordinator.getLocalStorage(),
    latestTokenRef: tokenRefProxy,
  };
}
