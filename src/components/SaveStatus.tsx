import React from 'react';
import type { SaveStatus as StatusType } from '../storage/types';

interface SaveStatusProps {
  status: StatusType;
  lastSavedAt: Date | null;
  onRetry?: () => void;
}

export const SaveStatus: React.FC<SaveStatusProps> = ({ status, lastSavedAt, onRetry }) => {
  const formatTime = (date: Date | null) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  switch (status) {
    case 'saving':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#666' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#3b82f6', animation: 'pulse 1s infinite' }} />
          <span>Saving...</span>
        </div>
      );
    case 'dirty':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#d97706' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
          <span>Unsaved changes</span>
        </div>
      );
    case 'error':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#dc2626' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
          <span>Save failed</span>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                backgroundColor: '#fee2e2',
                border: '1px solid #fca5a5',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          )}
        </div>
      );
    case 'saved':
    default:
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#16a34a' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#22c55e' }} />
          <span>Saved {lastSavedAt ? `at ${formatTime(lastSavedAt)}` : ''}</span>
        </div>
      );
  }
};

export default SaveStatus;
