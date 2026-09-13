import React, { useState } from 'react';
import type { MigrationSummary } from '../storage/migrationService';

export interface StorageMigrationModalProps {
  isOpen: boolean;
  localDrawingCount: number;
  onImport: () => Promise<MigrationSummary>;
  onSkip: () => void;
  onClose: () => void;
}

export const StorageMigrationModal: React.FC<StorageMigrationModalProps> = ({
  isOpen,
  localDrawingCount,
  onImport,
  onSkip,
  onClose,
}) => {
  const [status, setStatus] = useState<'idle' | 'importing' | 'completed' | 'error'>('idle');
  const [summary, setSummary] = useState<MigrationSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const handleImport = async () => {
    setStatus('importing');
    setErrorMessage(null);
    try {
      const result = await onImport();
      setSummary(result);
      setStatus('completed');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Migration failed');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 8,
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
          maxWidth: 440,
          width: '100%',
          padding: 24,
          boxSizing: 'border-box',
          fontFamily: 'inherit',
        }}
      >
        {status === 'idle' && (
          <>
            <h2 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 600, color: '#1e293b' }}>
              Import Local Drawings to Google Drive?
            </h2>
            <p style={{ margin: '0 0 20px 0', fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
              You have {localDrawingCount} drawing{localDrawingCount === 1 ? '' : 's'} stored locally on this device.
              Would you like to copy them to your CanvasVault folder in Google Drive?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={onSkip}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  backgroundColor: 'transparent',
                  color: '#475569',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={handleImport}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Import drawings
              </button>
            </div>
          </>
        )}

        {status === 'importing' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <h2 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 600, color: '#1e293b' }}>
              Importing Drawings...
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#475569' }}>
              Uploading local drawings to your Google Drive. Please wait...
            </p>
          </div>
        )}

        {status === 'completed' && summary && (
          <>
            <h2 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 600, color: '#1e293b' }}>
              Migration Complete
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
              Successfully imported {summary.imported} drawing{summary.imported === 1 ? '' : 's'} to Google Drive.
              {summary.skipped > 0 && ` (${summary.skipped} already existed)`}
              {summary.failed > 0 && ` (${summary.failed} failed)`}
            </p>
            {summary.failed > 0 && (
              <p style={{ margin: '0 0 16px 0', fontSize: 13, color: '#b91c1c' }}>
                Drawings that failed to import remain safely preserved on this device.
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <h2 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 600, color: '#991b1b' }}>
              Migration Error
            </h2>
            <p style={{ margin: '0 0 20px 0', fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
              {errorMessage || 'An error occurred during migration.'} Your local drawings remain safe on this device.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={onSkip}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  backgroundColor: 'transparent',
                  color: '#475569',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleImport}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
