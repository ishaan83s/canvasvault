import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export interface GoogleSignInButtonProps {
  onSignOutRequest?: () => void;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({ onSignOutRequest }) => {
  const { state, signIn, signOut, isConfigured } = useAuth();
  const [showConfigHelp, setShowConfigHelp] = useState(false);

  const handleSignInClick = () => {
    if (!isConfigured) {
      setShowConfigHelp(true);
      return;
    }
    signIn();
  };

  if (state.status === 'authenticated' && state.user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {state.user.picture ? (
          <img
            src={state.user.picture}
            alt={state.user.name}
            style={{ width: '24px', height: '24px', borderRadius: '50%', border: '1px solid #cbd5e1' }}
          />
        ) : (
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            {state.user.name.charAt(0).toUpperCase()}
          </div>
        )}

        <span style={{ fontSize: '12px', fontWeight: 500, color: '#334155' }}>
          {state.user.name}
        </span>

        <button
          onClick={() => {
            if (onSignOutRequest) {
              onSignOutRequest();
            } else {
              signOut();
            }
          }}
          title="Sign out of Google"
          style={{
            fontSize: '11px',
            padding: '3px 8px',
            borderRadius: '4px',
            border: '1px solid #cbd5e1',
            backgroundColor: '#ffffff',
            color: '#64748b',
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={handleSignInClick}
        disabled={state.status === 'authenticating'}
        title={isConfigured ? 'Sign in with Google' : 'Google OAuth is not configured'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          fontSize: '12px',
          fontWeight: 500,
          color: '#3c4043',
          backgroundColor: '#ffffff',
          border: '1px solid #dadce0',
          borderRadius: '4px',
          cursor: state.status === 'authenticating' ? 'wait' : 'pointer',
          transition: 'background-color 0.15s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafd')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
      >
        {/* Google G Logo */}
        <svg width="14" height="14" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.04 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
          />
        </svg>

        <span>{state.status === 'authenticating' ? 'Signing in...' : 'Sign in with Google'}</span>
      </button>

      {/* Help Modal when Client ID is missing */}
      {showConfigHelp && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowConfigHelp(false)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              padding: '20px 24px',
              borderRadius: '8px',
              maxWidth: '440px',
              width: '90%',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: '#0f172a' }}>
              Google OAuth Setup
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#475569', lineHeight: '1.5' }}>
              To connect your own Google account, configure your Google Cloud OAuth 2.0 Web Client ID:
            </p>
            <ol style={{ margin: '0 0 16px', paddingLeft: '20px', fontSize: '13px', color: '#334155', lineHeight: '1.6' }}>
              <li>Create an OAuth 2.0 Web Client ID in Google Cloud Console.</li>
              <li>Add <code>http://localhost:5173</code> to Authorized JavaScript Origins.</li>
              <li>Create a <code>.env.local</code> file in the project root:</li>
            </ol>
            <pre
              style={{
                backgroundColor: '#f1f5f9',
                padding: '8px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                fontFamily: 'monospace',
                overflowX: 'auto',
                marginBottom: '16px',
              }}
            >
              VITE_GOOGLE_CLIENT_ID=your_id.apps.googleusercontent.com
            </pre>
            <div style={{ textAlign: 'right' }}>
              <button
                onClick={() => setShowConfigHelp(false)}
                style={{
                  padding: '6px 14px',
                  fontSize: '13px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GoogleSignInButton;
