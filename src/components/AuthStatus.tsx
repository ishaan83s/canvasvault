import React from 'react';
import { useAuth } from '../auth/AuthContext';

export const AuthStatus: React.FC = () => {
  const { state, isConfigured } = useAuth();

  if (!isConfigured) {
    return (
      <span
        title="To connect Google Drive, add VITE_GOOGLE_CLIENT_ID to .env.local"
        style={{
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '12px',
          backgroundColor: '#f1f5f9',
          color: '#64748b',
          border: '1px solid #e2e8f0',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
        }}
      >
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#94a3b8' }} />
        Google Auth: Not Configured
      </span>
    );
  }

  switch (state.status) {
    case 'authenticated':
      return (
        <span
          title={`Signed in as ${state.user?.email || state.user?.name || 'Google User'}`}
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '12px',
            backgroundColor: '#f0fdf4',
            color: '#166534',
            border: '1px solid #bbf7d0',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#22c55e' }} />
          Connected: {state.user?.name || 'Google User'}
        </span>
      );

    case 'authenticating':
      return (
        <span
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '12px',
            backgroundColor: '#eff6ff',
            color: '#1d4ed8',
            border: '1px solid #bfdbfe',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#3b82f6', animation: 'pulse 1s infinite' }} />
          Connecting...
        </span>
      );

    case 'error':
      return (
        <span
          title={state.error || 'Authentication error'}
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '12px',
            backgroundColor: '#fef2f2',
            color: '#991b1b',
            border: '1px solid #fecaca',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
          Auth Error
        </span>
      );

    case 'unauthenticated':
    default:
      return (
        <span
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '12px',
            backgroundColor: '#f8fafc',
            color: '#64748b',
            border: '1px solid #e2e8f0',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#94a3b8' }} />
          Not connected
        </span>
      );
  }
};

export default AuthStatus;
