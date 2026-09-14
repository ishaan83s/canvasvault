import React, { useState } from 'react';
import { sanitizeErrorMessage } from '../storage/googleDriveErrors';

export type PendingSwitchAction =
  | { type: 'switch'; targetFileId: string; targetFileName?: string }
  | { type: 'new' };

export interface UnsavedSwitchModalProps {
  isOpen: boolean;
  currentFileName: string;
  pendingAction: PendingSwitchAction | null;
  onSaveAndProceed: () => Promise<boolean>;
  onDiscardAndProceed: () => void;
  onCancel: () => void;
  saveErrorMessage?: string | null;
}

export const UnsavedSwitchModal: React.FC<UnsavedSwitchModalProps> = ({
  isOpen,
  currentFileName,
  pendingAction,
  onSaveAndProceed,
  onDiscardAndProceed,
  onCancel,
  saveErrorMessage,
}) => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isOpen || !pendingAction) {
    return null;
  }

  const isNew = pendingAction.type === 'new';
  const targetLabel = isNew
    ? 'creating a new drawing'
    : pendingAction.targetFileName
    ? `switching to "${pendingAction.targetFileName}"`
    : 'switching to another drawing';

  const saveButtonLabel = isSubmitting
    ? 'Saving...'
    : isNew
    ? 'Save and Create'
    : 'Save and Switch';

  const discardButtonLabel = isNew ? 'Discard and Create' : 'Discard and Switch';

  const handleSaveAndProceed = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setLocalError(null);

    try {
      const success = await onSaveAndProceed();
      if (!success) {
        setLocalError(saveErrorMessage || 'Failed to save drawing. Active drawing preserved.');
        setIsSubmitting(false);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Save failed. Active drawing preserved.');
      setIsSubmitting(false);
    }
  };

  const handleDiscardAndProceed = () => {
    if (isSubmitting) return;
    onDiscardAndProceed();
  };

  const handleCancel = () => {
    if (isSubmitting) return;
    onCancel();
  };

  const rawError = localError || saveErrorMessage;
  const displayedError = rawError ? sanitizeErrorMessage(rawError) : null;

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
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          handleCancel();
        }
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 8,
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
          maxWidth: 480,
          width: '100%',
          padding: 24,
          boxSizing: 'border-box',
          fontFamily: 'inherit',
        }}
      >
        <h2 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 600, color: '#1e293b' }}>
          Unsaved Changes
        </h2>
        <p style={{ margin: '0 0 16px 0', fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
          You have unsaved changes in <strong>"{currentFileName}"</strong>. If you proceed with {targetLabel} without saving, your unsaved changes will be discarded.
        </p>

        {displayedError && (
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              color: '#991b1b',
              fontSize: 13,
              marginBottom: 16,
              lineHeight: 1.4,
            }}
          >
            <strong>Save failed:</strong> {displayedError}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              color: '#475569',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDiscardAndProceed}
            disabled={isSubmitting}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              backgroundColor: '#ffffff',
              border: '1px solid #fca5a5',
              borderRadius: 6,
              color: '#dc2626',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            {discardButtonLabel}
          </button>

          <button
            type="button"
            onClick={handleSaveAndProceed}
            disabled={isSubmitting}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: '#0284c7',
              border: 'none',
              borderRadius: 6,
              color: '#ffffff',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.8 : 1,
            }}
          >
            {saveButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UnsavedSwitchModal;
