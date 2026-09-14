import type { DrawingStorage } from './types';
import type { StorageMode, AuthMode } from './storageMode';
import { resolveStorageMode, resolveAuthMode } from './storageMode';
import { GoogleDriveAdapter } from './googleDriveAdapter';
import { testLocalStorageAdapter } from './localStorageAdapter';

export interface StorageCoordinatorOptions {
  initialMode?: StorageMode;
  initialToken?: string | null;
  localStorage?: DrawingStorage;
  createDriveAdapter?: (getToken: () => string | null) => DrawingStorage;
}

/**
 * StorageCoordinator establishes the authenticated storage selection foundation:
 * 1. Tracks storage mode ('local' | 'drive') and auth mode ('anonymous' | 'authenticated') explicitly.
 * 2. Active storage is selected strictly by storageMode, never by raw access-token presence.
 * 3. Latest-token ref pattern ensures Drive adapter always reads the current token dynamically.
 * 4. Token updates / refreshes do NOT recreate the Drive adapter (maintains stable identity).
 * 5. Generation increments ONLY for actual backend transitions (local <-> drive), never on token refresh.
 */
export class StorageCoordinator {
  private mode: StorageMode;
  private authMode: AuthMode;
  private generation: number = 0;
  private latestTokenRef: { current: string | null };
  private driveAdapter: DrawingStorage | null = null;
  private localStorage: DrawingStorage;
  private createDriveAdapterFn: (getToken: () => string | null) => DrawingStorage;

  constructor(options: StorageCoordinatorOptions = {}) {
    this.latestTokenRef = { current: options.initialToken ?? null };
    this.mode = options.initialMode ?? 'local';
    this.authMode = this.mode === 'drive' ? 'authenticated' : 'anonymous';
    this.localStorage = options.localStorage ?? testLocalStorageAdapter;
    this.createDriveAdapterFn =
      options.createDriveAdapter ??
      ((getToken) => new GoogleDriveAdapter({ getToken }));

    if (this.mode === 'drive') {
      this.driveAdapter = this.createDriveAdapterFn(() => this.latestTokenRef.current ?? null);
    }
  }

  getStorageMode(): StorageMode {
    return this.mode;
  }

  getAuthMode(): AuthMode {
    return this.authMode;
  }

  getGeneration(): number {
    return this.generation;
  }

  getLatestToken(): string | null {
    return this.latestTokenRef.current;
  }

  getDriveAdapter(): DrawingStorage | null {
    return this.driveAdapter;
  }

  getLocalStorage(): DrawingStorage {
    return this.localStorage;
  }

  /**
   * Active storage is selected strictly by storageMode, NOT by raw access-token presence.
   */
  getActiveStorage(): DrawingStorage {
    if (this.mode === 'drive') {
      if (!this.driveAdapter) {
        this.driveAdapter = this.createDriveAdapterFn(() => this.latestTokenRef.current ?? null);
      }
      return this.driveAdapter;
    }
    return this.localStorage;
  }

  /**
   * Updates the auth token in the latestTokenRef synchronously.
   * Token refresh must NOT recreate the Drive adapter.
   * Token refresh must NOT increment the storage generation.
   */
  setToken(token: string | null): void {
    this.latestTokenRef.current = token;
  }

  /**
   * Transitions storage mode.
   * Generation increments ONLY when an actual backend transition occurs (local <-> drive).
   * Redundant mode calls do NOT increment generation.
   */
  setStorageMode(nextMode: StorageMode): boolean {
    if (nextMode === this.mode) {
      return false;
    }

    this.mode = nextMode;
    this.authMode = resolveAuthMode(nextMode === 'drive');
    this.generation += 1;

    // Maintain stable adapter creation when transitioning into drive
    if (nextMode === 'drive' && !this.driveAdapter) {
      this.driveAdapter = this.createDriveAdapterFn(() => this.latestTokenRef.current ?? null);
    }

    return true;
  }

  /**
   * Helper to synchronize with auth status and token.
   * Synchronously updates token, then applies storage mode transition if required.
   */
  syncAuthState(isAuthenticated: boolean, token: string | null): { modeChanged: boolean; generation: number } {
    this.setToken(token);
    const nextMode = resolveStorageMode(isAuthenticated);
    const modeChanged = this.setStorageMode(nextMode);
    return {
      modeChanged,
      generation: this.generation,
    };
  }
}
