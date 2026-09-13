export interface UserProfile {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number; // in seconds
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

export type AuthStatus = 'unauthenticated' | 'authenticating' | 'authenticated' | 'error';

export interface AuthState {
  status: AuthStatus;
  user: UserProfile | null;
  accessToken: string | null;
  expiresAt: number | null; // epoch timestamp ms
  error: string | null;
}

export interface AuthContextType {
  state: AuthState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  isConfigured: boolean;
}

// Google Identity Services (GIS) global declarations
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type: string; message: string }) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
          };
          revoke: (accessToken: string, callback?: () => void) => void;
        };
      };
    };
  }
}
