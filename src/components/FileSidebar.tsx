import React, { useState } from 'react';
import type { DrawingFile } from '../storage/types';
import { stripExcalidrawExtension } from '../utils/excalidrawSerialization';

interface FileSidebarProps {
  isOpen: boolean;
  files: DrawingFile[];
  currentFileId: string | null;
  onSelectFile: (fileId: string) => void;
  onNewFile: () => void;
  onRenameFile: (fileId: string, newName: string) => void;
  onDeleteFile: (fileId: string) => void;
}

export const FileSidebar: React.FC<FileSidebarProps> = ({
  isOpen,
  files,
  currentFileId,
  onSelectFile,
  onNewFile,
  onRenameFile,
  onDeleteFile,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const startRename = (file: DrawingFile, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(file.id);
    setEditName(stripExcalidrawExtension(file.name));
  };

  const submitRename = (fileId: string) => {
    if (editName.trim()) {
      onRenameFile(fileId, editName.trim());
    }
    setEditingId(null);
  };

  const handleDelete = (file: DrawingFile, e: React.MouseEvent) => {
    e.stopPropagation();
    const displayName = stripExcalidrawExtension(file.name);
    if (window.confirm(`Are you sure you want to delete "${displayName}"?`)) {
      onDeleteFile(file.id);
    }
  };

  return (
    <aside
      style={{
        width: isOpen ? '260px' : '0px',
        minWidth: isOpen ? '260px' : '0px',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
        borderRight: isOpen ? '1px solid #e2e8f0' : 'none',
        backgroundColor: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        zIndex: 10,
      }}
    >
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: '14px', color: '#334155' }}>My Drawings</span>
        <button
          onClick={onNewFile}
          title="New drawing"
          style={{
            fontSize: '12px',
            fontWeight: 500,
            padding: '4px 8px',
            backgroundColor: '#0284c7',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          + New
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {files.length === 0 ? (
          <div style={{ padding: '20px 10px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
            No drawings saved yet.
          </div>
        ) : (
          files.map((file) => {
            const isSelected = file.id === currentFileId;
            const displayName = stripExcalidrawExtension(file.name);

            return (
              <div
                key={file.id}
                onClick={() => onSelectFile(file.id)}
                style={{
                  padding: '8px 10px',
                  marginBottom: '4px',
                  borderRadius: '6px',
                  backgroundColor: isSelected ? '#e0f2fe' : 'transparent',
                  border: isSelected ? '1px solid #bae6fd' : '1px solid transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '6px',
                }}
              >
                {editingId === file.id ? (
                  <input
                    type="text"
                    value={editName}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => submitRename(file.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename(file.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    style={{
                      fontSize: '13px',
                      padding: '2px 4px',
                      width: '130px',
                      border: '1px solid #94a3b8',
                      borderRadius: '3px',
                    }}
                  />
                ) : (
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: isSelected ? 600 : 400, color: '#1e293b' }}>
                      {displayName}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {new Date(file.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={(e) => startRename(file, e)}
                    title="Rename"
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: '12px',
                      padding: '2px',
                      color: '#64748b',
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={(e) => handleDelete(file, e)}
                    title="Delete"
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: '12px',
                      padding: '2px',
                      color: '#ef4444',
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};

export default FileSidebar;
