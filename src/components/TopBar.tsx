import React, { useState } from 'react';
import { SaveStatus } from './SaveStatus';
import type { SaveStatus as StatusType } from '../storage/types';

interface TopBarProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  currentFileName: string;
  saveStatus: StatusType;
  lastSavedAt: Date | null;
  onSave: () => void;
  onNew: () => void;
  onRename: (newName: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  currentFileName,
  saveStatus,
  lastSavedAt,
  onSave,
  onNew,
  onRename,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(currentFileName);
  const [prevFileName, setPrevFileName] = useState(currentFileName);

  if (prevFileName !== currentFileName) {
    setPrevFileName(currentFileName);
    setNameInput(currentFileName);
  }

  const handleNameSubmit = () => {
    if (nameInput.trim() && nameInput.trim() !== currentFileName) {
      onRename(nameInput.trim());
    }
    setIsEditingName(false);
  };

  return (
    <header
      style={{
        height: '44px',
        minHeight: '44px',
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        userSelect: 'none',
        zIndex: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={onToggleSidebar}
          title={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          style={{
            background: 'none',
            border: '1px solid #cbd5e1',
            borderRadius: '4px',
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          ☰
        </button>

        <span style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>CanvasVault</span>

        <span
          style={{
            fontSize: '11px',
            padding: '2px 6px',
            borderRadius: '4px',
            backgroundColor: '#f1f5f9',
            color: '#64748b',
            fontWeight: 500,
            border: '1px solid #e2e8f0',
          }}
        >
          Test Storage: LocalStorage
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '6px' }}>
          {isEditingName ? (
            <input
              type="text"
              value={nameInput}
              autoFocus
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameSubmit();
                if (e.key === 'Escape') {
                  setNameInput(currentFileName);
                  setIsEditingName(false);
                }
              }}
              style={{
                fontSize: '13px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid #3b82f6',
              }}
            />
          ) : (
            <span
              onClick={() => setIsEditingName(true)}
              title="Click to rename"
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#334155',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid transparent',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#cbd5e1')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
            >
              {currentFileName} ✏️
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <SaveStatus status={saveStatus} lastSavedAt={lastSavedAt} onRetry={onSave} />

        <button
          onClick={onNew}
          style={{
            fontSize: '12px',
            padding: '4px 10px',
            borderRadius: '4px',
            border: '1px solid #cbd5e1',
            backgroundColor: '#ffffff',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          New
        </button>

        <button
          onClick={onSave}
          disabled={saveStatus === 'saving'}
          style={{
            fontSize: '12px',
            padding: '4px 12px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: saveStatus === 'dirty' ? '#0284c7' : '#e2e8f0',
            color: saveStatus === 'dirty' ? '#ffffff' : '#475569',
            cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          Save
        </button>
      </div>
    </header>
  );
};

export default TopBar;
