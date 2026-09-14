import type { TokenResponse, UserProfile } from './types';

export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_IDENTITY_SCOPES = 'openid email profile';
export const REQUIRED_SCOPES = `${GOOGLE_DRIVE_FILE_SCOPE} ${GOOGLE_IDENTITY_SCOPES}`;

const PLACEHOLDER_CLIENT_ID = 'your_google_client_id_here.apps.googleusercontent.com';

/**
 * Returns the configured Google OAuth Client ID or empty string if unconfigured.
 */
export function getGoogleClientId(): string {
  const raw = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed === PLACEHOLDER_CLIENT_ID || trimmed === '') return '';
  return trimmed;
}

/**
 * Checks if a real (non-placeholder) Google Client ID has been configured.
 */
export function isGoogleAuthConfigured(): boolean {
  return getGoogleClientId().length > 0;
}

let gsiScriptPromise: Promise<void> | null = null;

/**
 * Ensures Google Identity Services (GIS) script is loaded and initialized.
 */
export function loadGsiScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (gsiScriptPromise) {
    return gsiScriptPromise;
  }

  gsiScriptPromise = new Promise<void>((resolve, reject) => {
    // Check if script element already exists in DOM
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services script')));
      // Check if already ready
      if (window.google?.accounts?.oauth2) {
        resolve();
      }
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) {
        resolve();
      } else {
        // Poll for a brief moment in case oauth2 object is still initializing
        const interval = setInterval(() => {
          if (window.google?.accounts?.oauth2) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
        setTimeout(() => {
          clearInterval(interval);
          if (window.google?.accounts?.oauth2) {
            resolve();
          } else {
            reject(new Error('Google Identity Services SDK loaded but accounts.oauth2 is unavailable'));
          }
        }, 3000);
      }
    };
    script.onerror = () => {
      reject(new Error('Failed to load Google Identity Services SDK (blocked or network failure)'));
    };

    document.head.appendChild(script);
  });

  return gsiScriptPromise;
}

/**
 * Requests an OAuth 2.0 access token via GIS Token Client popup.
 * Token is returned to memory and never logged or persisted insecurely.
 */
export async function requestGoogleAccessToken(prompt: string = 'consent'): Promise<TokenResponse> {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('Google Client ID is not configured. Add VITE_GOOGLE_CLIENT_ID to .env.local');
  }

  await loadGsiScript();

  const google = window.google;
  if (!google?.accounts?.oauth2) {
    throw new Error('Google Identity Services SDK is not available');
  }

  return new Promise<TokenResponse>((resolve, reject) => {
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: REQUIRED_SCOPES,
        callback: (response: TokenResponse) => {
          if (response.error) {
            reject(new Error(`Google OAuth error: ${response.error_description || response.error}`));
            return;
          }
          if (!response.access_token) {
            reject(new Error('No access token received from Google'));
            return;
          }
          resolve(response);
        },
        error_callback: (error) => {
          reject(new Error(`Google OAuth request failed: ${error.message || error.type}`));
        },
      });

      client.requestAccessToken({ prompt });
    } catch (err) {
      reject(new Error(`Failed to initialize Google Token Client: ${err instanceof Error ? err.message : String(err)}`));
    }
  });
}

/**
 * Fetches basic user profile from Google's standard userinfo endpoint.
 * Fails closed if the response is non-OK, invalid, or fails.
 */
export async function fetchUserProfile(accessToken: string): Promise<UserProfile> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Userinfo request failed with status ${res.status}`);
    }

    const data = await res.json();
    if (!data || typeof data !== 'object') {
      throw new Error('Userinfo response is invalid');
    }

    const id = (data as { sub?: unknown; id?: unknown }).sub || (data as { sub?: unknown; id?: unknown }).id;
    if (!id || typeof id !== 'string') {
      throw new Error('Userinfo response missing unique identifier');
    }

    const profileData = data as { name?: unknown; email?: unknown; picture?: unknown };
    const name = typeof profileData.name === 'string' && profileData.name.trim()
      ? profileData.name.trim()
      : typeof profileData.email === 'string' && profileData.email.trim()
      ? profileData.email.trim()
      : 'Google User';
    const email = typeof profileData.email === 'string' ? profileData.email.trim() : '';
    const picture = typeof profileData.picture === 'string' && profileData.picture.trim()
      ? profileData.picture.trim()
      : undefined;

    return {
      id,
      name,
      email,
      picture,
    };
  } catch {
    throw new Error('Failed to retrieve Google account information. Please try again.');
  }
}

/**
 * Revokes the Google OAuth access token.
 */
export function revokeGoogleToken(accessToken: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!accessToken || !window.google?.accounts?.oauth2?.revoke) {
      resolve();
      return;
    }
    try {
      window.google.accounts.oauth2.revoke(accessToken, () => {
        resolve();
      });
    } catch {
      resolve();
    }
  });
}
