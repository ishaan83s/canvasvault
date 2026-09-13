import React, { useState } from 'react';

export interface SignOutConfirmationModalProps {
  isOpen: boolean;
  onSaveAndSignOut: () => Promise<boolean>;
  onSignOutWithoutSaving: () => Promise<void>;
  onCancel: () => void;
  saveErrorMessage?: string | null;
}

export const SignOutConfirmationModal: React.FC<SignOutConfirmationModalProps> = ({
  isOpen,
  onSaveAndSignOut,
  onSignOutWithoutSaving,
  onCancel,
  saveErrorMessage,
}) => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [actionType, setActionType] = useState<'save' | 'discard' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const handleSaveAndSignOut = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setActionType('save');
    setLocalError(null);

    try {
      const success = await onSaveAndSignOut();
      if (!success) {
        setLocalError(saveErrorMessage || 'Failed to save drawing to Google Drive. You remain signed in.');
        setIsSubmitting(false);
        setActionType(null);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Save failed. You remain signed in.');
      setIsSubmitting(false);
      setActionType(null);
    }
  };

  const handleSignOutWithoutSaving = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setActionType('discard');
    try {
      await onSignOutWithoutSaving();
    } catch {
      setIsSubmitting(false);
      setActionType(null);
    }
  };

  const displayedError = localError || saveErrorMessage;

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
          maxWidth: 460,
          width: '100%',
          padding: 24,
          boxSizing: 'border-box',
          fontFamily: 'inherit',
        }}
      >
        <h2 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 600, color: '#1e293b' }}>
          Unsaved Changes in Google Drive
        </h2>
        <p style={{ margin: '0 0 16px 0', fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
          You have unsaved changes or an unconfirmed save in Google Drive. If you sign out without saving,
          these changes will be discarded from Google Drive and will not be automatically uploaded.
        </p>

        {displayedError && (
          <div
            style={{
              margin: '0 0 16px 0',
              padding: '10px 12px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              color: '#991b1b',
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {displayedError}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              backgroundColor: 'transparent',
              color: '#475569',
              fontSize: 13,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleSignOutWithoutSaving}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: '1px solid #f87171',
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              fontSize: 13,
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            {isSubmitting && actionType === 'discard' ? 'Signing out...' : 'Sign Out Without Saving'}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleSaveAndSignOut}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            {isSubmitting && actionType === 'save' ? 'Saving and signing out...' : 'Save and Sign Out'}
          </button>
        </div>
      </div>
    </div>
  );
};
