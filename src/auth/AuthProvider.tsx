import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { AuthState } from './types';
import { AuthContext } from './AuthContext';
import {
  isGoogleAuthConfigured,
  loadGsiScript,
  requestGoogleAccessToken,
  fetchUserProfile,
  revokeGoogleToken,
} from './googleAuth';

const initialAuthState: AuthState = {
  status: 'unauthenticated',
  user: null,
  accessToken: null,
  expiresAt: null,
  error: null,
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>(initialAuthState);
  const expirationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signInSeqRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const isConfigured = isGoogleAuthConfigured();

  // Track mount status and clear timer on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      signInSeqRef.current += 1; // Invalidate any in-flight sign-in
      if (expirationTimerRef.current) {
        clearTimeout(expirationTimerRef.current);
        expirationTimerRef.current = null;
      }
    };
  }, []);

  // Preload Google Identity Services script if configured
  useEffect(() => {
    if (isConfigured) {
      loadGsiScript().catch((err) => {
        console.warn('GIS prefetch error:', err instanceof Error ? err.message : err);
      });
    }
  }, [isConfigured]);

  const signOut = useCallback(async () => {
    // Invalidate any in-flight sign-in operation immediately
    signInSeqRef.current += 1;

    if (expirationTimerRef.current) {
      clearTimeout(expirationTimerRef.current);
      expirationTimerRef.current = null;
    }

    const tokenToRevoke = state.accessToken;

    // Immediately clear all auth state to unauthenticated
    setState({
      status: 'unauthenticated',
      user: null,
      accessToken: null,
      expiresAt: null,
      error: null,
    });

    if (tokenToRevoke) {
      await revokeGoogleToken(tokenToRevoke);
    }
  }, [state.accessToken]);

  const signIn = useCallback(async () => {
    if (!isConfigured) {
      setState({
        status: 'error',
        user: null,
        accessToken: null,
        expiresAt: null,
        error: 'Google OAuth Client ID is not configured. Add VITE_GOOGLE_CLIENT_ID to .env.local',
      });
      return;
    }

    // Sequence ID for this sign-in attempt
    const requestId = ++signInSeqRef.current;

    setState({
      status: 'authenticating',
      user: null,
      accessToken: null,
      expiresAt: null,
      error: null,
    });

    let acquiredToken: string | null = null;

    try {
      const response = await requestGoogleAccessToken('consent');

      // Cancellation check: provider unmounted or sign-out / newer sign-in started
      if (!isMountedRef.current || requestId !== signInSeqRef.current) {
        if (response.access_token) {
          revokeGoogleToken(response.access_token).catch(() => {});
        }
        return;
      }

      acquiredToken = response.access_token;
      const now = Date.now();
      const expiresAt = now + (response.expires_in || 3600) * 1000;

      // Fetch user profile (fails closed if non-OK, invalid, or unusable)
      const user = await fetchUserProfile(response.access_token);

      // Cancellation check: provider unmounted or sign-out / newer sign-in started during profile fetch
      if (!isMountedRef.current || requestId !== signInSeqRef.current) {
        revokeGoogleToken(response.access_token).catch(() => {});
        return;
      }

      setState({
        status: 'authenticated',
        user,
        accessToken: response.access_token,
        expiresAt,
        error: null,
      });

      // Schedule token expiration handler
      if (expirationTimerRef.current) {
        clearTimeout(expirationTimerRef.current);
      }
      const timeUntilExpiration = Math.max(1000, expiresAt - Date.now() - 60000); // 1 minute before expiry
      expirationTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current || requestId !== signInSeqRef.current) {
          return;
        }
        setState((prev) => {
          if (prev.status === 'authenticated') {
            return {
              ...prev,
              status: 'error',
              error: 'OAuth token has expired. Please sign in again.',
              accessToken: null,
            };
          }
          return prev;
        });
      }, timeUntilExpiration);
    } catch (err) {
      // If token was obtained before profile fetch failure or any other error, revoke it immediately
      if (acquiredToken) {
        revokeGoogleToken(acquiredToken).catch(() => {});
      }

      // Only update state if this request is still active and component is mounted
      if (isMountedRef.current && requestId === signInSeqRef.current) {
        setState({
          status: 'error',
          user: null,
          accessToken: null,
          expiresAt: null,
          error: err instanceof Error ? err.message : 'Authentication failed',
        });
      }
    }
  }, [isConfigured]);

  return (
    <AuthContext.Provider value={{ state, signIn, signOut, isConfigured }}>
      {children}
    </AuthContext.Provider>
  );
};
